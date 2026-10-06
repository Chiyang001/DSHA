const { test } = require('node:test')
const assert = require('node:assert/strict')
const { spawnSync } = require('node:child_process')
const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = require('node:fs')
const { join } = require('node:path')
const { tmpdir } = require('node:os')
const { pathToFileURL } = require('node:url')

test('real Android bootstrap adapts native-command for ESM and CommonJS plugins', () => {
  const temp = mkdtempSync(join(tmpdir(), 'dsha-plugin-interop-'))
  try {
    const code = `
      const assert = require('node:assert/strict');
      Object.defineProperty(process, 'platform', { value: 'android' });
      require(${JSON.stringify(join(__dirname, 'mobile-bootstrap.cjs'))});
      (async () => {
        const cjs = require('@deepseek-ai/dsh-native-command');
        const esm = await import('@deepseek-ai/dsh-native-command');
        for (const mod of [cjs, esm]) {
          assert.equal(mod.canOpenNativePath(), true);
          assert.equal(typeof mod.runNativeCommand, 'function');
          await assert.rejects(mod.openNativeAssociatedPath('relative.pdf'), /absolute Android/);
          await assert.rejects(mod.openNativeFileApplication('/file.pdf', ''), /application identifier/);
        }
      })().catch(e => { console.error(e); process.exitCode = 1 });
    `
    const result = spawnSync(process.execPath, ['-e', code], {
      cwd: __dirname, encoding: 'utf8', env: { ...process.env, DSH_HOME: join(temp, 'home') },
    })
    assert.equal(result.status, 0, result.stderr || result.stdout)
  } finally { rmSync(temp, { recursive: true, force: true }) }
})

test('Android bootstrap redirects native-command to the Android shim', () => {
  const temp = mkdtempSync(join(tmpdir(), 'dsha-native-command-test-'))
  try {
    const native = join(temp, 'node_modules/@deepseek-ai/dsh-native-command/lib/index.js')
    mkdirSync(require('node:path').dirname(native), { recursive: true })
    writeFileSync(join(require('node:path').dirname(native), 'package.json'), '{"type":"module"}')
    writeFileSync(native, `function canOpenNativePath() { return false }
function runNativeCommand() {}
export { canOpenNativePath, runNativeCommand };`)
    const shim = join(temp, 'android-native-command-shim.mjs')
    const bridge = join(temp, 'android-native-command.cjs')
    writeFileSync(bridge, `exports.canOpenNativePath = () => true
exports.openNativeTextFile = async () => {}
exports.openNativePath = async () => {}`)
    writeFileSync(shim, `import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
const here = dirname(fileURLToPath(import.meta.url))
const bridge = createRequire(import.meta.url)('./android-native-command.cjs')
const original = await import(pathToFileURL(join(here, 'node_modules/@deepseek-ai/dsh-native-command/lib/index.js')).href)
export const { runNativeCommand } = original
export const canOpenNativePath = bridge.canOpenNativePath
export const openNativeTextFile = bridge.openNativeTextFile
export const openNativePath = bridge.openNativePath`)
    writeFileSync(join(temp, 'mobile-bootstrap.cjs'), `const Module = require('node:module')
const { pathToFileURL } = require('node:url')
const { join } = require('node:path')
const nativeCommandShim = pathToFileURL(join(__dirname, 'android-native-command-shim.mjs')).href
Module.registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === '@deepseek-ai/dsh-native-command') return { url: nativeCommandShim, shortCircuit: true }
    return nextResolve(specifier, context)
  },
})`)
    const code = `
      Object.defineProperty(process, 'platform', { value: 'android' });
      require(${JSON.stringify(join(temp, 'mobile-bootstrap.cjs'))});
      (async () => {
        const mod = await import('@deepseek-ai/dsh-native-command');
        assert.equal(mod.canOpenNativePath(), true);
      })().catch(e => { console.error(e); process.exitCode = 1 });
    `
    const result = spawnSync(process.execPath, ['-e', code], { encoding: 'utf8', cwd: temp })
    assert.equal(result.status, 0, result.stderr || result.stdout)
  } finally { rmSync(temp, { recursive: true, force: true }) }
})

test('Android bootstrap maps subprocess-local terminal inspection to linux', () => {
  const temp = mkdtempSync(join(tmpdir(), 'dsha-inspector-test-'))
  try {
    const runner = join(temp, 'node_modules/@deepseek-ai/dsh-subprocess-local/lib/runner-launch-test.js')
    mkdirSync(require('node:path').dirname(runner), { recursive: true })
    writeFileSync(join(require('node:path').dirname(runner), 'package.json'), '{"type":"module"}')
    writeFileSync(runner, `const DEFAULT_INTERNALS = {}
class LinuxProcessInspector {}
function createProcessInspector(platform = process.platform, arch = process.arch, internals = DEFAULT_INTERNALS) {
	if (platform === "linux") return new LinuxProcessInspector();
	throw new Error(\`subprocess-local: terminal inspection is unsupported on platform \${platform}\`);
}
export { createProcessInspector, LinuxProcessInspector };`)
    const code = `
      Object.defineProperty(process, 'platform', { value: 'android' });
      require(${JSON.stringify(join(__dirname, 'mobile-bootstrap.cjs'))});
      (async () => {
        const mod = await import(${JSON.stringify(pathToFileURL(runner).href)});
        assert.ok(mod.createProcessInspector() instanceof mod.LinuxProcessInspector);
      })().catch(e => { console.error(e); process.exitCode = 1 });
    `
    const result = spawnSync(process.execPath, ['-e', code], { encoding: 'utf8', env: { ...process.env, DSH_HOME: join(temp, 'home') } })
    assert.equal(result.status, 0, result.stderr || result.stdout)
  } finally { rmSync(temp, { recursive: true, force: true }) }
})

