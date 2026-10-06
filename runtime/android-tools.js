import { defineTool } from '@deepseek-ai/dsh-tools'
import { AndroidLoopGuard, screenFingerprint } from './android-loop-guard.js'
import { coordinatePoint, observationText, observationContent, observationSchema } from './android-fast-screen.js'
import { readFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { annotateScreenshot } from './android-screen-annotate.js'
import {
  formatScreenSummary,
  gridCellCenter,
  mergeScreenTargets,
} from './android-screen-targets.js'
import {
  elementByIndex,
  scrollGesture,
  screenBoundsFromXml,
  scrollTarget,
} from './android-ui-parse.js'

export const name = 'dsh-android-device-tools'
export const inject = ['tools', 'sessions']

const token = process.env.DSH_ANDROID_BRIDGE_TOKEN
const endpoint = 'http://127.0.0.1:3981/rpc'
const UI_SNAPSHOT_TTL_MS = 120_000

async function call(method, fields, signal) {
  if (!token) throw new Error('Android bridge token is missing')
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-bridge-token': token },
    body: JSON.stringify({ method, ...fields }),
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(45_000)]) : AbortSignal.timeout(45_000),
  })
  const value = await response.json()
  if (!response.ok) throw new Error(value.error ?? `Android bridge HTTP ${response.status}`)
  return value
}

function register(ctx, toolName, description, parameters, method, format, actionRunner) {
  ctx.tools.register(defineTool({
    name: toolName,
    description,
    parameters,
    output: {
      schema: actionRunner ? observationSchema : { type: 'string' },
      render: (_args, result) => actionRunner ? observationContent(result) : [{ type: 'text', text: result }],
    },
    async execute(args, exec) {
      if (actionRunner) return actionRunner(method, args, exec)
      const result = await call(method, args, exec.signal)
      return format(result)
    },
  }))
}

const number = (description) => ({ type: 'number', required: true, description })
const optionalNumber = (description) => ({ type: 'number', description })

