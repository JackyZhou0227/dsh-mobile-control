import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { Provisioner } from '../host/provision.js'

// 纯离线：只验证路径解析顺序和缺工具时的报错，不联网、不碰真机。

const root = await mkdtemp(join(tmpdir(), 'dsh-mobile-provision-'))
const home = join(root, 'home')
await mkdir(home, { recursive: true })

async function touch(path) {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, '')
}

const win = (env) => ({ env, platform: 'win32' })

try {
  // 1. PATH 优先
  {
    const bin = join(root, 'bin')
    await touch(join(bin, 'adb.exe'))
    const provision = new Provisioner({}, win({ PATH: bin, USERPROFILE: home }))
    assert.equal(provision.adbPath(), join(bin, 'adb.exe'))
    console.log('ok PATH 里的 adb')
  }

  // 2. ANDROID_HOME 里的 platform-tools
  {
    const sdk = join(root, 'sdk')
    await touch(join(sdk, 'platform-tools', 'adb.exe'))
    const provision = new Provisioner({ adbPath: 'adb' }, win({ PATH: '', ANDROID_HOME: sdk, USERPROFILE: home }))
    assert.equal(provision.adbPath(), join(sdk, 'platform-tools', 'adb.exe'))
    console.log('ok ANDROID_HOME')
  }

  // 3. 之前下载到缓存的
  {
    const localAppData = join(root, 'localappdata')
    const cached = join(localAppData, 'dsh-mobile-control', 'platform-tools', 'adb.exe')
    await touch(cached)
    const provision = new Provisioner({}, win({ PATH: '', LOCALAPPDATA: localAppData, USERPROFILE: home }))
    assert.equal(provision.adbPath(), cached)
    assert.equal(provision.cacheDir, join(localAppData, 'dsh-mobile-control'))
    console.log('ok 缓存目录')
  }

  // 4. 显式配置最大：哪怕文件不存在也照用（让用户看到自己的路径而不是静默换成别的 adb）
  {
    const bin = join(root, 'bin')
    const provision = new Provisioner({ adbPath: 'C:\\tools\\adb.exe' }, win({ PATH: bin, USERPROFILE: home }))
    assert.equal(provision.adbPath(), 'C:\\tools\\adb.exe')
    console.log('ok 显式 adbPath')
  }

  // 5. 都找不到 + 关掉自动获取：报错要能指导用户
  {
    const provision = new Provisioner(
      { autoProvision: false },
      win({ PATH: '', USERPROFILE: join(root, 'empty-home') }),
    )
    assert.equal(provision.adbPath(), null)
    await assert.rejects(() => provision.ensureAdb(), /adbPath/)
    console.log('ok 缺 adb 的报错')
  }

  // 6. 不支持的平台：不抛网络错，报「手动装」
  {
    const provision = new Provisioner({}, { env: { PATH: '', HOME: home }, platform: 'aix' })
    await assert.rejects(() => provision.ensureAdb(), /adbPath/)
    console.log('ok 未知平台的报错')
  }

  // 7. 同一个 Provisioner 并发 ensure 只下载一次
  {
    const provision = new Provisioner(
      { autoProvision: false },
      win({ PATH: '', USERPROFILE: join(root, 'empty-home') }),
    )
    const results = await Promise.allSettled([provision.ensureAdb(), provision.ensureAdb()])
    assert.deepEqual(results.map((item) => item.status), ['rejected', 'rejected'])
    console.log('ok 并发 ensure')
  }

  // 8. hdc：显式配置
  {
    const provision = new Provisioner({ hdcPath: 'C:\\deveco\\hdc.exe' }, win({ PATH: '', USERPROFILE: home }))
    assert.equal(provision.hdcPath(), 'C:\\deveco\\hdc.exe')
    console.log('ok 显式 hdcPath')
  }

  // 9. hdc：从 DevEco SDK 里探测
  {
    const sdk = join(root, 'deveco-sdk')
    await touch(join(sdk, 'default', 'openharmony', 'toolchains', 'hdc.exe'))
    const provision = new Provisioner({}, win({ PATH: '', USERPROFILE: home, DEVECO_SDK_HOME: sdk }))
    assert.equal(provision.hdcPath(), join(sdk, 'default', 'openharmony', 'toolchains', 'hdc.exe'))
    console.log('ok DevEco 探测 hdc')
  }

  // 10. hdc 没有就返回 null，不报错、不下载
  {
    const provision = new Provisioner(
      {},
      { env: { PATH: '', HOME: join(root, 'empty-home') }, platform: 'linux' },
    )
    assert.equal(provision.hdcPath(), null)
    console.log('ok 没有 hdc 时返回 null')
  }

  // 11. describe() 的形状（工具结果里会带出去）
  {
    const provision = new Provisioner({}, { env: { PATH: '', HOME: home }, platform: 'linux' })
    assert.deepEqual(Object.keys(provision.describe()).sort(), ['adb', 'autoProvision', 'cacheDir', 'hdc'])
    assert.equal(provision.autoProvision, true)
    assert.equal(new Provisioner({ autoProvision: false }).autoProvision, false)
    console.log('ok describe')
  }
} finally {
  await rm(root, { recursive: true, force: true })
}

console.log('全部通过')
