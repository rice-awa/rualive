# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概览

UptimeFlare 二次开发版：Cloudflare 托管的免费 uptime 监控 + 状态页。上层是 Next.js（Pages Router，edge runtime）状态页，下层是 Cloudflare Worker 每分钟 cron 探测监控目标。fork 自 lyc8503/UptimeFlare，正在按 `docs/PRD.md` + `docs/DEV_PLAN.md` 开发「似了喵？」设备存活监控 + 屏幕使用时长统计（设备心跳上报、密钥分级的设备区块）。

## 常用命令

| 命令 | 说明 |
|---|---|
| `npm run dev` | Next.js dev server。注意 `next.config.js` 只在 dev 绑定了 KV `UPTIMEFLARE_STATE`，**D1 binding 不在其中**；要调 D1 相关逻辑用下一条 |
| `npm run preview` | `@cloudflare/next-on-pages` 构建后 `wrangler pages dev` 本地起 Pages 运行时（edge 环境，D1/secret 经 wrangler 传参） |
| `npm run build` | Next.js 构建 |
| `npm run lint` | `next lint` |
| `cd worker && npm run dev` | Worker 本地开发（`wrangler dev --test-scheduled`，可手动触发 cron） |
| `cd worker && npx wrangler deploy` | 部署 Worker |
| `npx wrangler d1 execute uptimeflare_d1 --local --file=init.sql` | 本地 D1 建表/执行 SQL（`--remote` 是生产库） |
| Docker 自托管 | `docker build` + `entrypoint.sh`（内部起 worker + pages + cron curl `/__scheduled`） |

**没有单元测试。** 验证手段是 `wrangler d1 execute` / `wrangler pages dev` + curl 打 API、`wrangler dev --test-scheduled`、真机联调。

## 架构

**两个运行时共享同一份 TS 代码——这是本项目最重要的结构事实。**

```
Cloudflare Pages (Next.js, edge)               Cloudflare Worker (cron, 每分钟)
  pages/index.tsx   SSR 读 D1 渲染状态页         worker/src/index.ts  探测 monitors
  pages/api/*.ts    只读/上报 API               worker/src/store.ts   压缩状态读写 D1
        │  import '@/worker/src/store'                 │
        └───────────────┬──────────────────────────────┘
                        ▼
  共享代码：uptime.config.ts / types/config.ts / worker/src/store.ts / worker/src/util.ts
                        ▼
   D1: uptimeflare(key,value) —— 单行 'state' 存全部监控的压缩 JSON
```

- **Worker 只有 `scheduled` 入口，没有任何 HTTP fetch handler**（`worker/wrangler.toml` 无 routes）。任何 HTTP 入口（如设备心跳上报）必须放在 Pages 的 `pages/api/*`。
- **Pages 里访问 D1 binding 通过 `process.env`**：`getFromStore(process.env as any, 'state')`。这里 `process.env` 承载的是 CF binding，不要按标准 Node 环境变量理解。
- **全站被 `<NoSsr>` 包裹**（`pages/_app.tsx`）：getServerSideProps 只负责传 props，组件渲染在客户端完成，纯客户端行为不要自己再包 NoSsr。
- **Worker 与 Pages 靠互相 import 共享代码**：worker 侧 `../../types/config`、`../../uptime.config`；pages 侧 `@/worker/src/store`。新增共享模块放 `worker/src/` 下即可两端复用，不要复制到 pages 侧。
- **状态存储**：D1 单表 `uptimeflare(key,value)`，key='state' 存 `MonitorStateCompacted` 压缩 JSON（列式 incident + RLE/base64 编码的 latency）。2026/01 已从 KV 迁到 D1（见 `types/config.ts` 里的性能注释），不要回退到 KV 心智。
- `proxy/` 是可选自托管的 Express 版探测服务（用于 `monitor.checkProxy` 指向自建 URL 的地理探测场景），与 Worker 逻辑互补但不共享代码。

## 配置与密钥（最容易踩的坑）

- `uptime.config.ts` / `uptime.config.full.ts` 会**同时编译进 Worker 和前端 bundle**（两个入口都 import 它）。**任何密钥（API key / token / 密码）严禁写入该文件**，只能走运行时 secret：
  - Pages secret：`deploy.tf` 的 `deployment_configs.production.env_vars`（`type = "secret_text"`，terraform provider v5 语法），运行时 `process.env.XXX` 读取
  - Worker secret：`wrangler secret put`
- 现有通知 webhook 在 `uptime.config.ts` 里用 `${env.RESEND_API_KEY}` 占位符，运行时替换成真实 env。
- `middleware.ts` 的 `passwordProtection`（Basic Auth）会拦截**所有**路由，包括 API。当前未启用；一旦启用，机器上报路径（如心跳）会被挡，需评估。
- 配置新增类型放 `types/config.ts`（`WorkerConfig` / `MonitorTarget` 等），页面与 worker 共用。

## 数据流与监控逻辑

1. Worker cron 每分钟遍历 `workerConfig.monitors`，HTTP/TCP 探测，维护两类结构：incident（故障区间数组）与 latency（近 12h 延迟采样，追加 + 清理旧值），压缩后写回 D1 'state'。
2. 状态翻转时经 `formatAndNotify` → `webhookNotify` 发通知（当前配置是 Resend 邮件）。
3. 前端 `pages/index.tsx` getServerSideProps 读 'state' 传给组件；URL hash `#<monitorId>` 直达单个监控详情。
4. 通知的宽限期 / 跳过 / 维护期逻辑都在 `worker/src/index.ts` + `worker/src/util.ts`，读通知相关代码从这两处入手。

## 部署

push 到 `main` 触发 `.github/workflows/deploy.yml`：构建 worker（dry-run）→ `@cloudflare/next-on-pages` → `deploy/init_d1.py`（幂等执行 `init.sql` 建表）→ `deploy/migrate_kv.py` → terraform（**无远端 state**，每次需 import 现有资源）→ `wrangler pages deploy`。

- **建表只需改 `init.sql`**：CI 的 init_d1.py 会自动执行（`CREATE TABLE IF NOT EXISTS` 幂等），新表随部署自动创建。
- terraform 需要 `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID`，Pages secret 通过 `TF_VAR_*` 从 GH Actions secrets 注入。
- 部署产物：worker 输出 `worker/dist/index.js`，pages 输出 `.vercel/output/static`。

## 语言 / i18n

界面文案经 `util/i18n.ts` 初始化 i18next，`pages/_app.tsx` 引入；新增文案加到 `locales/zh-CN/common.json`（及 `zh-TW` / `en` 对应项），不要硬编码在组件里。仓库注释与配置说明为中文。
