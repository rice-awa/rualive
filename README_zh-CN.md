<div align="right">
  <a title="English" href="README.md"><img src="https://img.shields.io/badge/English-2F855A?style=for-the-badge&logo=readme&logoColor=white" alt="English" /></a>
  <a title="简体中文" href="README_zh-CN.md"><img src="https://img.shields.io/badge/%E7%AE%80%E4%BD%93%E4%B8%AD%E6%96%87-CB6E5D?style=for-the-badge&logo=readme&logoColor=white" alt="简体中文" /></a>
</div>

<div align="center">
  <a href="https://github.com/rice-awa/rualive">
    <img src="public/rualive-card.png" alt="rualive — Are you alive?" width="100%" />
  </a>

  <h1>rualive (Are you alive?)</h1>

  <p>一个基于 Cloudflare 的动森风、自托管网站与设备存活监控项目。</p>

  <p>
    <a href="https://github.com/rice-awa/rualive/actions/workflows/deploy.yml"><img src="https://img.shields.io/github/actions/workflow/status/rice-awa/rualive/deploy.yml?branch=main&style=for-the-badge&label=deploy&logo=github" alt="Deploy status" /></a>
    <img src="https://img.shields.io/badge/Cloudflare%20Pages-F38020?style=for-the-badge&logo=cloudflare&logoColor=white" alt="Cloudflare Pages" />
    <img src="https://img.shields.io/badge/Cloudflare%20Workers-F38020?style=for-the-badge&logo=cloudflare&logoColor=white" alt="Cloudflare Workers" />
    <img src="https://img.shields.io/badge/Next.js%2014-000000?style=for-the-badge&logo=nextdotjs&logoColor=white" alt="Next.js 14" />
    <img src="https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white" alt="TypeScript" />
    <a href="LICENSE"><img src="https://img.shields.io/badge/license-Apache--2.0-4C1?style=for-the-badge&logo=apache&logoColor=white" alt="Apache 2.0 license" /></a>
  </p>
</div>

