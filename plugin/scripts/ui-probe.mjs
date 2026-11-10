#!/usr/bin/env node
/**
 * 坐标排查脚本：一次打印出所有可能不一致的「坐标空间」。
 *
 *   node plugin/scripts/ui-probe.mjs                      # 自动选唯一在线设备
 *   node plugin/scripts/ui-probe.mjs --device <serial>
 *   node plugin/scripts/ui-probe.mjs --find 展开           # 只看匹配的节点
 *   node plugin/scripts/ui-probe.mjs --tap 540 1062       # 顺手点一下验证
 *
 * 关注点：
 *   wm size 当前值 / 截图尺寸 / UI 树范围 三者是否自洽。
 *   树比屏幕小是正常的（树只覆盖前台窗口，一般不含导航栏），bounds 仍是屏幕绝对坐标。
 *   真正危险的是「树比屏幕大」（坐标空间被放大过）或「截图尺寸和 wm size 不一致」。
 */
import { AndroidAdapter } from '../host/adapters/android.js'

function parseArgs(argv) {
  const args = { device: undefined, find: undefined, tap: undefined, json: false }
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index]
    if (item === '--device') args.device = argv[++index]
    else if (item === '--find') args.find = argv[++index]
    else if (item === '--json') args.json = true
    else if (item === '--tap') {
      args.tap = [Number(argv[++index]), Number(argv[++index])]
      if (!args.tap.every(Number.isFinite)) throw new Error('--tap 需要两个数字：x y')
    } else if (item === '--help' || item === '-h') {
      args.help = true
    } else throw new Error(`未知参数 ${item}`)
  }
  return args
}

/** PNG 的 IHDR 就在最前面：16..24 字节是大端宽高。 */
function pngSize(buffer) {
  if (buffer.length < 24 || buffer.readUInt32BE(0) !== 0x89504e47) return null
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) }
}

const args = parseArgs(process.argv.slice(2))
if (args.help) {
  console.log(`
用法：node plugin/scripts/ui-probe.mjs [--device <serial>] [--find <文字>] [--tap <x> <y>] [--json]

  --device  指定设备；省略时取唯一的在线 Android 设备
  --find    只打印文本/描述包含该关键词的节点
  --tap     实际点一下 (x, y)，用来验证坐标系
  --json    输出 JSON，方便再处理
`)
  process.exit(0)
}

const adapter = new AndroidAdapter({
  adbPath: process.env.ADB_PATH || 'adb',
  // 排查时只 dump 一次：把真实的失败耗时暴露出来，别被重试掩盖。
  uiDumpAttempts: 1,
})

const devices = (await adapter.list()).filter((device) => device.state === 'online')
if (devices.length === 0) {
  console.error('没有在线的 Android 设备。先确认 adb devices 能看到设备并已授权。')
  process.exit(1)
}
const picked =
  (args.device ? devices.find((device) => device.id === args.device) : devices[0]) ?? undefined
if (!picked) {
  console.error(`未找到设备 ${args.device}，当前在线：${devices.map((d) => d.id).join('、')}`)
  process.exit(1)
}
const deviceId = picked.id

const report = { device: { id: deviceId, model: picked.model } }

// 1. 设备自己报告的屏幕尺寸
try {
  report.wmSize = await adapter.screen(deviceId)
} catch (error) {
  report.wmSize = { error: error.message }
}

// 2. 截图实际像素尺寸
try {
  const shot = await adapter.screenshot(deviceId)
  report.screencap = pngSize(Buffer.isBuffer(shot.data) ? shot.data : Buffer.from(shot.data))
} catch (error) {
  report.screencap = { error: error.message }
}

// 3. UI 树：空间、前台、耗时
const startedAt = Date.now()
let dump
try {
  dump = await adapter.uiDump(deviceId)
  report.dump = {
    ok: true,
    foreground: dump.foreground ?? null,
    space: { width: dump.width, height: dump.height },
    bytes: dump.bytes,
    nodes: dump.nodes.length,
    attempts: dump.attempts,
    elapsedMs: dump.elapsedMs,
  }
} catch (error) {
  report.dump = {
    ok: false,
    code: error.code ?? 'unknown',
    message: error.message,
    elapsedMs: Date.now() - startedAt,
  }
}

