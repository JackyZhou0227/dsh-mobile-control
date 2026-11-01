const KEY_NAMES = ['back', 'home', 'recents', 'enter', 'power', 'volumeUp', 'volumeDown']
const ACTIONS = ['tap', 'swipe', 'type', 'key', 'launch', 'stop']

function sessionIdOf(exec) {
  const id = exec?.agent?.id
  if (!id) throw new Error('这个工具只能在会话里调用。')
  return id
}

function asText(value, limit = 8000) {
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2)
  return text.length > limit ? `${text.slice(0, limit)}\n…（已截断）` : text
}

function textOutput(schema) {
  return { schema, render: (_args, value) => [{ type: 'text', text: asText(value) }] }
}

const DEVICE_ID = {
  type: 'string',
  description: '设备 id（adb serial）。省略时用本会话已认领的设备，没有就认领唯一的空闲设备。',
}

/** 在 UI 树里按文字找可点的节点；精确匹配优先，其次取第一个可点的包含匹配。 */
function findNode(nodes, query) {
  const needle = query.trim().toLowerCase()
  const hits = nodes.filter(
    (node) =>
      node.text.toLowerCase() === needle ||
      node.desc.toLowerCase() === needle ||
      (node.text && node.text.toLowerCase().includes(needle)) ||
      (node.desc && node.desc.toLowerCase().includes(needle)),
  )
  if (hits.length === 0) return undefined
  return hits.find((node) => node.clickable) ?? hits[0]
}

