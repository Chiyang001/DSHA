import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ANDROID_UI_CSS, MOBILE_CSS, ANDROID_MOBILE_SCRIPT } from './android-host.js'

/** Minimal DOM stub that records class writes and registered listeners. */
function createShell({
  width = 390,
  framePresent = true,
  sidebarPresent = false,
  sidebarCollapsed = false,
  androidShell = false,
} = {}) {
  const state = { classes: new Set(), listeners: [], observers: [], attrs: new Set() }
  if (sidebarCollapsed) state.attrs.add('data-sidebar-collapsed')
  const settingsArea = { nodeType: 1, className: 'hHd-Xa_settingsArea' }
  const footArea = sidebarPresent ? {
    nodeType: 1,
    children: [settingsArea],
    querySelector: (selector) => {
      if (selector === '.hHd-Xa_settingsArea') return settingsArea
      if (selector === '.dsh-android-collapse-sidebar') {
        return footArea.children.find((child) => child.className === 'dsh-android-collapse-sidebar') ?? null
      }
      return null
    },
    insertBefore(node, before) {
      const index = footArea.children.indexOf(before)
      footArea.children.splice(index, 0, node)
    },
  } : null
  const frame = framePresent ? {
    nodeType: 1,
    hasAttribute: (name) => state.attrs.has(name),
    setAttribute(name) { state.attrs.add(name) },
    removeAttribute(name) { state.attrs.delete(name) },
    querySelector: (selector) => (selector === '.hHd-Xa_toggle' ? { click: () => {
      state.toggles = (state.toggles ?? 0) + 1
      state.attrs.add('data-sidebar-collapsed')
    } } : null),
  } : null
  const root = {
    nodeType: 1,
    classList: {
      add: (name) => state.classes.add(name),
      remove: (name) => state.classes.delete(name),
      contains: (name) => state.classes.has(name),
    },
  }
  root.appendChild = () => {}
  root.remove = () => {}
  globalThis.document = {
    documentElement: root,
    body: root,
    querySelector: (selector) => {
      if (selector === '.hHd-Xa_footArea') return footArea
      if (selector === '.pI_x6G_frame') return frame
      if (selector === '.dsh-android-sidebar-restore') return null
      if (selector === '.dsh-android-collapse-sidebar') return null
      return frame
    },
    createElement: (tag) => {
      const node = {
        nodeType: 1,
        tagName: tag.toUpperCase(),
        className: '',
        type: '',
        innerHTML: '',
        style: {},
        children: [],
        setAttribute() {},
        addEventListener(type, handler) {
          state.listeners.push({ type, handler, node: this })
        },
      }
      return node
    },
    addEventListener: (type, handler) => state.listeners.push({ type, handler }),
  }
  globalThis.window = {
    innerWidth: width,
    DSHAndroid: androidShell ? { startDownload() {} } : undefined,
    addEventListener: (type, handler) => state.listeners.push({ type, handler }),
  }
  globalThis.localStorage = { length: 0, key: () => null }
  globalThis.setInterval = () => 0
  globalThis.Element = class {}
  globalThis.HTMLAnchorElement = { prototype: { click() {} } }
  globalThis.MutationObserver = class {
    constructor(callback) {
      state.observers.push(callback)
      callback()
    }
    observe() {}
    disconnect() {}
  }
  state.footArea = footArea
  state.settingsArea = settingsArea
  return state
}

function runScript(options) {
  const state = createShell(options)
  /* The host injects this text into a <script> tag; running it here proves the
     exact shipped string parses and does not throw on a bare shell. */
  new Function(ANDROID_MOBILE_SCRIPT)()
  return state
}

test('the injected shell script runs without throwing', () => {
  assert.doesNotThrow(() => runScript())
  assert.doesNotThrow(() => runScript({ framePresent: false }))
})

