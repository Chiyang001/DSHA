import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { EventEmitter } from 'node:events'
import { KernelUpdater } from './kernel-updater.js'

test('version checks use mirror latest and never downgrade a newer installed version', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dsh-updater-test-'))
  let version = '0.2.0-rc.2'
  let requested
  const updater = new KernelUpdater({ home, fetcher: async (url) => {
    requested = url
    return { ok: true, json: async () => ({ name: '@deepseek-ai/dsh', version }) }
  } })
  try {
    let status = await updater.check()
    assert.equal(requested, 'https://registry.npmmirror.com/@deepseek-ai%2Fdsh/latest')
    assert.equal(status.available, true)
    version = '0.1.0'
    status = await updater.check()
    assert.equal(status.available, false)
    await assert.rejects(updater.start(), /先检查更新/)
    version = 'invalid-version'
    status = await updater.check()
    assert.equal(status.phase, 'failed')
    assert.match(status.error, /无效版本/)
  } finally { await updater.flush(); await rm(home, { recursive: true, force: true }) }
})

test('installation is isolated, exposes progress, blocks concurrent work and can cancel', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dsh-updater-test-'))
  const fakeWorker = new EventEmitter()
  let workerData
  fakeWorker.terminate = async () => { fakeWorker.emit('exit', 1) }
  const options = { home, fetcher: async () => ({ ok: true, json: async () => ({ name: '@deepseek-ai/dsh', version: '0.2.0-rc.2' }) }), workerFactory: (data) => { workerData = data; return fakeWorker } }
  const updater = new KernelUpdater(options)
  try {
    await updater.check()
    const start = await updater.start()
    assert.equal(start.phase, 'resolve')
    assert.ok(workerData.stage.startsWith(join(home, 'kernels')))
    assert.notEqual(workerData.stage, updater.runtime)
    await assert.rejects(updater.start(), /已有更新/)
    await assert.rejects(updater.check(), /进行中/)
    await assert.rejects(updater.restart(), /尚未完成/)
    fakeWorker.emit('message', { phase: 'install', installed: 3, total: 10, package: 'example', log: '安装 example' })
    assert.equal(updater.snapshot().installed, 3)
    const cancelled = await updater.cancel()
    assert.equal(cancelled.phase, 'cancelled')
    assert.equal(updater.snapshot().currentVersion, start.currentVersion)
    const persisted = JSON.parse(await readFile(join(home, 'kernel-update.json'), 'utf8'))
    assert.equal(persisted.phase, 'cancelled')
    const restored = new KernelUpdater(options)
    await restored.initialized
    assert.equal(restored.snapshot().phase, 'cancelled')
    await restored.flush()
  } finally { await updater.flush(); await rm(home, { recursive: true, force: true }) }
})
