import { test } from 'node:test'
import assert from 'node:assert/strict'
import { scalePoint, visionDimensions } from './android-coordinate-scale.js'

test('visionDimensions downscales a tall phone screenshot for DeepSeek vision', () => {
  const vision = visionDimensions(1080, 2400)
  assert.ok(vision.width < 1080)
  assert.ok(vision.height < 2400)
  assert.equal(Math.round(vision.width * 2400 / 1080), vision.height)
})

test('scalePoint maps read_image vision coordinates onto device pixels', () => {
  const device = { width: 1080, height: 2400 }
  const vision = visionDimensions(device.width, device.height)
  const center = scalePoint(Math.round(vision.width / 2), Math.round(vision.height / 2), device, vision)
  assert.equal(center.x, 540)
  assert.equal(center.y, 1200)
})

test('scalePoint leaves coordinates unchanged when they already exceed vision bounds', () => {
  const device = { width: 1080, height: 2400 }
  const vision = visionDimensions(device.width, device.height)
  assert.deepEqual(scalePoint(900, 2000, device, vision), { x: 900, y: 2000 })
})
