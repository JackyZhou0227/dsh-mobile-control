# dsh-mobile-control

将 Android、HarmonyOS 和 iOS 设备接入 [DSH](https://github.com/DeepSeek-AI/DeepSeek-Harness)，让 agent 能查看屏幕、执行操作，并在侧栏查看设备画面。Android 通过 adb 连接；HarmonyOS 和 iOS 分别通过 hdc 和 WebDriverAgent 连接。

## 功能

- 通过对话操作手机，并在操作后检查结果
- 在 DSH 侧栏查看实时投屏
- 同时连接多台设备，或向多台设备下发同一任务
- 自动查找 adb；需要时可自动下载 Android platform-tools

## 安装

在 DSH 插件页添加 `@jackyzhou0227/dsh-mobile-control`，或运行：

```bash
dsh plugin add @jackyzhou0227/dsh-mobile-control
```

安装后重启 DSH，让插件和「手机操作」工作模式生效。

## 快速开始

1. 在电脑上安装 Android USB 驱动（如系统需要），用 USB 连接手机。
2. 在手机设置中开启开发者选项和 USB 调试，并授权这台电脑。
3. 在 DSH 右侧栏点击「+」→「手机控制」，认领要操作的设备。
4. 直接描述任务，例如：「打开设置，把亮度调到最高」。

也可以在手机控制面板中选择多台设备，向它们各自启动的会话下发同一任务。

## 支持平台

插件提供 Android、HarmonyOS 和 iOS 三个平台的连接适配。Android 使用 adb，HarmonyOS 使用 hdc，iOS 使用 WebDriverAgent（WDA）；设备操作通过 DSH 工具完成，Android 还支持实时投屏。

| 平台 | 连接方式 | 当前状态 |
| --- | --- | --- |
| Android | adb | 已实现并作为当前主要验证平台；支持设备操作与实时投屏。默认自动查找 adb，缺少时可按需下载 Android platform-tools。 |
| HarmonyOS | hdc | 适配器已实现，尚未实机验证；hdc 需由 DevEco Studio SDK 提供或自行配置路径。 |
| iOS | WebDriverAgent | 适配器已实现，尚未实机验证；需自行部署 WDA，并在配置中填写服务地址。 |

三个平台均纳入项目支持范围。当前 HarmonyOS 与 iOS 的硬件和运行环境条件有限，尚未完成实机验证；欢迎有设备和环境的用户协助测试。高级配置见[维护与配置指南](CONTRIBUTING.md#配置与平台)。

## 问题与贡献

使用中遇到问题，请在 [GitHub Issues](https://github.com/JackyZhou0227/dsh-mobile-control/issues) 提交复现步骤、DSH 版本和设备信息。开发测试与发布说明见[贡献指南](CONTRIBUTING.md)。
