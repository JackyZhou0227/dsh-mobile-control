import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { FLAG_IMAGE, FLAG_META, encodeFrame } from './scrcpy.js'

const requireFromPlugin = createRequire(import.meta.url)
const MAX_BODY_BYTES = 1024 * 1024
const SNAPSHOT_INTERVAL_MS = 1000

// 插件图标：客户端标签页/引导卡片直接引用这个文件，避免把 path 数据抄进 client.js。
let iconCache = null
const ICON_PATH = fileURLToPath(new URL('../icon.svg', import.meta.url))

async function serveIcon(res) {
  if (iconCache === null) iconCache = await readFile(ICON_PATH, 'utf8')
  const body = Buffer.from(iconCache, 'utf8')
  res.writeHead(200, {
    'Content-Type': 'image/svg+xml; charset=utf-8',
    // 图标会随手改，别让浏览器缓存一小时；文件才 6KB。
    'Cache-Control': 'no-cache',
    'Content-Length': body.length,
  })
  res.end(body)
}

/**
 * 自己弹目录对话框，而不是转发给 directoryPicker：
 * 宿主的 picker 用的是无 owner 的原生窗口，会被 DSH 主窗口压在下面。
 * 这里把当前 BrowserWindow 当 owner 传进去，窗口就永远在上面。
 */
async function pickDirectory() {
  let electron
  try {
    electron = requireFromPlugin('electron')
  } catch {
    return { ok: true, electron: false }
  }
  const { dialog, BrowserWindow } = electron ?? {}
  if (typeof dialog?.showOpenDialog !== 'function' || typeof BrowserWindow?.getAllWindows !== 'function') {
    return { ok: true, electron: false }
  }
  const win = BrowserWindow.getFocusedWindow?.() ?? BrowserWindow.getAllWindows()[0] ?? undefined
  const result = await dialog.showOpenDialog(win, {
    title: '选择工作区目录',
    buttonLabel: '用这个目录',
    properties: ['openDirectory', 'createDirectory'],
  })
  if (result?.canceled || !result?.filePaths?.length) return { ok: true, electron: true, path: null }
  return { ok: true, electron: true, path: result.filePaths[0] }
}

function sendJson(res, status, value) {
  const body = Buffer.from(JSON.stringify(value), 'utf8')
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': body.length,
  })
  res.end(body)
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        reject(new Error('请求体过大'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('error', reject)
    req.on('end', () => {
      if (chunks.length === 0) {
        resolve({})
        return
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      } catch {
        reject(new Error('请求体不是合法 JSON'))
      }
    })
  })
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function streamHeaders(res) {
  res.writeHead(200, {
    'Content-Type': 'application/octet-stream',
    'Cache-Control': 'no-store, no-cache, must-revalidate',
    Connection: 'keep-alive',
  })
}

/** scrcpy 视频流。 */
function pipeScrcpy({ streams, deviceId, restart, req, res }) {
  if (restart) streams.discard(deviceId)
  return streams.ensure(deviceId).then((producer) => {
    streamHeaders(res)
    let done = false
    const detach = producer.add(
      // ponytail: 不处理 res 背压，本地单 viewer 且 4Mbps 上限；哪天出现多 viewer 卡死再按帧丢弃 + 等 drain。
      (frame) => {
        if (!done) res.write(frame)
      },
      (message) => {
        if (done) return
        done = true
        detach()
        res.end(Buffer.from(message ?? '', 'utf8'))
      },
    )
    req.on('close', () => {
      if (done) return
      done = true
      detach()
      res.end()
    })
  })
}

/** 没有 scrcpy（非 Android / scrcpy 起不来）时的静态预览，1fps。 */
async function pipeSnapshots({ device, deviceId, req, res }) {
  streamHeaders(res)
  let seq = 0
  let done = false
  req.on('close', () => {
    done = true
  })
  res.write(
    encodeFrame(FLAG_META, ++seq, Buffer.from(JSON.stringify({ codec: 'jpeg', width: 0, height: 0 }))),
  )
  while (!done) {
    try {
      const shot = await device.adapter.screenshot(deviceId)
      const data = Buffer.isBuffer(shot.data) ? shot.data : Buffer.from(shot.data)
      res.write(encodeFrame(FLAG_IMAGE, ++seq, data))
    } catch (error) {
      if (!done) res.write(Buffer.from(`截图失败：${error.message}`, 'utf8'))
      break
    }
    await sleep(SNAPSHOT_INTERVAL_MS)
  }
  res.end()
}

/** 下发时可选的会话设置：预设、模型、权限。都从宿主现成的服务里读，不另存一份。 */
async function collectOptions(ctx) {
  const options = { presets: [], models: null, permissions: null }

  const presets = ctx.get('agentPresets')
  if (presets) {
    try {
      const roster = await presets.remoteExportList()
      options.presets = (roster?.presets ?? [])
        .filter((preset) => !preset.broken)
        .map((preset) => ({
          id: preset.id,
          name: preset.name ?? preset.id,
          isDefault: preset.isDefault === true,
        }))
    } catch (error) {
      options.presetsError = error?.message ?? String(error)
    }
  }

  const sessions = ctx.get('sessionController')
  if (sessions) {
    try {
      options.models = await sessions.modelCatalog()
    } catch (error) {
      options.modelsError = error?.message ?? String(error)
    }
  }

  const permissions = ctx.get('permissionPresets')
  if (permissions) {
    try {
      options.permissions = permissions.catalog()
    } catch (error) {
      options.permissionsError = error?.message ?? String(error)
    }
  }

  return options
}

/** 新会话落在发起会话的同一个目录里，等于同一个工作区。 */
async function resolveCwd(ctx, sessionId) {
  if (!sessionId) return undefined
  try {
    const inspection = await ctx.get('sessionController')?.inspect(sessionId)
    return inspection?.meta?.cwd
  } catch {
    return undefined
  }
}

