import { run } from '../exec.js'
import { Provisioner } from '../provision.js'
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
// 每次 dump 用独立文件名：失败时不会读到上一轮（甚至上一次会话）留下的旧树。
let dumpSequence = 0
// 冷启动时前台可能还停在启动页；只在树明显为空时才提示，别把正常的启动页残留当成空树。
const SPLASH_PATTERN = /splash|welcome|guide|launchscreen|startup/i
// 树里节点少到这个程度，才值得怀疑「抓到的是启动页」。
const SPARSE_TREE_NODES = 3

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** 把 adb/run 抛出的各种原文归到固定几类，调用方才能按类型决定下一步。 */
export function classifyDumpFailure(message) {
  const text = String(message ?? '')
  if (/could not get idle state|idle state/i.test(text)) return 'idle_timeout'
  if (/device .*offline|no devices|device not found|unauthorized|offline/i.test(text)) return 'device_offline'
  if (/超时|timed out|timeout/i.test(text)) return 'dump_timeout'
  if (/no such file|not found/i.test(text)) return 'xml_missing'
  return 'dump_failed'
}

const DUMP_CODE_HINT = {
  idle_timeout:
    'uiautomator 等界面「空闲」超时（约 10s）。视频/直播/滚动列表这类页面的无障碍事件一直不停，' +
    '同一页面状态下重试无效，所以没有再重试。下一步：换到静态页面再读，或用 mobile_screenshot 确认当前页面' +
    '（别拿截图估坐标，滚动时截图比真实位置滞后）。',
  dump_timeout: 'uiautomator dump 在超时时间内没返回。',
  device_offline: 'adb 连不上设备：检查 USB 线、USB 调试授权，或运行 adb devices。',
  xml_missing: 'dump 没有生成文件（通常是 dump 失败，或被其他 uiautomator 进程打断）。',
  xml_empty: 'dump 生成了空文件，或内容不是 uiautomator 的 XML。',
  dump_failed: 'uiautomator dump 报错。',
}

/**
 * dump 失败时抛这个：带分类码和上下文，别再让调用方只看一句「没拿到 hierarchy」。
 * 上层工具会直接把 message 透给模型，所以 message 里要写清「是什么、为什么、下一步」。
 */
export class UiDumpError extends Error {
  constructor(code, info = {}) {
    const { detail = '', foreground, elapsedMs, attempts = 1 } = info
    const context = [
      foreground ? `前台 ${foreground}` : '',
      Number.isFinite(elapsedMs) ? `耗时 ${elapsedMs}ms` : '',
      attempts > 1 ? `尝试 ${attempts} 次` : '',
    ]
      .filter(Boolean)
      .join('，')
    const extra = detail ? ` 原始信息：${String(detail).trim().slice(0, 200)}` : ''
    super(
      `UI 树读取失败[${code}]：${DUMP_CODE_HINT[code] ?? DUMP_CODE_HINT.dump_failed}` +
        `${context ? `（${context}）` : ''}${extra}`,
    )
    this.name = 'UiDumpError'
    this.code = code
    this.details = { ...info }
  }
}

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
  // 所有节点里最大的右下角，就是这个树的坐标空间；拿它和 wm size 对比能看出坐标系是否被改过。
  let width = 0
  let height = 0
  let truncated = false
  for (const match of xml.matchAll(/<node\b([^>]*?)\/?>/g)) {
    const attrs = match[1]
    const text = attr(attrs, 'text')
    const desc = attr(attrs, 'content-desc')
    const resourceId = attr(attrs, 'resource-id')
    const clickable = attr(attrs, 'clickable') === 'true'
    const bounds = attr(attrs, 'bounds')
    const rect = /\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]/.exec(bounds)
    if (rect) {
      width = Math.max(width, Number(rect[3]))
      height = Math.max(height, Number(rect[4]))
    }
    if (lines.length >= MAX_UI_LINES) {
      truncated = true
      continue
    }
    const center = centerOf(bounds)
    if (!text && !desc && !(resourceId && clickable)) continue
    if (!center) continue

    const cls = attr(attrs, 'class').split('.').pop() || 'Node'
    const parts = [`[${center.x},${center.y}]`, cls]
    if (text) parts.push(JSON.stringify(text))
    if (desc) parts.push(`desc=${JSON.stringify(desc)}`)
    if (resourceId && clickable) parts.push(`id=${resourceId}`)
    lines.push(parts.join(' '))
    nodes.push({ text, desc, resourceId, clickable, bounds, center })
  }
  if (truncated) lines.push('…（节点过多，已截断）')
  return { text: lines.join('\n'), nodes, width, height }
}

