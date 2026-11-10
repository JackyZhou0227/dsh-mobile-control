/**
 * UI 树读取的离线测试：不需要连手机。
 *
 * 重点是「失败时绝不返回旧树」和「失败原因可判定」——线上误点、误赞都出在这里。
 */
import assert from 'node:assert/strict'
import { AndroidAdapter, UiDumpError, classifyDumpFailure, compactUiTree } from '../host/adapters/android.js'

const XML = (bounds = '[0,0][1080,2310]') =>
  `<hierarchy rotation="0"><node class="android.widget.FrameLayout" bounds="${bounds}">` +
  '<node class="android.widget.TextView" text="暂停视频" bounds="[100,1000][980,1124]" clickable="true"/>' +
  '<node class="android.widget.ImageView" content-desc="返回" bounds="[0,48][96,144]" clickable="false"/>' +
  '</node></hierarchy>'

/** 用脚本化的 adb 响应替换真实调用；返回 adapter 和调用记录。 */
function fakeAdapter(handler, config = {}) {
  const adapter = new AndroidAdapter({ adbPath: 'adb', ...config })
  const calls = []
  adapter.call = async (deviceId, args, timeout) => {
    calls.push({ args, timeout })
    return handler(args, calls)
  }
  return { adapter, calls }
}

function resume(activity = 'com.ss.android.ugc.aweme/.main.MainActivity') {
  return `  mResumedActivity: ActivityRecord{abc u0 ${activity} t123}`
}

// ---- 离线：分类与解析 ----
{
  assert.equal(classifyDumpFailure('ERROR: could not get idle state.'), 'idle_timeout')
  assert.equal(classifyDumpFailure('error: device offline'), 'device_offline')
  assert.equal(classifyDumpFailure('adb 超时（20000ms）'), 'dump_timeout')
  assert.equal(classifyDumpFailure('cat: /data/local/tmp/x.xml: No such file or directory'), 'xml_missing')
  assert.equal(classifyDumpFailure('whatever'), 'dump_failed')
  console.log('ok 失败分类')
}

{
  const { text, nodes, width, height } = compactUiTree(XML())
  assert.equal(width, 1080)
  assert.equal(height, 2310)
  assert.equal(nodes.length, 2)
  assert.equal(nodes[0].bounds, '[100,1000][980,1124]')
  assert.deepEqual(nodes[0].center, { x: 540, y: 1062 })
  assert.match(text, /暂停视频/)
  console.log('ok UI 树空间与 bounds')
}

// ---- dump 失败时必须抛错，不能把旧文件当结果 ----
{
  const { adapter } = fakeAdapter((args) => {
    const command = String(args[1] ?? '')
    if (command.startsWith('dumpsys activity')) return resume()
    if (command.startsWith('rm -f')) return Buffer.from('')
    if (command.startsWith('uiautomator dump')) return Buffer.from('ERROR: could not get idle state.')
    // 旧文件还躺在设备上：修复前这里会被当成「成功」返回上一次的树。
    if (args[0] === 'exec-out') return Buffer.from(XML())
    throw new Error(`未预期的命令 ${args.join(' ')}`)
  }, { uiDumpAttempts: 1 })

  await assert.rejects(
    () => adapter.uiDump('dev-1'),
    (error) => {
      assert.ok(error instanceof UiDumpError, '应该抛 UiDumpError')
      assert.equal(error.code, 'idle_timeout')
      assert.match(error.message, /idle_timeout/)
      assert.match(error.message, /MainActivity/)
      return true
    },
  )
  console.log('ok idle 超时不会读到旧树')
}

// ---- 成功路径：独立文件、先删后 dump、返回坐标空间 ----
{
  const { adapter, calls } = fakeAdapter((args) => {
    const command = String(args[1] ?? '')
    if (command.startsWith('dumpsys activity')) return Buffer.from(resume())
    if (command === 'wm size') return Buffer.from('Physical size: 1080x2310\n')
    if (command.startsWith('rm -f')) return Buffer.from('')
    if (command.startsWith('uiautomator dump')) return Buffer.from('UI hierchary dumped to: /data/local/tmp/x.xml')
    if (args[0] === 'exec-out') return Buffer.from(XML())
    throw new Error(`未预期的命令 ${args.join(' ')}`)
  })

  const dump = await adapter.uiDump('dev-1')
  assert.equal(dump.width, 1080)
  assert.equal(dump.height, 2310)
  assert.equal(dump.nodes.length, 2)
  assert.equal(dump.foreground, 'com.ss.android.ugc.aweme/.main.MainActivity')
  assert.equal(dump.attempts, 1)
  assert.equal(dump.spaceMismatch, undefined, '树与 wm size 一致时不该报坐标错位')
  assert.ok(dump.elapsedMs >= 0)

  const dumpIndex = calls.findIndex((call) => String(call.args[1] ?? '').startsWith('uiautomator dump'))
  const firstRm = calls.findIndex((call) => String(call.args[1] ?? '').startsWith('rm -f'))
  assert.ok(firstRm >= 0 && firstRm < dumpIndex, 'dump 之前必须先删掉目标文件')
  // 每次的远程文件名都不一样，避免并发/上一轮残留。
  assert.match(String(calls[dumpIndex].args[1]), /dsh-ui-\d+-[a-z0-9]+\.xml/)
  // uiautomator 的 ERROR 走 stderr，必须合并进 stdout，否则 idle 超时会被误判成空文件。
  assert.match(String(calls[dumpIndex].args[1]), /2>&1/)
  console.log('ok 成功路径（先删后 dump、独立文件名、合并 stderr）')
}

