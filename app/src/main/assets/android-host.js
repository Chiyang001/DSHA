import { writeFileSync } from 'node:fs'

export const name = 'dsh-android-host'
export const inject = ['connection', 'webServer']

// Runs before the kernel's bootstrap scripts, including downloaded kernels.
// Older OEM WebViews can render the shell but fail when opening a session or
// subscribing to its message stream because these APIs are missing.
const ANDROID_COMPAT_SCRIPT = `
(function () {
  function define(owner, name, value) {
    if (owner[name] === undefined) Object.defineProperty(owner, name, {
      value: value, writable: true, configurable: true
    })
  }
  define(Promise, 'withResolvers', function () {
    var resolve, reject
    var promise = new this(function (yes, no) { resolve = yes; reject = no })
    return { promise: promise, resolve: resolve, reject: reject }
  })
  define(Symbol, 'dispose', Symbol('Symbol.dispose'))
  define(Symbol, 'asyncDispose', Symbol('Symbol.asyncDispose'))
  define(Array.prototype, 'toSorted', function (compare) {
    return Array.from(this).sort(compare)
  })
  if (typeof AbortSignal !== 'undefined' && typeof AbortController !== 'undefined') {
    define(AbortSignal.prototype, 'throwIfAborted', function () {
      if (this.aborted) throw this.reason === undefined
        ? new DOMException('The operation was aborted', 'AbortError') : this.reason
    })
    define(AbortSignal, 'any', function (signals) {
      var inputs = Array.from(signals)
      // Validate all inputs before registering any listeners.
      inputs.forEach(function (signal) {
        if (!(signal instanceof AbortSignal)) throw new TypeError('Expected an AbortSignal')
      })
      var controller = new AbortController()
      var listeners = []
      function cleanup() {
        listeners.forEach(function (entry) { entry[0].removeEventListener('abort', entry[1]) })
        listeners = []
      }
      function abort(signal) {
        cleanup()
        controller.abort(signal.reason)
      }
      for (var i = 0; i < inputs.length; i++) {
        if (inputs[i].aborted) { abort(inputs[i]); return controller.signal }
      }
      inputs.forEach(function (signal) {
        var listener = function () { abort(signal) }
        signal.addEventListener('abort', listener, { once: true })
        listeners.push([signal, listener])
      })
      return controller.signal
    })
  }
})()
`

const ANDROID_UI_CSS = `
*, *::before, *::after {
  -webkit-tap-highlight-color: transparent !important;
  tap-highlight-color: transparent;
}
/* Suppress the retired control even when an older kernel/footer plugin
   renders it. Keep the normal sidebar toggle outside the footer available. */
html.dsh-android-shell .dsh-android-collapse-sidebar,
html.dsh-android-shell .dsh-android-sidebar-restore,
html.dsh-android-shell .hHd-Xa_footArea button[aria-label="收起侧边栏"],
html.dsh-android-shell .hHd-Xa_footArea button[title="收起侧边栏"],
html.dsh-android-shell .hHd-Xa_footArea button[aria-label="Collapse sidebar"],
html.dsh-android-shell .hHd-Xa_footArea button[title="Collapse sidebar"] {
  display: none !important;
}
`

