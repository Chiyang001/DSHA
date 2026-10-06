<p align="center"><img src="docs/assets/readme-logos.svg" width="288" height="112" alt="Chiyang001 开发者 Logo | DSHA APP Logo"></p>

<h1 align="center">DSHA</h1>
<p align="center"><strong>Deepseek Harness for Android</strong></p>
<p align="center">在手机上运行 DeepSeek Harness，让 AI 调用 Android 设备工具。</p>

<p align="center">
  <img src="https://img.shields.io/badge/Android-11%2B-3DDC84?logo=android&amp;logoColor=white" alt="Android 11+">
  <img src="https://img.shields.io/badge/ABI-arm64--v8a-64748B" alt="arm64-v8a">
  <a href="https://github.com/Chiyang001/DSHA/releases/tag/v1.1.0"><img src="https://img.shields.io/badge/Release-1.1.0-2563EB" alt="Release 1.1.0"></a>
  <img src="https://img.shields.io/badge/Status-开发原型-F59E0B" alt="开发原型">
</p>

<p align="center">
  <a href="https://github.com/Chiyang001/DSHA/releases/download/v1.1.0/DSHA-1.1.0.apk"><strong>下载 APK</strong></a> ·
  <a href="#快速开始">快速开始</a> ·
  <a href="#内核更新">内核更新</a> ·
  <a href="#从源码构建">从源码构建</a> ·
  <a href="ANDROID-VALIDATION.md">验证记录</a>
</p>

---

## 项目简介

DSHA 是一个单 APK 原型：在 Android 应用进程内嵌 Node.js，启动官方 `@deepseek-ai/dsh` 的 Web profile，并把手机设备操作能力注册为 Harness 工具。**APK 不需要电脑在旁运行。**

| 能力 | 说明 |
| :--- | :--- |
| 手机端对话 | 在应用内使用官方 Harness Web UI，配置自己的 DeepSeek API Key |
| 设备操作 | 通过 Shizuku 授权，向 Harness 提供 `android_*` 手机工具 |
| 屏幕与文件 | 截图、读取 UI 层级、文件读写、文件名搜索与文字搜索 |
| 内核更新 | 在设置中下载并切换 DSH 内核，保留会话与设置 |

> [!NOTE]
> 当前发布支持 **Android 11 及以上 / arm64-v8a**。Release 为 **1.1.0**，附件是现有 debug APK，其内部 `versionName` 为 **0.1.0**、`versionCode` 为 **1**。首次运行会解包官方 npm 包，请预留数百 MB 可用存储。

## 快速开始

### 1. 安装与授权