// ---- 重试：第一次掉线，第二次成功 ----
{
  let dumpCalls = 0
  const { adapter } = fakeAdapter((args) => {
    const command = String(args[1] ?? '')
    if (command.startsWith('dumpsys activity')) return Buffer.from(resume())
    if (command === 'wm size') return Buffer.from('Physical size: 1080x2310\n')
    if (command.startsWith('rm -f')) return Buffer.from('')
    if (command.startsWith('uiautomator dump')) {
      dumpCalls += 1
      if (dumpCalls === 1) throw new Error('error: device offline')
      return Buffer.from('UI hierchary dumped to: /data/local/tmp/x.xml')
    }
    if (args[0] === 'exec-out') return Buffer.from(XML())
    throw new Error(`未预期的命令 ${args.join(' ')}`)
  }, { uiDumpAttempts: 2 })

  const dump = await adapter.uiDump('dev-1')
  assert.equal(dump.attempts, 2)
  assert.equal(dump.nodes.length, 2)
  console.log('ok 失败重试')
}

// ---- idle 超时是确定性的：不要重试（实测同一页面状态重试全部失败，只是白等 10s） ----
{
  let dumpCalls = 0
  const { adapter } = fakeAdapter((args) => {
    const command = String(args[1] ?? '')
    if (command.startsWith('dumpsys activity')) return Buffer.from(resume())
    if (command.startsWith('rm -f')) return Buffer.from('')
    if (command.startsWith('uiautomator dump')) {
      dumpCalls += 1
      return Buffer.from('ERROR: could not get idle state.')
    }
    if (args[0] === 'exec-out') return Buffer.from(XML())
    throw new Error(`未预期的命令 ${args.join(' ')}`)
  }, { uiDumpAttempts: 3 })

  await assert.rejects(
    () => adapter.uiDump('dev-1'),
    (error) => {
      assert.equal(error.code, 'idle_timeout')
      assert.equal(error.details.attempts, 1)
      assert.doesNotMatch(error.message, /尝试 3 次/)
      return true
    },
  )
  assert.equal(dumpCalls, 1, 'idle 超时只该尝试 1 次')
  console.log('ok idle 超时不重试')
}

// ---- 其它失败照常重试 ----
{
  let dumpCalls = 0
  const { adapter } = fakeAdapter((args) => {
    const command = String(args[1] ?? '')
    if (command.startsWith('dumpsys activity')) return Buffer.from(resume())
    if (command.startsWith('rm -f')) return Buffer.from('')
    if (command.startsWith('uiautomator dump')) {
      dumpCalls += 1
      throw new Error('error: device offline')
    }
    throw new Error(`未预期的命令 ${args.join(' ')}`)
  }, { uiDumpAttempts: 3 })

  await assert.rejects(
    () => adapter.uiDump('dev-1'),
    (error) => error.code === 'device_offline' && error.details.attempts === 3,
  )
  assert.equal(dumpCalls, 3, '掉线这类瞬时错误应该重试满次数')
  console.log('ok 瞬时错误仍重试')
}

// ---- 空文件要报 xml_empty，而不是「没拿到 hierarchy」 ----
{
  const { adapter } = fakeAdapter((args) => {
    const command = String(args[1] ?? '')
    if (command.startsWith('dumpsys activity')) return Buffer.from(resume())
    if (command.startsWith('rm -f')) return Buffer.from('')
    if (command.startsWith('uiautomator dump')) return Buffer.from('UI hierchary dumped to: /data/local/tmp/x.xml')
    if (args[0] === 'exec-out') return Buffer.from('')
    throw new Error(`未预期的命令 ${args.join(' ')}`)
  }, { uiDumpAttempts: 1 })

  await assert.rejects(
    () => adapter.uiDump('dev-1'),
    (error) => error.code === 'xml_empty',
  )
  console.log('ok 空文件')
}