const MOBILE_CSS = `
@media (max-width: 768px) {
  /* Expanded sidebar becomes a drawer; center column keeps full width underneath. */
  .pI_x6G_frame:not([data-sidebar-collapsed]) {
    grid-template-columns: 0 minmax(0, 1fr) 0 !important;
  }
  .pI_x6G_frame:not([data-sidebar-collapsed]) .pI_x6G_sidebarCol {
    position: fixed;
    z-index: 45;
    top: 0;
    left: 0;
    bottom: 0;
    width: min(88vw, 320px) !important;
    max-width: 320px;
    border-right: .5px solid var(--dsw-alias-border-l3);
    box-shadow: 0 12px 40px rgba(0, 0, 0, .28);
  }
  .pI_x6G_frame:not([data-sidebar-collapsed]) .pI_x6G_centerCol {
    position: relative;
    z-index: 1;
  }
  .pI_x6G_frame:not([data-sidebar-collapsed]) .pI_x6G_centerCol::before {
    content: '';
    position: fixed;
    inset: 0;
    z-index: 40;
    background: var(--dsw-alias-bg-mask-1, rgba(0, 0, 0, .45));
    pointer-events: auto;
  }
  .pI_x6G_frame:not([data-sidebar-collapsed]) .pI_x6G_handle {
    display: none !important;
  }
  .pI_x6G_frame[data-animating] {
    transition: none !important;
  }
  .hHd-Xa_root:not(.hHd-Xa_collapsed) {
    width: 100% !important;
    max-width: 100% !important;
  }

  /* Conversation and composer: avoid 680px minimum content width on narrow screens. */
  .wSkVaW_body {
    --dsh-chat-content-width: min(calc(100vw - 24px), 920px) !important;
    --dsh-composer-card-max-width: 100% !important;
    --dsh-composer-side-clearance: 8px !important;
    --dsh-composer-dock-inset: 6px !important;
  }
  .wSkVaW_header {
    padding: 8px 12px 0 !important;
    min-height: auto !important;
  }
  .wSkVaW_titleRow {
    padding-inline-start: 0 !important;
    flex-wrap: wrap;
    row-gap: 4px;
  }
  .wSkVaW_headerUtilities {
    margin-left: 4px !important;
  }
  .wSkVaW_headerCorner {
    margin-right: 0 !important;
    margin-left: auto !important;
  }
  .wSkVaW_crumb {
    max-width: min(42vw, 160px) !important;
  }
  .wSkVaW_tabs {
    gap: 20px !important;
    overflow-x: auto !important;
    -webkit-overflow-scrolling: touch;
  }
  .EvIC1a_scroll,
  .eGxaPq_slot {
    padding-left: 12px !important;
    padding-right: 12px !important;
  }
  .wSkVaW_widthHandle {
    display: none !important;
  }

  /* Settings panel (existing rules). */
  .VOzbGW_panel {
    flex-direction: column !important;
    width: 100vw !important;
    max-width: 100vw !important;
    height: 100dvh !important;
    max-height: 100dvh !important;
    border-radius: 0 !important;
  }
  .VOzbGW_nav {
    width: 100% !important;
    flex: none !important;
    flex-direction: row !important;
    align-items: center !important;
    gap: 8px !important;
    padding: 10px 8px 0 !important;
    overflow-x: auto !important;
    -webkit-overflow-scrolling: touch;
  }
  .VOzbGW_navTitle { display: none !important; }
  .VOzbGW_navList {
    flex-direction: row !important;
    flex: 1 !important;
    gap: 4px !important;
    overflow-x: auto !important;
    -webkit-overflow-scrolling: touch;
  }
  .VOzbGW_navCell {
    flex: none !important;
    white-space: nowrap !important;
    height: 36px !important;
    padding: 8px 12px !important;
  }
  .VOzbGW_content {
    flex: 1 !important;
    min-height: 0 !important;
    width: 100% !important;
  }
  .VOzbGW_header {
    height: auto !important;
    padding: 12px 12px 6px !important;
  }
  .VOzbGW_options {
    padding: 0 16px 20px !important;
  }
  .oY77xG_row,
  .hVGvvW_row,
  ._2XZxNq_row,
  .Pt1bsG_row {
    flex-direction: column !important;
    align-items: stretch !important;
    gap: 10px !important;
  }
  .oY77xG_rowText,
  .hVGvvW_rowText,
  ._2XZxNq_rowText {
    padding-right: 0 !important;
    min-width: 0 !important;
  }
  .oY77xG_title,
  .hVGvvW_title,
  ._2XZxNq_title,
  .Pt1bsG_title,
  ._8HJdBW_title {
    white-space: normal !important;
    word-break: break-word !important;
  }
  .oY77xG_desc,
  ._2XZxNq_desc,
  .Pt1bsG_description {
    white-space: normal !important;
    word-break: break-word !important;
  }
  .oY77xG_selector,
  .hVGvvW_selector,
  ._2XZxNq_selector {
    width: 100% !important;
    justify-content: space-between !important;
    box-sizing: border-box !important;
  }
  ._8HJdBW_cubeRow {
    flex-direction: column !important;
    align-items: stretch !important;
  }
  ._8HJdBW_themeCube {
    flex: none !important;
    width: 100% !important;
    box-sizing: border-box !important;
    padding: 14px 16px !important;
  }
}
`

