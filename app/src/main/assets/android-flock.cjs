const { getSystemErrorName } = require('node:util')
let binding
function loadBinding() {
  if (!binding) {
    if (!process.env.DSH_ANDROID_FLOCK_LIBRARY) throw new Error('Android flock library path is missing')
    const native = { exports: {} }
    process.dlopen(native, process.env.DSH_ANDROID_FLOCK_LIBRARY)
    binding = native.exports
  }
  return binding
}
function check(errno, syscall) {
  if (!errno) return
  const code = getSystemErrorName(-errno)
  throw Object.assign(new Error(`${code}: ${syscall} failed`), { code, errno, syscall })
}
exports.tryLockExclusive = async function (fd) {
  check(loadBinding().tryLock(fd), 'flock')
}
exports.publishNew = async function (source, destination) {
  check(loadBinding().publishNew(source, destination), 'renameat2')
}
// Attachment aliases must keep the source object. Copy to a private sibling,
// sync it, then publish exclusively, rather than exposing a partial copy.
exports.publishCopyNew = async function (source, destination) {
  const fs = require('node:fs/promises')
  const { constants } = require('node:fs')
  const temp = `${destination}.${require('node:crypto').randomUUID()}.android-tmp`
  try {
    await fs.copyFile(source, temp, constants.COPYFILE_EXCL)
    await fs.chmod(temp, 0o600)
    const handle = await fs.open(temp, 'r+')
    try { await handle.sync() } finally { await handle.close() }
    await exports.publishNew(temp, destination)
  } finally { await fs.rm(temp, { force: true }) }
}
exports.durableBoundary = async function (home, dataRoot) {
  const { dirname, resolve } = require('node:path')
  const { realpath } = require('node:fs/promises')
  // Android owns and durably creates the application's data directory; apps
  // cannot open/fsync its system-owned ancestors (/data/user/0, /data, /).
  const appRoot = await realpath(dataRoot ?? dirname(process.env.HOME))
  let ancestor = resolve(home)
  while (true) {
    if (await realpath(ancestor).catch(() => undefined) === appRoot) return ancestor
    const parent = dirname(ancestor)
    if (parent === ancestor) throw new Error('Attachment home is outside Android application data')
    ancestor = parent
  }
}
