import { readFile, unlink } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { run } from '../exec.js'
import { Provisioner } from '../provision.js'

const REMOTE_SHOT = '/data/local/tmp/dsh-mobile-shot.jpeg'
const UNSUPPORTED = '鸿蒙适配器目前只实现了列出设备 / 截图 / 点击 / 滑动 / 按键。'

/**
 * 鸿蒙（HarmonyOS NEXT）骨架：走 hdc 命令行，和 Android 的 adb 一一对应。
 * 本机没装 hdc，未实机验证。
 */
export class HarmonyAdapter {
  constructor(config, provision) {
    this.platform = 'harmony'
    this.provision = provision ?? new Provisioner(config)
  }

  /** hdc 没有便携发布物，只从 PATH / DevEco SDK 里探测。 */
  hdc() {
    const found = this.provision.hdcPath()
    if (!found) {
      throw new Error(
        '找不到 hdc：PATH 和 DevEco Studio 的 SDK 目录里都没有。' +
          '装好 DevEco Studio 后一般能自动找到；装在别处就在插件配置里设置 hdcPath。',
      )
    }
    return found
  }

  call(deviceId, args, timeout) {
    return run(this.hdc(), ['-t', deviceId, ...args], { timeout })
  }

  async list() {
    const output = (await run(this.hdc(), ['list', 'targets'], { timeout: 10000 })).toString('utf8')
    return output
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('[') && line !== 'Empty')
      .map((id) => ({ id, platform: 'harmony', model: id, state: 'online' }))
  }

  /** 鸿蒙只取能一条命令拿到的版本信息，别的靠 registry 缓存兜住。 */
  async details(deviceId) {
    try {
      const raw = (
        await this.call(
          deviceId,
          ['shell', 'param get const.product.software.version; param get const.ohos.apiversion'],
          10000,
        )
      )
        .toString('utf8')
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
      return {
        os: 'HarmonyOS',
        osVersion: raw[0] || undefined,
        sdk: Number(raw[1]) || undefined,
        connection: 'usb',
      }
    } catch {
      return { os: 'HarmonyOS', connection: 'usb' }
    }
  }

  async screenshot(deviceId) {
    const local = join(tmpdir(), `dsh-mobile-${randomUUID()}.jpeg`)
    try {
      await this.call(deviceId, ['shell', `snapshot_display -f ${REMOTE_SHOT}`], 20000)
      await this.call(deviceId, ['file', 'recv', REMOTE_SHOT, local], 20000)
      return { data: await readFile(local), mediaType: 'image/jpeg' }
    } finally {
      unlink(local).catch(() => {})
    }
  }

  async tap(deviceId, x, y) {
    await this.call(deviceId, ['shell', `uitest uiInput click ${Math.round(x)} ${Math.round(y)}`])
  }

  // ponytail: HarmonyOS 的 uitest swipe 第 5 个参数是速度而不是毫秒，先把 durationMs 忽略；要精确手势再改成速度换算。
  async swipe(deviceId, fromX, fromY, toX, toY) {
    await this.call(deviceId, [
      'shell',
      `uitest uiInput swipe ${Math.round(fromX)} ${Math.round(fromY)} ${Math.round(toX)} ${Math.round(toY)} 600`,
    ])
  }

  async key(deviceId, name) {
    const map = { back: 'Back', home: 'Home', power: 'Power' }
    const keyEvent = map[name]
    if (!keyEvent) throw new Error(`鸿蒙只支持 back / home / power，收到：${name}`)
    await this.call(deviceId, ['shell', `uitest uiInput keyEvent ${keyEvent}`])
  }

  async text() {
    // ponytail: 鸿蒙的 inputText 需要先给出焦点坐标，v1 不做；要中文输入时补「取焦点坐标 + uiInput inputText」。
    throw new Error(UNSUPPORTED)
  }

  async launch() {
    throw new Error(UNSUPPORTED)
  }

  async stop() {
    throw new Error(UNSUPPORTED)
  }

  async uiDump() {
    throw new Error(UNSUPPORTED)
  }
}
