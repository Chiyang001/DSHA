import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, unlink, rmdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { observationContent } from './android-fast-screen.js'

test('phone tools block ineffective input, stale taps, unknown outcomes and runaway agent turns', async () => {
  const originalFetch = globalThis.fetch
  const originalToken = process.env.DSH_ANDROID_BRIDGE_TOKEN
  process.env.DSH_ANDROID_BRIDGE_TOKEN = 'test-only'
  const tools = new Map(), listeners = new Map(), calls = [], cancellations = []
  const folder = await mkdtemp(join(tmpdir(), 'dshan-fast-test-'))
  const viewPath = join(folder, 'view.png')
  await writeFile(viewPath, 'mock-image-bytes')
  let label = '设置', failTap = false
  const agent = { session: { id: 'test' }, cancel: cause => cancellations.push(cause) }
  const exec = { agent, signal: new AbortController().signal }
  globalThis.fetch = async (_url, options) => {
    const request = JSON.parse(options.body)
    calls.push(request)
    if (request.method === 'tap' && failTap) throw new Error('connection lost')
    const data = request.method === 'screen' ? {
      path: '/nonexistent-test-image.png', width: 1080, height: 2400, ocr: [],
      uiXml: `<hierarchy><node text="${label}" clickable="true" enabled="true" bounds="[100,200][300,280]" /></hierarchy>`,
    } : request.method === 'screenshot' ? {
      path: viewPath, viewPath, width: 1080, height: 2400,
      viewWidth: 567, viewHeight: 1260, rotation: 0, fingerprint: label,
    } : { ok: true, exitCode: 0, transport: 'shizuku', durationMs: 100, output: request.method === 'shell' ? 'diagnostic output' : '' }
    return { ok: true, json: async () => data }
  }
  try {
    const { apply } = await import(`./android-tools.js?loop-test=${Date.now()}`)
    apply({ get: () => ({ saveImage: async ({ data }) => {
      assert.equal(data.toString(), 'mock-image-bytes')
      return { attachmentId: 'a'.repeat(64), mediaType: 'image/png', bytes: data.length, width: 567, height: 1260 }
    } }), tools: { register: tool => tools.set(tool.name, tool) }, on: (name, listener, options) => {
      if (name === 'agent/pre-step' || name === 'agent/request-error') assert.equal(options.prepend, true)
      listeners.set(name, listener)
    } })
    const invoke = (name, args = {}) => tools.get(name).execute(args, exec)
    const countTaps = () => calls.filter(request => request.method === 'tap').length
    const first = await invoke('android_screenshot')
    assert.equal(observationContent(first)[1].type, 'image')
    const firstId = /snapshot_id=(.*)/.exec(first.text)[1]
    assert.match((await invoke('android_tap', { x: 100, y: 200 })).text, /NO_OBSERVED_CHANGE/)
    assert.deepEqual({ x: calls.find(request => request.method === 'tap').x, y: calls.find(request => request.method === 'tap').y }, { x: 190, y: 381 })
    await assert.rejects(invoke('android_tap', { x: 100, y: 200, snapshot_id: firstId }), /STALE_SNAPSHOT/)
    assert.match((await invoke('android_tap', { x: 100, y: 200 })).text, /NO_OBSERVED_CHANGE/)
    for (let i = 0; i < 3; i++) await assert.rejects(invoke('android_tap', { x: 100, y: 200 }), /ANDROID_LOOP_BLOCKED/)
    assert.equal(countTaps(), 2)
    assert.match(cancellations[0].reason, /重复尝试/)
    label = '新的页面'
    await invoke('android_screenshot')
    assert.equal(countTaps(), 2)
    failTap = true
    await assert.rejects(invoke('android_tap', { x: 100, y: 200 }), /ACTION_OUTCOME_UNKNOWN/)
    await invoke('android_screenshot')
    await assert.rejects(invoke('android_tap', { x: 100, y: 200 }), /ANDROID_LOOP_BLOCKED/)
    assert.equal(countTaps(), 3)
    failTap = false
    assert.match((await invoke('android_shell', { command: 'echo diagnostic' })).text, /diagnostic output/)
    const gesture = { x1: 200, y1: 1000, x2: 200, y2: 300 }
    await invoke('android_swipe', { ...gesture, duration: 300 })
    await invoke('android_swipe', { ...gesture, duration: 500 })
    await assert.rejects(invoke('android_swipe', { ...gesture, duration: 1000 }), /ANDROID_LOOP_BLOCKED/)
    assert.equal(calls.filter(request => request.method === 'screen').length, 0, 'fast workflow must never request XML/OCR')
    const other = { agent: { session: { id: 'other' } }, signal: exec.signal }
    await assert.rejects(tools.get('android_tap').execute({ x: 100, y: 200 }, other), /first/)
    await assert.rejects(invoke('android_screenshot', { crop_x: 0 }), /four crop fields/)
    const preStep = listeners.get('agent/pre-step')
    for (let i = 0; i < 60; i++) await preStep({ agent, turn: 1 }, async () => 'continue')
    await assert.rejects(preStep({ agent, turn: 1 }, async () => 'continue'), /ANDROID_STEP_LIMIT/)
    assert.equal(await preStep({ agent, turn: 2 }, async () => 'continue'), 'continue')
    const requestError = listeners.get('agent/request-error')
    let retryDelegations = 0
    const retry = () => { retryDelegations++; return 'retry' }
    for (let i = 0; i < 3; i++) await requestError({ agent, turn: 2, step: 0 }, retry)
    assert.equal(retryDelegations, 2)
    assert.match(cancellations.at(-1).reason, /连续失败 3 次/)
  } finally {
    await unlink(viewPath)
    await rmdir(folder)
    globalThis.fetch = originalFetch
    if (originalToken === undefined) delete process.env.DSH_ANDROID_BRIDGE_TOKEN
    else process.env.DSH_ANDROID_BRIDGE_TOKEN = originalToken
  }
})
