import assert from 'node:assert/strict'
import { AndroidAdapter, compactUiTree } from '../host/adapters/android.js'
import { FLAG_CONFIG, FLAG_KEY, FLAG_META, StreamManager, decodePacketHeader, encodeFrame } from '../host/scrcpy.js'

// ---- 离线：帧包头与封包格式 ----
{
  const head = Buffer.alloc(12)
  head.writeBigUInt64BE((1n << 63n) | (1n << 62n), 0)
  head.writeUInt32BE(4321, 8)
  assert.deepEqual(decodePacketHeader(head), { size: 4321, isConfig: true, isKey: true })

  head.writeBigUInt64BE(0n, 0)
  assert.deepEqual(decodePacketHeader(head), { size: 4321, isConfig: false, isKey: false })

  const frame = encodeFrame(FLAG_KEY, 9, Buffer.from([0xaa, 0xbb]))
  assert.equal(frame.readUInt32LE(0), 2)
  assert.equal(frame[4], FLAG_KEY)
  assert.equal(frame.readUInt32LE(5), 9)
  assert.deepEqual([...frame.subarray(9)], [0xaa, 0xbb])
  console.log('ok 帧格式')
}

// ---- 离线：UI 树压缩 ----
{
  const xml =
    '<hierarchy><node class="android.widget.FrameLayout" bounds="[0,0][720,1612]">' +
    '<node class="android.widget.TextView" text="设置" bounds="[100,200][300,260]" clickable="true"/>' +
    '<node class="android.widget.ImageView" content-desc="返回" bounds="[0,60][80,140]" clickable="false"/>' +
    '<node class="android.view.View" bounds="[0,0][1,1]"/>' +
    '<node class="android.widget.TextView" text="幽灵" bounds="[0,0][0,0]"/>' +
    '</node></hierarchy>'
  const { text, nodes } = compactUiTree(xml)
  assert.equal(nodes.length, 2)
  assert.deepEqual(nodes[0].center, { x: 200, y: 230 })
  assert.match(text, /设置/)
  assert.match(text, /desc="返回"/)
  assert.doesNotMatch(text, /幽灵/)
  console.log('ok UI 树')
}

// ---- 真机 ----
const adapter = new AndroidAdapter({ adbPath: process.env.ADB_PATH || 'adb' })
const devices = await adapter.list()
assert.ok(devices.length > 0, '没有检测到 Android 设备')
const device = devices.find((item) => item.state === 'online') ?? devices[0]
console.log(`ok 设备 ${device.id} (${device.model}) ${device.state}`)
assert.equal(device.state, 'online', `设备 ${device.id} 状态是 ${device.state}，先授权 USB 调试`)

const shot = await adapter.screenshot(device.id)
assert.equal(shot.mediaType, 'image/png')
assert.ok(shot.data.length > 1024, `截图只有 ${shot.data.length} 字节`)
console.log(`ok 截图 ${Math.round(shot.data.length / 1024)}KB`)

await adapter.tap(device.id, 360, 150)
console.log('ok 点击')

const dump = await adapter.uiDump(device.id)
assert.ok(dump.nodes.length > 0, 'UI 树是空的')
console.log(`ok UI 树 ${dump.nodes.length} 个节点`)

const streams = new StreamManager({ adbPath: 'adb', streamMaxSize: 1024, streamMaxFps: 30 })
try {
  const producer = await streams.ensure(device.id)
  assert.ok(producer.info.width > 0 && producer.info.height > 0, 'scrcpy 没有给出分辨率')
  console.log(`ok scrcpy ${producer.info.width}x${producer.info.height}`)

  let packets = 0
  let sawConfig = false
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('15s 内没有收到视频帧')), 15000)
    const detach = producer.add(
      (frame) => {
        const flags = frame[4]
        if (flags & FLAG_META) return
        if (flags & FLAG_CONFIG) sawConfig = true
        packets += 1
        if (packets >= 3) {
          clearTimeout(timer)
          detach()
          resolve()
        }
      },
      (message) => {
        clearTimeout(timer)
        reject(new Error(message))
      },
    )
  })
  assert.ok(sawConfig, '没有收到 SPS/PPS 配置包')
  console.log(`ok scrcpy 视频流 ${packets} 帧`)
} finally {
  streams.dispose()
}

console.log('全部通过')
