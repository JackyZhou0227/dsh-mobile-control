import { randomUUID } from 'node:crypto'
import { Registry } from './host/registry.js'
import { StreamManager } from './host/scrcpy.js'
import { registerRoutes } from './host/routes.js'
import { registerTools } from './host/tools.js'

const DEFAULTS = {
  adbPath: 'adb',
  hdcPath: 'hdc',
  wdaBaseUrl: '',
  streamMaxFps: 30,
  streamMaxSize: 1024,
  uiDumpTimeoutMs: 20000,
}

export const inject = ['tools', 'webServer', 'attachments']

export function apply(ctx, config) {
  const resolved = { ...DEFAULTS, ...(config ?? {}) }
  const registry = new Registry(resolved)
  const streams = new StreamManager(resolved)

  // webServer 的路由不经过 connection 鉴权，token 就是唯一的门。它只在 index.html 里出现，
  // 所以本机别的进程拿不到这个路径。
  const token = randomUUID()
  const base = `/mobile-control/${token}`

  ctx.effect(
    () => () => {
      streams.dispose()
    },
    'mobile-control: streams',
  )
  ctx.on('agent/disposed', ({ agent }) => {
    registry.release(agent.id)
  })
  ctx.on('webserver/index-inject', (table) => {
    table.push({ kind: 'global', name: '__DSH_MOBILE_CONTROL__', value: { base } })
  })

  registerTools(ctx, { registry })
  registerRoutes(ctx, { registry, streams, base })
}
