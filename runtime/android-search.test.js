import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runSearch, apply } from './android-search.js'
import policy from './android-plugin-policy.cjs'
const target = path => ({ targetKey: path, displayPath: path })
const files = { '/work/a.js': '中文 hello\nvalue=42\n', '/work/sub/b.js': 'hello world', '/work/.hidden': 'hello', '/work/b.bin': '\0', '/work/large': 'x' }
const fs = {
  resolve: async (path, options) => { assert.equal(options.cwd, '/work'); return target(path === '.' ? '/work' : path.startsWith('/') ? path : '/work/' + path) },
  stat: async t => ({ type: files[t.displayPath] === undefined ? 'directory' : 'file', size: files[t.displayPath]?.length }),
  contains: (root, t) => t.displayPath.startsWith(root.displayPath + '/'),
  listDir: async t => t.displayPath === '/work/sub' ? [{ name: 'b.js', type: 'file', size: 32, target: target('/work/sub/b.js') }] : [
    ...['a.js', '.hidden', 'b.bin', 'large'].map(name => ({ name, type: 'file', size: name === 'large' ? 999999 : 32, target: target('/work/' + name) })),
    { name: 'sub', type: 'directory', target: target('/work/sub') },
    { name: 'escape', type: 'directory', target: target('/outside') },
  ],
  readBytes: async t => Buffer.from(files[t.displayPath]),
}
const exec = { agent: { session: { header: { cwd: '/work' } } }, signal: new AbortController().signal }
test('Android glob supports recursive, basename, braces and hidden files without outside traversal', async () => {
  assert.deepEqual((await runSearch(fs, { pattern: '**/*.js' }, exec, false)).paths, ['/work/a.js', '/work/sub/b.js'])
  assert.equal((await runSearch(fs, { pattern: '*.{js,txt}' }, exec, false)).paths.length, 2)
  assert.ok((await runSearch(fs, { pattern: '*' }, exec, false)).paths.includes('/work/.hidden'))
  await assert.rejects(runSearch(fs, { pattern: '{1..99999999}' }, exec, false), /SEARCH_INVALID_PATTERN/)
  await assert.rejects(runSearch(fs, { pattern: '{a,b}'.repeat(9) }, exec, false), /too many brace/)
})
test('Android grep supports regex, include, single-file paths and reports skipped files', async () => {
  const result = await runSearch(fs, { pattern: '中文|value=\\d+', include: '*.js' }, exec, true)
  assert.deepEqual(result.matches.map(m => m.lineNumber), [1, 2])
  assert.equal((await runSearch(fs, { path: 'a.js', pattern: 'hello' }, exec, true)).matches.length, 1)
  assert.equal((await runSearch(fs, { pattern: 'hello' }, exec, true)).skipped, 3)
  await assert.rejects(runSearch(fs, { pattern: '[' }, exec, true), /SEARCH_INVALID_PATTERN/)
  await assert.rejects(runSearch(fs, { pattern: 'x' }, { ...exec, signal: AbortSignal.abort() }, true), { name: 'AbortError' })
})
test('regex worker terminates pathological expressions', async () => {
  const evil = { ...fs, readBytes: async () => Buffer.from('a'.repeat(10000) + '!') }
  await assert.rejects(runSearch(evil, { path: 'a.js', pattern: '(a+)+$' }, exec, true), /SEARCH_TIMEOUT/)
})
test('tool registration retains glob and grep names', () => {
  const tools = []
  apply({ tools: { register: tool => tools.push(tool.name) } })
  assert.deepEqual(tools, ['glob', 'grep'])
})
test('all preset compositions receive filesystem/search/device tools and remove unavailable shells', () => {
  for (const id of ['android', 'standard', 'ptc', 'minimal', 'custom']) {
    const original = { name: '@deepseek-ai/dsh-agent-preset', config: { id, plugins: [{ name: '@deepseek-ai/dsh-tool-pwsh' }, { name: '@deepseek-ai/dsh-tool-fs-search' }] } }
    const result = policy.normalizeEntry(original)
    assert.equal(original.config.plugins.length, 2)
    assert.equal(result.config.plugins.length, 3)
    assert.deepEqual(policy.normalizeEntry(result), result)
    assert.ok(result.config.plugins.some(p => p.name.endsWith('/android-tools.js')))
    assert.ok(!result.config.plugins.some(p => p.name.endsWith('dsh-tool-pwsh')))
  }
  assert.equal(policy.normalizeEntry({ name: '@deepseek-ai/dsh-office-to-pdf' }).disabled, true)
  // permissionPresets depends on the confining shell service, even with the
  // desktop Bash tool removed. Keep the capability service mounted.
  assert.equal(policy.normalizeEntry({ name: '@deepseek-ai/dsh-bash-sandbox' }).disabled, undefined)
  assert.equal(policy.normalizeEntry({ name: '@deepseek-ai/dsh-tool-bash' }).disabled, true)
})
