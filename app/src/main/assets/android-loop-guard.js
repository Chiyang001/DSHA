import { createHash } from 'node:crypto'

// Structural evidence, not proof of task completion. Empty trees are unknown.
export function screenFingerprint(snapshot) {
  if (snapshot.fingerprint) return snapshot.fingerprint
  if (!snapshot.elements.length) return null
  return createHash('sha256').update(JSON.stringify([
    snapshot.width, snapshot.height,
    snapshot.elements.map(({ source, text, description, resourceId, className, bounds, clickable, scrollable }) =>
      [source, text, description, resourceId, className, bounds, clickable, scrollable]),
  ])).digest('hex')
}

export class AndroidLoopGuard {
  constructor() { this.history = []; this.blocked = 0 }

  begin(state, action) {
    const matches = this.history.filter(entry => entry.state === state && entry.action === action)
    const uncertain = matches.some(entry => entry.outcome === 'unknown')
    const unchanged = matches.filter(entry => entry.outcome === 'unchanged').length
    if (uncertain || unchanged >= 2 || matches.length >= 3) {
      this.blocked++
      const error = new Error('ANDROID_LOOP_BLOCKED: This action has already failed to change this screen, has an unknown outcome, or repeats a screen/action cycle. No input was sent. Inspect the current screen and choose a different strategy; do not repeat or bypass the blocked action. If the task cannot progress, explain the blocker and stop.')
      error.code = 'ANDROID_LOOP_BLOCKED'
      throw error
    }
    const entry = { state, action, outcome: 'unknown' }
    this.history.push(entry)
    this.history = this.history.slice(-32)
    return entry
  }

  finish(entry, after) {
    entry.outcome = entry.state === null || after === null ? 'unknown'
      : entry.state === after ? 'unchanged' : 'changed'
    return entry.outcome
  }
}
