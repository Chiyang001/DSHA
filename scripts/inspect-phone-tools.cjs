// Read-only diagnostics. Never prints user messages, credentials or tool args.
const { execFileSync } = require('node:child_process')
const { zstdDecompressSync } = require('node:zlib')
const adb = process.argv[2]
if (!adb) throw new Error('Usage: node inspect-phone-tools.cjs <adb path>')
const shell = (...args) => execFileSync(adb, ['exec-out', 'run-as', 'app.dsh.android', ...args], { maxBuffer: 32 * 1024 * 1024 })
const root = 'no_backup/dsh-home/sessions/--storage-emulated-0--'
const dirs = shell('ls', root).toString().trim().split(/\s+/)
for (const dir of dirs) {
  const bytes = shell('cat', `${root}/${dir}/session.v4.jsonl.zstd`)
  const chunks = []
  let offset = 0
  while (offset < bytes.length) {
    const frame = zstdDecompressSync(bytes.subarray(offset), { info: true })
    if (!frame.engine.bytesWritten) throw new Error('No frame progress')
    chunks.push(frame.buffer)
    offset += frame.engine.bytesWritten
  }
  const lines = Buffer.concat(chunks).toString().trim().split('\n')
  const types = {}, tools = {}, shapes = {}, samples = [], pending = new Map(), durations = [], outcomes = []
  for (const line of lines) {
    let event
    try { event = JSON.parse(line) } catch { continue }
    const type = event.type ?? event.event?.type ?? 'unknown'
    const data = event.data ?? event.event?.data ?? {}
    types[type] = (types[type] ?? 0) + 1
    if (type === 'tool/call') {
      const name = data.name ?? 'unknown'
      tools[name] = (tools[name] ?? 0) + 1
      pending.set(data.callId, { name, time: typeof event.time === 'number' ? event.time : Date.parse(event.time) })
    }
    if (type === 'tool/result') {
      const text = JSON.stringify(data)
      const flags = ['ANDROID_LOOP_BLOCKED', 'STALE_SCREEN', 'ACTION_OUTCOME_UNKNOWN', 'NO_OBSERVED_CHANGE', 'UNKNOWN_TOOL', 'INVALID', 'ASCII', 'first', 'stale', 'required', 'coordinate', 'index'].filter(flag => text.includes(flag))
      if (flags.length) samples.push({ flags, isError: data.isError, keys: Object.keys(data) })
      const call = pending.get(data.message?.toolCallId ?? data.callId)
      const time = typeof event.time === 'number' ? event.time : Date.parse(event.time)
      if (call && Number.isFinite(time - call.time)) durations.push({ name: call.name, ms: time - call.time })
      const blocks = data.message?.content ?? []
      const content = blocks.filter(block => block.type === 'text').map(block => block.text).join('\n')
      if (call?.name.startsWith('android_')) outcomes.push({ name: call.name, error: data.message?.isError, empty: content.length === 0, flags })
      shapes[Object.keys(data).join(',')] = (shapes[Object.keys(data).join(',')] ?? 0) + 1
    }
  }
  console.log(JSON.stringify({ session: dir, types, tools, outcomes, durations: durations.filter(item => item.name.startsWith('android_')).slice(-24) }))
}
