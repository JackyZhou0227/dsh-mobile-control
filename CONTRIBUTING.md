# 开发、配置与发布

本文面向需要本地开发、调整插件配置或发布新版本的维护者。普通用户请先看 [README](README.md)。

## 本地安装

1. 克隆仓库，并在项目根目录执行：

   ```bash
   node plugin/scripts/fetch-vendor.mjs
   ```

   该命令下载运行时所需的 scrcpy-server 和 yadb 到 `plugin/vendor/`。

2. 在 DSH 中安装本地 bundle，目标为 `plugin/` 目录的绝对路径。
3. 刷新 DSH 页面；如果工作模式列表未更新，重启 DSH。

## 配置与平台

插件配置位于 `plugin/cordis.patch.yml`，可在 DSH 插件配置中覆盖：

| 键 | 默认值 | 说明 |
| --- | --- | --- |
| `adbPath` | `adb` | adb 可执行文件路径。默认值会启用自动查找。 |
| `hdcPath` | `hdc` | HarmonyOS hdc 可执行文件路径。默认值会启用自动查找。 |
| `autoProvision` | `true` | 找不到 adb 时，是否自动下载 Google Android platform-tools。 |
| `wdaBaseUrl` | 空 | WebDriverAgent 地址；配置后启用 iOS 适配器。 |
| `streamMaxFps` | `30` | 实时投屏帧率上限。 |
| `streamMaxSize` | `1024` | 实时投屏画面的最长边像素。 |
| `uiDumpTimeoutMs` | `20000` | 单次获取界面节点树的超时时间（毫秒）。 |
| `uiDumpAttempts` | `2` | 界面树读取失败后的总尝试次数。 |

adb 默认按显式路径、PATH、Android SDK、插件缓存的顺序查找；需要时会从 Google 下载 platform-tools。下载文件保存在 Windows `%LOCALAPPDATA%\dsh-mobile-control`、macOS `~/Library/Caches/dsh-mobile-control` 或 Linux `~/.cache/dsh-mobile-control`。设 `autoProvision: false` 可禁止自动下载。

hdc 只从 PATH 和 DevEco Studio SDK 目录探测，不会自动下载。若安装在其他位置，请设置 `hdcPath`。iOS 适配需要用户自行准备 WDA，并在 macOS 上运行。

## 坐标排查

`mobile_ui` 和 `mobile_action` 共用同一套坐标（uiautomator 的 bounds）。怀疑点偏时，先跑诊断脚本，一次打印出 `wm size`、截图尺寸和 UI 树的坐标空间：

```bash
node plugin/scripts/ui-probe.mjs --device <serial>
node plugin/scripts/ui-probe.mjs --device <serial> --find 展开
node plugin/scripts/ui-probe.mjs --device <serial> --tap 540 1062   # 真点一下
```

三个尺寸里，UI 树通常比屏幕小（只覆盖前台窗口、不含导航栏），bounds 仍是屏幕绝对坐标，可以直接 tap；真正需要校准的信号是「树比屏幕还大」或「截图尺寸和 `wm size` 不一致」。

## 测试

以下命令从项目根目录运行：

```bash
node plugin/test/provision.mjs
node plugin/test/client.mjs
node plugin/test/uidump.mjs
node plugin/test/routes.mjs
node plugin/test/android.mjs
```

- `provision.mjs`：adb/hdc 路径解析及缺少工具时的错误处理，可离线运行。
- `client.mjs`：客户端注册、DOM 结构与样式检查，可离线运行。
- `uidump.mjs`：界面树读取的失败分类、重试、陈旧文件防护与坐标范围校验，可离线运行。
- `routes.mjs`：HTTP 路由、设备租约互斥、批量下发及投屏流首包检查。
- `android.mjs`：帧格式及 Android 截图、点击、界面树和 scrcpy 投屏；需要连接一台已授权的 Android 设备。

## 发布

1. 在 `plugin/package.json` 中更新 `version`，遵循语义化版本：修复递增 patch，兼容性功能递增 minor，破坏性变更递增 major。
2. 提交版本变更并创建对应标签，例如 `v0.2.1`。
3. 确认 `plugin/vendor/` 中包含 scrcpy-server 和 yadb，然后运行：

   ```bash
   cd plugin
   npm publish --access public
   ```

   若 npm 账号启用了双重验证，按 npm 提示提供一次性验证码。

`plugin/vendor/` 中的二进制不提交到 Git，但会包含在 npm 包中。只有升级 scrcpy 或 yadb 时，才需要修改 `plugin/scripts/fetch-vendor.mjs` 中对应的版本。