export class AndroidAdapter {
  constructor(config, provision) {
    this.platform = 'android'
    this.provision = provision ?? new Provisioner(config)
    this.uiDumpTimeoutMs = config.uiDumpTimeoutMs ?? 20000
    this.uiDumpAttempts = Math.max(1, config.uiDumpAttempts ?? 2)
    this.yadbReady = new Set()
    this.adbPath = null
    // uiautomator 是进程级单例：同一台机上并发 dump 会互相打断，这里按设备串行。
    this.locks = new Map()
  }

  /**
   * 同一设备的操作排队执行。dump 之间会互相打断；点在 dump 中间也会让树和真实界面对不上。
   */
  exclusive(deviceId, task) {
    const previous = this.locks.get(deviceId) ?? Promise.resolve()
    const current = previous.then(task, task)
    const settled = current.catch(() => {})
    this.locks.set(deviceId, settled)
    const release = () => {
      if (this.locks.get(deviceId) === settled) this.locks.delete(deviceId)
    }
    return current.finally(release)
  }

  /** adb 第一次真要用时才定下来：缺了就按需下载，之后复用。 */
  async adb() {
    if (!this.adbPath) this.adbPath = await this.provision.ensureAdb()
    return this.adbPath
  }

  async call(deviceId, args, timeout) {
    const adb = await this.adb()
    return run(adb, ['-s', deviceId, ...args], { timeout })
  }

  async list() {
    const adb = await this.adb()
    const output = (await run(adb, ['devices', '-l'], { timeout: 10000 })).toString('utf8')
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

  /** 当前屏幕的坐标空间（wm size 的 Override 优先，就是输入事件用的那套）。 */
  async screen(deviceId) {
    const raw = (await this.call(deviceId, ['shell', 'wm size'], 10000)).toString('utf8')
    const physical = /Physical size:\s*(\d+)\s*x\s*(\d+)/i.exec(raw)
    const override = /Override size:\s*(\d+)\s*x\s*(\d+)/i.exec(raw)
    const current = override ?? physical
    if (!current) return null
    return {
      width: Number(current[1]),
      height: Number(current[2]),
      physical: physical ? { width: Number(physical[1]), height: Number(physical[2]) } : null,
      override: Boolean(override),
    }
  }

  /** 前台 Activity（`包名/类名`）。拿不到就返回 undefined，不影响主流程。 */
  async foreground(deviceId) {
    try {
      const output = (
        await this.call(deviceId, ['shell', 'dumpsys activity activities | grep -m1 mResumedActivity'], 10000)
      ).toString('utf8')
      const match = /mResumedActivity:.*?([A-Za-z][\w.]*)\/([\w.$]+)/.exec(output)
      if (match) return `${match[1]}/${match[2]}`
    } catch {
      // 老机型没有 grep、或 dumpsys 被限权：前台未知不等于 dump 失败。
    }
    return undefined
  }

  /** 冷启动可能还停在启动页。只作为提示，不阻塞 dump（抖音等应用会长期挂着 SplashActivity）。 */
  isSplashLike(foreground) {
    return Boolean(foreground && SPLASH_PATTERN.test(foreground.split('/')[1] ?? ''))
  }

  async tap(deviceId, x, y) {
    const px = Math.round(Number(x))
    const py = Math.round(Number(y))
    if (!Number.isFinite(px) || !Number.isFinite(py)) throw new Error('tap 坐标必须是数字')
    const screen = await this.screen(deviceId).catch(() => null)
    // 坐标超出屏幕就别点了：静默点偏正是「误赞/误回复」的来源。
    if (screen && (px < 0 || py < 0 || px > screen.width || py > screen.height)) {
      throw new Error(
        `tap 坐标 (${px}, ${py}) 超出屏幕范围 ${screen.width}×${screen.height}。` +
          'mobile_ui 返回的坐标可以直接用；如果手动换算过，注意别重复换算。',
      )
    }
    await this.exclusive(deviceId, () =>
      this.call(deviceId, ['shell', `input tap ${px} ${py}`], 15000),
    )
  }

  async swipe(deviceId, fromX, fromY, toX, toY, durationMs = 300) {
    const points = [fromX, fromY, toX, toY].map((value) => Math.round(Number(value)))
    if (points.some((value) => !Number.isFinite(value))) throw new Error('swipe 坐标必须是数字')
    const screen = await this.screen(deviceId).catch(() => null)
    if (screen) {
      const outside = points.some((value, index) =>
        index % 2 === 0 ? value < 0 || value > screen.width : value < 0 || value > screen.height,
      )
      if (outside) {
        throw new Error(
          `swipe 坐标超出屏幕范围 ${screen.width}×${screen.height}：${points.join(', ')}。`,
        )
      }
    }
    await this.exclusive(deviceId, () =>
      this.call(deviceId, [
        'shell',
        `input swipe ${points[0]} ${points[1]} ${points[2]} ${points[3]} ${Math.round(Number(durationMs) || 300)}`,
      ], 15000),
    )
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
      await this.call(deviceId, ['push', requireVendor('yadb'), YADB_DEVICE_PATH], 60000)
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
      throw new Error(`launch 操作需要应用包名（例如 com.android.settings），当前值为：${target}`)
    }
    await this.call(deviceId, [
      'shell',
      `monkey -p ${target} -c android.intent.category.LAUNCHER 1`,
    ])
  }

