// For a temporary debug bootstrap only. Does not read user files or call APIs.
if (require('node:worker_threads').isMainThread) {
require('node:module').registerHooks({
  load(url, context, nextLoad) {
    const loaded = nextLoad(url, context)
    if (!url.includes('/@deepseek-ai/dsh-llm-deepseek/lib/') || loaded.format !== 'module') return loaded
    const source = typeof loaded.source === 'string' ? loaded.source : Buffer.from(loaded.source).toString('utf8')
    return { ...loaded, source: source.replaceAll('throw new LlmError("DeepSeek Messages transport failed", "TRANSPORT", { cause: error });',
      'console.error("ANDROID_TRANSPORT_CAUSE", error); throw new LlmError("DeepSeek Messages transport failed", "TRANSPORT", { cause: error });') }
  },
})
;(async () => {
  const assert = require('node:assert/strict')
  const fs = require('node:fs/promises')
  const path = require('node:path')
  const { tryLockExclusive } = await import('@deepseek-ai/node-addon-system/flock')
  require('node:dns').lookup('api.deepseek.com', { all: true }, (error, addresses) => {
    if (error) console.error('ANDROID_DNS_SMOKE_FAILED', error.code)
    else console.log('ANDROID_DNS_SMOKE_OK', addresses.length)
  })
  const { publishNew } = require(path.join(__dirname, 'android-flock.cjs'))
  const dir = await fs.mkdtemp(path.join(require('node:os').tmpdir(), 'dshan-native-test-'))
  let first, second
  try {
    first = await fs.open(path.join(dir, 'lock'), 'w')
    second = await fs.open(path.join(dir, 'lock'), 'w')
    await tryLockExclusive(first.fd)
    await assert.rejects(tryLockExclusive(second.fd), e => ['EAGAIN', 'EWOULDBLOCK'].includes(e.code))
    await first.close(); first = undefined
    await tryLockExclusive(second.fd)
    await assert.rejects(tryLockExclusive(2147483647), { code: 'EBADF' })
    const source = path.join(dir, 'source'), destination = path.join(dir, 'dest')
    await fs.writeFile(source, 'complete 中文')
    await publishNew(source, destination)
    assert.equal(await fs.readFile(destination, 'utf8'), 'complete 中文')
    await fs.writeFile(source, 'must not overwrite')
    await assert.rejects(publishNew(source, destination), { code: 'EEXIST' })
    assert.equal(await fs.readFile(destination, 'utf8'), 'complete 中文')
    assert.equal(await fs.readFile(source, 'utf8'), 'must not overwrite')
    console.log('ANDROID_NATIVE_SMOKE_OK: ESM flock, contention, close/relock, EBADF, atomic publish, EEXIST preservation')
    const { LocalFileSystem } = await import('@deepseek-ai/dsh-fs-local')
    const provider = Object.assign(Object.create(LocalFileSystem.prototype), {
      config: { cwd: dir, diffBasisMaxBytes: 65536 }, internals: {}, locks: new Map(),
    })
    const signal = new AbortController().signal
    const target = await provider.resolve('test.txt')
    const written = await provider.writeText(target, 'DSHAN_FILE_SMOKE_v1 中文', { kind: 'createIfAbsent' }, signal)
    assert.equal(await provider.readText(target, signal), 'DSHAN_FILE_SMOKE_v1 中文')
    await provider.editText(target, { oldString: 'v1', newString: 'v2', replaceAll: false }, { kind: 'replaceIfVersion', version: written.version }, signal)
    assert.equal(await provider.readText(target, signal), 'DSHAN_FILE_SMOKE_v2 中文')
    const { search } = await import(require('node:url').pathToFileURL(path.join(__dirname, 'android-fs-search.js')))
    const exec = { signal, agent: { session: { header: { cwd: dir } } } }
    assert.equal(JSON.parse(await search(provider, { query: 'test.txt' }, exec, false)).matches.length, 1)
    assert.equal(JSON.parse(await search(provider, { query: 'v2 中文' }, exec, true)).matches.length, 1)
    console.log('ANDROID_FS_SMOKE_OK: guarded create, read, edit, filename search, Unicode content search')
    const tools = new Map()
    const { apply } = await import(require('node:url').pathToFileURL(path.join(__dirname, 'android-tools.js')))
    apply({ tools: { register: tool => tools.set(tool.name, tool) } })
    const status = JSON.parse(await tools.get('android_status').execute({}, exec))
    console.log('ANDROID_BRIDGE_STATUS', JSON.stringify(status))
    if (status.connected && status.controlEnabled) {
      const xml = await tools.get('android_ui').execute({}, exec)
      assert.ok(xml.includes('<hierarchy'))
      const shot = await tools.get('android_screenshot').execute({}, exec)
      const bytes = await fs.readFile(shot)
      assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a')
      console.log('ANDROID_BRIDGE_SMOKE_OK: UI hierarchy and PNG screenshot')
      const { saveImageFile, readImageFile } = await import('@deepseek-ai/dsh-attachment-local')
      const imageRoot = path.join(dir, 'attachments', 'v1')
      const ref = await saveImageFile(imageRoot, { data: bytes, mediaType: 'image/png', name: 'test.png' },
        { maxImageBytes: 20971520, maxImagePixels: 64000000, maxImageDimension: 8192 },
        { maxPixels: 4194304, maxDimension: 8192, maxBytes: 4194304 })
      await readImageFile(imageRoot, ref, signal)
      console.log('ANDROID_IMAGE_SMOKE_OK: WASM decode/normalize, atomic attachment publication, image readback')
      if (status.shellEnabled) {
        assert.equal(await tools.get('android_shell').execute({ command: 'printf DSHAN_ANDROID_SMOKE' }, exec), 'DSHAN_ANDROID_SMOKE')
        console.log('ANDROID_SHELL_SMOKE_OK')
      }
      // At the upper-left edge; these do not target any app control or text.
      await tools.get('android_tap').execute({ x: 0, y: 0 }, exec)
      await tools.get('android_swipe').execute({ x1: 0, y1: 0, x2: 0, y2: 0, duration: 1 }, exec)
      await tools.get('android_key').execute({ keycode: 0 }, exec)
      console.log('ANDROID_INPUT_SMOKE_OK: tap/swipe/key dispatch (Unicode input tested separately using a disposable focused field)')
    }
  } finally {
    await first?.close(); await second?.close()
    await fs.rm(dir, { recursive: true, force: true })
  }
})().catch(error => console.error('ANDROID_NATIVE_SMOKE_FAILED', error))
}
