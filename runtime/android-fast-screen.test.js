import { test } from 'node:test'
import assert from 'node:assert/strict'
import { coordinatePoint, observationContent } from './android-fast-screen.js'

const screen = { width: 1080, height: 2400, imageWidth: 567, imageHeight: 1260 }
test('maps preview coordinates without guessing their space', () => {
  assert.deepEqual(coordinatePoint(283.5, 630, screen), { x: 540, y: 1200 })
  assert.deepEqual(coordinatePoint(500, 500, screen, 'normalized'), { x: 540, y: 1200 })
  assert.deepEqual(coordinatePoint(283, 630, screen, 'device'), { x: 283, y: 630 })
})
test('maps zoomed crop coordinates including offsets', () => {
  const crop = { ...screen, imageWidth: 1260, imageHeight: 630, crop: { left: 600, top: 800, width: 200, height: 100 } }
  assert.deepEqual(coordinatePoint(630, 315, crop), { x: 700, y: 850 })
})
test('rejects invalid coordinates and keeps normalized endpoints on screen', () => {
  for (const x of [-1, NaN, Infinity, 567]) assert.throws(() => coordinatePoint(x, 0, screen))
  assert.throws(() => coordinatePoint(1, 2, screen, 'guess'))
  assert.deepEqual(coordinatePoint(1000, 1000, screen, 'normalized'), { x: 1079, y: 2399 })
})
test('renders a durable image reference directly with explicit receipt', () => {
  const image = { attachmentId: 'test', mediaType: 'image/png', bytes: 10, width: 567, height: 1260 }
  assert.deepEqual(observationContent({ text: 'INPUT_SENT', image }), [{ type: 'text', text: 'INPUT_SENT' }, { type: 'image', attachment: image }])
  assert.deepEqual(observationContent({ text: 'Use read_image' }), [{ type: 'text', text: 'Use read_image' }])
})
