import { test } from 'node:test'
import assert from 'node:assert/strict'
import { search } from './android-fs-search.js'

const target = path => ({ displayPath: path, targetKey: path })
const entry = (path, type = 'file', size = 32) => ({ name: path.split('/').pop(), type, size, target: target(path) })
const exec = { signal: new AbortController().signal, agent: { session: { header: { cwd: '/work' } } } }
const fs = {
  resolve: async (path, options) => { assert.equal(options.cwd, '/work'); return target('/work') },
  listDir: async dir => dir.targetKey === '/work'
    ? [entry('/work/a.txt'), entry('/work/b.bin'), entry('/work/large.txt', 'file', 999999), entry('/work/sub', 'directory')]
    : [entry('/work/sub/c.txt'), { ...entry('/work/sub/loop', 'directory'), target: target('/work') }],
  readBytes: async file => file.displayPath.endsWith('.bin') ? Buffer.from([0, 1]) : Buffer.from('中文 search\nneedle\n'),
}

test('Android searches Unicode literal text with line numbers, skips binary/large files and stops directory cycles', async () => {
  const result = JSON.parse(await search(fs, { query: '中文' }, exec, true))
  assert.deepEqual(result.matches, ['/work/a.txt:1: 中文 search', '/work/sub/c.txt:1: 中文 search'])
  assert.equal(result.skipped, 2)
  assert.equal(result.truncated, false)
})
test('Filename search uses literal matching and reports result cap', async () => {
  const many = { ...fs, listDir: async () => Array.from({ length: 200 }, (_, i) => entry(`/work/${i}.txt`)) }
  const result = JSON.parse(await search(many, { query: '.txt' }, exec, false))
  assert.equal(result.matches.length, 100)
  assert.equal(result.truncated, true)
})
test('Cancellation and root permission errors propagate', async () => {
  const controller = new AbortController(); controller.abort()
  await assert.rejects(search(fs, { query: 'needle' }, { ...exec, signal: controller.signal }, true), { name: 'AbortError' })
  await assert.rejects(search({ ...fs, listDir: async () => { throw new Error('denied') } }, { query: 'needle' }, exec, true), /denied/)
})
