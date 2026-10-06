import { fileURLToPath } from 'node:url'

/** Mount Android browse backend + standard browse UI surface. */
export const name = 'directory-picker-android'
export const inject = ['webServer', 'loader']

const SURFACE = '@deepseek-ai/dsh-client-ui-directory-picker-browse'
const backend = fileURLToPath(new URL('./android-directory-picker-backend.js', import.meta.url))

export async function apply(ctx) {
  await ctx.effect(async () => {
    const ids = []
    const unmount = async () => {
      for (const id of [...ids].reverse()) {
        const entry = ctx.loader.store[id]
        if (entry === undefined) continue
        const disposal = entry.fiber?.dispose()
        ctx.loader.remove(id)
        await disposal
      }
    }
    try {
      for (const name of [backend, SURFACE]) {
        const id = await ctx.loader.create({ name })
        ids.push(id)
        const entry = ctx.loader.resolve(id)
        if (entry.fiber === undefined) throw new Error(`directory-picker-android: failed to load ${name}`)
        await entry.fiber.await()
      }
    } catch (cause) {
      await unmount()
      throw cause
    }
    return unmount
  }, 'directory-picker-android: interaction entries')
}
