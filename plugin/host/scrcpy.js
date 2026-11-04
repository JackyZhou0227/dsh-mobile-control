import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { run } from './exec.js'
import { Provisioner } from './provision.js'
import { requireVendor } from './vendor.js'

const SCRCPY_VERSION = '3.3.3'
const DEVICE_JAR_PATH = '/data/local/tmp/scrcpy-server.jar'
const IDLE_STOP_MS = 3000
const MAX_PACKET_BYTES = 20 * 1024 * 1024
const SOCKET_NAME = 'localabstract:scrcpy'

export const FLAG_CONFIG = 1
export const FLAG_KEY = 2
export const FLAG_META = 4
export const FLAG_IMAGE = 8

/**
 * 流上每一帧的封包：`u32 len | u8 flags | u32 seq | payload`。
 * seq 只是给解码器一个单调递增的时间戳，不用 scrcpy 的 pts（64 位微秒，塞不进 u32）。
 */
export function encodeFrame(flags, seq, payload) {
  const header = Buffer.allocUnsafe(9)
  header.writeUInt32LE(payload.length, 0)
  header.writeUInt8(flags, 4)
  header.writeUInt32LE(seq >>> 0, 5)
  return Buffer.concat([header, payload])
}

/** scrcpy 视频包的 12 字节头：u64 BE pts|flags（bit63=config, bit62=keyframe）+ u32 BE size。 */
export function decodePacketHeader(head) {
  const ptsFlags = head.readBigUInt64BE(0)
  return {
    size: head.readUInt32BE(8),
    isConfig: ptsFlags >> 63n === 1n,
    isKey: ((ptsFlags >> 62n) & 1n) === 1n,
  }
}

/** 在本机开一个一次性监听口，等设备反向连过来（scrcpy 默认 tunnel_forward=true 就是这条路）。 */
function listenForDevice() {
  return new Promise((resolve, reject) => {
    const server = createServer()
    let accept
    const accepted = new Promise((settle) => {
      accept = settle
    })
    server.on('connection', (socket) => accept(socket))
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      resolve({
        port: server.address().port,
        accepted,
        close: () => {
          try {
            server.close()
          } catch {}
        },
      })
    })
  })
}

/** socket 上按需读 n 个字节；剩余数据留在内部缓冲里。 */
function makeReader(socket) {
  const iterator = socket[Symbol.asyncIterator]()
  let buffer = Buffer.alloc(0)
  return {
    async read(n) {
      if (n === 0) return Buffer.alloc(0)
      while (buffer.length < n) {
        const { value, done } = await iterator.next()
        if (done) throw new Error('scrcpy 流已结束')
        buffer = buffer.length === 0 ? value : Buffer.concat([buffer, value])
      }
      const out = buffer.subarray(0, n)
      buffer = buffer.subarray(n)
      return out
    },
  }
}

function withTimeout(promise, ms, message) {
  let timer
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), ms)
    }),
  ]).finally(() => clearTimeout(timer))
}

class Producer {
  constructor(config, provision, deviceId) {
    this.config = config
    this.provision = provision
    this.deviceId = deviceId
    // start() 里才定下来（可能要下载 platform-tools）。
    this.adb = null
    this.subscribers = new Set()
    this.closed = false
    this.seq = 0
    this.port = null
    this.listener = null
    this.socket = null
    this.serverChild = null
    this.idleTimer = null
    this.info = null
    this.serverLog = ''
    this.metaPayload = null
    this.configPayload = null
    this.reader = null
    this.pumping = false
  }

  async start() {
    const jar = requireVendor('scrcpy-server')
    this.adb = await this.provision.ensureAdb()
    await run(this.adb, ['-s', this.deviceId, 'push', jar, DEVICE_JAR_PATH], { timeout: 60000 })

    this.listener = await listenForDevice()
    this.port = this.listener.port
    // adb reverse 的第一个参数是设备侧、第二个才是本机侧，顺序和 forward 相反。
    await run(this.adb, ['-s', this.deviceId, 'reverse', SOCKET_NAME, `tcp:${this.port}`])

    const options = [
      'log_level=warn',
      'audio=false',
      'control=false',
      'video_codec=h264',
      `max_size=${this.config.streamMaxSize ?? 1024}`,
      `max_fps=${this.config.streamMaxFps ?? 30}`,
      'video_bit_rate=4000000',
      'display_id=0',
    ].join(' ')
    this.serverChild = spawn(
      this.adb,
      [
        '-s',
        this.deviceId,
        'shell',
        `CLASSPATH=${DEVICE_JAR_PATH} app_process / com.genymobile.scrcpy.Server ${SCRCPY_VERSION} ${options}`,
      ],
      { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] },
    )
    this.serverChild.on('error', () => {})
    const collect = (chunk) => {
      this.serverLog = `${this.serverLog}${chunk.toString('utf8')}`.slice(-2000)
    }
    this.serverChild.stdout.on('data', collect)
    this.serverChild.stderr.on('data', collect)

