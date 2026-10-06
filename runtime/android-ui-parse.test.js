import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  elementByIndex,
  formatUiSummary,
  parseUiNodes,
  scrollGesture,
  scrollTarget,
  summarizeUi,
} from './android-ui-parse.js'

const SAMPLE = `<?xml version="1.0" encoding="UTF-8"?>
<hierarchy rotation="0">
  <node index="0" text="" resource-id="" class="android.widget.FrameLayout" package="com.example" content-desc="" clickable="false" enabled="true" focusable="false" scrollable="false" bounds="[0,0][1080,2400]">
    <node index="1" text="设置" resource-id="com.example:id/settings" class="android.widget.TextView" package="com.example" content-desc="" clickable="true" enabled="true" focusable="true" scrollable="false" bounds="[100,200][300,280]" />
    <node index="2" text="设置" resource-id="com.example:id/settings_row" class="android.widget.LinearLayout" package="com.example" content-desc="" clickable="true" enabled="true" focusable="true" scrollable="false" bounds="[80,180][340,320]" />
    <node index="3" text="" resource-id="com.example:id/list" class="android.widget.RecyclerView" package="com.example" content-desc="" clickable="false" enabled="true" focusable="false" scrollable="true" bounds="[0,400][1080,2200]" />
  </node>
</hierarchy>`

test('parseUiNodes extracts bounds and labels', () => {
  const nodes = parseUiNodes(SAMPLE)
  assert.equal(nodes.length, 4)
  assert.equal(nodes[1].text, '设置')
})

test('summarizeUi keeps leaf elements and assigns tap coordinates', () => {
  const elements = summarizeUi(SAMPLE)
  assert.equal(elements.length, 2)
  const settings = elements.find((node) => node.resourceId === 'com.example:id/settings')
  assert.equal(settings.tapX, 200)
  assert.equal(settings.tapY, 240)
  assert.ok(elements.some((node) => node.scrollable))
})

test('formatUiSummary tells the model to choose index only', () => {
  const summary = formatUiSummary(summarizeUi(SAMPLE))
  assert.match(summary, /#0 tap=\(200,240\)/)
  assert.match(summary, /android_tap_element\(\{ index: N \}\)/)
  assert.doesNotMatch(summary, /text, description, resource_id/)
})

test('scrollTarget resolves a numbered scrollable element', () => {
  const elements = summarizeUi(SAMPLE)
  const list = scrollTarget(elements, elements.find((node) => node.scrollable).index)
  const gesture = scrollGesture(list.bounds, 'up')
  assert.ok(gesture.y1 > gesture.y2)
})
