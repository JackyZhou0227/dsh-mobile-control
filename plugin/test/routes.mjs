import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { Registry } from '../host/registry.js'
import { StreamManager, FLAG_META } from '../host/scrcpy.js'
import { registerRoutes } from '../host/routes.js'
import { sessionAliveProbe } from '../index.js'

const ADB = process.env.ADB_PATH || 'adb'
const config = { adbPath: ADB, streamMaxFps: 30, streamMaxSize: 1024, uiDumpTimeoutMs: 20000 }

// ---- 假的 Cordis 上下文：只提供 routes.js 真正用到的那几样 ----
const registered = []
const created = []
const prompted = []
const modelsSelected = []
const permissionsSet = []
const archived = new Set()
const deleted = new Set()
const fakeSessions = {
  async create(options) {
    const sessionId = `session-${created.length + 1}`
    created.push({ sessionId, options })
    return { sessionId }
  },
  async prompt(request) {
    prompted.push(request)
    return { accepted: true }
  },
  async inspect(sessionId) {
    return { meta: { cwd: `/work/${sessionId}` } }
  },
  async selectModel(request) {
    modelsSelected.push(request)
    return { selected: { provider: request.provider, model: request.model } }
  },
  async modelCatalog() {
    return { default: { provider: 'deepseek', model: 'v4-flash' }, routableProviders: ['deepseek'], groups: [], failures: [] }
  },
}
const ctx = {
  effect(register) {
    return register()
  },
  webServer: {
    register(route) {
      registered.push(route)
      return () => {}
    },
  },
  get(name) {
    if (name === 'sessionController') return fakeSessions
    if (name === 'agentPresets') {
      return {
        async remoteExportList() {
          return { presets: [{ id: 'standard', name: '标准模式', isDefault: true }] }
        },
      }
    }
    if (name === 'permissionPresets') {
      return {
        catalog() {
          return { options: [{ value: 'workspace-write', name: '工作区内修改' }], defaultOptions: [], defaultPreset: 'workspace-write' }
        },
        set(session, name) {
          permissionsSet.push({ sessionId: session.id, name })
        },
      }
    }
    if (name === 'sessions') {
      return { get: (id) => (deleted.has(id) ? undefined : { id }) }
    }
    if (name === 'workspaceRegistry') {
      return {
        get archivedSessionIds() {
          return [...archived]
        },
      }
    }
    return undefined
  },
}

const registry = new Registry(config)
registry.setSessionProbe(sessionAliveProbe(ctx))
const streams = new StreamManager(config)
const base = '/mobile-control/test-token'
registerRoutes(ctx, { registry, streams, base })

assert.equal(registered.length, 1)
assert.equal(registered[0].kind, 'prefix')
assert.equal(registered[0].path, base)