test('Android bootstrap loads the APK PTY library for CommonJS and ESM callers', () => {
  const temp = mkdtempSync(join(tmpdir(), 'dsha-pty-test-'))
  try {
    const utils = join(temp, 'node_modules/node-pty/lib/utils.js')
    mkdirSync(require('node:path').dirname(utils), { recursive: true })
    writeFileSync(utils, 'function loadNativeModule(name) { throw new Error("missing prebuild") }\nexports.loadNativeModule = loadNativeModule')
    const code = `
      Object.defineProperty(process, 'platform', { value: 'android' });
      process.env.DSH_ANDROID_PTY_LIBRARY = '/apk/libdshpty.so';
      const calls = [];
      process.dlopen = (mod, path) => { calls.push(path); mod.exports = { fork: () => 'native' }; };
      require(${JSON.stringify(join(__dirname, 'mobile-bootstrap.cjs'))});
      (async () => {
        const assert = require('node:assert/strict');
        for (const mod of [require(${JSON.stringify(utils)}), await import(${JSON.stringify(pathToFileURL(utils).href)})]) {
          const native = mod.loadNativeModule('pty');
          assert.equal(native.module.fork(), 'native');
          assert.equal(native.dir, '/apk');
        }
        assert.deepEqual(calls, ['/apk/libdshpty.so', '/apk/libdshpty.so']);
      })().catch(e => { console.error(e); process.exitCode = 1 });
    `
    const result = spawnSync(process.execPath, ['-e', code], { encoding: 'utf8', env: { ...process.env, DSH_HOME: join(temp, 'home') } })
    assert.equal(result.status, 0, result.stderr || result.stdout)
  } finally { rmSync(temp, { recursive: true, force: true }) }
})

test('Android bootstrap redirects ESM flock and exclusively publishes session and filesystem temp files', () => {
  const temp = mkdtempSync(join(tmpdir(), 'dsha-loader-test-'))
  try {
    const session = join(temp, 'node_modules/@deepseek-ai/dsh-session-persistence-jsonl/lib/index.js')
    const local = join(temp, 'node_modules/@deepseek-ai/dsh-fs-local/lib/index.js')
    for (const file of [session, local]) {
      mkdirSync(require('node:path').dirname(file), { recursive: true })
      writeFileSync(join(require('node:path').dirname(file), 'package.json'), '{"type":"module"}')
    }
    writeFileSync(session, 'export async function save(tmp, finalPath) { await link(tmp, finalPath) }\nexport async function migrate(staged, currentPath) { await internals.fs.link(staged, currentPath) }')
    writeFileSync(local, 'export async function save(tempPath, absolutePath) { await linkFile(tempPath, absolutePath) }')
    const code = `
      Object.defineProperty(process, 'platform', { value: 'android' });
      process.env.DSH_ANDROID_FLOCK_LIBRARY = 'test-native';
      const calls = [];
      const again = -[...require('node:util').getSystemErrorMap()].find(([,value]) => value[0] === 'EAGAIN')[0];
      process.dlopen = mod => { mod.exports = { tryLock: fd => fd === 2 ? again : 0, publishNew: (a,b) => { calls.push([a,b]); return 0 } } };
      require(${JSON.stringify(join(__dirname, 'mobile-bootstrap.cjs'))});
      (async () => {
        const assert = require('node:assert/strict');
        const {tryLockExclusive} = await import('@deepseek-ai/node-addon-system/flock');
        await tryLockExclusive(1);
        await assert.rejects(tryLockExclusive(2), {code:'EAGAIN', syscall:'flock'});
        const session = await import(${JSON.stringify(pathToFileURL(session).href)});
        await session.save('a','b'); await session.migrate('c','d');
        await (await import(${JSON.stringify(pathToFileURL(local).href)})).save('e','f');
        assert.deepEqual(calls, [['a','b'],['c','d'],['e','f']]);
      })().catch(e => { console.error(e); process.exitCode=1 });
    `
    const result = spawnSync(process.execPath, ['-e', code], { encoding: 'utf8', env: { ...process.env, DSH_HOME: join(temp, 'home') } })
    assert.equal(result.status, 0, result.stderr)
  } finally { rmSync(temp, { recursive: true, force: true }) }
})
