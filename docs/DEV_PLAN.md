# 开发计划：「似了喵？」设备存活监控 + 屏幕使用时长统计

> 版本: v0.1 · 日期: 2026-08-29 · 输入: `docs/PRD.md` + `docs/prototype.html` · 全部关键假设已对代码库核实

---

## 0. 结论速览

1. **PRD 的所有架构性假设均已核实，无阻塞项**，可直接进入实现。
2. 分三阶段交付，与 PRD §9 里程碑对齐：**M1 存活链路 + 共存 + 解锁** → **M2 使用统计** → **M3 通知收尾**。
3. 前端布局**严格对齐 `prototype.html`**，两个变体都做：**「主页」变体**（指挥台 + 卡片墙 + 详情页）与**「猫猫日记流」变体**（横幅流 + 内联统计，无二级页），右上角视图切换。**不引入新设计、不大改**，仅对动画做打磨优化（实现动画时按 `animate` / `animation-vocabulary` / `find-animation-opportunities` / `improve-animations` 动画指导 skill 执行）。
4. **密钥注入方案已确认**：Terraform provider v5 的 `cloudflare_pages_project.deployment_configs.production.env_vars` 支持 `type = "secret_text"`，`AGENT_TOKEN` / `USAGE_API_KEY` 可随 `terraform apply` 部署，无需手动 `wrangler pages secret put`（关闭 PRD 风险 #6）。
5. 新增 D1 表追加进 `init.sql` 即可，现有 `deploy/init_d1.py` 幂等执行，**新表随下一次 CI 部署自动创建**。
6. Worker 与 Pages 已共享代码（`pages/index.tsx` 直接 import `@/worker/src/store`），设备 DB 层放 `worker/src/` 下天然被两端复用，零重复实现。

---

## 1. 现状核实（代码探索结论）

### 1.1 架构确认表

| PRD 假设 | 代码核实结果 |
|---|---|
| Worker 无 HTTP fetch 入口，只有 cron | ✅ `worker/src/index.ts` 仅有 `scheduled`，`worker/wrangler.toml` 无 routes → 心跳入口必须放 Pages API |
| Pages 可在 edge runtime 访问 D1 | ✅ `pages/index.tsx:73`、`pages/api/data.ts:16` 均用 `getFromStore(process.env as any, ...)`，binding 经 `process.env` 暴露 |
| 通知链路可复用 | ✅ `worker/src/util.ts` 导出 `webhookNotify` / `formatAndNotify`；`uptime.config.ts` 已配 Resend webhook |
| 单表 KV 不适合时序数据 | ✅ D1 仅 `uptimeflare` 单表（`init.sql`），新增 3 表互不干扰 |
| 前端有 chart.js + i18n + 暗色 | ✅ `components/DetailChart.tsx`（chart.js + react-chartjs-2）、`locales/zh-CN`、`_app.tsx` Mantine `defaultColorScheme="auto"` |
| animal-island-ui 未引入 | ✅ `package.json` 无此依赖，需新增并锁定 `0.7.7` |

### 1.2 与 PRD 的重要差异 / 补充（实现时必须遵守）

1. **全站被 `NoSsr` 包裹**（`_app.tsx:9` `dynamic(..., {ssr:false})`）——实际是「getServerSideProps 传 props + 客户端渲染」。PRD 说的「SSR 提供首屏公开数据避免白屏」在本架构下应改为：**设备公开数据通过 `getServerSideProps` 作为 props 传入**，密钥解锁后的详细字段由客户端 30s 轮询补齐。两者都不算纯 SSR，但数据流一致。
2. **`#device:<id>` 路由必须在现有 monitorId 逻辑之前解析**。`pages/index.tsx:31` 目前把 `location.hash.substring(1)` 直接当 monitorId 查找，找不到就显示 "Monitor not found"。若不加前缀判断，`#device:riceawa-desktop` 会被当成 monitorId 报错。
3. **worker 与 pages 已共享代码**：worker 通过相对路径 `../../uptime.config`、`../../types/config` 引用；pages 通过 `@/worker/src/store` 反向引用。设备 DB helper 放 `worker/src/deviceStore.ts` 即可两端共用，**不要复制到 pages 侧**。
4. **密钥注入路径已定**（见 §7 部署清单）：`deploy.tf` 的 `deployment_configs.production` 增加 `env_vars` 块，用 `secret_text` 类型。注意现有 `deploy.tf` 已是 provider v5 的 nested-attribute 写法，直接追加即可。
5. **middleware 的 Basic Auth 会拦截所有路由（含 API）**：`middleware.ts` 无 matcher 限制。当前 `passwordProtection` 未配置，无影响；若将来启用，需评估对 `/api/heartbeat` 的冲击（PRD §8 已提示）。
6. **worker cron 每分钟一次**，通知判定粒度即 1 分钟；`device_events` 清理可挂在同一 cron，不另起定时器。
7. **worker 的 `Env` 接口已含 `UPTIMEFLARE_D1`**（`worker/src/index.ts:12`），cron 读 `device_status` 无需改绑定。

