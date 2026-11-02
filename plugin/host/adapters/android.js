import { run } from '../exec.js'
import { requireVendor } from '../vendor.js'

const KEY_CODES = {
  back: 4,
  home: 3,
  recents: 187,
  enter: 66,
  power: 26,
  volumeUp: 24,
  volumeDown: 25,
}
const ASCII_ONLY = /^[\t\n\r\x20-\x7e]*$/
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47])
const YADB_DEVICE_PATH = '/data/local/tmp/yadb'
const REMOTE_TMP = '/data/local/tmp'

/** 单引号包一层，内部单引号按 sh 规则断开再拼。 */
function quote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`
}

function attr(source, name) {
  return new RegExp(`${name}="([^"]*)"`).exec(source)?.[1] ?? ''
}

/** `[x1,y1][x2,y2]` → 中心点。 */
function centerOf(bounds) {
  const match = /\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]/.exec(bounds)
  if (!match) return undefined
  const [x1, y1, x2, y2] = match.slice(1, 5).map(Number)
  if (x2 <= x1 || y2 <= y1) return undefined // 零尺寸=不在屏幕上，点它等于点 (0,0)
  return { x: Math.round((x1 + x2) / 2), y: Math.round((y1 + y2) / 2) }
}

const MAX_UI_LINES = 400

/** uiautomator 的 XML 压成「一行一个可操作节点」，模型读这个比读 XML 便宜得多。 */
export function compactUiTree(xml) {
  const lines = []
  const nodes = []
  for (const match of xml.matchAll(/<node\b([^>]*?)\/?>/g)) {
    if (lines.length >= MAX_UI_LINES) {
      lines.push('…（节点过多，已截断）')
      break
    }
    const attrs = match[1]
    const text = attr(attrs, 'text')
    const desc = attr(attrs, 'content-desc')
    const resourceId = attr(attrs, 'resource-id')
    const clickable = attr(attrs, 'clickable') === 'true'
    const bounds = attr(attrs, 'bounds')
    const center = centerOf(bounds)
    if (!text && !desc && !(resourceId && clickable)) continue
    if (!center) continue

    const cls = attr(attrs, 'class').split('.').pop() || 'Node'
    const parts = [`[${center.x},${center.y}]`, cls]
    if (text) parts.push(JSON.stringify(text))
    if (desc) parts.push(`desc=${JSON.stringify(desc)}`)
    if (resourceId && clickable) parts.push(`id=${resourceId}`)
    lines.push(parts.join(' '))
    nodes.push({ text, desc, resourceId, clickable, center })
  }
  return { text: lines.join('\n'), nodes }
}

export class AndroidAdapter {
  constructor(config) {
    this.platform = 'android'
    this.adb = config.adbPath || 'adb'
    this.uiDumpTimeoutMs = config.uiDumpTimeoutMs ?? 20000
    this.yadbReady = new Set()
  }

  call(deviceId, args, timeout) {
    return run(this.adb, ['-s', deviceId, ...args], { timeout })
  }

  async list() {
    const output = (await run(this.adb, ['devices', '-l'], { timeout: 10000 })).toString('utf8')
    const devices = []
    for (const line of output.split(/\r?\n/)) {
      const match = /^(\S+)\s+(\S+)(.*)$/.exec(line.trim())
      if (!match || match[1] === 'List') continue
      const [, id, state, rest] = match
      devices.push({
        id,
        platform: 'android',
        model: /model:(\S+)/.exec(rest)?.[1] ?? id,
        state: state === 'device' ? 'online' : state,
      })
    }
    return devices
  }

  /** 设备详情：型号之外的系统、分辨率、连接方式。变化很慢，由 registry 缓存。 */
  async details(deviceId) {
    const raw = (
      await this.call(
        deviceId,
        [
          'shell',
          [
            'getprop ro.product.brand',
            'getprop ro.build.version.release',
            'getprop ro.build.version.sdk',
            'wm size',
            'wm density',
          ].join('; '),
        ],
        15000,
      )
    )
      .toString('utf8')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)

    const brand = raw[0] || undefined
    const version = raw[1] || undefined
    const sdk = Number(raw[2]) || undefined
    const sizeLine = raw.find((line) => /Override size:/i.test(line)) ?? raw.find((line) => /size:/i.test(line))
    const densityLine = raw.find((line) => /density:/i.test(line))
    const size = sizeLine ? /(\d+)\s*x\s*(\d+)/.exec(sizeLine) : null
    const density = densityLine ? /(\d+)/.exec(densityLine.split(':')[1] ?? '') : null