test('the shell script only keeps its own startup and tap behaviour', () => {
  const state = runScript()
  assert.equal(state.classes.size, 0)
  assert.ok(state.listeners.some(({ type }) => type === 'click'))
  assert.doesNotMatch(ANDROID_MOBILE_SCRIPT, /agentLog|layoutSnapshot|debugLog|fetch\(/)
  assert.doesNotMatch(ANDROID_MOBILE_SCRIPT, /getComputedStyle|setProperty/)
  /* A dot written without its backslash would reach the browser as `\.` and
     throw InvalidCharacterError out of querySelector. */
  assert.doesNotMatch(ANDROID_MOBILE_SCRIPT, /querySelector\(\./)
})

test('the mobile drawer keeps its original rules', () => {
  assert.match(MOBILE_CSS, /@media \(max-width: 768px\)/)
  /* The open drawer floats over the centre, which keeps the full frame width. */
  assert.match(MOBILE_CSS, /\.pI_x6G_frame:not\(\[data-sidebar-collapsed\]\) \{\s*grid-template-columns: 0 minmax\(0, 1fr\) 0 !important;\s*\}/)
  assert.match(MOBILE_CSS, /\.pI_x6G_frame:not\(\[data-sidebar-collapsed\]\) \.pI_x6G_sidebarCol \{[^}]*position: fixed;/)
  assert.match(MOBILE_CSS, /width: min\(88vw, 320px\) !important;/)
  assert.match(MOBILE_CSS, /\.pI_x6G_frame:not\(\[data-sidebar-collapsed\]\) \.pI_x6G_centerCol::before \{[^}]*background: var\(--dsw-alias-bg-mask-1/)
  /* The frame's own row layout is never pinned. */
  assert.doesNotMatch(MOBILE_CSS, /grid-template-rows/)
})

test('no column arrow styling or override remains', () => {
  assert.doesNotMatch(MOBILE_CSS, /dsh-android-nav/)
  assert.doesNotMatch(MOBILE_CSS, /--dsh-sidebar-unfold|--dsh-sidebar-fold/)
  assert.doesNotMatch(ANDROID_MOBILE_SCRIPT, /dsh-android-nav/)
  assert.match(MOBILE_CSS, /\.pI_x6G_frame\[data-animating\] \{\s*transition: none !important;/)
})

test('an outside tap on the open drawer still collapses it', () => {
  const state = runScript({ androidShell: true })
  const tap = state.listeners.find(({ type }) => type === 'click').handler
  let toggles = 0
  const toggle = { click: () => { toggles += 1 } }
  const sidebar = { contains: () => false }
  const center = {}
  const frame = { querySelector: (selector) => (selector === '.pI_x6G_sidebarCol' ? sidebar : selector === '.pI_x6G_centerCol' ? center : toggle) }
  globalThis.document.querySelector = () => frame
  tap({ target: center })
  assert.equal(toggles, 1)
  // A dialog/menu rendered outside the drawer is not its backdrop.
  tap({ target: {} })
  assert.equal(toggles, 1)
  globalThis.window.innerWidth = 1280
  tap({ target: center })
  assert.equal(toggles, 1)
  globalThis.window.innerWidth = 390
  /* A tap inside the column belongs to the drawer and is left alone. */
  globalThis.document.querySelector = () => ({ querySelector: (selector) => (selector === '.pI_x6G_sidebarCol' ? { contains: () => true } : toggle) })
  tap({ target: {} })
  assert.equal(toggles, 1)
  /* Without the Android shell bridge the outside tap stays inert. */
  const desktop = runScript()
  const desktopTap = desktop.listeners.find(({ type }) => type === 'click').handler
  desktopTap({ target: {} })
  assert.equal(toggles, 1)
})

test('the tap-highlight reset still ships as its own style block', () => {
  assert.match(ANDROID_UI_CSS, /-webkit-tap-highlight-color: transparent/)
})

test('Android sidebar footer keeps only its original settings area', () => {
  for (const sidebarCollapsed of [false, true]) {
    const state = runScript({ sidebarPresent: true, sidebarCollapsed, androidShell: true })
    assert.deepEqual(state.footArea.children, [state.settingsArea])
    assert.equal(state.observers.length, 0)
    assert.ok(!state.classes.has('dsh-android-sidebar-hidden'))
  }
  assert.doesNotMatch(ANDROID_MOBILE_SCRIPT, /dsh-android-collapse-sidebar|dsh-android-sidebar-restore|dsh-android-sidebar-hidden|dshAndroidSidebarInset|syncSidebarCollapseButton|hideSidebarRail/)
  assert.match(ANDROID_UI_CSS, /\.hHd-Xa_footArea button\[aria-label="收起侧边栏"\]/)
  assert.match(ANDROID_UI_CSS, /display: none !important/)
})