---

## 2. 目标架构（本计划落地形态）

```
┌──────────────┐  POST /api/heartbeat (Bearer AGENT_TOKEN)  ┌───────────────────────────┐
│ Agent        │ ─────────────────────────────────────────▶ │ Cloudflare Pages          │
│ agent.py     │                                            │ pages/api/heartbeat.ts    │ UPSERT/INSERT
│ agent.ps1    │                                            │ pages/api/device/*.ts     │──────────▶ D1
└──────────────┘                                            │ pages/index.tsx (SSR)     │ device_status
                                                            │   + 设备区 + 详情         │ device_events
┌──────────────┐  GET /api/device/status (可选 X-API-Key)    │ pages/_app.tsx (动森样式) │ usage_daily
│ 浏览器       │ ◄────────────────────────────────────────── └────────────┬──────────────┘
└──────────────┘  GET /api/device/usage (必须 X-API-Key)                  │ cron 读
                                                                           ▼
                                                            │ Worker scheduled（M3）     │
                                                            │ 下线/上线通知 + 事件清理     │
```

前端结构（`pages/index.tsx`，不替换现有区块；设备区整体复刻 prototype，含「主页 / 猫猫日记」视图切换）：

```
Header（现有）
OverallStatus（现有，不动）
「似了喵？」设备区（新增，workerConfig.devices 非空时渲染）
  ├─ 视图切换按钮（右上角，主页 ⇄ 猫猫日记，复刻 prototype 的 view-toggle）
  ├─ 主页变体 = 指挥台 hero（主设备）+ 全部设备卡片墙
  │               └─ 设备详情 overlay（#device:<id>，统计图表 M2 起）
  └─ 日记流变体 = 每设备一张横幅（对话气泡 + 内联展开统计，无二级页），与主页共用数据层
MonitorList（现有，不动）
Footer（现有）
```

---

## 3. 里程碑任务分解

> 约定：估时 = 单人专注实现的人工日。含编码 + 自测，不含代码评审与联调打磨。

### M1 — 存活链路 + 共存 + 解锁（P0，核心）