const ANDROID_MOBILE_SCRIPT = `
(function () {
  function collapseRestoredTerminalSidebar() {
    try {
      for (var i = 0; i < localStorage.length; i++) {
        var key = localStorage.key(i)
        if (!key || key.indexOf('dsh.sidebar-right.v1.') !== 0) continue
        var envelope = JSON.parse(localStorage.getItem(key) || 'null')
        if (!envelope || !envelope.bySession) continue
        var sessionId = key.slice('dsh.sidebar-right.v1.'.length)
        var saved = envelope.bySession[sessionId]
        if (!saved || !saved.layout || !saved.layout.expanded) continue
        var layout = saved.layout
        var pane = layout.nodes[layout.activePaneId]
        if (!pane || !pane.activeTabId) continue
        var tab = layout.tabs[pane.activeTabId]
        if (tab && tab.kind === 'terminal') {
          layout.expanded = false
          localStorage.setItem(key, JSON.stringify(envelope))
        }
      }
    } catch (_ignored) {}
  }
  collapseRestoredTerminalSidebar()
  try {
    var key = 'dsh.terminal.shell'
    var saved = localStorage.getItem(key)
    if (saved && /adb/i.test(saved)) localStorage.removeItem(key)
  } catch (_ignored) {}
  const isAndroidShell = !!(window.DSHAndroid && typeof window.DSHAndroid.startDownload === 'function')
  if (isAndroidShell) document.documentElement.classList.add('dsh-android-shell')
  if (isAndroidShell) {
    const nativeClick = HTMLAnchorElement.prototype.click
    HTMLAnchorElement.prototype.click = function () {
      if (this.download) {
        window.DSHAndroid.startDownload(new URL(this.href, location.href).href, this.download)
        return
      }
      return nativeClick.call(this)
    }
  }
  document.addEventListener('click', function (event) {
    // Only the narrow layout has a drawer mask. Wide tablet layouts and
    // portalled dialogs must keep their original click targets mounted.
    if (window.innerWidth > 768) return
    const frame = document.querySelector('.pI_x6G_frame:not([data-sidebar-collapsed])')
    if (!frame || !isAndroidShell) return
    const sidebar = frame.querySelector('.pI_x6G_sidebarCol')
    if (!sidebar || sidebar.contains(event.target)) return
    const center = frame.querySelector('.pI_x6G_centerCol')
    if (!center || event.target !== center) return
    const toggle = frame.querySelector('.hHd-Xa_toggle')
    if (toggle) toggle.click()
  }, true)
})()
`

export { ANDROID_UI_CSS, MOBILE_CSS, ANDROID_MOBILE_SCRIPT, ANDROID_COMPAT_SCRIPT }

export function apply(ctx) {
  ctx.on('webserver/index-inject', table => {
    // Prepend: the module loader itself also uses Promise.withResolvers.
    table.unshift({ kind: 'script', placement: 'head', text: ANDROID_COMPAT_SCRIPT })
    table.push({ kind: 'style', text: ANDROID_UI_CSS })
    table.push({ kind: 'style', text: MOBILE_CSS })
    table.push({ kind: 'script', placement: 'body', text: ANDROID_MOBILE_SCRIPT })
  })
  ctx.inject(['connection', 'webServer'], ready => {
    const port = ready.webServer.port
    const url = ready.connection.authenticatedUrl(`http://127.0.0.1:${port}/`)
    if (process.env.DSH_ANDROID_URL_FILE) writeFileSync(process.env.DSH_ANDROID_URL_FILE, url)
  })
}
