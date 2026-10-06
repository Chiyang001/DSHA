import { test } from 'node:test'
import assert from 'node:assert/strict'
import { gridCellCenter, mergeScreenTargets, ocrToElements } from './android-screen-targets.js'

const UI_XML = `<?xml version="1.0" encoding="UTF-8"?>
<hierarchy rotation="0">
  <node index="0" text="" class="android.widget.FrameLayout" package="com.example" content-desc="" clickable="false" enabled="true" focusable="false" scrollable="false" bounds="[0,0][1080,2400]">
    <node index="1" text="设置" resource-id="com.example:id/settings" class="android.widget.TextView" package="com.example" content-desc="" clickable="true" enabled="true" focusable="true" scrollable="false" bounds="[100,200][300,280]" />
  </node>
</hierarchy>`

test('mergeScreenTargets keeps OCR lines missing from accessibility', () => {
  const merged = mergeScreenTargets(UI_XML, [
    { text: 'MT管理器', left: 120, top: 500, right: 420, bottom: 560 },
    { text: '复制', left: 700, top: 900, right: 820, bottom: 960 },
  ])
  assert.ok(merged.some((node) => node.source === 'accessibility' && node.text === '设置'))
  assert.ok(merged.some((node) => node.source === 'ocr' && node.text === 'MT管理器'))
  assert.ok(merged.some((node) => node.source === 'ocr' && node.text === '复制'))
})

test('ocrToElements computes tap centers from OCR bounds', () => {
  const [item] = ocrToElements([{ text: '删除', left: 100, top: 200, right: 180, bottom: 240 }])
  assert.equal(item.tapX, 140)
  assert.equal(item.tapY, 220)
})

test('gridCellCenter maps grid coordinates to screen pixels', () => {
  const point = gridCellCenter(1080, 2400, 6, 12)
  assert.equal(point.x, 585)
  assert.equal(point.y, 1250)
})
