const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const sync = require('node:fs')
const { join } = require('node:path')
const { tmpdir } = require('node:os')
const adapter = require('./android-flock.cjs')

test('Attachment publication preserves source, refuses collisions and removes temporary files', async () => {
  const dir = await fs.mkdtemp(join(tmpdir(), 'dsha-copy-test-'))
  const oldDlopen = process.dlopen
  const oldLibrary = process.env.DSH_ANDROID_FLOCK_LIBRARY
  process.env.DSH_ANDROID_FLOCK_LIBRARY = 'test-native'
  process.dlopen = mod => { mod.exports = { publishNew: (a, b) => {
    if (sync.existsSync(b)) return -[...require('node:util').getSystemErrorMap()].find(([,value]) => value[0] === 'EEXIST')[0]
    sync.renameSync(a, b); return 0
  } } }
  try {
    const source = join(dir, 'source'), dest = join(dir, 'dest')
    await fs.writeFile(source, '图片数据')
    await adapter.publishCopyNew(source, dest)
    assert.equal(await fs.readFile(source, 'utf8'), '图片数据')
    assert.equal(await fs.readFile(dest, 'utf8'), '图片数据')
    await fs.writeFile(source, 'new')
    await assert.rejects(adapter.publishCopyNew(source, dest), { code: 'EEXIST' })
    assert.equal(await fs.readFile(dest, 'utf8'), '图片数据')
    assert.deepEqual((await fs.readdir(dir)).sort(), ['dest', 'source'])
    assert.equal(await adapter.durableBoundary(dir, dir), dir)
    await assert.rejects(adapter.durableBoundary(tmpdir(), dir), /outside Android/)
  } finally {
    process.dlopen = oldDlopen
    if (oldLibrary === undefined) delete process.env.DSH_ANDROID_FLOCK_LIBRARY
    else process.env.DSH_ANDROID_FLOCK_LIBRARY = oldLibrary
    await fs.rm(dir, { recursive: true, force: true })
  }
})