| # | 任务 | 说明 | 主要文件 | 依赖 | 估时 |
|---|---|---|---|---|---|
| T1 | **依赖引入** | 安装 `animal-island-ui@0.7.7`（锁定），在 `_app.tsx` `import 'animal-island-ui/style'`，对照仓库 `AI_USAGE.md` 核对 9 个目标组件的 props | `package.json`、`pages/_app.tsx` | — | 0.5d |
| T2 | **数据层** | `init.sql` 新增 `device_status` / `device_events` / `usage_daily` 三表（§5.1 完整 SQL）；新建 `worker/src/deviceStore.ts`（UPSERT/插入/聚合/清理函数） | `init.sql`、`worker/src/deviceStore.ts`(新) | — | 1d |
| T3 | **配置类型** | `types/config.ts` 新增 `DeviceConfig` + `WorkerConfig.devices`；`uptime.config.ts` 加示例设备（不填密钥） | `types/config.ts`、`uptime.config.ts` | T2 | 0.3d |
| T4 | **心跳 API** | `POST /api/heartbeat`：`AGENT_TOKEN` 常量时间校验 → UPSERT `device_status`；**M1 阶段全部按 `usageTracking:false` 处理**（不写 events/usage_daily），埋好配置读取点 | `pages/api/heartbeat.ts`(新) | T2, T3 | 0.7d |
| T5 | **设备状态 API** | `GET /api/device/status`：公开字段（在线/挂机/离线、最后活跃、今日总时长、设备名）+ `X-API-Key`/`publicWindow` 分级窗口字段；CORS 头加 `X-API-Key` | `pages/api/device/status.ts`(新) | T2, T3 | 0.7d |
| T6 | **密钥工具 + 解锁弹窗** | `util/usageKey.ts`（localStorage 键 `uf_usage_key`）；`DeviceUnlockModal`（animal-island-ui `Modal`+`Input`）；锁定按钮；401 自动清缓存 | `util/usageKey.ts`(新)、`components/DeviceUnlockModal.tsx`(新) | T1, T5 | 0.7d |
| T7 | **猫猫图标** | 三态（活跃/挂机/离线）动森风 SVG，直接用 prototype 的 `catSVG()` 移植为 React 组件（内置 10 图标无猫，需自制） | `components/DeviceCat.tsx`(新) | — | 0.5d |
| T8 | **设备区 UI · 主页变体** | 复刻 prototype 主页：`DeviceSection`（指挥台 hero + 卡片墙）+ `DeviceCard` + 详情 overlay 骨架，30s 轮询 hook（`useDeviceStatus`）；集成进 `index.tsx`（OverallStatus 与 MonitorList 之间） | `components/DeviceSection.tsx`、`DeviceHero.tsx`、`DeviceCard.tsx`、`util/useDeviceStatus.ts`(均新)、`pages/index.tsx` | T1, T5, T6, T7 | 1.2d |
| T8B | **设备区 UI · 猫猫日记流变体** | 复刻 prototype 日记流：`DeviceFeed`（横幅 + 对话气泡 + 内联展开统计 + 展开/收起）+ 右上角「主页/猫猫日记」视图切换；布局与交互严格对齐原型，不新增设计 | `components/DeviceFeed.tsx`、`components/DeviceBanner.tsx`(新)、`pages/index.tsx` | T8 | 1d |
| T8C | **动画打磨** | 仅优化动画，不动布局：打字机状态文案（状态翻转重挂载重打）、猫猫三态动画（tail 摇摆 / zz 浮动 / 离线光环与翅膀 / 在线 bounce）、轮询更新的状态过渡；实现时先跑 `animate` / `animation-vocabulary` / `find-animation-opportunities` / `improve-animations` skill，并尊重 `prefers-reduced-motion` | `components/DeviceCat.tsx`、`components/Device*` | T8, T8B | 0.5d |
| T9 | **hash 路由扩展** | `index.tsx` 先判 `#device:<id>` 走设备详情，否则走现有 monitorId 逻辑；设备详情先出骨架（无统计时显示"未开启统计"态） | `pages/index.tsx`、`components/DeviceDetail.tsx`(新) | T8 | 0.5d |
| T10 | **样式冲突实测** | 动森全局样式 vs Mantine 共存检查（底色/圆角/字体）；冲突则收窄样式引入范围或对齐主题变量 | `pages/_app.tsx`、`styles/*` | T1, T8 | 0.5d |
| T11 | **Windows Agent** | PowerShell 5.1+ 单文件零依赖：P/Invoke `GetForegroundWindow`/`GetWindowTextW`/`GetWindowThreadProcessId`、`GetLastInputInfo`、常驻循环、`schtasks` 登录自启 | `agent/agent.ps1`、`agent/agent.json.example`(新) | T4 | 1d |
| T12 | **Linux Agent** | Python 3.8+：kdotool（`getactivewindow`/`getwindowname`/`getwindowclassname`）、`qdbus org.freedesktop.ScreenSaver /ScreenSaver GetSessionIdleTime`、kdotool 可用性探测、systemd user unit | `agent/agent.py`、`agent/systemd/uptimeflare-agent.service`、`agent/README.md`(新) | T4 | 1d |
| T13 | **M1 联调 + 验收** | 真机（KDE Wayland 笔记本 + Windows 台式机）跑通 §8.1 验收清单 | — | T4–T12 | 0.5d |

### M2 — 使用统计（配置项开启，密钥保护，P1）