  async stop(deviceId, target) {
    if (!/^[A-Za-z][\w.]*$/.test(target)) {
      throw new Error(`stop 操作需要应用包名，当前值为：${target}`)
    }
    await this.call(deviceId, ['shell', `am force-stop ${target}`])
  }

  /**
   * 读一次界面树。
   *
   * 三件事必须做对，否则会静默给出错坐标：
   * 1. 每次用独立文件、并且先删再 dump —— 失败时绝不把旧树当本次结果；
   * 2. 失败要分类（idle / 掉线 / 空文件 / 超时），别统一报「没拿到 hierarchy」；
   * 3. dump 串行化 —— uiautomator 是单例，并发会互相打断。
   */
  async uiDump(deviceId, options = {}) {
    const attempts = Math.max(1, options.attempts ?? this.uiDumpAttempts)
    return this.exclusive(deviceId, () => this.dumpWithRetry(deviceId, attempts))
  }

  async dumpWithRetry(deviceId, attempts) {
    const startedAt = Date.now()
    const foreground = await this.foreground(deviceId)
    let lastError = null
    let attemptsMade = 0
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      attemptsMade = attempt
      try {
        const tree = await this.dumpOnce(deviceId)
        const screen = await this.screen(deviceId).catch(() => null)
        // 注意：树只覆盖前台窗口，通常不含导航栏，所以「比屏幕小」是正常的。
        // 只有「比屏幕还大」才说明坐标空间被放大过，这时绝不能直接点。
        const oversized =
          screen && (tree.width > screen.width || tree.height > screen.height) ? screen : null
        const splashLike = this.isSplashLike(foreground)
        return {
          ...tree,
          screen,
          foreground,
          attempts: attempt,
          elapsedMs: Date.now() - startedAt,
          warning: splashLike && tree.nodes.length <= SPARSE_TREE_NODES ? 'splash' : undefined,
          spaceMismatch: oversized
            ? {
                tree: { width: tree.width, height: tree.height },
                screen: { width: oversized.width, height: oversized.height },
              }
            : undefined,
        }
      } catch (error) {
        if (!(error instanceof UiDumpError)) throw error
        lastError = error
        // 空闲超时是确定性的：同一页面状态立刻重试只会再白等 10s（实测重试全部失败）。
        if (error.code === 'idle_timeout') break
        if (attempt < attempts) await sleep(600)
      }
    }
    throw new UiDumpError(lastError.code, {
      ...lastError.details,
      foreground,
      attempts: attemptsMade,
      elapsedMs: Date.now() - startedAt,
    })
  }

  async dumpOnce(deviceId) {
    const remote = `${REMOTE_TMP}/dsh-ui-${process.pid}-${(++dumpSequence).toString(36)}.xml`
    try {
      await this.call(deviceId, ['shell', `rm -f ${remote}`], 10000).catch(() => {})
      let output = ''
      try {
        // `2>&1` 不能省：uiautomator 的 ERROR 走 stderr，不合并就会把 idle 超时误判成空文件。
        output = (
          await this.call(deviceId, ['shell', `uiautomator dump ${remote} 2>&1`], this.uiDumpTimeoutMs)
        ).toString('utf8')
      } catch (error) {
        throw new UiDumpError(classifyDumpFailure(error.message), { detail: error.message })
      }
      // uiautomator 失败时通常仍然退出码 0，只在输出里留一句 ERROR。
      if (/could not get idle state/i.test(output)) {
        throw new UiDumpError('idle_timeout', { detail: output })
      }
      if (/\bERROR\b/.test(output)) {
        throw new UiDumpError(classifyDumpFailure(output), { detail: output })
      }

      let xml = ''
      try {
        xml = (await this.call(deviceId, ['exec-out', `cat ${remote}`], 20000)).toString('utf8')
      } catch (error) {
        throw new UiDumpError('xml_missing', { detail: error.message })
      }
      if (!xml.trim()) throw new UiDumpError('xml_empty', { detail: 'dump 文件为空' })
      if (!xml.includes('<hierarchy')) {
        throw new UiDumpError('xml_empty', { detail: `内容不是 hierarchy（${xml.length} 字节）` })
      }
      return { ...compactUiTree(xml), bytes: xml.length }
    } finally {
      // 文件名唯一，这里不用等它完成，也不会误删下一轮的文件。
      this.call(deviceId, ['shell', `rm -f ${remote}`]).catch(() => {})
    }
  }
}
