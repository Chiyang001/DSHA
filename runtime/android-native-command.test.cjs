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
      res.end(JSON.stringify({ ok: true }))
    })
  })
  await new Promise(resolve => server.listen(3981, '127.0.0.1', resolve))
  try {
    const { openNativeTextFile, canOpenNativePath } = require('./android-native-command.cjs')
    assert.equal(canOpenNativePath(), true)
    await openNativeTextFile('/data/local/tmp/settings.yml')
    assert.deepEqual(requests, [{ method: 'openTextFile', path: '/data/local/tmp/settings.yml' }])
  } finally {
    await new Promise(resolve => server.close(resolve))
    delete process.env.DSH_ANDROID_BRIDGE_TOKEN
  }
})