| # | 任务 | 说明 | 主要文件 | 依赖 | 估时 |
|---|---|---|---|---|---|
| T14 | **统计写入** | 心跳 handler 内：设备 `usageTracking:true` 且 `idle < idle_threshold` → 写 `device_events` + 原子累加 `usage_daily`（`ON CONFLICT ... DO UPDATE SET duration=duration+excluded.duration`） | `pages/api/heartbeat.ts`、`worker/src/deviceStore.ts` | T4, T2 | 0.7d |
| T15 | **统计 API** | `GET /api/device/usage?days=&date=`：必须 `X-API-Key`，聚合 SQL 返回 `daily` + `hourly_today` | `pages/api/device/usage.ts`(新) | T5, T14 | 0.7d |
| T16 | **设备详情视图** | `DeviceDetail` 完善：今日应用排行（chart.js 水平条形图）、24h 时间线柱状图、7/30 天趋势、口径说明 Collapse；未解锁 → 锁定态（不发出数据请求） | `components/DeviceDetail.tsx`、`components/DeviceUsageChart.tsx`(新) | T9, T15 | 1.5d |
| T17 | **Linux X11 fallback** | agent.py 探测无 Wayland 时回退 xdotool + xprintidle | `agent/agent.py` | T12 | 0.5d |
| T18 | **M2 验收** | §8.2 验收清单 | — | T14–T17 | 0.3d |

### M3 — 通知与收尾（P2）

| # | 任务 | 说明 | 主要文件 | 依赖 | 估时 |
|---|---|---|---|---|---|
| T19 | **下线/上线通知** | worker cron 末尾读 `device_status` + `workerConfig.devices`，翻转时复用 `webhookNotify` 发 Resend 邮件；新增 `device_notify_state` 小表记上次状态防重复通知；消息文案按 PRD §F6 | `worker/src/index.ts`、`worker/src/deviceStore.ts`、`init.sql` | T2, T3 | 1d |
| T20 | **事件过期清理** | cron 顺带 `DELETE FROM device_events WHERE ts < now - 14d` | `worker/src/deviceStore.ts` | T19 | 0.2d |
| T21 | **收尾（可选）** | `title_filter` 隐私过滤、headless Agent（仅心跳）、i18n en 补齐、Plasma 5 (kdotool v0.2.x) 支持评估 | 多处 | — | 1–2d |

**合计约 14.5–15.5 个工作日**（不含 T21 可选部分），其中 M1 ≈ 9.5d，M2 ≈ 3.5d，M3 ≈ 1.5d。

---

## 4. 任务依赖与执行顺序

```
                 ┌─ T1 (依赖引入) ─┬───────────────┐
                 │                │               ▼
 T2 (数据层) ─┬─▶│             T7 (猫猫) ───▶ T8 (主页变体) ─▶ T8B (日记流变体) ─┐
 T3 (配置)  ──┘  │                ▲                    │                      │
                 │                └── T6 (解锁弹窗) ────┘                      ▼
                 ▼                │                                    T8C (动画) ─▶ T9 (hash路由) ─▶ T13 (M1验收)
 T4 (心跳API) ──▶ T5 (状态API) ────┘     T10 (样式冲突, 与T8/T8B并行)
                 │
 T11 (Win Agent) ┘
 T12 (Linux Agent) ┘
────────────────────────── M2 ─────────────────────────────
 T14 (统计写入) → T15 (统计API) → T16 (设备详情)
 T12 → T17 (X11 fallback)
────────────────────────── M3 ─────────────────────────────
 T19 (通知) → T20 (清理) → T21 (收尾可选)
```

- **关键路径**：T2/T3 → T4 → T5 → T6 → T8 → T8B → T8C → T9 → T13。前端和 Agent 两轨在 T5 之后可并行。
- **T11/T12（两个 Agent）可完全并行**，且只依赖 T4 的接口契约（文档先行：`docs/PRD.md` §7 已有请求/响应格式，实现时按契约写，不阻塞等联调）。
- **T10（样式冲突实测）越早越好**：若冲突严重，会反作用于 T8/T8B 的组件封装方式（决定用 animal-island-ui 组件还是自制容器），所以把它与 T8 并行，而不是最后收尾。
- **T8B/T8C 紧跟在 T8 之后**：日记流变体复用主页同一套数据层与解锁状态，只换渲染形态；动画最后统一打磨（T8C），避免两处重复调。

---

## 5. 关键实现要点

### 5.1 数据层（T2）

`init.sql` 追加（`CREATE TABLE IF NOT EXISTS`，幂等，随 CI 自动执行）：

