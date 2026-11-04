import { AndroidAdapter } from './adapters/android.js'
import { HarmonyAdapter } from './adapters/harmony.js'
import { IosAdapter } from './adapters/ios.js'
import { Provisioner } from './provision.js'

const REFRESH_TTL_MS = 2000
// 系统版本、分辨率这类信息几乎不变，缓存久一点，别每 3 秒轮询都去 shell 一次。
const DETAIL_TTL_MS = 60000

/**
 * 设备表 + 租约。
 *
 * 租约规则（会话 ↔ 设备 1:1）：
 * - 一台设备同时只能被一个会话持有；
 * - 一个会话同时只持有一台设备；
 * - 租约只存在内存里，插件重载后重新认领即可。
 */
export class Registry {
  constructor(config, provision) {
    this.config = config
    this.provision = provision ?? new Provisioner(config)
    this.android = new AndroidAdapter(config, this.provision)
    this.harmony = new HarmonyAdapter(config, this.provision)
    this.ios = new IosAdapter(config)
    this.devices = new Map()
    this.errors = []
    this.broken = new Set()
    this.claims = new Map()
    this.leases = new Map()
    this.detailCache = new Map()
    this.refreshedAt = 0
    this.pending = null
  }

  /** 设备的系统/分辨率/连接方式，按设备缓存一分钟。 */
  async detailsOf(device) {
    const cached = this.detailCache.get(device.id)
    if (cached && Date.now() - cached.at < DETAIL_TTL_MS) return cached.info
    if (device.state !== 'online' || typeof device.adapter?.details !== 'function') return null
    let info = {}
    try {
      info = (await device.adapter.details(device.id)) ?? {}
    } catch {
      info = {}
    }
    this.detailCache.set(device.id, { at: Date.now(), info })
    return info
  }

  adapters() {
    const list = [this.android]
    // hdc 是探测出来的：没装 DevEco 的机器不挂鸿蒙适配器，省得每次刷新都报一条无意义的错误。
    if (this.provision.hdcPath()) list.push(this.harmony)
    if (this.config.wdaBaseUrl) list.push(this.ios)
    return list.filter((adapter) => !this.broken.has(adapter.platform))
  }

  /**
   * 会话还能不能继续持有手机：会话被删掉、或被归档，就该自动解绑。
   * 由插件在启动时注入（registry 不直接依赖 DSH 的 ctx）。
   */
  setSessionProbe(probe) {
    this.sessionAlive = probe
  }

  /** 租约按会话存，会话没了租约也没意义——每次刷新顺手清一遍。 */
  pruneSessions() {
    if (typeof this.sessionAlive !== 'function') return
    for (const sessionId of [...this.leases.keys()]) {
      if (!this.sessionAlive(sessionId)) this.release(sessionId)
    }
  }

  /** 设备列表，2s 内复用；并发调用共享同一次枚举。 */
  async refresh(force = false) {
    // 放在 TTL 之前：设备列表可以缓存，「会话还在不在」不缓存。
    this.pruneSessions()
    if (!force && Date.now() - this.refreshedAt < REFRESH_TTL_MS) return this.devices
    if (this.pending) return this.pending

    this.pending = (async () => {
      const adapters = this.adapters()
      const results = await Promise.allSettled(adapters.map((adapter) => adapter.list()))
      const devices = new Map()
      const errors = []

      results.forEach((result, index) => {
        const adapter = adapters[index]
        if (result.status === 'rejected') {
          const message = result.reason?.message ?? String(result.reason)
          errors.push({ platform: adapter.platform, message })
          // 二进制都找不到就不要再每 2s 试一次。
          if (/找不到|ENOENT/.test(message)) this.broken.add(adapter.platform)
          return
        }
        for (const device of result.value) {
          devices.set(device.id, { ...device, adapter })
        }
      })

      // 拔掉的设备要连租约一起清掉，否则会话会一直以为手里有台不存在的手机。
      for (const deviceId of [...this.claims.keys()]) {
        if (!devices.has(deviceId)) this.claims.delete(deviceId)
      }
      for (const [sessionId, deviceId] of [...this.leases.entries()]) {
        if (!this.claims.has(deviceId)) this.leases.delete(sessionId)
      }
      for (const deviceId of [...this.detailCache.keys()]) {
        if (!devices.has(deviceId)) this.detailCache.delete(deviceId)
      }

      // 补系统/分辨率/连接方式；都走一分钟缓存，首次之后几乎不花时间。
      await Promise.all(
        [...devices.values()].map(async (device) => {
          const info = await this.detailsOf(device)
          if (info) Object.assign(device, info)
        }),
      )

      this.devices = devices
      this.errors = errors
      this.refreshedAt = Date.now()
      return devices
    })().finally(() => {
      this.pending = null
    })

    return this.pending
  }