export function registerTools(ctx, { registry }) {
  const tools = []

  tools.push({
    name: 'mobile_devices',
    description:
      '列出当前接上的手机及占用情况。claimedBy 是 free 表示空闲可认领，me 表示本会话已占用，其它值是别的会话在占用。',
    parameters: { type: 'object', properties: {} },
    output: textOutput({ type: 'object' }),
    isConcurrencySafe: () => true,
    async execute(_args, exec) {
      await registry.refresh(true)
      return registry.view(sessionIdOf(exec))
    },
  })

  tools.push({
    name: 'mobile_use',
    description:
      '认领一台手机给当前会话。一台手机同时只能被一个会话操作。只接一台手机时可以省略 deviceId。',
    parameters: {
      type: 'object',
      properties: { deviceId: DEVICE_ID },
    },
    output: textOutput({ type: 'object' }),
    async execute(args, exec) {
      const device = await registry.resolve(sessionIdOf(exec), args?.deviceId)
      return { ok: true, deviceId: device.id, platform: device.platform, model: device.model }
    },
  })

  tools.push({
    name: 'mobile_release',
    description: '释放当前会话占用的手机，让别的会话可以认领它。',
    parameters: { type: 'object', properties: {} },
    output: textOutput({ type: 'object' }),
    async execute(_args, exec) {
      const deviceId = registry.release(sessionIdOf(exec))
      return { ok: true, released: deviceId ?? null }
    },
  })

  tools.push({
    name: 'mobile_screenshot',
    description:
      '截取当前手机屏幕并返回图片。动手之前先截图看一眼；每一步操作之后再截一次确认结果。',
    parameters: {
      type: 'object',
      properties: { deviceId: DEVICE_ID },
    },
    output: {
      schema: { type: 'object' },
      render: (_args, value) => [
        { type: 'text', text: `设备 ${value.deviceId} 的屏幕截图` },
        { type: 'image', attachment: value.image },
      ],
    },
    timeoutMs: 60000,
    isConcurrencySafe: () => false,
    async execute(args, exec) {
      const device = await registry.resolve(sessionIdOf(exec), args?.deviceId)
      const shot = await device.adapter.screenshot(device.id)
      const image = await ctx.attachments.saveImage({
        data: shot.data,
        mediaType: shot.mediaType,
        name: `${device.id}-${Date.now()}.png`,
      })
      return { ok: true, deviceId: device.id, width: image.width, height: image.height, image }
    },
  })

  tools.push({
    name: 'mobile_ui',
    description:
      '读取当前界面的可操作节点列表（文字、描述、点击坐标），比截图更适合找精确坐标。注意：在部分机器上一次要数秒。',
    parameters: {
      type: 'object',
      properties: { deviceId: DEVICE_ID },
    },
    output: textOutput({ type: 'object' }),
    timeoutMs: 60000,
    isConcurrencySafe: () => false,
    async execute(args, exec) {
      const device = await registry.resolve(sessionIdOf(exec), args?.deviceId)
      const dump = await device.adapter.uiDump(device.id)
      return { ok: true, deviceId: device.id, text: dump.text, nodes: dump.nodes.length }
    },
  })

  tools.push({
    name: 'mobile_action',
    description: [
      '操作手机。action 取值：',
      'tap（点按：给 x/y，或给 text 按界面文字定位）、',
      'swipe（给 fromX/fromY/toX/toY，可选 durationMs）、',
      'type（给 text 输入文字，先点中输入框）、',
      `key（给 key，取值 ${KEY_NAMES.join('/')}）、`,
      'launch / stop（给 target 包名，例如 com.android.settings）。',
      '操作后建议再调 mobile_screenshot 确认。',
    ].join(''),
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ACTIONS },
        deviceId: DEVICE_ID,
        x: { type: 'number', description: 'tap 的横坐标' },
        y: { type: 'number', description: 'tap 的纵坐标' },
        text: { type: 'string', description: 'tap 时是要找的界面文字；type 时是要输入的内容' },
        fromX: { type: 'number' },
        fromY: { type: 'number' },
        toX: { type: 'number' },
        toY: { type: 'number' },
        durationMs: { type: 'number', description: 'swipe 持续时间，默认 300' },
        key: { type: 'string', enum: KEY_NAMES },
        target: { type: 'string', description: 'launch / stop 的包名' },
      },
      required: ['action'],
    },
    output: textOutput({ type: 'object' }),
    timeoutMs: 60000,
    isConcurrencySafe: () => false,
    async execute(args, exec) {
      const action = args?.action
      if (!ACTIONS.includes(action)) throw new Error(`不支持的 action：${action}`)
      const device = await registry.resolve(sessionIdOf(exec), args?.deviceId)
      const adapter = device.adapter

      if (action === 'tap') {
        if (Number.isFinite(args.x) && Number.isFinite(args.y)) {
          await adapter.tap(device.id, args.x, args.y)
          return { ok: true, deviceId: device.id, action, x: args.x, y: args.y }
        }
        if (typeof args.text === 'string' && args.text !== '') {
          const dump = await adapter.uiDump(device.id)
          const node = findNode(dump.nodes, args.text)
          if (!node) throw new Error(`界面上没找到「${args.text}」，先用 mobile_ui 看看有哪些节点。`)
          await adapter.tap(device.id, node.center.x, node.center.y)
          return { ok: true, deviceId: device.id, action, matched: node.text || node.desc, ...node.center }
        }
        throw new Error('tap 需要 x/y 坐标，或者 text 作为定位文字。')
      }

      if (action === 'swipe') {
        const coords = [args.fromX, args.fromY, args.toX, args.toY]
        if (coords.some((value) => !Number.isFinite(value))) {
          throw new Error('swipe 需要 fromX/fromY/toX/toY。')
        }
        await adapter.swipe(device.id, args.fromX, args.fromY, args.toX, args.toY, args.durationMs ?? 300)
        return { ok: true, deviceId: device.id, action }
      }

      if (action === 'type') {
        if (typeof args.text !== 'string') throw new Error('type 需要 text。')
        await adapter.text(device.id, args.text)
        return { ok: true, deviceId: device.id, action, length: args.text.length }
      }

      if (action === 'key') {
        if (!args.key) throw new Error(`key 需要 key，取值 ${KEY_NAMES.join('/')}。`)
        await adapter.key(device.id, args.key)
        return { ok: true, deviceId: device.id, action, key: args.key }
      }

      if (!args.target) throw new Error(`${action} 需要 target 包名。`)
      if (action === 'launch') await adapter.launch(device.id, args.target)
      else await adapter.stop(device.id, args.target)
      return { ok: true, deviceId: device.id, action, target: args.target }
    },
  })

  ctx.effect(() => {
    const disposers = tools.map((tool) => ctx.tools.register(tool))
    return () => disposers.forEach((dispose) => dispose())
  }, 'mobile-control: tools')
}