```sql
-- 每设备一行，心跳 UPSERT，读多写少
CREATE TABLE IF NOT EXISTS device_status (
  device_id   TEXT PRIMARY KEY,
  device_name TEXT NOT NULL,
  os          TEXT,
  last_seen   INTEGER NOT NULL,   -- 服务端 Unix 秒
  last_title  TEXT,
  last_app    TEXT,
  last_idle   INTEGER DEFAULT 0
);

-- 原始采样，仅保留 14 天；仅 usageTracking=true 时写入
CREATE TABLE IF NOT EXISTS device_events (
  device_id TEXT NOT NULL,
  ts        INTEGER NOT NULL,     -- 服务端 Unix 秒
  app       TEXT,
  title     TEXT,
  idle      INTEGER DEFAULT 0,
  PRIMARY KEY (device_id, ts)
);

-- 每日使用聚合（长期统计，永不清理）；仅 usageTracking=true 时写入
CREATE TABLE IF NOT EXISTS usage_daily (
  device_id TEXT NOT NULL,
  date      TEXT NOT NULL,        -- 'YYYY-MM-DD'，Asia/Shanghai 切日（可配）
  app       TEXT NOT NULL,
  duration  INTEGER NOT NULL,     -- 累计秒数
  PRIMARY KEY (device_id, date, app)
);

-- M3 通知去重用：每设备一行，记最近一次通知时状态（-1 离线 / 1 在线）
CREATE TABLE IF NOT EXISTS device_notify_state (
  device_id   TEXT PRIMARY KEY,
  last_online INTEGER NOT NULL
);
```

`worker/src/deviceStore.ts` 函数清单（worker 与 pages 共用，`env` 复用 `Env` 类型）：

| 函数 | SQL 要点 |
|---|---|
| `upsertDeviceStatus(env, d)` | `INSERT ... ON CONFLICT(device_id) DO UPDATE SET ...` |
| `appendDeviceEvent(env, d)` | `INSERT OR IGNORE`（防同秒重试冲突） |
| `incrementUsageDaily(env, deviceId, date, app, seconds)` | `ON CONFLICT(device_id,date,app) DO UPDATE SET duration = duration + excluded.duration`（原子累加） |
| `listDeviceStatus(env)` | `SELECT * FROM device_status`（M3 通知 + 前端 SSR 用） |
| `sumToday(env, deviceId, date)` | `SELECT SUM(duration) FROM usage_daily WHERE device_id=? AND date=?` |
| `getUsageDaily(env, deviceId, fromDate)` | `SELECT date, app, duration ... WHERE device_id=? AND date>=?` |
| `getHourlyToday(env, deviceId, dayStartTs)` | `SELECT ts, duration` 由 events 按小时桶聚合（或 SQL `strftime('%H', ts, 'unixepoch')`） |
| `getNotifyState / setNotifyState(env, deviceId, online)` | 见 `device_notify_state` |
| `cleanupDeviceEvents(env, beforeTs)` | `DELETE FROM device_events WHERE ts < ?` |

切日时间戳：edge/worker 运行时用 `new Intl.DateTimeFormat('en-CA', { timeZone, ... })` 计算 `YYYY-MM-DD` 与当日 0 点时间戳，**不要用服务器时区猜**。时区取 `workerConfig.notification?.timeZone ?? 'Asia/Shanghai'` 或设备级配置。

### 5.2 鉴权与数据分级（T4/T5/T15）

- **常量时间比较**：复用 `middleware.ts:12-20` 的写法，封装 `util/timingSafeEqual(a: string, b: string): boolean`，供 heartbeat 与 device API 共用。两个 secret 都从 `process.env` 读取（本地开发用 `wrangler pages dev` 的 `.dev.vars`）。
- **`AGENT_TOKEN`（heartbeat）**：Header `Authorization: Bearer <AGENT_TOKEN>`。失败一律 `401`；缺 `device_id`/`title`/`app` → `400`。字段截断（title 200 / app 64）。请求体先读 `content-length` 或按 4KB 上限截断。不回 CORS 头（非浏览器调用方）。
- **`USAGE_API_KEY`（读取）**：Header `X-API-Key`。分级规则严格按 PRD §F7 表：
  - `/api/device/status`：无 key 或 key 无效 → `last_title`/`last_app` 为 `null`（除非 `publicWindow:true`）；**key 无效与无 key 表现一致，不额外报错**（防枚举，前端只需区分"有没有详细字段"）。
  - `/api/device/usage`：无 key 或无效 → 一律 `401`。
  - CORS `Access-Control-Allow-Headers` 追加 `X-API-Key`（`pages/api/data.ts` 已有头模板可参考）。
