import { test } from 'node:test'
import assert from 'node:assert/strict'
import { apply } from './index.js'

test('Android settings requires authentication, same-origin writes and valid switches', async () => {
  let route
  let authorized = false
  const calls = []
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (_url, options) => {
    calls.push(JSON.parse(options.body))
    return { ok: true, json: async () => ({ controlEnabled: false }) }
  }
  apply({
    effect: (fn) => fn(),
    webServer: { register: (value) => { route = value; return () => {} } },
    connection: { authorizeIndex: (_req, res) => { if (!authorized) res.writeHead(401); return authorized } },
  })
  async function request(method, body, origin = 'http://127.0.0.1:3080') {
    const response = { status: 200, setHeader() {}, writeHead(status) { this.status = status }, end(body) { this.body = body } }
    await route.handler({
      method, headers: { host: '127.0.0.1:3080', origin },
      async *[Symbol.asyncIterator]() { yield Buffer.from(JSON.stringify(body)) },
    }, response)
    return response
  }
  try {
    assert.equal((await request('GET')).status, 401)
    assert.equal(calls.length, 0)
    authorized = true
    assert.equal((await request('POST', { method: 'updateAndroidSettings' }, 'https://example.com')).status, 403)
    assert.equal((await request('POST', { method: 'shell' })).status, 400)
    assert.equal((await request('POST', { method: 'updateAndroidSettings', controlEnabled: 'true' })).status, 400)
    assert.equal(calls.length, 0)
    assert.equal((await request('POST', { method: 'updateAndroidSettings', controlEnabled: false, ignored: 'value' })).status, 200)
    assert.deepEqual(calls[0], { method: 'updateAndroidSettings', controlEnabled: false })
    assert.equal((await request('GET')).status, 200)
    assert.deepEqual(calls[1], { method: 'androidSettings' })
  } finally { globalThis.fetch = originalFetch }
})