1. [下载并安装 APK](https://github.com/Chiyang001/DSHA/releases/download/v1.1.0/DSHA-1.1.0.apk)，打开应用，按引导向导完成初次配置。
2. 在手机安装并启动 [Shizuku](https://shizuku.rikka.app/download/)。首次启动按 Shizuku 应用内指引开启系统无线调试并启动服务。
3. 回到本应用，在引导向导中点击 **使用 Shizuku 一键授权**，接受授权弹窗。
4. 在向导中开启 **允许 Harness 控制这台手机**。任意 shell 命令另有独立开关，默认关闭。

### 2. 配置与对话

完成向导后进入 **DeepSeek Harness** 页面，在官方 Web UI 的模型设置中配置自己的 **DeepSeek API Key**，即可开始对话。例如：

> 先检查 android_status，再截屏，帮我打开设置中的蓝牙页面。

后续可在 **设置 → Android 设置** 中重新授权 Shizuku、管理存储访问权限或修改 Harness 控制开关。主界面按系统返回键会将应用退到后台。

> [!IMPORTANT]
> 模型执行操作时，应用进程必须保持运行。首版尚无后台常驻服务，部分厂商系统会在离开应用后回收进程。关闭 Shizuku 服务或在系统应用设置中强制停止本应用，即可中断设备操作。

## 内核更新

在设置面板顶部点击 **检查更新**（位于“打开配置文件”左侧），通过 `https://registry.npmmirror.com` 查询 `@deepseek-ai/dsh` 的 `latest` 版本。

1. 点击 **下载并安装更新**，查看依赖解析、镜像请求、下载校验、解包安装和最终验证的实时日志，以及包处理数量与耗时。
2. 等待安装完成；关闭窗口不会取消安装。
3. 点击 **重启并启用**，切换到新内核。重启会中断当前任务。

| 更新行为 | 说明 |
| :--- | :--- |
| 数据保留 | 更新安装在独立目录，不改动会话与设置 |
| 失败回退 | 旧内核保留；新内核启动后 120 秒内未加载界面则自动回退 |
| 更新范围 | 仅更新 DSH 内核及依赖，不升级 APK 内置 Node.js |
| 兼容性检查 | Node 不兼容时显示原因并禁止更新 |

## 从源码构建

### 环境要求

| 依赖 | 要求 |
| :--- | :--- |
| Java | JDK 17+ |
| Android | SDK API 34、NDK / CMake |
| Gradle | 8.13 |
| JavaScript | Node / npm |

构建脚本使用官方 npm 版本 `@deepseek-ai/dsh@0.1.7-rc.2`，以及 [nodejs-mobile](https://github.com/fogtape/nodejs-mobile) 的 Node 24 Android `libnode.so`。首次构建先运行下载脚本，它会校验运行时的 SHA-256。

### 构建命令

在项目根目录运行：

```powershell
npx --yes node@24 --version
./scripts/fetch-node.ps1
npm ci --prefix runtime --omit=dev --ignore-scripts --os=android --cpu=arm64 --libc=bionic
./scripts/prepare-runtime.ps1
./gradlew assembleDebug
```

生成的 APK 位于 `app/build/outputs/apk/debug/`。

## 适配与当前边界

这是开发原型。**2026-10-03** 已在 **OPPO PKQ110 / Android 16 / Shizuku** 上验证更新内核 `0.2.0-rc.2` 的对话、重启恢复会话、原生锁、文件读写与搜索、截图和 UI 层级读取。具体覆盖范围见 [Android 验证记录](ANDROID-VALIDATION.md)。

| 项目 | 当前说明 |
| :--- | :--- |
| 桌面插件 | 官方 Harness 的桌面终端、PowerShell、浏览器启动等插件不是针对 Android 开发的，部分能力在手机上可能不可用；`android_*` 工具用于手机操作 |
| 文字输入 | `android_text` 目前仅支持 ASCII，复杂输入可通过其他适配方式后续扩展 |
| 截图查看 | `android_screenshot` 返回图片的本地路径；请让模型接着调用官方 `read_image` 工具查看 |
| 文件搜索 | `android_find_files` 按文件名包含匹配，`android_search_text` 按区分大小写的文字包含匹配；替代没有 Android 二进制的桌面 `glob` / `grep` |
| 搜索上限 | 搜索有数量、时间和文件大小上限，会明确报告跳过和截断 |

<details>
<summary><strong>运行时适配与本地通信</strong></summary>

- 官方 Harness 依赖的 `node-addon-require-builtin` 没有 Android 原生包；本项目在固定的 Node 24 移动构建上通过 `--expose-internals` 适配，升级 Node / Harness 时需要重新验证。
- APK 提供真正的 Android `flock`，并将会话 / 新文件发布适配为 `renameat2(RENAME_NOREPLACE)`，保留原子提交与并发保护。
- 图片使用 sharp 的 WASM 后端；附件通过临时副本原子发布，并将目录同步限制在应用私有数据目录。已有下载内核也会在启动时获得适配。
- Web UI 仅绑定 `127.0.0.1:3080`；原生桥接仅绑定 `127.0.0.1:3981`，并以每次进程启动随机产生的 token 鉴权。

</details>

## 上游与参考

- [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) — 官方 Harness 项目
- [Shizuku](https://shizuku.rikka.app/) — 手机设备操作授权
- [nodejs-mobile](https://github.com/fogtape/nodejs-mobile) — Android Node.js 运行时
- [Android ADB 文档](https://developer.android.com/tools/adb) — Android 调试与设备操作参考