- **在线判定（无状态）**：读取方按 `now - last_seen` 实时算：`> offlineAfterSeconds`（默认 90）→ 离线；在线且 `last_idle >= idleThreshold`（默认 120）→ 挂机；否则活跃。写库时不更新状态字段。

### 5.3 前端（T6–T9、T16）

- **数据流**：
  - `getServerSideProps`（`pages/index.tsx`）读 `workerConfig.devices` + `listDeviceStatus` + `sumToday`，把**公开**字段作为 `devices` props 传入（在线/挂机/离线、last_seen、today_total、usage_tracking、publicWindow）。
  - 客户端 `useDeviceStatus` hook 每 30s `fetch('/api/device/status')`，带本地 `uf_usage_key`（若有）→ 合并详细字段；每 30s 刷新 `last_seen` 相对时间与状态色。
  - 详情统计由 `DeviceDetail` 在已解锁时 `fetch('/api/device/usage?days=7')`；未解锁不发起请求（PRD M2 验收点）。
- **双变体 + 动画（T8/T8B/T8C）**：主页变体与日记流变体共用同一数据层（`useDeviceStatus` 轮询、解锁状态、usage 数据），仅渲染形态不同；视图切换用 prototype 的 `view-toggle`（URL `?page=` 可选，但本项目以 hash 路由为主，可用组件内 state，参照 prototype 的 `setPage`）。日记流横幅 = 卡片的信息压缩形态（状态文案 + 对话气泡 + 内联 Top3/24h + 7 天 sparkline + 展开面板）。动画（T8C）实现时先调用 `animate` / `animation-vocabulary` / `find-animation-opportunities` / `improve-animations` skill 校准动画设计；范围仅限打字机状态文案、猫猫三态（tail 摇摆 / zz 浮动 / 离线光环与翅膀 / 在线 bounce）、轮询刷新时的状态过渡；所有动画尊重 `prefers-reduced-motion`（prototype 已有对应 CSS）。
- **组件映射**（animal-island-ui 9 个组件）：`Card`（卡片容器，`color` 按状态切换）、`Typewriter`（状态文案，翻转时重挂载触发重打）、`Modal`+`Input`（解锁弹窗）、`Tabs`/`Collapse`/`Card`（详情统计区）、`Footer`/`Divider`/`Time`/`Cursor`（设备区装饰）。无猫 → `DeviceCat` 自制 SVG（移植 prototype `catSVG()`，含 tail 摇摆/zz 动画/离线光环与翅膀）。
- **hash 路由**（`pages/index.tsx`）：先 `const m = location.hash.match(/^#device:(.+)$/)`，命中则渲染 `DeviceDetail`；否则走现有 monitorId 逻辑。注意该文件当前是函数组件顶层 `if` 分支返回，需保持两个独立分支。
- **localStorage**：`uf_usage_key`；请求统一从 `util/usageKey.ts` 取 key 附加 `X-API-Key`；收到 401 → 清缓存回锁定态；提供「锁定」按钮清除。
- **i18n**：新增文案进 `locales/zh-CN/common.json`（及 `zh-TW`/`en` 占位，en 可 M3 补齐）。
- **SSR 安全**：`getServerSideProps` 与页面 JS 一律不接触 key；详细字段只在客户端请求中带 `X-API-Key`。

### 5.4 Agent（T11/T12）

**通用行为**：读同目录 `agent.json`（`endpoint`/`token`/`device_id`/`interval` 默认 30/`idle_threshold` 默认 120）；常驻循环；POST 失败静默跳过下周期重试；**不信任本地时钟**（服务端打时间戳，`client_time` 仅参考）；无本地持久化。上报体：

```json
{ "device_id": "...", "device_name": "...", "os": "windows", "os_ver": "11",
  "title": "PRD.md - Visual Studio Code", "app": "Code.exe", "idle": 0, "client_time": 1787990000 }
```

**Windows（`agent.ps1`，零依赖）**：
- P/Invoke：`GetForegroundWindow` → `GetWindowTextW`（标题）→ `GetWindowThreadProcessId` → `Process.GetProcessById().ProcessName`（app=exe 名）。
- 空闲：`GetLastInputInfo`，`(Environment.TickCount - lastInputTicks) / 1000`。
- 开机自启：`schtasks /create /sc onlogon`。
- 无窗口/锁屏时 title/app 为空串、idle 为大值（服务端按 idle_threshold 判挂机）。