export function apply(ctx) {
  let updates = Promise.resolve()
  let fallbackSnapshot = null
  const snapshots = new WeakMap()
  const displayTargets = new WeakMap()
  let fallbackDisplay = 0
  const displayOwner = exec => exec.agent?.session ?? exec.agent
  const displayFor = exec => displayOwner(exec) ? displayTargets.get(displayOwner(exec)) ?? 0 : fallbackDisplay
  const snapshotFor = exec => exec.agent ? snapshots.get(exec.agent) : fallbackSnapshot
  function storeSnapshot(exec, value) {
    if (exec.agent) snapshots.set(exec.agent, value)
    else fallbackSnapshot = value
    return value
  }
  if (ctx.effect && typeof ctx.tools.presentAs === 'function') {
    ctx.effect(() => ctx.tools.presentAs('native'))
  }
  let actionBusy = false
  const guards = new WeakMap()
  const fallbackGuard = new AndroidLoopGuard()
  const turns = new WeakMap()

  function turnState(agent, turn) {
    let state = turns.get(agent)
    if (!state || state.turn !== turn) {
      state = { turn, steps: 0, retryStep: null, failures: 0 }
      turns.set(agent, state)
      guards.set(agent, new AndroidLoopGuard())
    }
    return state
  }

  function stopAgent(agent, reason) {
    agent?.cancel({ kind: 'hook', reason }, { keepInbox: true })
    void call('progress', { session: String(agent?.session?.id ?? ''), text: reason, active: false }, AbortSignal.timeout(2000)).catch(() => {})
  }

  ctx.on('agent/pre-step', async ({ agent, turn }, next) => {
    const state = turnState(agent, turn)
    if (++state.steps > 60) {
      stopAgent(agent, '手机操作已停止：本轮超过 60 个模型步骤，请检查卡住的操作后继续。')
      throw new Error('ANDROID_STEP_LIMIT: stop and report the unresolved task.')
    }
    return next()
  }, { prepend: true })

  ctx.on('agent/request-error', async ({ agent, turn, step }, next) => {
    const state = turnState(agent, turn)
    if (state.retryStep !== step) { state.retryStep = step; state.failures = 0 }
    if (++state.failures >= 3) {
      stopAgent(agent, '手机操作已停止：同一步模型请求连续失败 3 次，避免无限重试。')
      return undefined
    }
    return next()
  }, { prepend: true })

  async function runAction(method, fields, exec, expectedSnapshot) {
    if (displayFor(exec) !== 0 && method === 'shell') throw new Error('Secondary display: arbitrary shell is disabled to avoid main-screen actions. Use android_launch_app or dedicated input tools.')
    if (actionBusy) throw new Error('Another phone action is in progress. Wait and inspect the screen again.')
    actionBusy = true
    try {
      // Use the observation already shown to the model. Full XML/OCR scans
      // before every tap were slow and rejected unrelated page changes.
      const before = expectedSnapshot ?? snapshotFor(exec) ?? await captureFast(exec)
      const displayId = displayFor(exec)
      if ((before.displayId ?? 0) !== displayId) throw new Error('DISPLAY_CHANGED: Take a fresh screenshot of the selected display. No input sent.')
      let guard = exec.agent ? guards.get(exec.agent) : fallbackGuard
      if (!guard) { guard = new AndroidLoopGuard(); guards.set(exec.agent, guard) }
      // Tap identity uses the resolved physical point, so element/grid aliases
      // at the same point cannot evade the detector by changing tool names.
      const actionFields = method === 'swipe'
        ? { x1: fields.x1, y1: fields.y1, x2: fields.x2, y2: fields.y2 }
        : fields
      const action = JSON.stringify([method, actionFields])
      let entry
      try { entry = guard.begin(screenFingerprint(before), action) }
      catch (error) {
        if (guard.blocked >= 3) stopAgent(exec.agent, '手机操作已停止：重复尝试被拦截 3 次，需要更换操作策略。')
        throw error
      }
      storeSnapshot(exec, null) // Even a timed-out injection may have reached the device.
      let result
      try { result = await call(method, { ...fields, displayId, ...(before.rotation === undefined ? {} : { expectedRotation: before.rotation }) }, exec.signal) }
      catch (error) {
        throw new Error(`ACTION_OUTCOME_UNKNOWN: ${error.message}. Do not repeat this action; inspect the phone first. The input may already have executed.`)
      }
      let after
      try { after = await captureFast(exec) }
      catch (error) {
        return { status: 'ACTION_OUTCOME_UNKNOWN', text: `${result.output || ''}\nACTION_OUTCOME_UNKNOWN: Input request completed (exitCode=${result.exitCode ?? 'unavailable'}) but observation failed (${error.message}). Inspect the phone; do not repeat blindly.` }
      }
      const outcome = guard.finish(entry, before.fingerprint ? screenFingerprint(after) : null)
      const feedback = outcome === 'changed'
        ? 'SCREEN_CHANGED: Input was sent and the sampled screenshot changed. This does not prove the intended task succeeded; verify the expected result.'
        : outcome === 'unchanged'
          ? 'NO_OBSERVED_CHANGE: Input was sent but the sampled screenshot did not change. Small changes may be missed, or loading may be delayed. Inspect the image; avoid repeating blindly.'
          : 'ACTION_OUTCOME_UNKNOWN: UI evidence is insufficient. Inspect the screenshot before another action.'
      const status = result.ok === false ? 'COMMAND_FAILED' : 'INPUT_SENT'
      const receipt = `${status}: ${method}; exitCode=${result.exitCode ?? 'unavailable'}; transport=${result.transport ?? 'unavailable'}; durationMs=${result.durationMs ?? 'unavailable'}. ${result.output || '(no stdout; this does not mean the tool call was empty)'}\n${feedback}\n${observationText(after)}`
      return { status, text: receipt, ...(after.image ? { image: after.image } : {}) }
    } finally { actionBusy = false }
  }

  function requireSnapshot(exec, id) {
    const uiSnapshot = snapshotFor(exec)
    if (!uiSnapshot) {
      throw new Error('Call android_screenshot first before coordinate taps; call android_screen before numbered targets.')
    }
    if (Date.now() - uiSnapshot.at > UI_SNAPSHOT_TTL_MS) {
      throw new Error('The observation is stale. Call android_screenshot again before coordinate taps, or android_screen before numbered targets.')
    }
    if (id && id !== uiSnapshot.id) throw new Error('STALE_SNAPSHOT: snapshot_id does not match the latest image. Take a fresh screenshot.')
    return uiSnapshot
  }

  async function captureFast(exec, crop = {}) {
    const displayId = displayFor(exec)
    const result = await call('screenshot', { fast: true, ...crop, displayId }, exec.signal)
    if ((result.displayId ?? 0) !== displayId) throw new Error('DISPLAY_MISMATCH: Screenshot does not belong to the selected display. No input sent.')
    let image
    let attachmentNote = ''
    const attachments = ctx.get?.('attachments')
    if (attachments && result.viewPath) {
      try {
        image = await attachments.saveImage({ data: await readFile(result.viewPath), mediaType: 'image/png', name: 'phone-screen.png' })
      } catch (error) { attachmentNote = `Image attachment failed (${error.message}). Open the screenshot path with read_image.` }
    }
    const snapshot = storeSnapshot(exec, {
      id: randomUUID(), kind: 'visual', at: Date.now(), elements: [], width: result.width, height: result.height,
      rotation: result.rotation, fingerprint: result.fingerprint,
      displayId,
      annotatedPath: result.viewPath ?? result.path,
      imageWidth: image?.width ?? result.viewWidth ?? result.width,
      imageHeight: image?.height ?? result.viewHeight ?? result.height,
      crop: { left: result.cropLeft ?? 0, top: result.cropTop ?? 0, width: result.cropWidth ?? result.width, height: result.cropHeight ?? result.height },
      ...(image ? { image } : {}), attachmentNote,
    })
    return snapshot
  }

  async function captureScreen(exec) {
    if (displayFor(exec) !== 0) throw new Error('Secondary display: use android_screenshot and coordinate tools; UI XML may belong to the main display.')
    const result = await call('screen', { displayId: 0 }, exec.signal)
    const uiXml = result.uiXml ?? ''
    const ocrLines = Array.isArray(result.ocr) ? result.ocr : []
    const elements = mergeScreenTargets(uiXml, ocrLines)
    let annotatedPath = result.path
    try {
      annotatedPath = await annotateScreenshot(result.path, elements, result.width, result.height)
    } catch (error) {
      annotatedPath = result.path
    }
    return storeSnapshot(exec, {
      id: randomUUID(),
      xml: uiXml,
      elements,
      width: result.width,
      height: result.height,
      imageWidth: result.width,
      imageHeight: result.height,
      rotation: result.rotation,
      annotatedPath,
      at: Date.now(),
    })
  }

  ctx.on('session/event', (session, event) => {
    const titles = { 'turn/start': '开始处理任务', 'step/start': '正在请求 DeepSeek',
      'assistant/attempt': '模型请求重试中', 'assistant/message': '模型已返回，准备执行动作',
      'tool/call': '正在执行工具', 'tool/result': '工具执行结束', 'turn/end': '任务结束' }
    if (!titles[event.type]) return
    const active = event.type !== 'turn/end'
    const tool = event.type === 'tool/call' ? event.data?.name : undefined
    const reason = event.type === 'turn/end' ? event.data?.reason?.kind : undefined
    const text = tool ? `正在执行 ${tool}` : reason ? `任务结束（${reason}）` : titles[event.type]
    updates = updates.catch(() => {}).then(() => call('progress', {session: String(session.id), text, active}, AbortSignal.timeout(2000))).catch(() => {})
  })

  register(ctx, 'android_status',
    'Check whether this Android phone is paired, connected, and authorized for Harness control.',
    {}, 'status', value => JSON.stringify(value))

  register(ctx, 'android_displays',
    'List Shizuku logical display IDs and names, including virtual secondary screens. Never guess a display ID.',
    {}, 'displays', value => JSON.stringify(value))

  ctx.tools.register(defineTool({
    name: 'android_select_display',
    description: 'Select the display for this conversation before secondary-screen operations. First list android_displays. Subsequent screenshots, taps, swipes, keys, typing and app launches use this ID until explicitly changed. Secondary capture requires Android 14+ and Shizuku; unavailable displays never fall back to the main screen.',
    parameters: { display_id: number('Logical display ID from android_displays; 0 explicitly selects the main screen') },
    output: { schema: { type: 'string' }, render: (_args, result) => [{ type: 'text', text: result }] },
    async execute(args, exec) {
      const id = args.display_id
      if (!Number.isInteger(id) || id < 0 || id > 2147483647) throw new Error('display_id must be a nonnegative integer')
      if (actionBusy) throw new Error('Wait for the current action before changing displays')
      actionBusy = true
      try {
        const available = await call('displays', {}, exec.signal)
        if (!available.displays?.some(display => display.displayId === id)) throw new Error('DISPLAY_UNAVAILABLE: Requested display was not listed; selection unchanged')
        const shot = await call('screenshot', { fast: true, displayId: id }, exec.signal)
        if ((shot.displayId ?? 0) !== id) throw new Error('DISPLAY_MISMATCH: Selection unchanged')
        const owner = displayOwner(exec)
        if (owner) displayTargets.set(owner, id); else fallbackDisplay = id
        storeSnapshot(exec, null)
        return 'Selected display_id=' + id + '. Call android_screenshot before further actions. Use android_launch_app; do not use shell or main-screen UI tools for secondary displays.'
      } finally { actionBusy = false }
    },
  }))

  register(ctx, 'android_launch_app',
    'Launch an installed application package on the selected display. Use this instead of am start, monkey, or shell commands; inspect the returned screenshot to verify placement. Some apps or OEM policies may refuse secondary displays.',
    { package: { type: 'string', required: true, description: 'Installed Android application package, e.g. com.android.settings' } },
    'launch', value => value.output, runAction)

  ctx.tools.register(defineTool({
    name: 'android_screen',
    description: 'Analyze the current screen: accessibility XML + on-device OCR + annotated screenshot. Returns a numbered target list. Open the annotated image with read_image, then tap by index only.',
    parameters: {},
    output: {
      schema: { type: 'string' },
      render: (_args, result) => [{ type: 'text', text: result }],
    },
    async execute(_args, exec) {
      const snapshot = await captureScreen(exec)
      return 'display_id=0\n' + formatScreenSummary(snapshot.elements, snapshot.annotatedPath, snapshot.width, snapshot.height)
    },
  }))

  ctx.tools.register(defineTool({
    name: 'android_ui',
    description: 'Alias of android_screen. Use android_screen for accessibility + OCR targets and an annotated screenshot.',
    parameters: {},
    output: {
      schema: { type: 'string' },
      render: (_args, result) => [{ type: 'text', text: result }],
    },
    async execute(_args, exec) {
      const snapshot = await captureScreen(exec)
      return formatScreenSummary(snapshot.elements, snapshot.annotatedPath, snapshot.width, snapshot.height)
    },
  }))

  ctx.tools.register(defineTool({
    name: 'android_tap_element',
    description: 'Tap one numbered target from the latest android_screen list. Pass only index; never pass x/y coordinates.',
    parameters: {
      index: number('Target index from android_screen, for example 0, 1, 2'),
    },
    output: {
      schema: observationSchema,
      render: (_args, result) => observationContent(result),
    },
    async execute(args, exec) {
      const snapshot = requireSnapshot(exec)
      if (!snapshot.elements.length) throw new Error('No numbered targets in this observation. Use android_tap on the attached image, or call android_screen to obtain target indices.')
      const element = elementByIndex(snapshot.elements, args.index)
      return runAction('tap', { x: element.tapX, y: element.tapY }, exec, snapshot)
    },
  }))

  ctx.tools.register(defineTool({
    name: 'android_tap_cell',
    description: 'Fallback tap by grid cell after android_screen. Use only when no numbered target matches. The annotated screenshot shows a 12x24 grid with col,row labels.',
    parameters: {
      col: number('Grid column from the annotated screenshot, 0-11'),
      row: number('Grid row from the annotated screenshot, 0-23'),
    },
    output: {
      schema: observationSchema,
      render: (_args, result) => observationContent(result),
    },
    async execute(args, exec) {
      const snapshot = requireSnapshot(exec)
      const point = gridCellCenter(snapshot.width, snapshot.height, args.col, args.row)
      return runAction('tap', point, exec, snapshot)
    },
  }))

  ctx.tools.register(defineTool({
    name: 'android_scroll',
    description: 'Scroll a numbered scrollable target from android_screen, or the main screen when index is omitted.',
    parameters: {
      direction: { type: 'string', required: true, description: 'One of up, down, left, or right' },
      index: optionalNumber('Optional scrollable target index from android_screen'),
      duration: optionalNumber('Swipe duration in milliseconds, 1 to 5000'),
    },
    output: {
      schema: observationSchema,
      render: (_args, result) => observationContent(result),
    },
    async execute(args, exec) {
      const direction = String(args.direction ?? '').toLowerCase()
      if (!['up', 'down', 'left', 'right'].includes(direction)) {
        throw new Error('direction must be one of up, down, left, or right')
      }
      const snapshot = requireSnapshot(exec)
      const target = scrollTarget(snapshot.elements, args.index) ?? {
        bounds: screenBoundsFromXml(snapshot.xml ?? '') ?? `[0,0][${snapshot.width},${snapshot.height}]`,
        index: -1,
      }
      const gesture = scrollGesture(target.bounds, direction)
      const duration = Number.isInteger(args.duration) ? args.duration : 350
      return runAction('swipe', { ...gesture, duration }, exec, snapshot)
    },
  }))

  register(ctx, 'android_key',
    'Send an Android keycode, for example 3 Home, 4 Back, 66 Enter, or 26 Power.',
    { keycode: { type: 'number', required: true, description: 'Android keycode 0 to 300' } },
    'key', value => value.output || 'Key sent', runAction)
  register(ctx, 'android_text',
    'Type up to 128 ASCII characters through ADB input text. Non-ASCII characters are not supported by this tool.',
    { text: { type: 'string', required: true, description: 'ASCII text to type' } },
    'text', value => value.output || 'Text sent', runAction)

  const coordinateSpace = { type: 'string', enum: ['image', 'device', 'normalized'], description: 'Default image: pixels on the attached preview. device: original full-screen pixels. normalized: 0-1000 within the attached image.' }
  const snapshotId = { type: 'string', description: 'snapshot_id from the image being acted on. Recommended; stale IDs are rejected.' }
  ctx.tools.register(defineTool({
    name: 'android_tap',
    description: 'Fast coordinate tap via Shizuku (ADB fallback). Use the latest attached screenshot, measure x/y on that image, and pass its snapshot_id. Returns a new screenshot directly. No XML/OCR scan.',
    parameters: { x: number('Horizontal image pixel coordinate'), y: number('Vertical image pixel coordinate'), coordinate_space: coordinateSpace, snapshot_id: snapshotId },
    output: { schema: observationSchema, render: (_args, result) => observationContent(result) },
    async execute(args, exec) {
      const snapshot = requireSnapshot(exec, args.snapshot_id)
      if (snapshot.kind !== 'visual') throw new Error('Call android_screenshot for an image with an explicit coordinate scale before android_tap.')
      return runAction('tap', coordinatePoint(args.x, args.y, snapshot, args.coordinate_space), exec, snapshot)
    },
  }))
  ctx.tools.register(defineTool({
    name: 'android_swipe',
    description: 'Fast swipe using coordinates on the latest screenshot. Returns the new screenshot directly. Stop scrolling if no progress is visible.',
    parameters: { x1: number('Start x'), y1: number('Start y'), x2: number('End x'), y2: number('End y'), duration: optionalNumber('Duration in milliseconds, default 350; 1-5000'), coordinate_space: coordinateSpace, snapshot_id: snapshotId },
    output: { schema: observationSchema, render: (_args, result) => observationContent(result) },
    async execute(args, exec) {
      const snapshot = requireSnapshot(exec, args.snapshot_id)
      if (snapshot.kind !== 'visual') throw new Error('Call android_screenshot for an image with an explicit coordinate scale before android_swipe.')
      const start = coordinatePoint(args.x1, args.y1, snapshot, args.coordinate_space)
      const end = coordinatePoint(args.x2, args.y2, snapshot, args.coordinate_space)
      const duration = args.duration ?? 350
      if (!Number.isInteger(duration) || duration < 1 || duration > 5000) throw new Error('duration must be an integer from 1 to 5000')
      return runAction('swipe', { x1: start.x, y1: start.y, x2: end.x, y2: end.y, duration }, exec, snapshot)
    },
  }))
  ctx.tools.register(defineTool({
    name: 'android_screenshot',
    description: 'Fast screenshot, attached directly when supported. Start phone operations here; then android_tap or android_swipe using image pixel coordinates. Optional crop in original device pixels zooms small targets. Use android_screen only when visual targeting is ambiguous.',
    parameters: {
      crop_x: optionalNumber('Crop left in device pixels'), crop_y: optionalNumber('Crop top in device pixels'),
      crop_width: optionalNumber('Crop width in device pixels'), crop_height: optionalNumber('Crop height in device pixels'),
    },
    output: {
      schema: observationSchema,
      render: (_args, result) => observationContent(result),
    },
    async execute(args, exec) {
      const keys = ['crop_x', 'crop_y', 'crop_width', 'crop_height']
      if (keys.some(key => args[key] !== undefined)) {
        if (!keys.every(key => Number.isInteger(args[key]))) throw new Error('All four crop fields must be integers in device pixels')
        if (args.crop_x < 0 || args.crop_y < 0 || args.crop_width <= 0 || args.crop_height <= 0) throw new Error('Invalid crop rectangle')
      }
      const snapshot = await captureFast(exec, args)
      return { text: observationText(snapshot), ...(snapshot.image ? { image: snapshot.image } : {}) }
    },
  }))

  register(ctx, 'android_shell',
    'Run an arbitrary ADB shell command on this phone. Requires the separate advanced shell toggle inside the Android app.',
    { command: { type: 'string', required: true, description: 'ADB shell command, up to 2048 characters' } },
    'shell', value => value.output, runAction)
}
