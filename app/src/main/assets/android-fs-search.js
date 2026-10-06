import { defineTool } from '@deepseek-ai/dsh-tools'

export const name = 'android-fs-search'
export const inject = ['tools', 'fs']

// Use the same filesystem provider as read/write, preserving its path policy.
// Literal searches avoid unbounded regular-expression execution on the UI host.
export async function search(fs, args, exec, contents) {
  if (!args.query || args.query.length > 1024) throw new Error('query must contain 1 to 1024 characters')
  const root = await fs.resolve(args.path || '.', { cwd: exec.agent?.session.header.cwd, signal: exec.signal })
  const pending = [root]
  const visited = new Set()
  const matches = []
  let scanned = 0, skipped = 0, bytes = 0, truncated = false
  const deadline = Date.now() + 10000
  while (pending.length && !truncated) {
    exec.signal?.throwIfAborted()
    const dir = pending.pop()
    if (visited.has(dir.targetKey)) continue
    visited.add(dir.targetKey)
    let entries
    try { entries = await fs.listDir(dir, exec.signal) }
    catch (error) {
      exec.signal?.throwIfAborted()
      if (dir === root) throw error
      skipped++; continue
    }
    for (const entry of entries) {
      exec.signal?.throwIfAborted()
      if (++scanned > 5000 || Date.now() > deadline || bytes >= 8 * 1024 * 1024) { truncated = true; break }
      if (entry.type === 'directory') {
        if (!['.git', 'node_modules'].includes(entry.name)) pending.push(entry.target)
        continue
      }
      if (entry.type !== 'file') continue
      if (!contents) {
        if (entry.name.includes(args.query)) matches.push(entry.target.displayPath)
      } else {
        if (entry.size === undefined || entry.size > 256 * 1024) { skipped++; continue }
        let text
        try {
          const data = await fs.readBytes(entry.target, exec.signal, 256 * 1024)
          bytes += data.byteLength
          if (data.includes(0)) { skipped++; continue }
          text = new TextDecoder('utf-8', { fatal: true }).decode(data)
        } catch { exec.signal?.throwIfAborted(); skipped++; continue }
        const lines = text.split('\n')
        for (let i = 0; i < lines.length; i++) {
          if (lines[i].includes(args.query)) matches.push(`${entry.target.displayPath}:${i + 1}: ${lines[i].slice(0, 500)}`)
          if (matches.length >= 100) { truncated = true; break }
        }
      }
      if (matches.length >= 100) { truncated = true; break }
    }
  }
  return JSON.stringify({ matches, scanned, skipped, truncated })
}

export function apply(ctx) {
  for (const contents of [false, true]) ctx.tools.register(defineTool({
    name: contents ? 'android_search_text' : 'android_find_files',
    description: contents
      ? 'Search UTF-8 files recursively for literal text (case sensitive, no regex). Skips binary files and files over 256 KiB; limited to 5000 entries, 8 MiB, 10 seconds and 100 matches. Reports skipped and truncated results.'
      : 'Find files recursively whose name contains literal text (case sensitive, no glob). Skips .git and node_modules; limited to 5000 entries, 10 seconds and 100 matches.',
    parameters: {
      path: { type: 'string', description: 'Directory to search; defaults to session workspace' },
      query: { type: 'string', required: true, description: 'Literal text to find' },
    },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    execute: (args, exec) => search(ctx.fs, args, exec, contents),
  }))
}
