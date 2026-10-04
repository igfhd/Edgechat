<div align="center">
  <img src="Edgechat.png" alt="EdgeChat" width="640" />

  <h3>基于 Cloudflare 全家桶打造的现代团队聊天系统</h3>
  <p>账号体系 · 公开/私有群组 · 私信 · 实时消息 · 文件上传 · 管理后台</p>

  <p>
    <img src="https://img.shields.io/github/license/aozorae/Edgechat?style=flat-square&color=blue" alt="license" />
    <img src="https://img.shields.io/github/stars/aozorae/Edgechat?style=flat-square&color=orange" alt="stars" />
    <img src="https://img.shields.io/github/forks/aozorae/Edgechat?style=flat-square" alt="forks" />
    <img src="https://img.shields.io/github/issues/aozorae/Edgechat?style=flat-square" alt="issues" />
    <img src="https://img.shields.io/github/last-commit/aozorae/Edgechat?style=flat-square" alt="last commit" />
  </p>
  <p>
    <img src="https://img.shields.io/badge/Vue.js-3-4FC08D?style=flat-square&logo=vuedotjs&logoColor=white" alt="Vue 3" />
    <img src="https://img.shields.io/badge/Cloudflare-Workers-F38020?style=flat-square&logo=cloudflare&logoColor=white" alt="Cloudflare Workers" />
    <img src="https://img.shields.io/badge/Hono-E36002?style=flat-square&logo=hono&logoColor=white" alt="Hono" />
    <img src="https://img.shields.io/badge/Durable_Objects-WebSocket-F38020?style=flat-square&logo=cloudflare&logoColor=white" alt="Durable Objects" />
    <img src="https://img.shields.io/badge/GPL--3.0--or--later-A42E2B?style=flat-square&logo=gnu&logoColor=white" alt="GPL-3.0-or-later" />
    <img src="https://img.shields.io/badge/Telegram-双向消息桥接-26A5E4?style=flat-square&logo=telegram&logoColor=white" alt="Telegram Bridge" />
  </p>

  <p>
    <a href="README.md"><b>中文</b></a> ·
    <a href="README.en.md">English</a> ·
    <a href="README.ja.md">日本語</a> ·
    <a href="https://edgechat-demo.wcjxxgaq.workers.dev">在线 Demo</a> ·
    <a href="https://echat.azora.top/">项目文档</a> ·
    <a href="https://t.me/EdgeChatlounge">Telegram 社区</a>
  </p>

  > ***这可能是 1000 万以下最好用的 Cloudflare 聊天室***
</div>

<br />

EdgeChat 是一个部署在 Cloudflare 上的团队聊天系统：账号体系、公开群组、私有群组、私信、实时消息、文件上传、管理员后台一应俱全。目标很直接——在 Cloudflare 生态里，用尽量低的运维成本，跑起一套能直接落地使用的站内 IM。

## 目录

