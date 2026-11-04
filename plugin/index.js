import { randomUUID } from 'node:crypto'
import { Provisioner } from './host/provision.js'
import { Registry } from './host/registry.js'
import { StreamManager } from './host/scrcpy.js'
import { registerRoutes } from './host/routes.js'
import { registerTools } from './host/tools.js'

const DEFAULTS = {
  adbPath: 'adb',
  hdcPath: 'hdc',
  // 缺 adb 时自动下载 platform-tools 到用户缓存目录；设成 false 就只按配置/PATH 找。
  autoProvision: true,
  wdaBaseUrl: '',
  streamMaxFps: 30,
  streamMaxSize: 1024,
  uiDumpTimeoutMs: 20000,
}

export const inject = ['tools', 'webServer', 'attachments']

/** 会话还能不能持有手机：会话从 store 里消失了（删除），或者进了归档集合。 */
export function sessionAliveProbe(ctx) {
  return (sessionId) => {
    const sessions = ctx.get('sessions')
    // 这个 profile 没有会话服务时不做判断，否则会把所有租约误清。
    if (typeof sessions?.get !== 'function') return true
    if (!sessions.get(sessionId)) return false
    return !(ctx.get('workspaceRegistry')?.archivedSessionIds ?? []).includes(sessionId)
  }
}

export function apply(ctx, config) {
  const resolved = { ...DEFAULTS, ...(config ?? {}) }
  const provision = new Provisioner(resolved)
  const registry = new Registry(resolved, provision)
  const streams = new StreamManager(resolved, provision)

  registry.setSessionProbe(sessionAliveProbe(ctx))

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
