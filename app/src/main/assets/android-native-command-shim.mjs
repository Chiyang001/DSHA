import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)
const bridge = require('./android-native-command.cjs')
const original = await import(pathToFileURL(join(here, 'node_modules/@deepseek-ai/dsh-native-command/lib/index.js')).href)

export const {
  desktopApplicationIcon,
  desktopDataDirectories,
  desktopEntryFields,
  nativeFileManager,
  revealNativePath,
  runNativeCommand,
} = original

export const openNativePath = bridge.openNativePath
export const openNativeTextFile = bridge.openNativeTextFile
export const canOpenNativePath = bridge.canOpenNativePath
export const openNativeAssociatedPath = bridge.openNativeAssociatedPath
export const nativeFileApplications = bridge.nativeFileApplications
export const openNativeFileApplication = bridge.openNativeFileApplication