- [界面预览](#界面预览)
- [在线 Demo](#在线-demo)
- [特色功能：Telegram 消息双向桥接](#特色功能telegram-消息双向桥接)
- [为什么是 EdgeChat](#为什么是-edgechat)
- [功能特性](#功能特性)
- [技术栈](#技术栈)
- *[Telegram 社区](#telegram-社区)*
- [部署](#部署)
- [快速开始](#快速开始)
- [项目结构](#项目结构)
- [贡献](#贡献)
- [Star History](#star-history)
- [协议说明](#协议说明)

## 界面预览

<table>
  <tr>
    <td width="50%" align="center"><strong>聊天界面</strong></td>
    <td width="50%" align="center"><strong>管理后台</strong></td>
  </tr>
  <tr>
    <td width="50%"><img src="assets/previews/chat-home.png" alt="EdgeChat 聊天界面预览" width="100%" /></td>
    <td width="50%"><img src="assets/previews/admin-dashboard.png" alt="EdgeChat 管理后台预览" width="100%" /></td>
  </tr>
</table>

## 在线 Demo

**[edgechat-demo.wcjxxgaq.workers.dev](https://edgechat-demo.wcjxxgaq.workers.dev)**

演示站复用正式项目的 Vue 页面、路由、状态管理和实时消息逻辑，但所有 API、WebSocket、文件上传与 Telegram 回流都在浏览器内存中模拟。刷新页面或点击右上角「重置演示数据」即可恢复初始状态，不会访问正式 Worker，也不会写入 D1、KV 或 R2。

## 特色功能：Telegram 消息双向桥接

管理员可以把 EdgeChat 内的任意一个群组，与一个 Telegram 群组绑定。绑定后，通过 Telegram Bot，两侧的消息会**双向实时转发**——EdgeChat 成员发的消息会同步出现在 Telegram 群里，Telegram 群里的消息也会同步出现在 EdgeChat 里，两边成员就像在同一个群里聊天一样，完全不需要互相切换应用或重复建群。

<div align="center">
  <img
    src="https://github.com/user-attachments/assets/eb5d6b5a-4664-41c6-a760-02c4a1398b36"
    alt="EdgeChat 与 Telegram 双向消息桥接演示"
    width="90%"
  />
  <br />
  <sub>实时无缝转发，双向同步</sub>
</div>

## 为什么是 EdgeChat

| | EdgeChat | 自建 Rocket.Chat / Mattermost | 商业 SaaS IM |
|---|---|---|---|
| 部署成本 | Cloudflare 免费额度内可跑 | 需要常驻服务器 / 容器 | 按人头订阅收费 |
| 运维负担 | 无需管理服务器，Serverless | 需要自行运维数据库、缓存 | 无需运维，但不可控 |
| 数据归属 | 完全在自己的 Cloudflare 账号 | 完全自持 | 数据在第三方 |
| 上线方式 | GitHub Actions 一键自动部署 | 手动 / Docker Compose | 直接注册 |

> 这张对比表只是给出一个大致的选型参考，实际是否合适取决于你的团队规模和需求，欢迎在 Issue 里讨论指正。

## 功能特性

**💬 消息与会话体验**
- **全场景会话支持**：公开频道、私密群组与 1v1 私信会话
- **消息单条/批量转发**：支持跨会话转发，私密 E2EE 附件在客户端内存中安全解密并根据目标会话类型重新加密分发，保留语音条元数据并支持附加留言
- **[Telegram 群组双向消息桥接](#特色功能telegram-消息双向桥接)**：通过 Telegram Bot 实现 EdgeChat 与 Telegram 群消息无缝实时互通
- **群聊专属成员色彩**：12 套精心调配的高对比度成员气泡调色盘（浅色模式柔和粉彩，暗黑模式深邃暗夜发光边框），彻底告别群聊单调白泡
- **精准已读回执**：支持单勾（已发出）与双勾（已读）状态显示，基于 WebSocket 实时广播、REST 水位与消息流因果多层级判定
- **富交互与辅助功能**：Markdown 渲染、代码高亮与一键复制、表情反应（Reactions）、快速回复、Telegram 风格未读消息分割线与快速跳底浮标

**📁 团队云盘与聊天生态联动 (EdgeChat Drive)**
- **独立云盘存储系统**：支持个人云盘与群组共享文件管理，多层级文件夹、批量拖拽上传与存储分析
- **聊天与云盘双向互通**：一键将聊天中的单条/多选附件打包归档至我的云盘；支持从云盘直接向聊天会话发送文件或富交互文件分享卡片
- **多格式在线预览**：原生支持图片、音视频、PDF、文档及代码文件的网页端即时预览与直接下载

**🎙️ 语音条、变声器与实时通话**
- **微信风格语音条**：按住说话、上滑取消发送、音频波形动画、未读红点追踪与连续自动播放
- **音频 DSP 实时变声**：内置客户端音频变声引擎（原声、萝莉、大叔、机器人、空灵回声等）
- **实时语音通话与群组语音会议**：基于 Cloudflare Calls SFU 构建的 1v1 语音通话与多人群组会议，支持音浪检测、举手发言、主持人全员静音与浮动通话悬浮窗

**🔐 零知识端到端加密与隐私保护**
- **端到端加密 (E2EE)**：私聊与私密群组默认启用 X25519 密钥协商 + AES-256-GCM 载荷信封，附件在客户端内存加密后存入 R2
- **安全云端私钥备份**：基于用户密码派生密钥加密备份私钥，实现跨设备登录无缝解密历史 E2EE 消息
 - **流量混淆与自适应伪装反代**：支持双向诱饵流量（Cover Traffic）、定长数据包填充对齐（256B/1024B/4096B）、多隐藏路径入口（Multi-Route Entrances）与零暴露反代伪装（Disguise Proxy）
- **服务端数据加密**：公开频道消息正文与附件默认使用 AES-256-GCM 服务端静态加密；管理员后台完全无权查看任何群组或私信明文正文

**🛠 管理后台与运维**
- **全方位管理仪表盘**：用户封禁/解封、修改资料、重置密码、注册邀请链接管理
- **R2 存储流式分析**：游标分页扫描 R2 存储桶，精准呈现各用户文件数与存储容量消耗
- **在线版本对比与更新检查**：浏览器端直接比对源码仓库，提示当前部署版本与更新日志
- **全自动化运维脚本**：配套 Linux/macOS 工业级一键部署与多账号热更新脚本（`deploy_edgechat_Linux.sh`）

## 技术栈

<p>
  <img src="https://img.shields.io/badge/Frontend-Vue_3_·_Vue_Router_·_Vite-4FC08D?style=flat-square&logo=vuedotjs&logoColor=white" alt="frontend" />
  <img src="https://img.shields.io/badge/Backend-Cloudflare_Workers_·_Hono-F38020?style=flat-square&logo=cloudflare&logoColor=white" alt="backend" />
  <br />
  <img src="https://img.shields.io/badge/Realtime-Durable_Objects_(WS_Hibernation)-F38020?style=flat-square&logo=cloudflare&logoColor=white" alt="realtime" />
  <img src="https://img.shields.io/badge/WebRTC_SFU-Cloudflare_Calls-F38020?style=flat-square&logo=webrtc&logoColor=white" alt="calls" />
  <img src="https://img.shields.io/badge/Crypto-Web_Crypto_X25519_·_AES--GCM-007ACC?style=flat-square&logo=securityscorecard&logoColor=white" alt="crypto" />
  <br />
  <img src="https://img.shields.io/badge/Database-Cloudflare_D1-F38020?style=flat-square&logo=cloudflare&logoColor=white" alt="d1" />
  <img src="https://img.shields.io/badge/Session-Cloudflare_KV-F38020?style=flat-square&logo=cloudflare&logoColor=white" alt="kv" />
  <img src="https://img.shields.io/badge/Files-Cloudflare_R2-F38020?style=flat-square&logo=cloudflare&logoColor=white" alt="r2" />
  <br />
  <img src="https://img.shields.io/badge/Deploy-Wrangler_·_GitHub_Actions-2088FF?style=flat-square&logo=githubactions&logoColor=white" alt="deploy" />
</p>

## Telegram 社区

欢迎加入我们的 [Telegram 社区](https://t.me/EdgeChatlounge)，与其他用户和开发者交流讨论、反馈问题，第一时间获取项目动态。

## 部署

### 🔑 Cloudflare API Token 权限配置指南

无论使用 GitHub Actions、Web Deployer 还是 Linux/macOS 部署脚本，推荐在 [Cloudflare 控制台 -> API 令牌](https://dash.cloudflare.com/profile/api-tokens) 创建包含以下 **账户级 (Account)** 权限的 API Token：

| 权限类别 (Category) | 权限名称 (Permission) | 访问级别 (Access) | 作用说明 |
|---|---|---|---|
| **账户 (Account)** | **Cloudflare Workers** | `编辑 (Edit)` | 部署 Worker 核心逻辑与 Durable Objects |
| **账户 (Account)** | **D1** | `编辑 (Edit)` | 自动创建与迁移 D1 SQLite 数据库 |
| **账户 (Account)** | **Workers KV 存储** | `编辑 (Edit)` | 自动创建与绑定高频会话 KV 空间 |
| **账户 (Account)** | **Workers R2 存储** | `编辑 (Edit)` | 自动创建与绑定文件存储桶（若选用 R2） |
| **账户 (Account)** | **Calls** | `编辑 (Edit)` | **自动创建并开通 WebRTC 音视频通话 SFU 应用** |

### GitHub Actions 自动部署（推荐）

推荐优先使用 GitHub Actions 部署，适合长期维护和生产环境更新。仓库内已提供 `.github/workflows/deploy-worker.yml`，推送到 `master` 或 `main`，或手动触发 `workflow_dispatch` 即可执行自动部署。

- 快速开始：<https://echat.azora.top/guide/getting-started.html>
- 详细教程：<https://echat.azora.top/guide/actions-deploy.html>

### Web Deployer 网页图形化部署（零门槛 / VPS 自建）

项目提供了基于 Web 界面的可视化自动化部署服务（**EdgeChat Web Deployer**）。用户只需在浏览器中填入 Cloudflare API Token 和配置项，系统便会自动调用 Cloudflare API 与 Wrangler 完成 D1、KV、R2 创建与 Worker 发布，并支持实时 SSE 部署日志流与 24 小时数据自动销毁。

- **本地启动**：运行 `./server/run.sh` 访问 `http://localhost:8000`
- **VPS / Docker 部署并公开分享**：在 `deploy/` 目录下执行 `docker compose up -d --build`，配合 Nginx 反代与 SSL 即可对外提供公开部署网页。详细配置与注意事项参见 [DOCKER.md](DOCKER.md)。

### Linux / macOS 命令行一键部署

也可以在终端直接运行全自动化交互式部署脚本：

```bash
./deploy_edgechat_Linux.sh
```

<details>
<summary><strong>🔐 隐私与服务端加密说明（点击展开）</strong></summary>

<br />

GitHub Actions 会管理服务端加密 Worker Secrets。首次部署时，如果目标 Worker 尚无加密 Secret，工作流会自动生成随机 32 字节 AES 密钥，以独立的版本化 Secret 注入，并记录当前 active key ID；后续普通部署只检查这些 Secret 是否存在，不会重新生成、覆盖或轮换。生产环境已经存在的 `EDGECHAT_ENCRYPTION_KEYRING` JSON 密钥环也会被原样保留并继续兼容。

部署后新写入的消息正文和新上传的附件会自动加密。历史 D1 消息和 R2 附件保持原状，读取时同时兼容历史明文与新密文；项目不会通过 Cron、定时任务或部署脚本循环加密全部历史数据。

需要手动指定密钥时，可创建名为 `EDGECHAT_ENCRYPTION_KEYRING` 的 GitHub Repository Secret，格式如下：

```json
{"activeKeyId":"v1","keys":{"v1":"BASE64_ENCODED_32_BYTE_KEY"}}
```

首次部署会直接采用该值。已有 Worker 需要自动增量轮换时，手动运行 `Deploy Worker` 并勾选 `rotate_encryption_key`：工作流只新增一个版本化密钥 Secret，并把 active key ID 切换到新版本，所有旧 Secret 和旧 JSON 密钥环都保持不变。新消息会使用新 active key，旧密文继续使用各自信封中的 key ID 解密。

`apply_encryption_keyring` 是备用的手动覆盖入口。使用它时，Repository Secret 中必须是完整 JSON 密钥环，`keys` 需要保留所有仍被历史密文引用的旧 key ID，再增加新 key 并更新 `activeKeyId`。删除旧 key 会导致对应历史密文永久无法读取。`apply_encryption_keyring` 与 `rotate_encryption_key` 不能在同一次运行中同时启用。

这属于服务端静态加密，不是端到端加密。Worker 会在通过会话权限校验后解密内容，因此 Cloudflare Worker 运行环境和掌握密钥的部署方仍位于信任边界内。作为配套隐私调整，管理员后台的消息搜索与完整会话查看页面及其 API 已移除；管理员仍可看到消息数量等聚合统计。

</details>

### 手动部署 / Docker

<details>
<summary>点击展开手动部署与 Docker 说明</summary>

<br />

如果你希望本地手动部署，完整步骤、资源准备和注意事项请查看文档站教程：

- 手动部署教程：<https://echat.azora.top/guide/getting-started.html>
- 文档首页：<https://echat.azora.top/>
- Docker 本地部署：[DOCKER.md](DOCKER.md)

</details>

### Android 客户端

项目的 Android 客户端采用 Capacitor 构建方案（位于 `capacitor/`）。APK 直接打包 Vue Web UI，系统的文件选取、本地通知、麦克风录音权限与外链处理由轻量 Kotlin 原生插件桥接实现。Application ID 为 `com.aozorae.edgechat.web`，首次登录时由用户输入自己的 EdgeChat HTTPS 服务器地址，不绑定特定部署。

- **首次使用**：在登录界面填入自己的 EdgeChat HTTPS 实例地址、账号与密码
- **本地编译**：安装 JDK 21 与 Android SDK 36 后执行 `npm run build:capacitor`
- **构建产物**：Debug APK 输出于 `capacitor/android/app/build/outputs/apk/debug/app-debug.apk`
- **CI/CD**：配套提供 `.github/workflows/capacitor-android-ci.yml` 与 `.github/workflows/android-release.yml`
- **切换服务器**：退出登录后可重新修改服务器地址；切换到不同实例会自动清理旧会话凭据

## 快速开始

```bash
# 安装依赖
npm install

# 前端开发
npm run dev:frontend

# 纯前端 demo（独立端口和构建目录）
npm run dev:demo

# 本地构建
npm run build

# 构建 Android Capacitor 客户端（需 JDK 21 与 Android SDK 36）
npm run build:capacitor

# 本地手动发布
npm run deploy
```

<details>
<summary>更多脚本说明（demo 构建 / 部署、CI 环境变量）</summary>

<br />

```bash
# 独立构建 demo
npm run build:demo

# 部署独立 demo Worker
npm run deploy:demo
```

demo 使用 `wrangler.demo.toml` 和 `.github/workflows/deploy-demo.yml`，Worker 名称为 `edgechat-demo`。GitHub Actions 仅支持手动触发，并读取 `DEMO_CLOUDFLARE_ACCOUNT_ID`、`DEMO_CLOUDFLARE_API_TOKEN`，不会改变现有生产部署工作流。

在非交互环境下部署时，需要提前设置 `CLOUDFLARE_API_TOKEN`。

后台更新检查会在构建时自动记录当前 GitHub 仓库、分支和提交。为了获得准确结果，手动部署应在 Git 仓库内基于已经推送的干净提交构建；源码仓库需要保持公开，浏览器才能直接调用 GitHub Compare API，整个过程不会创建定时任务。

PowerShell 示例：

```powershell
$env:CLOUDFLARE_API_TOKEN = "your-token"
npm run deploy
```

</details>

## 项目结构

<details>
<summary>点击展开目录树</summary>

```text
edgechat/
├─ assets/
│  └─ previews/
│     ├─ chat-home.png
│     └─ admin-dashboard.png
├─ frontend/
│  ├─ src/
│  │  ├─ api.js
│  │  ├─ router.js
│  │  ├─ store.js
│  │  ├─ ws.js
│  │  ├─ runtime.js
│  │  ├─ demo/
│  │  ├─ styles.css
│  │  ├─ components/ui/
│  │  └─ pages/
│  ├─ vite.config.js
│  └─ vite.demo.config.js
├─ worker/
│  ├─ schema.sql
│  ├─ migrations/
│  └─ src/
│     ├─ index.js
│     ├─ auth.js
│     ├─ db.js
│     ├─ middleware.js
│     ├─ utils.js
│     ├─ api/
│     └─ do/
├─ wrangler.toml
├─ wrangler.demo.toml
├─ package.json
├─ README.md
├─ README.en.md
├─ README.ja.md
└─ LICENSE
```

</details>

更多实现说明可查看 [TECHNICAL.md](TECHNICAL.md) 和文档站：<https://echat.azora.top/>

## 贡献

欢迎提交 Issue 和 Pull Request，一起完善 EdgeChat。

感谢所有为项目提供帮助的贡献者：

[![贡献者](https://contrib.rocks/image?repo=aozorae/Edgechat)](https://github.com/aozorae/Edgechat/graphs/contributors)

## Star History

<a href="https://www.star-history.com/?type=date&repos=aozorae%2FEdgechat">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/chart?repos=aozorae/Edgechat&type=date&theme=dark&legend=top-left&sealed_token=GpyqTbdwb3a2OHOT-WlCSoSzrumr3iwtcNluTpGbcU5CuyfP4eKf9TjtDuJ2uY4XK0P6knEB6OFCkbaAMsMCO3vnGPprGvB4f4rd7kmbUNe3fJ8LNaaGVH7JZLDT7SNNy3DC-sBxZwBmfL7gP9AFv1iKX1FgYnRZuOBGcKkbWFlBuoq2TXpYIfWmoUF9" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/chart?repos=aozorae/Edgechat&type=date&legend=top-left&sealed_token=GpyqTbdwb3a2OHOT-WlCSoSzrumr3iwtcNluTpGbcU5CuyfP4eKf9TjtDuJ2uY4XK0P6knEB6OFCkbaAMsMCO3vnGPprGvB4f4rd7kmbUNe3fJ8LNaaGVH7JZLDT7SNNy3DC-sBxZwBmfL7gP9AFv1iKX1FgYnRZuOBGcKkbWFlBuoq2TXpYIfWmoUF9" />
   <img alt="Star History Chart" src="https://api.star-history.com/chart?repos=aozorae/Edgechat&type=date&legend=top-left&sealed_token=GpyqTbdwb3a2OHOT-WlCSoSzrumr3iwtcNluTpGbcU5CuyfP4eKf9TjtDuJ2uY4XK0P6knEB6OFCkbaAMsMCO3vnGPprGvB4f4rd7kmbUNe3fJ8LNaaGVH7JZLDT7SNNy3DC-sBxZwBmfL7gP9AFv1iKX1FgYnRZuOBGcKkbWFlBuoq2TXpYIfWmoUF9" />
 </picture>
</a>

[![Typing SVG](https://readme-typing-svg.demolab.com?font=Fira+Code&size=24&duration=2500&pause=1000&color=F7D747&width=435&lines=%E2%AD%90+star+%E7%82%B9%E8%B5%B7%E6%9D%A5%EF%BC%81)](https://git.io/typing-svg)

## 协议说明

本项目采用 [`GNU GPL v3.0 or later`](LICENSE)。

你可以使用、修改和分发本项目；如果你分发修改版本，需要继续提供对应源代码，并保持 GPL 兼容。

## 鸣谢

感谢 <a href="https://linux.do" target="_blank">linux do</a> 在推广方面为本项目做出的贡献。
