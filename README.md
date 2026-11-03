# dsh-mobile-control

把安卓手机接进 DSH：agent 直接操作手机，右侧栏实时投屏（scrcpy + WebCodecs），可以同时挂多台手机、给一批设备统一下发同一个任务。

插件在 [`plugin/`](plugin/)，是 DSH 的持久化 bundle（Host + Client 双半）。参考项目 `.example/midscene` 只用来对照连接方式，没有引入它的任何包。

## 装

发布版（推荐）：在 DSH 插件页点「添加插件」输入 `@jackyzhou0227/dsh-mobile-control`，或命令行：

```bash
dsh plugin add @jackyzhou0227/dsh-mobile-control
```

本地开发版：

```bash
node plugin/scripts/fetch-vendor.mjs   # 下载 scrcpy-server 与 yadb 到 plugin/vendor/
```

然后在 DSH 里安装这个 bundle（`plugin_manager` 的 `install_bundle`，目标 `plugin/` 的绝对路径），**刷新一次页面**。

安装后「工作模式」列表里会多一个「手机操作」：只挂手机任务需要的行（操作员人设、文件读写、shell、后台任务、待办、上下文压缩），`mobile_*` 工具本身在宿主层，任何模式都有。重启一次 DSH 后生效，批量下发任务时也能选它。

## 用

1. 手机插 USB，打开开发者选项里的 USB 调试，授权这台电脑。
2. 右侧栏「+」→「手机控制」。
3. 面板里认领会话要用的手机（一台手机同时只能被一个会话占用）。
4. 对 DSH 说人话，例如「打开设置，把亮度调到最高」。模型会调 `mobile_devices` / `mobile_screenshot` / `mobile_action` / `mobile_ui`。
5. 面板底部「批量下发任务」：用设备芯片多选（支持全选）+ 工作区/模式/权限/模型 + 一句提示词 → 每台各自起一个会话并收到同一条任务。模式默认选「手机操作」（插件装了才会有）。

## 工具

| 工具 | 作用 |
| --- | --- |
| `mobile_devices` | 列出设备与占用状态 |
| `mobile_use` / `mobile_release` | 认领 / 释放设备（会话 ↔ 设备 1:1） |
| `mobile_screenshot` | 截屏（返回图片给模型看） |
| `mobile_ui` | 界面节点树（带点击坐标，部分机器一次要数秒） |
| `mobile_action` | tap / swipe / type / key / launch / stop |

## 发版

1. 版本号只改 `plugin/package.json` 的 `version`，按 semver：修 bug 进位第三位，加功能进位第二位，破坏性改动才动第一位。
2. 发包四步：改 version → `git commit` → `git tag v<x.y.z>` → `cd plugin && npm publish --access public`（账号开了 2FA 就加 `--otp=` 六位码）。
3. `vendor/` 二进制（scrcpy-server / yadb）不进 git，但会进 npm 包；发包前确认它们在本地存在。只有升级 scrcpy/yadb 时才改 `scripts/fetch-vendor.mjs` 里的版本号。

## 平台

- **Android**：完整实现，走 `adb` 命令行 + scrcpy 视频流。中文输入走 yadb。
- **HarmonyOS**：`hdc` 适配器骨架（列表 / 截图 / 点击 / 滑动 / 按键）。
- **iOS**：WebDriverAgent REST 适配器骨架，配 `wdaBaseUrl` 才启用，WDA 必须在 macOS 上跑。

后两个本机没有环境和设备，**未实机验证**。

## 配置

`cordis.patch.yml` 里的 `config` 覆盖（都有默认值）：

| 键 | 默认 | 说明 |
| --- | --- | --- |
| `adbPath` / `hdcPath` | `adb` / `hdc` | 二进制路径 |
| `wdaBaseUrl` | 空 | 填了才启用 iOS |
| `streamMaxFps` | 30 | 投屏帧率上限 |
| `streamMaxSize` | 1024 | 投屏最长边像素 |
| `uiDumpTimeoutMs` | 20000 | `mobile_ui` 超时 |

## 自检

```bash
node plugin/test/client.mjs    # 纯离线：注册了什么、DOM 结构、样式守卫（不需要手机）
node plugin/test/routes.mjs    # HTTP 路由 + 租约互斥 + 批量下发 + 投屏流首包
node plugin/test/android.mjs   # 帧格式 + 真机截图/点击/UI树 + scrcpy 视频流
```

后两个都要接一台已授权的安卓机。