  claim(deviceId, sessionId) {
    const device = this.devices.get(deviceId)
    if (!device) throw new Error(`没有找到设备 ${deviceId}。用 mobile_devices 看当前可用设备。`)
    if (device.state !== 'online') throw new Error(`设备 ${deviceId} 状态是 ${device.state}，还不能操作。`)

    const holder = this.claims.get(deviceId)
    if (holder && holder !== sessionId) {
      throw new Error(
        `设备 ${deviceId} 正被另一个会话占用。同一台手机一次只能一个会话操作，先让那个会话解绑。`,
      )
    }

    const leased = this.leases.get(sessionId)
    if (leased && leased !== deviceId) {
      throw new Error(
        `本会话已持有设备 ${leased}。一个会话只能操作一台手机，先 mobile_release 再换。`,
      )
    }

    this.claims.set(deviceId, sessionId)
    this.leases.set(sessionId, deviceId)
    return device
  }

  release(sessionId) {
    const deviceId = this.leases.get(sessionId)
    if (deviceId === undefined) return undefined
    this.leases.delete(sessionId)
    if (this.claims.get(deviceId) === sessionId) this.claims.delete(deviceId)
    return deviceId
  }

  holderOf(deviceId) {
    return this.claims.get(deviceId)
  }

  /** 按设备解绑：不管是谁持有的，在设备列表里直接松开（会话卡死时的兜底）。 */
  releaseDevice(deviceId) {
    const sessionId = this.claims.get(deviceId)
    if (sessionId === undefined) return undefined
    this.release(sessionId)
    return sessionId
  }

  /**
   * 工具调用前把「本会话该操作哪台设备」定下来。
   * 显式 deviceId → 必须是它；省略 → 用租约，没有租约就认领唯一空闲设备。
   */
  async resolve(sessionId, deviceId) {
    if (!sessionId) throw new Error('这个操作只能从会话里发起。')
    await this.refresh()

    if (deviceId) {
      const device = this.devices.get(deviceId)
      if (!device) throw new Error(`没有找到设备 ${deviceId}。用 mobile_devices 看当前可用设备。`)
      if (this.claims.get(deviceId) === sessionId) return device
      return this.claim(deviceId, sessionId)
    }

    const leased = this.leases.get(sessionId)
    if (leased !== undefined) {
      const device = this.devices.get(leased)
      if (device?.state === 'online') return device
      this.release(sessionId)
    }

    const free = [...this.devices.values()].filter(
      (device) => device.state === 'online' && !this.claims.has(device.id),
    )
    if (free.length === 0) {
      const listed = [...this.devices.values()]
        .map((device) => `${device.id}(${device.state})`)
        .join('、')
      throw new Error(
        listed
          ? `没有空闲设备可认领，当前设备：${listed}。`
          : '没有检测到设备。检查 USB 连接、USB 调试授权，或运行 adb devices 确认。',
      )
    }
    if (free.length > 1) {
      throw new Error(
        `当前有多台空闲设备，请用 deviceId 指定一台：${free.map((device) => device.id).join('、')}。`,
      )
    }
    return this.claim(free[0].id, sessionId)
  }

  /** 给 UI 的状态快照。 */
  view(sessionId) {
    const leased = sessionId ? this.leases.get(sessionId) : undefined
    return {
      lease: leased ?? null,
      errors: this.errors,
      // adb / hdc 最终用的是哪个文件、缓存目录在哪，排错时一眼能看到。
      provision: this.provision.describe(),
      devices: [...this.devices.values()].map((device) => {
        const holder = this.claims.get(device.id)
        return {
          id: device.id,
          platform: device.platform,
          model: device.model,
          state: device.state,
          claimedBy: holder === undefined ? 'free' : holder === sessionId ? 'me' : 'other',
          // 被别人占用时把完整会话 id 带出去，客户端「前往绑定会话」要用它跳转。
          holderSessionId: holder !== undefined && holder !== sessionId ? holder : undefined,
          os: device.os,
          osVersion: device.osVersion,
          brand: device.brand,
          sdk: device.sdk,
          width: device.width,
          height: device.height,
          density: device.density,
          connection: device.connection,
        }
      }),
    }
  }

  adapterFor(device) {
    return device.adapter
  }
}