// ---- 坐标超出屏幕：直接拒绝，别静默点偏 ----
{
  const { adapter, calls } = fakeAdapter((args) => {
    const command = String(args[1] ?? '')
    if (command === 'wm size') return Buffer.from('Physical size: 1080x2400\nOverride size: 1080x2310\n')
    if (command.startsWith('input tap')) return Buffer.from('')
    throw new Error(`未预期的命令 ${args.join(' ')}`)
  })

  const screen = await adapter.screen('dev-1')
  assert.deepEqual(screen, {
    width: 1080,
    height: 2310,
    physical: { width: 1080, height: 2400 },
    override: true,
  })

  await assert.rejects(
    () => adapter.tap('dev-1', 540, 2350),
    (error) => {
      assert.match(error.message, /超出屏幕范围/)
      assert.match(error.message, /1080×2310/)
      return true
    },
  )
  assert.equal(calls.filter((call) => String(call.args[1] ?? '').startsWith('input tap')).length, 0)

  await adapter.tap('dev-1', 540, 1062)
  assert.equal(
    calls.filter((call) => String(call.args[1] ?? '').startsWith('input tap')).length,
    1,
  )
  console.log('ok 坐标范围校验')
}

// ---- 树的坐标空间和 wm size 不一致时要报出来（这就是「点偏」的可判定信号） ----
{
  const { adapter } = fakeAdapter((args) => {
    const command = String(args[1] ?? '')
    if (command.startsWith('dumpsys activity')) return Buffer.from(resume())
    if (command === 'wm size') return Buffer.from('Physical size: 1080x2400\nOverride size: 1080x2310\n')
    if (command.startsWith('rm -f')) return Buffer.from('')
    if (command.startsWith('uiautomator dump')) return Buffer.from('UI hierchary dumped to: /data/local/tmp/x.xml')
    if (args[0] === 'exec-out') return Buffer.from(XML('[0,0][1080,2400]'))
    throw new Error(`未预期的命令 ${args.join(' ')}`)
  }, { uiDumpAttempts: 1 })

  const dump = await adapter.uiDump('dev-1')
  assert.deepEqual(dump.spaceMismatch, {
    tree: { width: 1080, height: 2400 },
    screen: { width: 1080, height: 2310 },
  })
  console.log('ok 树比屏幕大 → 报坐标空间异常')
}

// ---- 树比屏幕小是正常的（树只覆盖前台窗口，不含导航栏），不能报异常 ----
{
  const { adapter } = fakeAdapter((args) => {
    const command = String(args[1] ?? '')
    if (command.startsWith('dumpsys activity')) return Buffer.from(resume())
    if (command === 'wm size') return Buffer.from('Physical size: 1080x2340\n')
    if (command.startsWith('rm -f')) return Buffer.from('')
    if (command.startsWith('uiautomator dump')) return Buffer.from('UI hierchary dumped to: /data/local/tmp/x.xml')
    // 真机实测：抖音信息流树高 2202，屏幕 2340。
    if (args[0] === 'exec-out') return Buffer.from(XML('[0,0][1080,2193]'))
    throw new Error(`未预期的命令 ${args.join(' ')}`)
  }, { uiDumpAttempts: 1 })

  const dump = await adapter.uiDump('dev-1')
  assert.equal(dump.width, 1080)
  assert.equal(dump.height, 2193)
  assert.equal(dump.spaceMismatch, undefined, '树比屏幕小是前台窗口的正常裁剪')
  console.log('ok 树比屏幕小不算坐标异常')
}

// ---- 启动页：只有树几乎为空时才提示，别在正常页面误报 ----
{
  const make = (xml) =>
    fakeAdapter((args) => {
      const command = String(args[1] ?? '')
      if (command.startsWith('dumpsys activity')) {
        return Buffer.from(resume('com.ss.android.ugc.aweme/.splash.SplashActivity'))
      }
      if (command === 'wm size') return Buffer.from('Physical size: 1080x2340\n')
      if (command.startsWith('rm -f')) return Buffer.from('')
      if (command.startsWith('uiautomator dump')) return Buffer.from('UI hierchary dumped to: /data/local/tmp/x.xml')
      if (args[0] === 'exec-out') return Buffer.from(xml)
      throw new Error(`未预期的命令 ${args.join(' ')}`)
    }, { uiDumpAttempts: 1 })

  const sparse = await make(
    '<hierarchy><node class="android.widget.FrameLayout" bounds="[0,0][1080,2340]">' +
      '<node class="android.widget.ImageView" content-desc="启动图" bounds="[0,0][1080,2340]"/></node></hierarchy>',
  ).adapter.uiDump('dev-1')
  assert.equal(sparse.warning, 'splash')

  const normal = await make(
    '<hierarchy><node class="android.widget.FrameLayout" bounds="[0,0][1080,2340]">' +
      Array.from(
        { length: 6 },
        (_, index) =>
          `<node class="android.widget.TextView" text="条目${index}" bounds="[0,${index * 100}][1080,${index * 100 + 90}]" clickable="true"/>`,
      ).join('') +
      '</node></hierarchy>',
  ).adapter.uiDump('dev-1')
  assert.equal(normal.warning, undefined, '正常页面即使前台残留 SplashActivity 也不该提示')
  console.log('ok 启动页只在空树时提示')
}

console.log('全部通过')
