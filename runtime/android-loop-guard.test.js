import { test } from 'node:test'
import assert from 'node:assert/strict'
import { AndroidLoopGuard, screenFingerprint } from './android-loop-guard.js'

test('blocks the third unchanged action even with observations between calls', () => {
  const guard = new AndroidLoopGuard()
  for (let i = 0; i < 2; i++) guard.finish(guard.begin('screen', 'tap'), 'screen')
  assert.throws(() => guard.begin('screen', 'tap'), /ANDROID_LOOP_BLOCKED/)
  assert.doesNotThrow(() => guard.begin('screen', 'different target'))
})

test('detects alternating screen/action cycles', () => {
  const guard = new AndroidLoopGuard()
  for (let i = 0; i < 3; i++) {
    guard.finish(guard.begin('A', 'open'), 'B')
    guard.finish(guard.begin('B', 'back'), 'A')
  }
  assert.throws(() => guard.begin('A', 'open'), /ANDROID_LOOP_BLOCKED/)
})

test('does not repeat input after a lost response or insufficient UI evidence', () => {
  const guard = new AndroidLoopGuard()
  guard.begin('A', 'submit')
  assert.throws(() => guard.begin('A', 'submit'), /ANDROID_LOOP_BLOCKED/)
  const entry = guard.begin(null, 'scroll')
  assert.equal(guard.finish(entry, null), 'unknown')
  assert.throws(() => guard.begin(null, 'scroll'), /ANDROID_LOOP_BLOCKED/)
})

test('legitimate scrolling with different visible targets is allowed', () => {
  const guard = new AndroidLoopGuard()
  for (let i = 0; i < 20; i++) guard.finish(guard.begin(`page${i}`, 'scroll'), `page${i + 1}`)
})

test('fingerprints ignore screenshot paths, timestamps and badge indices', () => {
  const snapshot = { width: 1080, height: 2400, elements: [{ text: '设置', bounds: '[0,0][100,100]', index: 0 }] }
  assert.equal(screenFingerprint(snapshot), screenFingerprint({ ...snapshot, at: 100, annotatedPath: 'another.png', elements: [{ ...snapshot.elements[0], index: 9 }] }))
  assert.notEqual(screenFingerprint(snapshot), screenFingerprint({ ...snapshot, elements: [{ text: '下一页' }] }))
  assert.equal(screenFingerprint({ ...snapshot, elements: [] }), null)
})
