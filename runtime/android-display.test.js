import { test } from 'node:test'
import assert from 'node:assert/strict'

test('secondary display selection routes every input and rejects vanished or mismatched displays', async () => {
  const savedFetch = globalThis.fetch, savedToken = process.env.DSH_ANDROID_BRIDGE_TOKEN
  process.env.DSH_ANDROID_BRIDGE_TOKEN = 'display-test'
  const calls = [], tools = new Map()
  let vanished = false, mismatch = false
  globalThis.fetch = async (_url, options) => {
    const request = JSON.parse(options.body); calls.push(request)
    if (request.displayId === 7 && vanished) return { ok: false, json: async () => ({ error: 'DISPLAY_UNAVAILABLE' }) }
    const result = request.method === 'displays' ? { displays: [{ displayId: 0 }, { displayId: 7 }] }
      : request.method === 'screenshot' ? { path: '/test-screen.png', width: 800, height: 600, rotation: 1,
        displayId: mismatch ? 0 : request.displayId, fingerprint: String(calls.length) }
      : { ok: true, exitCode: 0, displayId: request.displayId, output: '' }
    return { ok: true, json: async () => result }
  }
  try {
    const { apply } = await import('./android-tools.js?display-test')
    apply({ tools: { register: tool => tools.set(tool.name, tool) }, on() {} })
    const session = {}, exec = { agent: { session }, signal: new AbortController().signal }
    const invoke = (name, args = {}, execution = exec) => tools.get(name).execute(args, execution)
    await assert.rejects(invoke('android_select_display', { display_id: 1 }), /UNAVAILABLE/)
    await invoke('android_select_display', { display_id: 7 })
    await assert.rejects(invoke('android_tap', { x: 10, y: 20 }), /first/)
    await invoke('android_screenshot')
    for (const [name, args, method] of [
      ['android_tap', { x: 10, y: 20 }, 'tap'],
      ['android_swipe', { x1: 10, y1: 20, x2: 30, y2: 40 }, 'swipe'],
      ['android_key', { keycode: 4 }, 'key'],
      ['android_text', { text: 'test' }, 'text'],
      ['android_launch_app', { package: 'com.android.settings' }, 'launch'],
    ]) {
      await invoke(name, args)
      assert.equal(calls.filter(call => call.method === method).at(-1).displayId, 7)
    }
    const before = calls.length
    await assert.rejects(invoke('android_shell', { command: 'am start -a test' }), /arbitrary shell is disabled/)
    await assert.rejects(invoke('android_screen'), /Secondary display/)
    assert.equal(calls.length, before)
    mismatch = true
    await assert.rejects(invoke('android_screenshot'), /DISPLAY_MISMATCH/)
    mismatch = false; vanished = true
    await assert.rejects(invoke('android_screenshot'), /DISPLAY_UNAVAILABLE/)
    assert.equal(calls.at(-1).displayId, 7, 'missing display must not trigger a main-screen fallback')
    vanished = false
    const nextAgent = { agent: { session }, signal: exec.signal }
    await invoke('android_screenshot', {}, nextAgent)
    assert.equal(calls.at(-1).displayId, 7, 'selection survives agent changes in the same session')
    const other = { agent: { session: {} }, signal: exec.signal }
    await invoke('android_screenshot', {}, other)
    assert.equal(calls.at(-1).displayId, 0, 'other conversations do not inherit the secondary screen')
    await invoke('android_select_display', { display_id: 0 })
    await invoke('android_screenshot')
    assert.equal(calls.at(-1).displayId, 0)
  } finally {
    globalThis.fetch = savedFetch
    if (savedToken === undefined) delete process.env.DSH_ANDROID_BRIDGE_TOKEN
    else process.env.DSH_ANDROID_BRIDGE_TOKEN = savedToken
  }
})