const server = createServer((req, res) => {
  const path = new URL(req.url, 'http://127.0.0.1').pathname
  if (!path.startsWith(base)) {
    res.writeHead(404).end()
    return
  }
  Promise.resolve(registered[0].handler(req, res)).catch(() => {
    if (!res.headersSent) res.writeHead(500).end()
  })
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const origin = `http://127.0.0.1:${server.address().port}`

const json = async (path, init) => {
  const response = await fetch(`${origin}${base}${path}`, init)
  const body = await response.json()
  return { status: response.status, body }
}

try {
  // 未知路由
  assert.equal((await json('/nope')).status, 404)

  // 设备状态
  const state = await json('/state')
  assert.equal(state.status, 200)
  assert.ok(Array.isArray(state.body.devices))
  assert.ok(state.body.devices.length > 0, '没有设备，先接一台手机')
  const deviceId = state.body.devices.find((item) => item.state === 'online')?.id
  assert.ok(deviceId, '没有在线设备')
  const info = state.body.devices.find((item) => item.id === deviceId)
  assert.equal(info.os, 'Android', '缺系统信息')
  assert.ok(info.width > 0 && info.height > 0, '缺分辨率')
  assert.equal(info.connection, 'usb', '缺连接方式')
  console.log(`ok state: ${deviceId} ${info.os} ${info.osVersion ?? ''} ${info.width}x${info.height}`)

  // 认领：先按会话 A 认领，再让会话 B 抢，必须被拒
  const claimed = await json('/claim', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ deviceId, sessionId: 'session-A' }),
  })
  assert.equal(claimed.status, 200)
  assert.equal(claimed.body.lease, deviceId)

  const stolen = await json('/claim', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ deviceId, sessionId: 'session-B' }),
  })
  assert.equal(stolen.status, 500)
  assert.match(stolen.body.error, /正被另一个会话占用/)

  // 别的会话看到的视图：只标「被占用」+ 完整持有者 id（客户端用它跳转）
  const asOther = await json('/state?sessionId=session-B')
  const seen = asOther.body.devices.find((item) => item.id === deviceId)
  assert.equal(seen.claimedBy, 'other')
  assert.equal(seen.holderSessionId, 'session-A')
  console.log('ok 租约互斥')

  // 批量下发：设备已被 session-A 占用，应该复用而不是新建会话
  const dispatch = await json('/dispatch', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ deviceIds: [deviceId], prompt: '打开设置', sessionId: 'me' }),
  })
  assert.equal(dispatch.status, 200)
  assert.equal(dispatch.body.results[0].ok, true)
  assert.equal(dispatch.body.results[0].sessionId, 'session-A')
  assert.equal(created.length, 0, '不该给已有会话的设备新建会话')
  assert.equal(prompted[0].content[0].text, '打开设置')
  console.log('ok 批量下发复用租约')

  // 释放后再下发，应该自动建会话，并把 cwd / 预设 / 模型 / 权限一起落地
  await json('/release', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sessionId: 'session-A' }),
  })
  const dispatch2 = await json('/dispatch', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      deviceIds: [deviceId],
      prompt: '回到桌面',
      sessionId: 'me',
      agentPreset: 'standard',
      permission: 'workspace-write',
      model: { provider: 'deepseek', model: 'v4-flash' },
    }),
  })
  assert.equal(dispatch2.body.results[0].ok, true)
  assert.equal(created.length, 1)
  assert.equal(dispatch2.body.results[0].sessionId, created[0].sessionId)
  assert.equal(created[0].options.cwd, '/work/me', '应继承发起会话的 cwd')
  assert.equal(created[0].options.agentPreset, 'standard')
  assert.deepEqual(modelsSelected[0], {
    sessionId: created[0].sessionId,
    provider: 'deepseek',
    model: 'v4-flash',
  })
  assert.deepEqual(permissionsSet[0], { sessionId: created[0].sessionId, name: 'workspace-write' })

  // 选了工作区：落点跟着工作区走，覆盖「继承发起会话 cwd」
  await json('/release', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sessionId: created[0].sessionId }),
  })
  const dispatch3 = await json('/dispatch', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      deviceIds: [deviceId],
      prompt: '把截图存到工作区',
      sessionId: 'me',
      workspaceId: 'ws-1',
      workspacePath: '/ws/one',
    }),
  })
  assert.equal(dispatch3.body.results[0].ok, true)
  assert.equal(created.length, 2)
  // session.create 只接受 workspaceId 或 cwd 其一，两个都给会报「accepts workspaceId or cwd, not both」
  assert.equal(created[1].options.workspaceId, 'ws-1')
  assert.equal(created[1].options.cwd, undefined, '指定工作区时不能再传 cwd')
  console.log('ok 批量下发指定工作区')
  console.log('ok 批量下发自动建会话（cwd/预设/模型/权限）')

  // 会话归档 / 删除后自动解绑：租约跟着会话一起失效
  await json('/release', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sessionId: created[1].sessionId }),
  })
  await json('/claim', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ deviceId, sessionId: 'session-archived' }),
  })
  archived.add('session-archived')
  const afterArchive = await json('/state?sessionId=session-archived')
  assert.equal(afterArchive.body.lease, null, '归档的会话不该再持有手机')
  assert.equal(afterArchive.body.devices.find((item) => item.id === deviceId).claimedBy, 'free')

  await json('/claim', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ deviceId, sessionId: 'session-deleted' }),
  })
  deleted.add('session-deleted')
  const afterDelete = await json('/state?sessionId=session-deleted')
  assert.equal(afterDelete.body.lease, null, '删除的会话不该再持有手机')
  assert.equal(afterDelete.body.devices.find((item) => item.id === deviceId).claimedBy, 'free')
  console.log('ok 归档/删除会话自动解绑')

  // 设备列表里的兜底解绑：只给 deviceId 就能松开，不用知道是哪个会话持有
  await json('/claim', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ deviceId, sessionId: 'session-stuck' }),
  })
  const unbound = await json('/release', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ deviceId }),
  })
  assert.equal(unbound.status, 200)
  assert.equal(unbound.body.released, 'session-stuck')
  assert.equal(unbound.body.devices.find((item) => item.id === deviceId).claimedBy, 'free')
  console.log('ok 按设备解绑')

  // 下发栏的可选项
  const options = await json('/options')
  assert.equal(options.status, 200)
  assert.equal(options.body.presets[0].id, 'standard')
  assert.equal(options.body.presets[0].isDefault, true)
  assert.equal(options.body.permissions.defaultPreset, 'workspace-write')
  assert.equal(options.body.models.default.model, 'v4-flash')
  console.log('ok 可选项')

  // 插件图标：直接发 icon.svg，标签页用 <img> 引用
  const iconResponse = await fetch(`${origin}${base}/icon.svg`)
  assert.equal(iconResponse.status, 200)
  assert.match(iconResponse.headers.get('content-type') ?? '', /image\/svg\+xml/)
  const svg = await iconResponse.text()
  assert.match(svg, /<svg/)
  assert.match(svg, /#3B82FE/, '图标内容不对')
  console.log('ok 图标资源')

  // 目录选择：Node 里没有 Electron，必须干净地回落到客户端 pickDirectory
  const pick = await json('/pick-directory', { method: 'POST', body: '{}' })
  assert.equal(pick.status, 200)
  assert.equal(pick.body.ok, true)
  assert.equal(pick.body.electron, false, '没有 electron 时应该返回 electron:false')
  console.log('ok 目录选择回落')

  // 空提示词必须被拒
  const empty = await json('/dispatch', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ deviceIds: [deviceId], prompt: '   ' }),
  })
  assert.equal(empty.status, 500)

  // 投屏流：首包必须是 META（不用解码器也能验证隧道通了）
  const response = await fetch(`${origin}${base}/stream/${encodeURIComponent(deviceId)}`, {
    signal: AbortSignal.timeout(30000),
  })
  assert.equal(response.status, 200)
  const reader = response.body.getReader()
  let buffer = new Uint8Array(0)
  const deadline = Date.now() + 25000
  while (Date.now() < deadline) {
    const { value, done } = await reader.read()
    if (done) break
    const merged = new Uint8Array(buffer.length + value.length)
    merged.set(buffer)
    merged.set(value, buffer.length)
    buffer = merged
    if (buffer.length >= 9) {
      const length = new DataView(buffer.buffer, buffer.byteOffset).getUint32(0, true)
      if (buffer.length >= 9 + length) {
        assert.equal(buffer[4] & FLAG_META, FLAG_META, '首包应该是 META')
        const meta = JSON.parse(new TextDecoder().decode(buffer.slice(9, 9 + length)))
        assert.equal(meta.codec, 'h264')
        assert.ok(meta.width > 0)
        console.log(`ok 投屏流 ${meta.width}x${meta.height}`)
        break
      }
    }
  }
  await reader.cancel()
} finally {
  server.close()
  streams.dispose()
}

console.log('全部通过')
process.exit(0)