/** 新建的会话按用户在下发栏里选的模型 / 权限落地；复用的会话保持原设置。 */
async function applySessionOptions(ctx, sessionId, body) {
  const controller = ctx.get('sessionController')
  const model = body?.model
  if (controller && model?.provider && model?.model) {
    await controller.selectModel({
      sessionId,
      provider: model.provider,
      model: model.model,
      ...(model.reasoningEffort ? { reasoningEffort: model.reasoningEffort } : {}),
    })
  }

  const permission = body?.permission
  if (permission) {
    const presets = ctx.get('permissionPresets')
    const session = ctx.get('sessions')?.get(sessionId)
    if (!presets || !session) throw new Error('当前配置不支持权限预设，因此无法应用权限设置。')
    presets.set(session, permission)
  }
}

async function dispatchBatch(ctx, registry, body) {
  const deviceIds = Array.isArray(body?.deviceIds) ? body.deviceIds : []
  const prompt = String(body?.prompt ?? '').trim()
  if (!prompt) throw new Error('任务内容不能为空。')
  if (deviceIds.length === 0) throw new Error('请至少选择一台设备。')

  const sessions = ctx.get('sessionController')
  if (!sessions) throw new Error('当前配置不支持会话创建，因此无法下发任务。')

  await registry.refresh(true)
  // 选了工作区就以它为落点（产物留在那里）；没选则跟随发起会话的目录。
  // session.create 只认 workspaceId 或 cwd 其一，两个都给会直接报错。
  const workspaceId = typeof body.workspaceId === 'string' ? body.workspaceId : undefined
  const cwd = workspaceId
    ? undefined
    : (typeof body.workspacePath === 'string' ? body.workspacePath : undefined) ??
      (await resolveCwd(ctx, body.sessionId))

  return Promise.all(
    deviceIds.map(async (deviceId) => {
      try {
        let sessionId = registry.holderOf(deviceId)
        if (sessionId === undefined) {
          const created = await sessions.create({
            ...(cwd ? { cwd } : {}),
            ...(workspaceId ? { workspaceId } : {}),
            ...(body.agentPreset ? { agentPreset: body.agentPreset } : {}),
          })
          sessionId = created.sessionId
          await applySessionOptions(ctx, sessionId, body)
          registry.claim(deviceId, sessionId)
        }
        await sessions.prompt(
          {
            requestId: randomUUID(),
            sessionId,
            mode: 'queue',
            content: [{ type: 'text', text: prompt }],
          },
          AbortSignal.timeout(30000),
        )
        return { deviceId, sessionId, ok: true }
      } catch (error) {
        return { deviceId, ok: false, error: error?.message ?? String(error) }
      }
    }),
  )
}

async function handle(ctx, { registry, streams, base }, req, res) {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1')
  const route = url.pathname.slice(base.length)
  const sessionId = url.searchParams.get('sessionId') ?? undefined

  if (route === '/state' && req.method === 'GET') {
    await registry.refresh()
    sendJson(res, 200, { ok: true, ...registry.view(sessionId) })
    return
  }

  if (route.startsWith('/stream/') && req.method === 'GET') {
    const deviceId = decodeURIComponent(route.slice('/stream/'.length))
    await registry.refresh()
    const device = registry.devices.get(deviceId)
    if (!device) {
      sendJson(res, 404, { ok: false, error: `未找到设备 ${deviceId}。` })
      return
    }
    const restart = url.searchParams.get('restart') === '1'
    if (device.platform === 'android') {
      try {
        await pipeScrcpy({ streams, deviceId, restart, req, res })
        return
      } catch {
        // scrcpy 起不来就退回静态预览，让面板至少不是黑的。
      }
    }
    await pipeSnapshots({ device, deviceId, req, res })
    return
  }

  if (route === '/claim' && req.method === 'POST') {
    const body = await readJson(req)
    await registry.refresh(true)
    const device = registry.claim(body.deviceId, body.sessionId ?? sessionId)
    sendJson(res, 200, { ok: true, deviceId: device.id, ...registry.view(body.sessionId) })
    return
  }

  if (route === '/release' && req.method === 'POST') {
    const body = await readJson(req)
    // deviceId 是设备列表里的兜底解绑：不关心是哪个会话持有的。
    const released = body.deviceId
      ? registry.releaseDevice(body.deviceId)
      : registry.release(body.sessionId ?? sessionId)
    sendJson(res, 200, {
      ok: true,
      released: released ?? null,
      ...registry.view(body.sessionId ?? sessionId),
    })
    return
  }

  if (route === '/options' && req.method === 'GET') {
    sendJson(res, 200, { ok: true, ...(await collectOptions(ctx)) })
    return
  }

  if (route === '/icon.svg' && req.method === 'GET') {
    await serveIcon(res)
    return
  }

  if (route === '/pick-directory' && req.method === 'POST') {
    sendJson(res, 200, await pickDirectory())
    return
  }

  if (route === '/dispatch' && req.method === 'POST') {
    const body = await readJson(req)
    const results = await dispatchBatch(ctx, registry, body)
    sendJson(res, 200, { ok: true, results })
    return
  }

  sendJson(res, 404, { ok: false, error: `未知路由 ${route}` })
}

export function registerRoutes(ctx, options) {
  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'prefix',
        path: options.base,
        handler: async (req, res) => {
          try {
            await handle(ctx, options, req, res)
          } catch (error) {
            if (res.headersSent) {
              res.end()
              return
            }
            sendJson(res, 500, { ok: false, error: error?.message ?? String(error) })
          }
        },
      }),
    'mobile-control: routes',
  )
}