// 4. 可选：真点一下
if (args.tap) {
  try {
    await adapter.tap(deviceId, args.tap[0], args.tap[1])
    report.tap = { x: args.tap[0], y: args.tap[1], ok: true }
  } catch (error) {
    report.tap = { x: args.tap[0], y: args.tap[1], ok: false, error: error.message }
  }
}

if (args.json) {
  console.log(JSON.stringify(report, null, 2))
  process.exit(report.dump.ok ? 0 : 2)
}

const sizeText = (value) =>
  !value ? '未知' : value.error ? `失败（${value.error}）` : `${value.width}×${value.height}`

console.log(`设备 ${deviceId}（${picked.model}）`)
console.log(`  wm size   ${sizeText(report.wmSize)}${
  report.wmSize?.override ? '（有 Override）' : ''
}${report.wmSize?.physical ? `，物理 ${report.wmSize.physical.width}×${report.wmSize.physical.height}` : ''}`)
console.log(`  截图      ${sizeText(report.screencap)}`)
console.log(
  `  UI 树     ${report.dump.ok ? `${report.dump.space.width}×${report.dump.space.height}，${report.dump.nodes} 个节点，${report.dump.elapsedMs}ms，${report.dump.bytes} 字节` : `失败 [${report.dump.code}] ${report.dump.elapsedMs}ms`}`,
)
if (!report.dump.ok) console.log(`  原因      ${report.dump.message}`)
if (report.dump.ok) console.log(`  前台      ${report.dump.foreground ?? '未知'}`)

if (report.dump.ok) {
  const space = report.dump.space
  const wm = report.wmSize
  console.log('')
  if (wm && !wm.error) {
    if (space.width > wm.width || space.height > wm.height) {
      console.log('✗ UI 树比 wm size 还大，坐标空间被放大过：tap 之前必须换算。')
      console.log(`    UI 树 ${space.width}×${space.height}，wm size ${wm.width}×${wm.height}`)
    } else {
      // 树只覆盖前台窗口，通常不含导航栏；bounds 仍然是屏幕绝对坐标。
      console.log(
        `✓ UI 树 ${space.width}×${space.height} 落在屏幕 ${wm.width}×${wm.height} 内：` +
          'bounds 是屏幕绝对坐标，可以直接 tap（比屏幕小是正常的，树不含导航栏）。',
      )
    }
  }
  if (report.screencap && !report.screencap.error) {
    if (wm && !wm.error && (report.screencap.width !== wm.width || report.screencap.height !== wm.height)) {
      console.log(
        `! 截图 ${report.screencap.width}×${report.screencap.height} 与 wm size ${wm.width}×${wm.height} 不一致：` +
          '截图和输入事件可能不是同一套坐标，这才是需要校准的信号。',
      )
    } else {
      console.log('✓ 截图与 wm size 一致：截图尺寸可以当屏幕尺寸用。')
    }
    const sameAsTree = report.screencap.width === space.width && report.screencap.height === space.height
    if (!sameAsTree && space.height < report.screencap.height) {
      console.log(
        `  （截图比树高 ${report.screencap.height - space.height}px，很可能是被树漏掉的导航栏；` +
          '别拿截图直接推断树的坐标。）',
      )
    }
  }

  const nodes = dump.nodes.filter((node) => {
    if (!args.find) return true
    const needle = args.find.toLowerCase()
    return `${node.text} ${node.desc}`.toLowerCase().includes(needle)
  })
  if (nodes.length > 0) {
    console.log('')
    for (const node of nodes.slice(0, 60)) {
      const label = node.text || node.desc
      console.log(`  tap=(${node.center.x},${node.center.y})  ${label ?? '(无文本)'}  ${node.bounds}${node.clickable ? '  [可点]' : ''}`)
    }
    if (nodes.length > 60) console.log(`  …共 ${nodes.length} 个匹配节点，只显示前 60 个`)
  }
}

if (report.tap) {
  console.log('')
  console.log(report.tap.ok ? `已点击 (${report.tap.x}, ${report.tap.y})` : `点击失败：${report.tap.error}`)
}

process.exit(report.dump.ok ? 0 : 2)
