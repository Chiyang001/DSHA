import { createRequire } from 'node:module'
import { Worker } from 'node:worker_threads'
import { relative, isAbsolute } from 'node:path'
import { defineTool } from '@deepseek-ai/dsh-tools'
const require = createRequire(new URL('./node_modules/npm/package.json', import.meta.url))
const { Minimatch } = require('./node_modules/minimatch')
export const name = 'android-search'
export const inject = ['tools', 'fs']

function glob(pattern) {
  if (typeof pattern !== 'string' || !pattern || pattern.length > 1024) throw new Error('SEARCH_INVALID_PATTERN: pattern must contain 1–1024 characters')
  let start = -1, expansions = 1
  for (let i = 0; i < pattern.length; i++) {
    if (pattern[i] === '\\') { i++; continue }
    if (pattern[i] === '{') {
      if (start !== -1) throw new Error('SEARCH_INVALID_PATTERN: nested brace expansion is unsupported')
      start = i
    } else if (pattern[i] === '}' && start !== -1) {
      const body = pattern.slice(start + 1, i)
      if (body.includes('..')) throw new Error('SEARCH_INVALID_PATTERN: brace ranges are unsupported')
      expansions *= body.split(',').length
      if (expansions > 128) throw new Error('SEARCH_INVALID_PATTERN: too many brace expansions')
      start = -1
    }
  }
  return new Minimatch(pattern, { dot: true, matchBase: true, nocomment: true, nonegate: true })
}

// Regex evaluation never runs on the host event loop. Termination bounds even
// catastrophic JavaScript expressions, without relying on shell binaries.
function regexLines(pattern, signal) {
  if (typeof pattern !== 'string' || !pattern || pattern.length > 1024) throw new Error('SEARCH_INVALID_PATTERN: invalid pattern length')
  const worker = new Worker(`
    const {parentPort,workerData}=require('node:worker_threads');
    let regex;try{regex=new RegExp(workerData,'u');parentPort.postMessage({ready:true})}
    catch(e){parentPort.postMessage({error:'SEARCH_INVALID_PATTERN: '+e.message})}
    parentPort.on('message',({text,limit})=>{const matches=[];const lines=text.split('\\n');
      for(let i=0;i<lines.length;i++)if(regex.test(lines[i])){matches.push({lineNumber:i+1,line:lines[i].slice(0,2000)});if(matches.length>=limit)break}
      parentPort.postMessage({matches})});
  `, { eval: true, workerData: pattern })
  let pending
  const fail = error => { pending?.reject(error); pending = undefined }
  worker.on('message', value => { const current = pending; pending = undefined; value.error ? current?.reject(new Error(value.error)) : current?.resolve(value) })
  worker.on('error', fail)
  worker.on('exit', code => { if (pending) fail(new Error(`SEARCH_FAILED: regex worker exited ${code}`)) })
  const abort = () => { fail(signal.reason || new Error('Search aborted')); void worker.terminate() }
  signal?.addEventListener('abort', abort, { once: true })
  const request = send => new Promise((resolve, reject) => {
    signal?.throwIfAborted()
    const timer = setTimeout(() => { fail(new Error('SEARCH_TIMEOUT: regex evaluation exceeded 2 seconds')); void worker.terminate() }, 2000)
    pending = { resolve: value => { clearTimeout(timer); resolve(value) }, reject: error => { clearTimeout(timer); reject(error) } }
    if (send) worker.postMessage(send)
  })
  const ready = request()
  return { ready, async match(text, limit) { await ready; return (await request({ text, limit })).matches }, async close() { signal?.removeEventListener('abort', abort); await worker.terminate() } }
}

export async function runSearch(fs, args, exec, contents) {
  exec.signal?.throwIfAborted()
  const matcher = contents ? null : glob(args.pattern)
  const include = args.include ? glob(args.include) : null
  // Claim parse failures immediately, including an empty directory search.
  const root = await fs.resolve(args.path || '.', { cwd: exec.agent?.session.header.cwd, signal: exec.signal })
  const regex = contents ? regexLines(args.pattern, exec.signal) : null
  const paths = [], matches = [], visited = new Set(), pending = [root]
  let scanned = 0, skipped = 0, bytes = 0, truncated = false
  const deadline = Date.now() + 10000
  try {
    if (regex) await regex.ready
    while (pending.length && !truncated) {
      exec.signal?.throwIfAborted()
      const target = pending.pop()
      if (visited.has(target.targetKey)) continue
      visited.add(target.targetKey)
      const info = await fs.stat(target, exec.signal)
      if (!info) { if (target === root) throw new Error('SEARCH_FAILED: search path does not exist'); skipped++; continue }
      let entries
      if (info.type === 'file') entries = [{ ...info, target, name: target.displayPath.split('/').pop() }]
      else if (info.type === 'directory') {
        try { entries = await fs.listDir(target, exec.signal) }
        catch (error) { exec.signal?.throwIfAborted(); if (target === root) throw error; skipped++; continue }
      } else { skipped++; continue }
      for (const entry of entries) {
        exec.signal?.throwIfAborted()
        if (++scanned > 5000 || bytes >= 8 * 1024 * 1024 || Date.now() > deadline) { truncated = true; break }
        // Targets are realpath-derived: do not follow links outside the search root.
        if (info.type === 'directory' && !fs.contains(root, entry.target)) { skipped++; continue }
        if (entry.type === 'directory') { pending.push(entry.target); continue }
        if (entry.type !== 'file') continue
        const display = info.type === 'file' && target === root ? entry.name : relative(root.displayPath, entry.target.displayPath).replaceAll('\\', '/')
        if (isAbsolute(display) || display.startsWith('../')) { skipped++; continue }
        if (!contents) { if (matcher.match(display)) paths.push(entry.target.displayPath) }
        else if (!include || include.match(display)) {
          if (entry.size === undefined || entry.size > 256 * 1024) { skipped++; continue }
          let text
          try {
            const data = await fs.readBytes(entry.target, exec.signal, 256 * 1024)
            bytes += data.byteLength
            if (data.includes(0)) { skipped++; continue }
            text = new TextDecoder('utf-8', { fatal: true }).decode(data)
          } catch (error) { exec.signal?.throwIfAborted(); skipped++; continue }
          for (const match of await regex.match(text, 100 - matches.length)) matches.push({ path: entry.target.displayPath, ...match })
        }
        if (paths.length >= 100 || matches.length >= 100) { truncated = true; break }
      }
    }
    if (regex) await regex.match('', 1)
    return { root: root.displayPath, ...(contents ? { matches } : { paths }), scanned, skipped, truncated }
  } finally { await regex?.close() }
}

export function apply(ctx) {
  for (const contents of [false, true]) ctx.tools.register(defineTool({
    name: contents ? 'grep' : 'glob',
    description: contents ? 'Search UTF-8 files using JavaScript Unicode regular expressions, with optional include glob. No ripgrep binary needed. Returns paths, line numbers and text; skips binary and files over 256 KiB.' : 'Find files by glob, including hidden files; basename patterns match at any depth. No external binary needed.',
    parameters: { pattern: { type: 'string', required: true, description: contents ? 'JavaScript regex (not all ripgrep extensions are supported)' : 'Glob such as **/*.js or *.txt' }, path: { type: 'string', description: 'Search root; defaults to current session workspace' }, ...(contents ? { include: { type: 'string', description: 'Optional filename glob' } } : {}) },
    output: { schema: { type: 'object', additionalProperties: true }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
    execute: (args, exec) => runSearch(ctx.fs, args, exec, contents),
  }))
}
