const { test } = require('node:test')
const assert = require('node:assert/strict')
const http = require('node:http')

test('Android native command opens text files through the bridge', async () => {
  process.env.DSH_ANDROID_BRIDGE_TOKEN = 'test-only'
  const requests = []
  const server = http.createServer((req, res) => {
    let body = ''
    req.on('data', chunk => { body += chunk })
    req.on('end', () => {
      requests.push(JSON.parse(body))
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ ok: true, applications: [{ id: 'reader/.Main', name: 'Reader', default: true, icon: null }] }))
    })
  })
  await new Promise(resolve => server.listen(3981, '127.0.0.1', resolve))
  try {
    const { openNativeTextFile, canOpenNativePath, openNativePath, openNativeAssociatedPath,
      nativeFileApplications, openNativeFileApplication } = require('./android-native-command.cjs')
    assert.equal(canOpenNativePath(), true)
    await openNativeTextFile('/data/local/tmp/settings.yml')
    assert.deepEqual(requests, [{ method: 'openTextFile', path: '/data/local/tmp/settings.yml' }])
    await openNativePath('/storage/emulated/0/report.pdf')
    await openNativeAssociatedPath('/storage/emulated/0/image.png')
    assert.equal((await nativeFileApplications('/storage/emulated/0/report.pdf'))[0].id, 'reader/.Main')
    await openNativeFileApplication('/storage/emulated/0/report.pdf', 'reader/.Main')
    assert.deepEqual(requests.slice(1), [
      { method: 'openFile', path: '/storage/emulated/0/report.pdf' },
      { method: 'openFile', path: '/storage/emulated/0/image.png' },
      { method: 'fileApplications', path: '/storage/emulated/0/report.pdf' },
      { method: 'openFile', path: '/storage/emulated/0/report.pdf', application: 'reader/.Main' },
    ])
    const count = requests.length
    await assert.rejects(openNativePath('relative.pdf'), /absolute Android/)
    await assert.rejects(openNativePath('/bad\0file'), /absolute Android/)
    await assert.rejects(openNativePath('/file', AbortSignal.abort()), { name: 'AbortError' })
    assert.equal(requests.length, count)
  } finally {
    await new Promise(resolve => server.close(resolve))
    delete process.env.DSH_ANDROID_BRIDGE_TOKEN
  }
})