**Linux KDE Wayland（`agent.py`，stdlib + requests + kdotool）**：
- 每周期 3 次子进程调用：`kdotool getactivewindow` → `kdotool getwindowname <id>` → `kdotool getwindowclassname <id>`；空闲用 `qdbus org.freedesktop.ScreenSaver /ScreenSaver GetSessionIdleTime`（秒）。
- **kdotool 探测**：启动时 `shutil.which('kdotool')` + `kdotool --version`；v0.3.0+ 仅 Plasma 6，探测失败给出明确报错与安装指引（PRD §5 F5 风险 2）。
- **idle 防御**：只在 `0 <= idle < 86400` 时采信，连续异常值记日志但不断上报（PRD 风险 3）。
- 无图形会话（headless）→ 仅上报心跳，title/app 为空。
- systemd user unit：`[Install] WantedBy=graphical-session.target` + `Restart=always`，只在图形会话内跑。

### 5.5 通知（T19）

- cron 末尾：`listDeviceStatus()` 遍历 `workerConfig.devices`，按 `offlineAfterSeconds` 判在线/离线；与 `device_notify_state` 记录比较，翻转才通知。
- 直接调 `webhookNotify(env, workerConfig.notification.webhook, msg)`（已导出，跳过 `formatAndNotify` 的 monitor 相关逻辑）。
- 文案（时区 `Asia/Shanghai`）：
  - 下线：`「{device_name}」似了喵…（最后活跃 {HH:mm}）`
  - 上线：`「{device_name}」活着喵！（离线时长 {duration}）`
- **注意**：当前 `workerConfig.notification.webhook` 的 subject 是 "UptimeFlare 状态更新"，设备通知同通道即可，无需改配置。

---

## 6. 测试策略

| 层 | 方法 |
|---|---|
| D1/API | 本地 `wrangler d1 execute --local` 验证 SQL；`wrangler pages dev`（配 `.dev.vars` 放 `AGENT_TOKEN`/`USAGE_API_KEY`）+ `curl` 打 3 个接口，覆盖 200/204/400/401 与 CORS 头 |
| Worker cron | `npm run dev`（worker 目录，`wrangler dev --test-scheduled`）手动触发 scheduled，验证 M3 通知翻转 |
| 前端 | `npm run dev`（`next.config.js` 已有 dev bindings，需补 D1 本地绑定）；原型已固化的状态翻转、解锁/锁定、锁定态不发请求等交互照 prototype 对照验收 |
| Agent | 真机：KDE Wayland 笔记本 + Windows 台式机；断开/恢复网络验证卡片 90s 内翻转；切换窗口验证 30s 内当前窗口跟随（已解锁时） |
| 回归 | 现有主页/博客监控、`/incidents`、`/api/data`、`/api/badge` 全量手测，确保零侵入 |

**M1 验收**（对照 PRD §9）：
- KDE Wayland 笔记本 + Windows 台式机同时上报，同屏见设备卡片 + 原有监控列表
- 开机 → 90s 内「活着喵！」；断网/关机 → 90s–2min 内「似了喵…」+ 最后活跃时间
- Plasma 6 切窗口 → 已解锁时当前窗口 30s 内跟随
- 匿名看不到窗口标题；输入密钥立即解锁；刷新/下次访问免输；「锁定」后回访客视角
- 动森风与 Mantine 同屏无样式互相破坏

**M2 验收**：连续使用一天后各应用时长与感知一致（误差 < interval）；挂机不计入；`usageTracking:false` 设备无 `usage_daily`/`device_events`；未解锁详情页不发统计请求。

---

## 7. 部署与发布清单

1. **`init.sql` 追加 3(+1) 张表** —— 随 CI `deploy/init_d1.py` 自动执行（幂等），无需手动。
2. **`deploy.tf` 追加 Pages secrets**（provider v5 `env_vars` 语法）：
   ```hcl
   production = {
     # ...现有 d1_databases / compatibility_date 等保持...
     env_vars = {
       AGENT_TOKEN   = { type = "secret_text", value = var.AGENT_TOKEN }
       USAGE_API_KEY = { type = "secret_text", value = var.USAGE_API_KEY }
     }
   }
   ```
   - CI `.github/workflows/deploy.yml` 的 terraform 步骤增加 `TF_VAR_AGENT_TOKEN` / `TF_VAR_USAGE_API_KEY`，从 GitHub Actions secrets 注入；`deploy.tf` 顶部补 `variable` 声明。
   - ⚠️ secret 会进 terraform state（当前无远端 state，状态在本地/CI 一次性），个人项目可接受；若介意，回退方案为一次性的 `wrangler pages secret put` 手动步骤（PRD 风险 #6 的备选）。