    try {
      this.socket = await withTimeout(
        this.listener.accepted,
        15000,
        'scrcpy 服务端 15s 内没有连上来（检查设备是否允许 USB 调试、scrcpy-server 是否推上去了）',
      )
      const reader = makeReader(this.socket)
      // 3.x 的设备头是 64 字节设备名；1.x 前面还有一个恒为 0 的 dummy 字节。首字节判一下。
      const first = (await reader.read(1))[0]
      const nameBytes =
        first === 0
          ? await reader.read(64)
          : Buffer.concat([Buffer.from([first]), await reader.read(63)])
      const name = nameBytes.toString('utf8').replace(/\0[\s\S]*$/, '')
      const codec = (await reader.read(4)).toString('latin1')
      const width = (await reader.read(4)).readUInt32BE(0)
      const height = (await reader.read(4)).readUInt32BE(0)
      if (!codec.includes('264')) {
        throw new Error(`scrcpy 返回的视频编码是 ${JSON.stringify(codec)}，只支持 h264`)
      }
      this.info = { codec: 'h264', width, height, device: name }
      this.metaPayload = Buffer.from(
        JSON.stringify({ codec: 'h264', width, height, device: name }),
        'utf8',
      )
      this.reader = reader
      // 先不开始 pump：等第一个订阅者接上再放行，否则 META 和首个 IDR 会推给空集合。
    } catch (error) {
      const tail = this.serverLog.trim()
      throw new Error(`${error.message}${tail ? `（scrcpy：${tail.slice(-600)}）` : ''}`)
    }
  }

  emit(flags, payload) {
    this.seq = (this.seq + 1) >>> 0
    const frame = encodeFrame(flags, this.seq, payload)
    for (const entry of [...this.subscribers]) {
      try {
        entry.onFrame(frame)
      } catch {
        this.subscribers.delete(entry)
      }
    }
  }

  async pump(reader) {
    try {
      for (;;) {
        if (this.closed) return
        const head = await reader.read(12)
        const { size, isConfig, isKey } = decodePacketHeader(head)
        if (size > MAX_PACKET_BYTES) throw new Error(`scrcpy 帧过大（${size} 字节）`)
        const payload = await reader.read(size)
        if (isConfig) this.configPayload = payload
        this.emit((isConfig ? FLAG_CONFIG : 0) | (isKey ? FLAG_KEY : 0), payload)
      }
    } catch (error) {
      if (this.closed) return
      this.fail(error)
    }
  }

  fail(error) {
    const message = error?.message ?? String(error)
    for (const entry of this.subscribers) {
      if (typeof entry.onEnd === 'function') entry.onEnd(message)
    }
    this.subscribers.clear()
    this.stop()
  }

  add(onFrame, onEnd) {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer)
      this.idleTimer = null
    }
    const entry = { onFrame, onEnd }
    this.subscribers.add(entry)

    // 补上订阅之前就已经读到的 META / SPS-PPS，解码器才有编码参数可用。
    const replay = (flags, payload) => {
      this.seq = (this.seq + 1) >>> 0
      onFrame(encodeFrame(flags, this.seq, payload))
    }
    if (this.metaPayload) replay(FLAG_META, this.metaPayload)
    if (this.configPayload) replay(FLAG_CONFIG, this.configPayload)

    if (!this.pumping && this.reader) {
      this.pumping = true
      void this.pump(this.reader)
    }

    return () => {
      this.subscribers.delete(entry)
      if (this.subscribers.size === 0 && !this.closed) {
        this.idleTimer = setTimeout(() => this.stop(), IDLE_STOP_MS)
      }
    }
  }

  stop() {
    if (this.closed) return
    this.closed = true
    if (this.idleTimer) clearTimeout(this.idleTimer)
    this.subscribers.clear()
    try {
      this.socket?.destroy()
    } catch {}
    this.listener?.close()
    try {
      this.serverChild?.kill('SIGKILL')
    } catch {}
    if (this.port !== null && this.adb) {
      run(this.adb, ['-s', this.deviceId, 'reverse', '--remove', SOCKET_NAME]).catch(() => {})
    }
  }
}

export class StreamManager {
  constructor(config, provision) {
    this.config = config
    this.provision = provision ?? new Provisioner(config)
    this.producers = new Map()
  }

  async ensure(deviceId) {
    const existing = this.producers.get(deviceId)
    if (existing && !existing.closed) return existing
    const producer = new Producer(this.config, this.provision, deviceId)
    this.producers.set(deviceId, producer)
    try {
      await producer.start()
    } catch (error) {
      this.producers.delete(deviceId)
      producer.stop()
      throw error
    }
    return producer
  }

  discard(deviceId) {
    const producer = this.producers.get(deviceId)
    if (!producer) return
    this.producers.delete(deviceId)
    producer.stop()
  }

  dispose() {
    for (const producer of this.producers.values()) producer.stop()
    this.producers.clear()
  }
}