`rualive` 是 [UptimeFlare](https://github.com/lyc8503/UptimeFlare) 的二次开发版。它保留原有的网站 / 服务监控流程，并加入由设备 Agent 驱动的心跳监控，用来回答一个简单的问题：**Are you alive?**

项目面向个人单实例部署：状态页运行在 Cloudflare Pages，Cloudflare Worker 每分钟执行主动探测，监控和设备数据存储在 Cloudflare D1 中。

## 功能

### 网站与服务监控

- 按 1 分钟周期执行 HTTP、HTTPS、TCP 检查。
- 支持自定义请求方法、请求头、请求体、预期状态码和关键词规则。
- 可选代理探测或指定 Cloudflare 地理位置探测。
- 提供事件历史、可用率、延迟图表和计划维护提示。
- 通过通用 Webhook / Apprise 兼容流程发送通知。
- 响应式状态页，支持亮色 / 暗色主题、自定义链接、自有域名 CNAME、可选密码保护和 JSON API。

### 设备存活与屏幕使用统计

设备 Agent 每隔几十秒向 `/api/heartbeat` 上报一次心跳。配置设备后，状态页可以展示：

- 根据最后一次心跳判断活跃、挂机或离线。
- 最后活跃时间，以及动森风格的设备卡片。
- 当前前台应用和窗口标题。
- 今日活跃时长、24 小时活动、应用排行和 7 / 30 天趋势（需开启 `usageTracking`）。
- 使用 `USAGE_API_KEY` 保护窗口详情和使用统计。
- 通过现有 Webhook 发送设备上线 / 下线通知。
- 设备主页卡片和紧凑的猫猫日记流两种视图。

Agent 只采集前台窗口标题、应用标识和输入空闲时长，不会截图，也不会记录按键内容。

## 动森风视觉说明

项目采用 **动森风（Animal Crossing-inspired / animal-island）视觉语言**：米白纸张底色、叶绿色状态色、圆角手绘描边、友好的动物状态插画，以及紧凑清晰的数据卡片。设备区是视觉重点，网站 / 服务监控卡片复用同一套视觉 token，让整张状态页保持统一。

设备 UI 使用并参考了开源 React 组件库 [animal-island-ui](https://github.com/guokaigdg/animal-island-ui)。

## 架构

```text
                         GET /api/device/*
浏览器  <──────────────────────────────────┐
                                           │
Agent ───── POST /api/heartbeat ───────> Cloudflare Pages
                                           │  Next.js / Edge API
Worker 定时任务 ── HTTP/TCP 探测 ─────────┤
                                           ▼
                                     Cloudflare D1
                                           │
                                           ▼
                                        Webhook
```

- **Cloudflare Pages** 渲染状态页，并承载所有 HTTP API，包括设备心跳入口。
- **Cloudflare Worker** 每分钟运行网站 / 服务检查，并发送状态通知。
- **Cloudflare D1** 保存压缩后的监控状态、设备状态、事件、每日使用时长和通知状态。
- **共享 TypeScript 模块** 让 Pages 与 Worker 使用同一套数据模型。

## 快速开始

### 1. 安装依赖

```bash
git clone https://github.com/rice-awa/rualive.git rualive
cd rualive
npm install
cd worker && npm install
cd ..
```

### 2. 配置监控目标和设备

编辑 [`uptime.config.ts`](uptime.config.ts)：

- 将 `pageConfig.title` 设置为 `rualive · Are you alive?`。
- 在 `workerConfig.monitors` 中添加网站或服务目标。
- 在 `workerConfig.devices` 中添加需要上报心跳的设备。
- 只对确实需要记录活动的设备设置 `usageTracking: true`。
- 除非允许访客看到当前窗口，否则保持 `publicWindow: false`。

设备配置示例：

```ts
devices: [
  {
    id: 'my-laptop',
    name: '我的笔记本',
    os: 'Linux / KDE Plasma',
    offlineAfterSeconds: 90,
    usageTracking: true,
    publicWindow: false,
  },
],
```

不要把 `AGENT_TOKEN`、`USAGE_API_KEY` 或其他密钥写进 `uptime.config.ts`。该文件会同时编译进 Worker 和公开的前端 bundle。

本地 Pages 调试时，把测试值放入不会提交到 Git 的 `.dev.vars`：

```dotenv
AGENT_TOKEN=replace-with-a-local-agent-token
USAGE_API_KEY=replace-with-a-local-usage-key
```

### 3. 本地运行

```bash
# 创建本地 D1 表结构
npx wrangler d1 execute uptimeflare_d1 --local --file=init.sql

# 构建 Pages bundle 并运行 Cloudflare Pages 运行时
npm run preview
```

只做 UI 调试时，可以使用 `npm run dev` 启动普通 Next.js 开发服务器。涉及 D1 的设备和状态页逻辑，应使用 `npm run preview` 验证。单独运行 Worker 定时任务：

```bash
cd worker
npm run dev
```

### 4. 部署到 Cloudflare

推送到 `main` 后，[`.github/workflows/deploy.yml`](.github/workflows/deploy.yml) 会自动部署。首次部署前，请配置以下 GitHub Actions secrets：

| Secret | 是否必需 | 用途 |
|---|---:|---|
| `CLOUDFLARE_API_TOKEN` | 是 | 创建并部署 Cloudflare 资源 |
| `CLOUDFLARE_ACCOUNT_ID` | 否 | Cloudflare 账户 ID；工作流也可以通过 API token 自动发现 |
| `AGENT_TOKEN` | 是 | 验证设备心跳 |
| `USAGE_API_KEY` | 是 | 解锁私有窗口详情和使用统计 |

工作流会构建 Worker 和 Pages 应用，根据 [`init.sql`](init.sql) 创建 / 初始化 D1，应用 Terraform 资源，并上传 Pages 部署。手动部署方式请参考 [上游部署文档](https://github.com/lyc8503/UptimeFlare/wiki)。

## 设备 Agent

Agent 文件位于 [`agent/`](agent/)，Linux 和 Windows 使用相同的 `agent.json` 配置格式：

```bash
cd agent
cp agent.json.example agent.json
# 编辑 agent.json 中的 endpoint、token 和 device_id
```

`endpoint` 填状态页根地址，不要包含 `/api`；`device_id` 必须与 `workerConfig.devices` 中的设备 ID 完全一致。

| 平台 | 要求 | 安装 |
|---|---|---|
| Linux | Python 3.8+、`requests`、KDE Plasma / Wayland；`kdotool` 和 `qdbus` 可选 | `bash install-linux.sh`，安装用户服务并可配置 `kdotool` |
| Windows | PowerShell 5.1+ | `powershell -NoProfile -ExecutionPolicy Bypass -File .\\agent\\agent.ps1 -Install` |

Windows 不需要第三方依赖。Linux 找不到 `kdotool` 时会退化为仅上报心跳，不采集窗口信息。完整配置、排错和手动服务步骤见 [Agent 指南](agent/README.md)。

安装 Windows 登录自启任务前，可先执行一次：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\agent\agent.ps1 -Once
```

Linux 可以使用 dry-run 验证采集结果而不发送数据：

```bash
python3 agent/agent.py --once --dry-run
```

## API 概览

| 方法与路径 | 鉴权 | 说明 |
|---|---|---|
| `POST /api/heartbeat` | `Authorization: Bearer <AGENT_TOKEN>` | 接收设备心跳，并按配置记录使用数据；成功返回 `204`。 |
| `GET /api/device/status` | 公开；`X-API-Key` 可选 | 返回在线 / 挂机 / 离线状态；有效密钥还会返回私有窗口字段。 |
| `GET /api/device/usage?device_id=<id>&days=7` | 必须提供 `X-API-Key` | 返回每日、逐小时和应用使用数据。 |
| `GET /api/data` | 公开 | 返回当前网站 / 服务监控状态 JSON。 |
| `GET /api/state` | 公开 | 返回前端实时刷新使用的压缩状态。 |
| `GET /api/badge?id=<monitor-id>` | 公开 | 返回指定监控的 badge 数据。 |

心跳请求示例：

```bash
export RUALIVE_URL="https://your-status-page.example"
export AGENT_TOKEN="your-agent-token"

curl --request POST "$RUALIVE_URL/api/heartbeat" \
  --header "Authorization: Bearer $AGENT_TOKEN" \
  --header "Content-Type: application/json" \
  --data '{
    "device_id": "my-laptop",
    "device_name": "我的笔记本",
    "os": "linux",
    "os_ver": "KDE Plasma / Wayland",
    "title": "README.md - Visual Studio Code",
    "app": "code",
    "idle": 0
  }'
```

## 隐私与密钥

- `AGENT_TOKEN` 只用于接收设备心跳。
- `USAGE_API_KEY` 用于解锁使用统计和私有窗口数据。
- 没有有效 usage key 时，`/api/device/status` 会隐藏 `last_title` 和 `last_app`，除非设备显式配置 `publicWindow: true`。
- 心跳在线状态使用服务端时间戳计算，不信任客户端时间。
- `agent/agent.json` 和 `.dev.vars` 已被 Git 忽略，请勿提交。

## 项目目录

```text
pages/              Next.js 状态页和 Edge API 路由
components/         监控与设备 UI 组件
worker/src/         定时 Worker 和共享 D1 数据层
agent/              Linux 与 Windows 心跳 Agent
init.sql            D1 表结构
deploy.tf           Cloudflare Terraform 资源
docs/               PRD、开发计划和预览资源
```

## 开发检查

项目目前没有自动化单元测试。提交改动前建议执行：

```bash
npm run lint
npm run build
```

设备功能的详细需求和实现决策见 [`docs/PRD.md`](docs/PRD.md) 与 [`docs/DEV_PLAN.md`](docs/DEV_PLAN.md)。

## 致谢与许可证

rualive 基于 fork 上游项目和原始 UptimeFlare 项目的工作，感谢维护者与贡献者提供 Cloudflare 监控基础能力。

- **动森风 UI 组件库与视觉参考：** [guokaigdg/animal-island-ui](https://github.com/guokaigdg/animal-island-ui)

<div align="center">
  <a href="https://github.com/afoim/UptimeFlare">
    <img src="https://github-readme-stats.vercel.app/api/pin/?username=afoim&repo=UptimeFlare&show_owner=true&theme=default" alt="afoim/UptimeFlare — fork 上游项目" />
  </a>
  <a href="https://github.com/lyc8503/UptimeFlare">
    <img src="https://github-readme-stats.vercel.app/api/pin/?username=lyc8503&repo=UptimeFlare&show_owner=true&theme=default" alt="lyc8503/UptimeFlare — 原始项目" />
  </a>
</div>

- **Fork 上游项目：** [afoim/UptimeFlare](https://github.com/afoim/UptimeFlare)
- **原始项目：** [lyc8503/UptimeFlare](https://github.com/lyc8503/UptimeFlare)

项目使用 [Apache License 2.0](LICENSE) 开源。