3. **Agent 配置**：`agent.json` 里的 `token` 即 `AGENT_TOKEN`（与 `USAGE_API_KEY` 相互独立，勿混用）。
4. **上线前核对**：`uptime.config.ts` 不含任何密钥；`device_id` 与配置一致；`deploy.tf` 无明文 secret。

---

## 8. 工作量估算

| 阶段 | 估时 | 说明 |
|---|---|---|
| M1 | ≈ 9.5 人日 | T1–T13（含日记流变体 T8B 与动画打磨 T8C） |
| M2 | ≈ 3.5 人日 | T14–T18 |
| M3 | ≈ 1.5 人日 | T19–T20（T21 可选另计 1–2 人日） |
| 合计 | ≈ 14.5 人日 | 不含评审/打磨 |

若单人串行推进，节奏建议：**先做 T2/T3/T4/T5（后端链路）→ T6/T8/T8B/T8C/T9（前端 M1）→ 两个 Agent 并行 → M1 联调 → 再进入 M2**。

---

## 9. 待确认决策

| # | 决策 | 现状/建议 | 影响 |
|---|---|---|---|
| D1 | 前端布局选「主页」还是「猫猫日记流」变体 | ✅ **已决策：两个变体都做**，严格对齐 prototype，右上角视图切换（见 §3 T8/T8B）；动画单独打磨（T8C） | 影响 T8/T8B/T8C/T9/T16 |
| D2 | animal-island-ui 全局样式冲突的处理 | 先按 T1 实测（P0）；冲突则把样式引入收窄到设备区容器，或调 Mantine 主题变量对齐动森色板 | 影响 T10，反作用 T8 |
| D3 | `idle_threshold` 是否做成设备级配置 | 建议在 `DeviceConfig` 加可选 `idleThreshold`（默认 120），与 `offlineAfterSeconds` 对称 | 影响 T3/T4 |
| D4 | M3 的 `title_filter` / headless Agent / en i18n | 本期均标可选；headless 设备常规走 HTTP 监控即可 | 影响 T21 范围 |

---

## 10. 风险清单（实现层）

| # | 风险 | 应对 |
|---|---|---|
| R1 | animal-island-ui 全局样式（底色/圆角/字体）破坏 Mantine 观感 | T1/T10 尽早实测；收窄样式范围 / 对齐主题变量（PRD 风险 #10） |
| R2 | `workerConfig` 被编译进前端 bundle，误放密钥 | 上线核对步骤强制检查；密钥只走 `process.env`（PRD 风险 #9） |
| R3 | kdotool 版本坑（v0.3.0+ 无 Plasma 5）与 `GetSessionIdleTime` 恒 0 | 启动探测 + 防御性采信 + 明确报错（PRD 风险 #2/#3） |
| R4 | 浏览器标签页标题高基数 | 聚合只到 app；title 只进 14 天 events 表（PRD 风险 #4） |
| R5 | 笔记本合盖睡眠被算"似了" | MVP 接受；M3 可选"计划离线"时段配置（PRD 风险 #5） |
| R6 | 同秒心跳重试导致 `(device_id,ts)` 主键冲突 | `device_events` 用 `INSERT OR IGNORE` |
| R7 | secret 进 terraform state | 个人项目可接受；介意则回退 `wrangler pages secret put` |
| R8 | edge 运行时 `Intl` 时区切日 | 用 `Intl.DateTimeFormat('en-CA',{timeZone})` 得 `YYYY-MM-DD`，CI 加一条单测/手测确认 |

---

## 11. 参考文档

- `docs/PRD.md` —— 需求唯一权威来源（本计划只增补实现细节，不改变需求）
- `docs/prototype.html` —— UI 参考（主页变体）
- `worker/src/store.ts` / `pages/api/data.ts` —— D1 访问与 CORS 头模板
- `middleware.ts` —— 常量时间比较模板
- animal-island-ui `AI_USAGE.md` —— 编码前必读（组件 API 与硬性规则）
