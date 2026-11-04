import { existsSync, readdirSync } from 'node:fs'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { run } from './exec.js'

// Google 官方的 platform-tools 快照，跟着系统走；不需要把二进制打进 npm 包。
const DOWNLOAD_URL = {
  win32: 'https://dl.google.com/android/repository/platform-tools-latest-windows.zip',
  darwin: 'https://dl.google.com/android/repository/platform-tools-latest-darwin.zip',
  linux: 'https://dl.google.com/android/repository/platform-tools-latest-linux.zip',
}

const SUFFIX = { win32: '.exe', darwin: '', linux: '' }
const DOWNLOAD_TIMEOUT_MS = 180000
const EXTRACT_TIMEOUT_MS = 120000
// 下载失败后别每 2s 重试一次（registry 刷新很频繁）。
const FAILURE_COOLDOWN_MS = 60000
const MAX_SCAN_DIRS = 300

function missingAdb() {
  return new Error(
    '找不到 adb：PATH、ANDROID_HOME 和常见 SDK 目录里都没有。' +
      '可以装 Android platform-tools 后把路径填进插件配置的 adbPath，' +
      '或让 autoProvision 保持打开（默认），插件会自己下载一份到用户缓存目录。',
  )
}

function missingHdc() {
  return new Error(
    '找不到 hdc：PATH 和 DevEco Studio 的 SDK 目录里都没有。' +
      '装好 DevEco Studio 后一般能自动找到；装在别处就在插件配置里设置 hdcPath。',
  )
}

/** 逐层找文件名，限制层数和目录数，避免扫整个磁盘。 */
function searchForFile(root, fileName, maxDepth) {
  const queue = [{ dir: root, depth: 0 }]
  let visited = 0
  while (queue.length > 0 && visited < MAX_SCAN_DIRS) {
    const { dir, depth } = queue.shift()
    visited += 1
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      if (entry.isFile() && entry.name === fileName) return join(dir, entry.name)
    }
    if (depth >= maxDepth) continue
    for (const entry of entries) {
      if (entry.isDirectory() && entry.name !== 'node_modules') {
        queue.push({ dir: join(dir, entry.name), depth: depth + 1 })
      }
    }
  }
  return null
}

function extract(archive, destination, platform) {
  if (platform === 'win32') {
    const quoted = (value) => `'${String(value).replace(/'/g, "''")}'`
    const command =
      `Expand-Archive -LiteralPath ${quoted(archive)} ` +
      `-DestinationPath ${quoted(destination)} -Force`
    return run('powershell', ['-NoProfile', '-NonInteractive', '-Command', command], {
      timeout: EXTRACT_TIMEOUT_MS,
    })
  }
  return run('unzip', ['-o', '-q', archive, '-d', destination], { timeout: EXTRACT_TIMEOUT_MS })
}

/**
 * 电脑侧工具（adb / hdc）的定位与获取。
 *
 * adb 解析顺序：显式配置 → PATH → Android SDK → 插件缓存 → 自动下载 platform-tools。
 * 优先用 PATH 上的，避免和用户已有的 adb server 版本打架。
 * hdc 没有便携发布物（只在 HarmonyOS SDK 里），所以只做探测，不下载。
 */
export class Provisioner {
  constructor(config = {}, { env = process.env, platform = process.platform } = {}) {
    this.config = config
    this.env = env
    this.platform = platform
    this.pending = null
    this.failedAt = 0
    this.lastError = null
    this.resolvedAdb = undefined
    this.resolvedHdc = undefined
  }

  get suffix() {
    return SUFFIX[this.platform] ?? ''
  }

  get autoProvision() {
    return this.config.autoProvision !== false
  }

  get explicitAdb() {
    const value = this.config.adbPath
    return typeof value === 'string' && value !== '' && value !== 'adb' ? value : null
  }

  get explicitHdc() {
    const value = this.config.hdcPath
    return typeof value === 'string' && value !== '' && value !== 'hdc' ? value : null
  }

  get pathDirs() {
    const raw = this.env.PATH ?? this.env.Path ?? ''
    return raw.split(this.platform === 'win32' ? ';' : ':').filter(Boolean)
  }

  get homeDir() {
    return this.env.USERPROFILE || this.env.HOME || homedir()
  }

  /** adb / hdc 都放这里，装一次以后离线可用。 */
  get cacheDir() {
    if (this.platform === 'win32') {
      return join(this.env.LOCALAPPDATA || join(this.homeDir, 'AppData', 'Local'), 'dsh-mobile-control')
    }
    if (this.platform === 'darwin') {
      return join(this.homeDir, 'Library', 'Caches', 'dsh-mobile-control')
    }
    return join(this.env.XDG_CACHE_HOME || join(this.homeDir, '.cache'), 'dsh-mobile-control')
  }

  findOnPath(name) {
    const fileName = `${name}${this.suffix}`
    for (const dir of this.pathDirs) {
      const candidate = join(dir.replace(/^"|"$/g, ''), fileName)
      if (existsSync(candidate)) return candidate
    }
    return null
  }

