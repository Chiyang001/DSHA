import { test } from 'node:test'
import assert from 'node:assert/strict'

test('Android progress preserves event order and exposes tool name and completion without arguments', async () => {
  process.env.DSH_ANDROID_BRIDGE_TOKEN = 'test-only'
  const { apply } = await import('./android-tools.js')
  const original = globalThis.fetch
  const requests = []
  globalThis.fetch = async (_url, request) => {
    requests.push(JSON.parse(request.body))
    return { ok: true, json: async () => ({ ok: true }) }
  }
  try {
    let listener
    apply({ tools: {register() {}}, on(name, fn) { if (name === 'session/event') listener = fn } })
    const session = {id: 'test-session'}
    listener(session, {type:'turn/start',data:{}})
    listener(session, {type:'tool/call',data:{name:'android_tap',arguments:'private argument'}})
    listener(session, {type:'turn/end',data:{reason:{kind:'completed'}}})
    await new Promise(resolve => setImmediate(resolve))
    assert.deepEqual(requests.map(r=>[r.text,r.active]), [['开始处理任务',true],['正在执行 android_tap',true],['任务结束（completed）',false]])
    assert.ok(requests.every(r=>r.session==='test-session' && !JSON.stringify(r).includes('private argument')))
  } finally { globalThis.fetch=original; delete process.env.DSH_ANDROID_BRIDGE_TOKEN }
})
