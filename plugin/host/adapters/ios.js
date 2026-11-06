const UNSUPPORTED = 'iOS 适配器目前只实现了列出设备 / 截图 / 点击 / 滑动 / 输入 / 按键 / 启停 App。'

/**
 * iOS 骨架：走 WebDriverAgent 的 REST（WDA 必须跑在 macOS 上，本插件只连它的 URL）。
 * 一个 wdaBaseUrl 就是一台设备。未在 Windows 实机验证。
 */
export class IosAdapter {
  constructor(config) {
    this.platform = 'ios'
    this.baseUrl = String(config.wdaBaseUrl || '').replace(/\/+$/, '')
    this.id = 'wda'
    this.sessionId = null
  }

  async request(path, { method = 'GET', body } = {}) {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: body ? { 'content-type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(30000),
    })
    const text = await response.text()
    if (!response.ok) throw new Error(`WDA ${method} ${path} → HTTP ${response.status}：${text.slice(0, 300)}`)
    return text ? JSON.parse(text) : {}
  }

  async session() {
    if (this.sessionId) return this.sessionId
    const created = await this.request('/session', {
      method: 'POST',
      body: { capabilities: { alwaysMatch: {} } },
    })
    const sessionId = created?.value?.sessionId
    if (!sessionId) throw new Error('WDA 没有返回 sessionId，检查 WDA 是否已启动。')
    this.sessionId = sessionId
    return sessionId
  }

  async list() {
    const status = await this.request('/status')
    const name = status?.value?.device?.name ?? status?.value?.os?.version ?? this.id
    return [{ id: this.id, platform: 'ios', model: String(name), state: 'online' }]
  }

  async details() {
    try {
      const status = await this.request('/status')
      const value = status?.value ?? {}
      return {
        os: 'iOS',
        osVersion: value.os?.version,
        connection: 'usb',
      }
    } catch {
      return { os: 'iOS', connection: 'usb' }
    }
  }

  async screenshot() {
    const shot = await this.request('/screenshot')
    const data = shot?.value
    if (!data) throw new Error('WDA 截图没有返回数据')
    return { data: Buffer.from(data, 'base64'), mediaType: 'image/jpeg' }
  }

  async tap(_deviceId, x, y) {
    const sid = await this.session()
    await this.request(`/session/${sid}/wda/tap/0`, { method: 'POST', body: { x, y } })
  }

  async swipe(_deviceId, fromX, fromY, toX, toY, durationMs = 300) {
    const sid = await this.session()
    await this.request(`/session/${sid}/wda/dragfromtoforduration`, {
      method: 'POST',
      body: { fromX, fromY, toX, toY, duration: durationMs / 1000 },
    })
  }

  async text(_deviceId, value) {
    const sid = await this.session()
    await this.request(`/session/${sid}/wda/keys`, {
      method: 'POST',
      body: { value: [...value] },
    })
  }

  async key(_deviceId, name) {
    const sid = await this.session()
    if (name === 'back') {
      throw new Error('iOS 不提供系统返回键，请通过滑动手势或页面返回按钮返回。')
    }
    const names = { home: 'home', power: 'lock', volumeUp: 'volumeUp', volumeDown: 'volumeDown' }
    const button = names[name]
    if (!button) throw new Error(`iOS 不支持按键 ${name}`)
    await this.request(`/session/${sid}/wda/pressButton`, { method: 'POST', body: { name: button } })
  }

  async launch(_deviceId, target) {
    const sid = await this.session()
    await this.request(`/session/${sid}/wda/apps/launch`, {
      method: 'POST',
      body: { bundleId: target },
    })
  }

  async stop(_deviceId, target) {
    const sid = await this.session()
    await this.request(`/session/${sid}/wda/apps/terminate`, {
      method: 'POST',
      body: { bundleId: target },
    })
  }

  async uiDump() {
    throw new Error(UNSUPPORTED)
  }
}