  androidSdkDirs() {
    const dirs = [this.env.ANDROID_HOME, this.env.ANDROID_SDK_ROOT]
    if (this.platform === 'win32') {
      if (this.env.LOCALAPPDATA) dirs.push(join(this.env.LOCALAPPDATA, 'Android', 'Sdk'))
      dirs.push(join(this.homeDir, 'AppData', 'Local', 'Android', 'Sdk'), 'C:\\Android\\Sdk')
    } else if (this.platform === 'darwin') {
      dirs.push(join(this.homeDir, 'Library', 'Android', 'sdk'))
    } else {
      dirs.push(join(this.homeDir, 'Android', 'Sdk'), '/usr/lib/android-sdk')
    }
    return dirs.filter(Boolean)
  }

  cachedAdb() {
    const candidate = join(this.cacheDir, 'platform-tools', `adb${this.suffix}`)
    return existsSync(candidate) ? candidate : null
  }

  /** 只查文件，不启动进程；每处调用都很频繁。 */
  adbPath() {
    if (this.resolvedAdb !== undefined) return this.resolvedAdb
    const found =
      this.explicitAdb ??
      this.findOnPath('adb') ??
      this.androidSdkDirs()
        .map((dir) => join(dir, 'platform-tools', `adb${this.suffix}`))
        .find((candidate) => existsSync(candidate)) ??
      this.cachedAdb()
    this.resolvedAdb = found
    return found
  }

  /** 真正要用 adb 时调用：缺了就按需下载一次。 */
  async ensureAdb() {
    const found = this.adbPath()
    if (found) return found
    if (!this.autoProvision) throw missingAdb()
    if (this.lastError && Date.now() - this.failedAt < FAILURE_COOLDOWN_MS) throw this.lastError
    if (!this.pending) {
      this.pending = this.installPlatformTools().finally(() => {
        this.pending = null
      })
    }
    return this.pending
  }

  async installPlatformTools() {
    const url = DOWNLOAD_URL[this.platform]
    if (!url) {
      const error = missingAdb()
      this.failedAt = Date.now()
      this.lastError = error
      throw error
    }
    try {
      const root = this.cacheDir
      await mkdir(root, { recursive: true })
      const archive = join(root, 'platform-tools.zip')
      const response = await fetch(url, {
        redirect: 'follow',
        signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
      })
      if (!response.ok) throw new Error(`下载 platform-tools 失败：HTTP ${response.status}`)
      await writeFile(archive, Buffer.from(await response.arrayBuffer()))
      await extract(archive, root, this.platform)
      await rm(archive, { force: true })

      const adb = join(root, 'platform-tools', `adb${this.suffix}`)
      if (!existsSync(adb)) throw new Error('解压后没找到 adb，platform-tools 的包结构可能变了。')
      // 真跑一次：缺 DLL 或架构不对时这里就能报出来，而不是等截屏时莫名失败。
      await run(adb, ['version'], { timeout: 20000 })

      this.resolvedAdb = adb
      this.failedAt = 0
      this.lastError = null
      return adb
    } catch (error) {
      this.failedAt = Date.now()
      this.lastError = new Error(`自动安装 adb 失败（${this.cacheDir}）：${error.message}`)
      throw this.lastError
    }
  }

  hdcRoots() {
    const roots = [this.env.DEVECO_SDK_HOME, this.env.OHOS_SDK_HOME, this.env.HOS_SDK_HOME]
    if (this.platform === 'win32') {
      roots.push('C:\\Program Files\\Huawei\\DevEco Studio\\sdk')
      if (this.env.LOCALAPPDATA) {
        roots.push(join(this.env.LOCALAPPDATA, 'Huawei', 'Sdk'))
        roots.push(join(this.env.LOCALAPPDATA, 'OpenHarmony', 'Sdk'))
      }
    } else if (this.platform === 'darwin') {
      roots.push('/Applications/DevEco-Studio.app/Contents/sdk')
    } else {
      roots.push(join(this.homeDir, 'DevEco-Studio', 'sdk'), join(this.homeDir, 'Huawei', 'Sdk'))
    }
    return roots.filter((root) => root && existsSync(root))
  }

  /** 没装 hdc 就是没有，不下载：它只在 HarmonyOS SDK 里发布。 */
  hdcPath() {
    if (this.resolvedHdc !== undefined) return this.resolvedHdc
    if (this.explicitHdc) return (this.resolvedHdc = this.explicitHdc)

    const onPath = this.findOnPath('hdc')
    if (onPath) return (this.resolvedHdc = onPath)

    const name = `hdc${this.suffix}`
    for (const root of this.hdcRoots()) {
      const direct = [
        join(root, 'default', 'openharmony', 'toolchains', name),
        join(root, 'default', 'harmonyos', 'toolchains', name),
        join(root, 'toolchains', name),
      ].find((candidate) => existsSync(candidate))
      if (direct) return (this.resolvedHdc = direct)
      const deep = searchForFile(root, name, 3)
      if (deep) return (this.resolvedHdc = deep)
    }
    this.resolvedHdc = null
    return null
  }

  /** 给移动端 UI / 排错用的一句话状态。 */
  describe() {
    return {
      adb: this.adbPath(),
      hdc: this.hdcPath(),
      autoProvision: this.autoProvision,
      cacheDir: this.cacheDir,
    }
  }
}
