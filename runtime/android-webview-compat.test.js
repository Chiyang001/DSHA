import { test } from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { ANDROID_COMPAT_SCRIPT, apply } from './android-host.js'

function legacy() {
  const context = vm.createContext({ AbortController, DOMException })
  // Independent signal classes prevent modifying the test process's globals.
  vm.runInContext(`
    class AbortSignal extends EventTarget {
      aborted = false; reason = undefined;
    }
    class AbortController {
      signal = new AbortSignal();
      abort(reason) {
        if (this.signal.aborted) return;
        this.signal.aborted = true;
        this.signal.reason = reason;
        this.signal.dispatchEvent(new Event('abort'));
      }
    }
    Promise.withResolvers = undefined;
    Array.prototype.toSorted = undefined;
  `, Object.assign(context, { EventTarget, Event }))
  return context
}

test('old WebView session deferred fails without compatibility and works with it', async () => {
  const context = legacy()
  assert.throws(() => vm.runInContext('Promise.withResolvers()', context), /not a function/)
  vm.runInContext(ANDROID_COMPAT_SCRIPT, context)
  const result = vm.runInContext(`(async () => {
    const opening = Promise.withResolvers();
    const stream = Promise.withResolvers();
    opening.resolve('session-open');
    stream.resolve('reply');
    return [await opening.promise, await stream.promise];
  })()`, context)
  assert.deepEqual(Array.from(await result), ['session-open', 'reply'])
  await assert.rejects(vm.runInContext(`(() => {
    const task = Promise.withResolvers(); task.reject(new Error('failed')); return task.promise;
  })()`, context), /failed/)
  assert.equal(vm.runInContext(`class Child extends Promise {}; Promise.withResolvers.call(Child).promise instanceof Child`, context), true)
})

test('combined cancellation preserves first reason and removes source listeners', () => {
  const context = legacy()
  vm.runInContext(ANDROID_COMPAT_SCRIPT, context)
  assert.equal(vm.runInContext(`(() => {
    const first = new AbortController(), second = new AbortController();
    let removed = 0;
    for (const input of [first.signal, second.signal]) {
      const original = input.removeEventListener;
      input.removeEventListener = function (...args) { removed++; original.apply(this, args); };
    }
    const signal = AbortSignal.any([first.signal, second.signal]);
    second.abort('stop'); first.abort('later');
    let thrown;
    try { signal.throwIfAborted(); } catch (error) { thrown = error; }
    return signal.aborted && signal.reason === 'stop' && thrown === 'stop' && removed === 2;
  })()`, context), true)
  assert.equal(vm.runInContext(`(() => {
    const input = new AbortController(); input.abort('already');
    return AbortSignal.any([input.signal]).reason === 'already' && !AbortSignal.any([]).aborted;
  })()`, context), true)
  assert.throws(() => vm.runInContext('AbortSignal.any([{}])', context), /Expected an AbortSignal/)
})

test('sorting keeps source intact and compatibility preserves native implementations', () => {
  const context = legacy()
  vm.runInContext(ANDROID_COMPAT_SCRIPT, context)
  assert.equal(vm.runInContext(`const input = [3, 1, 2]; input.toSorted().join() === '1,2,3' && input.join() === '3,1,2'`, context), true)
  const before = vm.runInContext('Promise.withResolvers', context)
  vm.runInContext(ANDROID_COMPAT_SCRIPT, context)
  assert.equal(vm.runInContext('Promise.withResolvers', context), before)
  assert.equal(vm.runInContext(`typeof Symbol.dispose === 'symbol' && typeof Symbol.asyncDispose === 'symbol'`, context), true)
})

test('compatibility is placed before kernel bootstrap and boot readiness', () => {
  let inject
  apply({ on: (event, handler) => { inject = handler }, inject() {} })
  const table = [{ kind: 'script-src', placement: 'head', src: '/kernel-bootstrap.js' }]
  inject(table)
  assert.equal(table[0].placement, 'head')
  assert.equal(table[0].text, ANDROID_COMPAT_SCRIPT)
  assert.equal(table[1].src, '/kernel-bootstrap.js')
})