    return {
      os: 'Android',
      osVersion: version,
      brand,
      sdk,
      width: size ? Number(size[1]) : undefined,
      height: size ? Number(size[2]) : undefined,
      density: density ? Number(density[1]) : undefined,
      connection: deviceId.includes(':') ? 'wifi' : 'usb',
    }
  }

  async screenshot(deviceId) {
    const direct = await this.call(deviceId, ['exec-out', 'screencap', '-p'])
    if (direct.subarray(0, 4).equals(PNG_MAGIC)) {
      return { data: direct, mediaType: 'image/png' }
    }

    // 部分老设备 exec-out 会改写字节，退回文件 + cat。
    const remote = `${REMOTE_TMP}/dsh-mobile-shot.png`
    await this.call(deviceId, ['shell', `screencap -p ${remote}`])
    const viaFile = await this.call(deviceId, ['exec-out', `cat ${remote}`])
    this.call(deviceId, ['shell', `rm -f ${remote}`]).catch(() => {})
    if (!viaFile.subarray(0, 4).equals(PNG_MAGIC)) throw new Error('截图失败：返回的不是 PNG 数据')
    return { data: viaFile, mediaType: 'image/png' }
  }

  async tap(deviceId, x, y) {
    await this.call(deviceId, ['shell', `input tap ${Math.round(x)} ${Math.round(y)}`])
  }

  async swipe(deviceId, fromX, fromY, toX, toY, durationMs = 300) {
    await this.call(deviceId, [
      'shell',
      `input swipe ${Math.round(fromX)} ${Math.round(fromY)} ${Math.round(toX)} ${Math.round(toY)} ${Math.round(durationMs)}`,
    ])
  }

  async text(deviceId, value) {
    if (typeof value !== 'string' || value === '') throw new Error('要输入的文字不能为空')
    if (ASCII_ONLY.test(value)) {
      await this.call(deviceId, ['shell', `input text ${quote(value)}`])
      return
    }
    // `input text` 只认 ASCII，中文/emoji 走 yadb 注入。
    await this.ensureYadb(deviceId)
    const payload = quote(value.replace(/\n/g, '\\n'))
    await this.call(deviceId, [
      'shell',
      `app_process -Djava.class.path=${YADB_DEVICE_PATH} /data/local/tmp com.ysbing.yadb.Main -keyboard ${payload}`,
    ])
  }

  async ensureYadb(deviceId) {
    if (this.yadbReady.has(deviceId)) return
    const present = (
      await this.call(deviceId, ['shell', `[ -f ${YADB_DEVICE_PATH} ] && echo yes || echo no`])
    )
      .toString('utf8')
      .includes('yes')
    if (!present) {
      await run(this.adb, ['-s', deviceId, 'push', requireVendor('yadb'), YADB_DEVICE_PATH])
    }
    this.yadbReady.add(deviceId)
  }

  async key(deviceId, name) {
    const code = KEY_CODES[name]
    if (code === undefined) {
      throw new Error(`不支持的按键 ${name}，可用：${Object.keys(KEY_CODES).join(' / ')}`)
    }
    await this.call(deviceId, ['shell', `input keyevent ${code}`])
  }

  async launch(deviceId, target) {
    if (!/^[A-Za-z][\w.]*$/.test(target)) {
      throw new Error(`launch 需要包名（例如 com.android.settings），收到：${target}`)
    }
    await this.call(deviceId, [
      'shell',
      `monkey -p ${target} -c android.intent.category.LAUNCHER 1`,
    ])
  }

  async stop(deviceId, target) {
    if (!/^[A-Za-z][\w.]*$/.test(target)) {
      throw new Error(`stop 需要包名，收到：${target}`)
    }
    await this.call(deviceId, ['shell', `am force-stop ${target}`])
  }

  async uiDump(deviceId) {
    const remote = `${REMOTE_TMP}/dsh-mobile-ui.xml`
    try {
      await this.call(deviceId, ['shell', `uiautomator dump ${remote}`], this.uiDumpTimeoutMs)
    } catch (error) {
      // dump 有时会因为窗口动画失败一次，读不到就报清楚。
      if (!/dumped|ERROR/i.test(error.message)) throw error
    }
    const xml = (await this.call(deviceId, ['exec-out', `cat ${remote}`])).toString('utf8')
    this.call(deviceId, ['shell', `rm -f ${remote}`]).catch(() => {})
    if (!xml.includes('<hierarchy')) throw new Error('UI 树读取失败：没有拿到 hierarchy')
    return compactUiTree(xml)
  }
}
