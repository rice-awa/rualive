# PRD：「似了喵？」设备存活监控 + 屏幕使用时长统计

> 版本: v0.1 草案 · 日期: 2026-08-29 · 基于仓库: UptimeFlare（lyc8503/UptimeFlare 二次开发版）

---

## 1. 背景与目标

「似了喵？」是一个个人化的设备存活监控页面：实时展示我的电脑（Linux / Windows）是否在线——在线显示「活着喵！」，离线显示「似了喵…」。同时记录设备的**屏幕使用时长**，按应用 / 窗口标题统计每天用了什么、用了多久。

与现有 UptimeFlare 的区别：

| | 现有 UptimeFlare | 本项目 |
|---|---|---|
| 探测方向 | 云端 Worker 主动探测目标（HTTP/TCP） | 设备上的 Agent 主动上报心跳（推模式） |
| 监控对象 | 网站 / 服务 | 我自己的设备 |
| 附加数据 | 延迟、错误信息 | 活动窗口标题、应用名、使用时长 |
| 页面定位 | 通用状态页 | 设备存活检测区（猫猫主题），与状态页共存 |

**核心目标：**
1. 设备离线能一眼看出来（页面上 + 可选通知）
2. 知道设备当前正在用哪个窗口 / 应用
3. 沉淀每日屏幕使用时长统计（按应用、按时段，**通过配置项按设备开启**）
4. **与原有多节点监控共存**：同一个页面上既能看个人设备（推送心跳），也能看原有的服务器 / 网站监控（Worker 主动探测）
5. **详细数据密钥保护**：使用统计、当前窗口等细节默认仅 API Key 可见；前端输入一次后缓存在浏览器，访客只能看到在线 / 离线等基础状态

**非目标（本期不做）：**
- 不做多用户 / 多租户，单实例单用户
- 不做屏幕截图、按键记录等侵入式采集（只取窗口标题和进程名）
- 不做手机端 Agent
- 不改动现有 HTTP 监控的数据链路（主页 / 博客的探测继续在 Worker 里跑），页面层只新增区块

---

## 2. 现有代码分析（结论）

当前架构（已阅读代码确认）：

```
┌─ Cloudflare Worker (worker/src/index.ts)
│    cron 每分钟 → 检查 uptime.config.ts 里的 monitors
│    → 状态以压缩 JSON 存入 D1 表 uptimeflare(key,value)（worker/src/store.ts）
│    → 变更时走 webhook 通知（worker/src/util.ts formatAndNotify）
│    ⚠️ Worker 没有任何 HTTP fetch 入口，只被 cron 触发
│
├─ Cloudflare Pages (Next.js, edge runtime)
│    pages/index.tsx        SSR 直读 D1 渲染状态页
│    pages/api/data.ts      只读 JSON API（带 CORS）
│    pages/incidents.tsx    事件历史页
│    middleware.ts          可选 Basic Auth
│    ✅ Pages 已绑定同一个 D1（deploy.tf deployment_configs）
│
└─ D1 (uptimeflare_d1)  单表 KV：key='state' 存全部监控状态
```

对本项目的影响（关键设计约束）：

1. **心跳上报入口放在 Pages 的 API 路由**（`pages/api/heartbeat.ts`），而不是给 Worker 加 fetch handler。理由：Worker 目前没有路由 / 域名绑定，加 HTTP 入口要动 Terraform 的路由配置；Pages 已经有域名、TLS、D1 绑定，且现有 `pages/api/data.ts` 已示范了如何在 edge runtime 里访问 D1（`getFromStore(process.env as any, ...)`）。
2. **现有单表 KV 不适合存心跳时序数据**。心跳 / 使用时长需要新表（见 §6），不改现有 `uptimeflare` 表，与旧监控互不干扰。
3. **通知可以直接复用**：`uptime.config.ts` 里已配置 Resend 邮件 webhook，下线通知走同一套配置（新增配置项，见 §7）。
4. **前端 UI 组件可复用**：chart.js（`components/DetailChart.tsx` 在用）、i18n（`locales/zh-CN`）、暗色模式适配全部沿用；设备区块的视觉层引入 [animal-island-ui](https://github.com/guokaigdg/animal-island-ui)（动森风 React 组件库，见 F8），现有 Mantine 区块保持不动。

---

## 3. 用户故事

- **US-1**：我打开「似了喵？」页面，3 秒内看到设备当前是在线还是离线，离线时能看到"最后活跃于 X 分钟前"。
- **US-2**：设备在线时，页面显示当前活动窗口（应用名 + 窗口标题），我知道这台机器在干什么。
- **US-3**：我挂机 / 锁屏离开后，页面自动变为离线（或"挂机中"），不需要我手动操作。
- **US-4**：对开启了使用统计的设备，我能在页面上看到今天各应用的使用时长排行，以及最近 7 天的每日总时长趋势。
- **US-5**：设备意外断电 / 断网超过阈值时，我收到一封邮件通知（复用现有 Resend 通道）。
- **US-6**：设备恢复在线时，收到恢复通知。
- **US-7**：原有服务器 / 网站监控和设备监控在同一页面共存，我不需要切换两个站点分别查看。
- **US-8**：陌生人打开页面只能看到我"活着 / 似了"和最后活跃时间，看不到我在用什么应用、用了多久；我在浏览器里输入一次访问密钥后，详细数据自动解锁，下次访问不用再输。

---

## 4. 系统架构（目标状态）

```
┌──────────────┐   HTTPS POST /api/heartbeat (每 30s, Bearer Token)
│ Agent 脚本    │ ──────────────────────────────────────────┐
│ (Linux/Win)  │                                            ▼
└──────────────┘                              ┌──────────────────────────┐
                                              │ Cloudflare Pages         │
┌──────────────┐   GET /api/device/*          │ pages/api/heartbeat.ts   │写
│ 浏览器        │ ◄──────────────────────────  │ pages/api/device/*.ts    │
│ 状态页        │    JSON (带 CORS)            │ pages/index.tsx          │
└──────────────┘                              │ (设备区 + 原监控列表共存)  │
                                              └────────────┬─────────────┘
                                                           │ D1 binding
                                                           ▼
                                              ┌──────────────────────────┐
                                              │ D1: 新增 3 张表           │
                                              │ device_status / events / │
                                              │ usage_daily              │
                                              └────────────┬─────────────┘
                                                           │ 读
┌──────────────┐   cron 每分钟（已有）                       ▼
│ Worker 补充   │ ─────────────────────────► 检查心跳超时 → 复用 webhook 发通知
└──────────────┘
```

- **Worker**：现有监控逻辑不动；新增一小段 cron 逻辑负责"下线/上线通知"（P2，可后做）。
- **前端**：**现有状态页保持主体**（OverallStatus + MonitorList 展示服务器/网站监控），顶部新增「似了喵？」设备卡片区；点击设备卡片进入设备详情（含使用统计图表），复用现有 URL hash 机制（`pages/index.tsx` 已支持 `#<monitorId>` 直达详情，设备用 `#device:<id>` 同样处理）。
- **Agent**：只负责采集 + 上报，无本地状态（除失败重试），无本地存储。
- **Pages API**：负责鉴权、写库、按服务端时间打时间戳、在线判定、聚合计算。

---

## 5. 功能需求

### F1 心跳上报（P0）

Agent 每 `interval` 秒（默认 30s，可配 15–120s）向 `POST /api/heartbeat` 上报：

```json
{
  "device_id": "riceawa-desktop",
  "device_name": "DESKTOP-AB12CD",
  "os": "windows",
  "os_ver": "11",
  "title": "PRD.md - Visual Studio Code",
  "app": "Code.exe",
  "idle": 0,
  "client_time": 1787990000
}
```

字段要求：
- `device_id`：设备唯一标识，由 Agent 配置指定（必填）
- `title`：当前前台窗口标题（必填，服务端截断至 200 字符）
- `app`：前台窗口所属进程名（必填，截断至 64 字符）
- `idle`：输入空闲秒数（鼠标键盘无操作时长），用于区分"在使用"和"挂着"
- `client_time`：仅记录参考，**服务端一律使用自己的时间戳**，不信任客户端时钟

服务端行为：
- 校验 `Authorization: Bearer <AGENT_TOKEN>`（见 §8 安全）
- UPSERT `device_status` 该设备一行；该设备 `usageTracking: true` 时追加一条 `device_events` 采样
- 原子累加 `usage_daily`（仅 `usageTracking: true`）：当 `idle < idle_threshold`（默认 120s）时，本次 interval 计入该 (date, app) 的时长
- 成功返回 `204`；无效请求返回 `401/400`，Agent 静默重试

### F2 在线判定（P0）

- **在线**：`now - last_seen ≤ online_timeout`，其中 `online_timeout = 3 × interval`（interval=30s 时即 90s）
- **挂机（idle）**：在线但 `idle ≥ idle_threshold`，页面上与"活跃使用"区分展示（如灰猫 vs 彩猫）
- **离线**：超过 `online_timeout` 未收到心跳
- 判定是**无状态的**：由读取方（前端 API / Worker cron）按时间差实时计算，不依赖写库时更新状态字段

### F3 「似了喵？」设备区——与原有多节点监控共存（P0）

**不替换现有首页**，首页结构变为：

```
Header（现有）
OverallStatus（现有，不动）
「似了喵？」设备卡片区（新增，仅当 workerConfig.devices 非空时渲染）
MonitorList（现有服务器 / 网站监控列表，不动）
Footer（现有）
```

设备卡片（新组件 `components/DeviceCard.tsx`）：

1. **猫图标 + 状态色**（始终公开）
   - 在线且活跃：「活着喵！」绿色猫
   - 在线但挂机：「在挂机喵…」灰色猫
   - 离线：「似了喵…」暗色 / 灰暗配色
2. **辅助信息**：最后心跳相对时间（"X 分钟前"）与今日活跃总时长（仅开启统计的设备显示）**始终公开**；**当前活动窗口（`app` + `title`）默认需密钥解锁**（F7），未解锁时该行显示 🔒 占位（"输入密钥查看"），设备配置 `publicWindow: true` 时才公开显示
3. **解锁入口**：卡片 🔒 占位 / 详情页上的锁形按钮打开解锁弹窗（animal-island-ui `Modal`（自带打字机对话）+ `Input type="password"`，见 F8），输入 `USAGE_API_KEY` 成功后立即刷新为完整数据
4. **交互**：点击卡片进入设备详情视图（URL hash `#device:<id>`，与现有 `#<monitorId>` 机制一致），详情内为 F4 统计图表（需密钥）+ 数据口径说明
5. **自动刷新**：客户端每 30s 轮询 `GET /api/device/status`（SSR 提供首屏公开数据，避免白屏；密钥解锁后的详细字段由客户端轮询补齐）
6. 复用现有 Header / Footer / i18n；设备区块整体采用动森风格（F8），与下方 Mantine 风格的监控列表以 `Divider`（animal-island-ui）做视觉分界

> **布局补充（2026-08-29 决策）**：前端实现严格对齐 `docs/prototype.html`，**「主页」与「猫猫日记流」两个变体均实现**（右上角视图切换）。主页 = 本 F3 结构；日记流 = 横幅流（对话气泡 + 内联展开统计，无二级页），与主页共用数据层与解锁状态。布局不大改、仅打磨动画（见 `docs/DEV_PLAN.md` T8C）。

### F4 屏幕使用时长统计——配置项开启（P1）

**开关设计**：`workerConfig.devices[]` 中每个设备增加 `usageTracking?: boolean`（默认 `false`）：

- **关闭**（服务器等 headless 设备的默认形态）：服务端只 UPSERT `device_status`（在线判定 + 当前窗口），**不写** `device_events` 和 `usage_daily`，不产生统计存储
- **开启**（个人电脑）：写入原始采样并累加日聚合，前端展示统计图表
- Agent 端行为不变（总是上报 title/idle），是否落盘统计完全由服务端配置决定，改配置无需重装 Agent

统计内容（对 `usageTracking: true` 的设备，**全部在 F7 密钥保护之后**，无密钥的访客不可见）：

- **今日应用排行**：按 `usage_daily` 当日聚合，水平条形图 Top 10（应用名 + 时长）
- **24 小时时间线**：按小时桶汇总当日活跃分钟数的柱状图
- **近 7 / 30 天趋势**：每日总活跃时长折线 / 柱状图
- 口径定义：一条心跳样本计入时长的条件 = 收到心跳时 `idle < idle_threshold`；时长按上报间隔计入（30s/次，丢包不计入，天然容忍误差）
- 窗口标题粒度：只按 **app** 聚合出图；`title` 存原始值进 `device_events` 供后续细分（浏览器标签页这类高基数标题不做长期聚合）
- 图表实现：chart.js（现有依赖）+ 动森色板主题（配色取 animal-island-ui 的 Card 色板 token，见 F8）；图表容器、Tab 切换（今日 / 7 天 / 30 天）、口径说明折叠面板分别用 animal-island-ui 的 `Card` / `Tabs` / `Collapse`

### F5 Agent 脚本（P0，第一阶段范围：Windows + KDE Wayland）

跨平台 Agent，行为一致，**第一阶段只实现两个目标平台：Windows 与 Linux KDE (Wayland)**，其他桌面环境见里程碑。

| | Windows | Linux（KDE / Wayland） |
|---|---|---|
| 实现 | PowerShell 5.1+ 单文件 `agent.ps1`（零依赖） | Python 3.8+ `agent.py`（标准库 + `requests`，外部命令仅 kdotool） |
| 前台窗口 | P/Invoke `GetForegroundWindow` + `GetWindowTextW`（标题）+ `GetWindowThreadProcessId`（进程） | `kdotool getactivewindow` 取窗口 id → `getwindowname`（标题）→ `getwindowclassname`（应用标识） |
| 空闲检测 | `GetLastInputInfo` | D-Bus: `qdbus org.freedesktop.ScreenSaver /ScreenSaver GetSessionIdleTime`（单位：秒，KWin 支持） |
| `app` 字段来源 | 进程 exe 名 | KWin 的 `resourceClass`（如 `code`、`org.kde.dolphin`），比进程名更稳定 |
| 调度 | 常驻循环 + `Start-Sleep`；开机自启用 `schtasks` 登录触发 | systemd user service（`Restart=always`），仅图形会话内运行 |
| 重试 | 请求失败不退出，下个周期照常上报 | 同左 |
| 配置 | 同目录 `agent.json`：endpoint、token、device_id、interval、idle_threshold | 同左 |

**KDE Wayland 技术调研结论（已确认，作为实现依据）：**

1. Wayland 出于安全设计没有全局"取前台窗口"的协议接口，KDE 下唯一可靠路径是 **KWin scripting API**：KWin 脚本（JavaScript）读 `workspace.activeWindow`（Plasma 6）/ `workspace.activeClient`（Plasma 5），通过 `callDBus` 把结果回调出来。脚本经由 D-Bus `org.kde.KWin /Scripting` 的 `loadScript` → `run` → `unload` 加载执行。
2. [kdotool](https://github.com/jinliu/kdotool) 已经封装了上面整套机制（每次调用动态生成 KWin 脚本 → D-Bus 加载 → 回调取值 → 卸载），提供 `getactivewindow` / `getwindowname` / `getwindowclassname` / `getwindowpid` 等命令，Wayland 与 X11 会话均可用。**决定：直接依赖 kdotool**，不自研 KWin 脚本编排（自研需要自己起临时 D-Bus 服务接收回调，复杂度不成比例）。
3. **版本坑**：kdotool 自 v0.3.0 起移除了 Plasma 5 支持（只支持 Plasma 6）；Plasma 5 用户需用 v0.2.x。Plasma 5/6 的 KWin API 本身有破坏性改名（`activeClient`→`activeWindow`、`clientList`→`windowList`），`caption`（标题）与 `resourceClass`（应用标识）两代通用。Agent 首次启动时探测 kdotool 是否可用并明确报错提示。
4. **空闲检测**：`org.freedesktop.ScreenSaver /ScreenSaver GetSessionIdleTime` 返回会话空闲**秒数**，KWin（Wayland）支持；GNOME/Mutter 未完整实现该接口（它用 `org.gnome.Mutter.IdleMonitor`，非本项目范围）。已知的坑：个别场景有人报告恒返回 0（KDE 论坛有案例），Agent 侧做防御：返回值只在 `0 ≤ idle < 86400` 时采信，连续异常值时告警日志但不中断上报。
5. 每次采样 3 次 kdotool 子进程调用（30s 一次），开销可忽略。

采集原则：只读前台窗口句柄信息，不读屏幕内容、不注入进程；上传前不做本地过滤（过滤是服务端配置的事，见 §8 隐私）。headless 服务器也可运行同一 Agent（检测不到图形会话时仅上报心跳，`title`/`app` 为空）——但常规服务器监控走原有 HTTP 探测即可，此为可选形态。

### F6 下线 / 上线通知（P2）

- Worker 现有 cron（每分钟）末尾追加：读 `device_status`，对 `uptime.config.ts` 新增的 `devices` 配置逐个判定
- 状态翻转时（在线→离线、离线→在线）复用 `formatAndNotify` 走现有 webhook（Resend 邮件）
- 消息文案（中文）：
  - 下线：`「{device_name}」似了喵…（最后活跃 {HH:mm}）`
  - 上线：`「{device_name}」活着喵！（离线时长 {duration}）`
- 通知配置（token、收件人）完全复用现有 `notification.webhook`，不新增通道

### F7 详细数据访问控制——API Key + 浏览器缓存（P0）

**威胁模型**：页面公开可访问（"似了喵？"的乐趣所在），但"我在用什么应用、窗口标题是什么、每天用了多久"属于隐私，不应向匿名访客暴露。在线 / 离线状态、最后活跃时间、今日总时长这类聚合信息保持公开。

**密钥设计：**

- 新增 Pages 运行时 secret：`USAGE_API_KEY`（与 Agent 上报的 `AGENT_TOKEN` **相互独立**，用途与轮换策略分开）
- ⚠️ 密钥**严禁**写入 `uptime.config.ts`——该文件会被编译进前端 bundle，等于公开；只能作为 Pages 环境变量绑定
- 校验方式：`X-API-Key` 请求头，常量时间比较（沿用 `middleware.ts` 的 timing-safe 写法）；密钥为 ≥ 32 位随机串
- 失败一律 `401`，不做任何区分（防枚举）

**接口分级：**

| 数据 | 访问级别 |
|---|---|
| 在线 / 挂机 / 离线、最后活跃时间、设备名 | 公开 |
| 今日活跃总时长（聚合） | 公开 |
| 当前活动窗口（`app` + `title`） | **需密钥**（除非设备配置 `publicWindow: true`） |
| 使用统计全套（`/api/device/usage`：应用排行、24h 时间线、趋势） | **需密钥** |

**前端缓存（解锁体验）：**

- 存储位置：`localStorage`（键名 `uf_usage_key`），跨会话持久——输入一次，之后访问自动解锁
- 请求行为：前端所有 `/api/device/*` 调用，凡本地有 key 就自动附带 `X-API-Key` 头
- 解锁流程：🔒 占位 / 锁形按钮 → 弹窗输入 → 附带 key 重新请求 → 成功则存入 localStorage 并刷新；`401` 则提示错误、**不落盘**
- 失效处理：已存的 key 遇到 `401`（如密钥轮换后）→ 自动清除本地缓存、回到锁定态并提示重新输入
- 提供「锁定」按钮主动清除 localStorage 中的 key（公用电脑场景）
- SSR 不接触 key：首屏只渲染公开字段，详细字段在客户端 hydration 后由带 key 的轮询补齐

### F8 视觉风格与组件库——animal-island-ui（动森风）（P0）

设备区块采用 [animal-island-ui](https://github.com/guokaigdg/animal-island-ui)（动物森友会风格 React + TypeScript 组件库，MIT，当前版本 **v0.7.7，锁定**）。

**兼容性结论（已对照其 AI_USAGE.md 与 package.json 确认）：**
- peer 依赖 `react >= 17`，与本项目 React 18.3.1 兼容 ✓
- 样式为预编译 CSS，`import 'animal-island-ui/style'` 即可，无需引入 Less 工具链；Pages Router 下在 `_app.tsx` 全局引入 ✓
- 字体（Nunito / Noto Sans SC / Zen Maru Gothic）经 @fontsource 自动打包，无需手动接入 ✓
- 无 SSR 专属障碍，但 `Time`（每秒跳动）/ `Typewriter` / `Cursor` 属客户端行为，必要时用现有 `components/NoSsr.tsx` 包裹 ✓

**组件映射（17 个组件中我们用到 9 个）：**

| 需求 | 组件 | 用法 |
|---|---|---|
| 设备卡片容器 | `Card` | `color` 按状态切换：在线活跃 `lime-green` / `app-green`，挂机 `app-yellow`，离线 `default`（羊皮纸底 + 弱化文字） |
| 状态文案 | `Typewriter` | 「活着喵！/ 在挂机喵… / 似了喵…」状态翻转时打字机效果 |
| 解锁弹窗（F7） | `Modal` + `Input` | Modal 自带打字机对话；`Input type="password"` 输入 `USAGE_API_KEY` |
| 统计图表容器 / Tab / 口径说明 | `Card` / `Tabs` / `Collapse` | F4 设备详情内 |
| 装饰 | `Footer` / `Divider` / `Time` / `Cursor` | 设备区页脚（海浪/树）、与 Mantine 区块分界、实时时钟、光标特效 |

**边界与策略：**
- **范围控制**：animal-island-ui 只用于「似了喵？」设备区 + 设备详情；现有 MonitorList / MonitorDetail / incidents 保持 Mantine，不做整页改造。若后续想整页动森化，作为独立迭代评估
- ⚠️ **全局样式冲突（最大风险）**：`animal-island-ui/style` 是全局美学预设（暖羊皮纸底色、药丸圆角、3D 按钮阴影）并设置**全局 font-family**，可能影响 Mantine 组件观感。M1 实测两者共存效果；若冲突明显，把样式引入范围从 `_app.tsx` 收窄到设备区块容器，或接受全局字体替换后微调 Mantine 主题变量对齐动森色板
- **图标限制**：内置 `Icon` 仅 10 个固定动森图标（叶子/树/房子等），**没有猫**——「似了喵？」的猫猫状态图（活跃/挂机/离线三态）需自制 SVG，风格对齐动森（圆角、描边、扁平）
- 图表能力该库没有（也不该有），chart.js 保留并做动森配色

---

## 6. 数据模型（D1 新增表）

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

-- 原始采样，仅保留 N 天（默认 14），用于时间线回放与标题细分
-- 仅对该设备 usageTracking: true 时写入
CREATE TABLE IF NOT EXISTS device_events (
  device_id TEXT NOT NULL,
  ts        INTEGER NOT NULL,     -- 服务端 Unix 秒
  app       TEXT,
  title     TEXT,
  idle      INTEGER DEFAULT 0,
  PRIMARY KEY (device_id, ts)
);

-- 每日使用聚合（长期统计，永不清理）
-- 仅对该设备 usageTracking: true 时写入
CREATE TABLE IF NOT EXISTS usage_daily (
  device_id TEXT NOT NULL,
  date      TEXT NOT NULL,        -- 'YYYY-MM-DD'，按 Asia/Shanghai 切日（可配）
  app       TEXT NOT NULL,
  duration  INTEGER NOT NULL,     -- 累计秒数
  PRIMARY KEY (device_id, date, app)
);
```

- 建表 SQL 加入 `init.sql`，并在 `deploy/` 下补一个初始化脚本说明（沿用现有 `deploy/init_d1.py` 模式）
- 旧表 `uptimeflare` 与旧监控逻辑完全不动

**容量评估**（D1 免费档：10 万行写/天，500 万行读/天，5GB 存储）：
- 写入：30s 心跳 ≈ 2,880 行/天（events）+ 1 行 UPSERT + usage_daily 增量，远低于限额
- 读取：前端 30s 轮询读聚合表 ≈ 2,880 行读/天，无压力
- 存储：events 14 天 ≈ 4 万行；usage_daily 1 设备 1 年 ≈ 3,000–1 万行，可忽略

**清理策略**：`device_events` 由 Worker cron 每天顺手 `DELETE WHERE ts < now - 14d`（或上报时低频抽查执行）。

---

## 7. API 设计

### `POST /api/heartbeat`（新增，edge runtime）

- 请求：JSON（§5 F1），Header `Authorization: Bearer <AGENT_TOKEN>`
- 响应：`204` / `401`（token 错）/ `400`（缺字段）
- CORS：无需开放（Agent 非浏览器），不回 `Access-Control-Allow-Origin`

### `GET /api/device/status`（新增，带 CORS，同 `pages/api/data.ts` 风格）

- 鉴权：公开可读；可选 `X-API-Key` 头（F7）——带有效 key 时响应包含 `last_title` / `last_app`，否则这两个字段为 `null`（除非设备配置 `publicWindow: true`）
- CORS：`Access-Control-Allow-Headers` 需加入 `X-API-Key`

```json
{
  "now": 1787990100,
  "devices": [
    {
      "device_id": "riceawa-desktop",
      "device_name": "DESKTOP-AB12CD",
      "os": "windows",
      "online": true,
      "idle": false,
      "last_seen": 1787990080,
      "last_title": "PRD.md - Visual Studio Code",
      "last_app": "Code.exe",
      "usage_tracking": true,
      "today_total_seconds": 12600
    }
  ]
}
```

> `today_total_seconds` 仅在设备开启 `usageTracking` 时有值，否则为 `null`。

### `GET /api/device/usage?days=7&date=2026-08-29`（新增，仅密钥可访问，仅统计设备有数据）

- 鉴权：**必须**携带 `X-API-Key: <USAGE_API_KEY>`（F7），否则 `401`

```json
{
  "daily": [{ "date": "2026-08-23", "total_seconds": 28800,
              "by_app": { "Code.exe": 14400, "firefox": 7200 } }],
  "hourly_today": [{ "hour": 14, "active_seconds": 2100 }]
}
```

- 聚合查询直接跑 D1 SQL（`SUM(duration) GROUP BY ...`），行数少，无性能问题

---

## 8. 非功能需求

**安全**
- `AGENT_TOKEN`（Agent 上报）与 `USAGE_API_KEY`（详细数据读取）作为两个独立的 Pages secret 绑定（Terraform `deployment_configs` 或 `wrangler pages secret put`），均常量时间比较，长度 ≥ 32
- ⚠️ 两个密钥都**不能**写进 `uptime.config.ts`（会编译进公开的前端 bundle），只能走 Pages 运行时环境变量
- 请求体大小限制（如 4KB）、字段白名单截断，防止异常大 payload
- 读取接口分级公开（F7）：在线状态等聚合信息公开；窗口标题与详细统计需 `USAGE_API_KEY`。现有 `passwordProtection` Basic Auth 仍可作为整站可选的第二层（注意它同时会挡 API，如启用需评估 Agent 上报路径）

**隐私**
- 窗口标题含敏感信息的可能性客观存在；本服务为私有部署，数据只存自己的 D1
- 预留服务端配置 `title_filter`（正则替换 / 黑名单名单，如密码管理器窗口置为 `[REDACTED]`）——P2，MVP 先不做，PRD 明确保留此扩展点

**可靠性**
- Agent 与服务端均无单点依赖新增：Pages API 挂了 → Agent 静默重试，期间在线判定自然超时（准确行为）
- 服务端时间戳为准，容忍 Agent 与云端时钟偏差

**兼容性**
- 现有页面与 API（`/` 状态页、`/incidents`、`/api/badge`、`/api/data`）全部保持可用，新增区块与路由对它们零侵入
- 现有 HTTP 监控（主页 / 博客）与通知行为零改动

---

## 9. 里程碑

### M1 — 第一阶段：Windows + KDE Wayland，跑通共存链路
1. `init.sql` 新增 3 张表，D1 手动执行
2. `POST /api/heartbeat` + `GET /api/device/status`（含 `AGENT_TOKEN` 鉴权）；此时长统计写入逻辑先关闭（所有设备视为 `usageTracking: false`）
3. `USAGE_API_KEY` 机制：`X-API-Key` 校验、status 接口字段分级（标题默认锁定）+ 前端解锁弹窗与 localStorage 缓存（F7）
4. Windows `agent.ps1`（PowerShell 零依赖）
5. Linux `agent.py`（**KDE Wayland 优先**：kdotool + GetSessionIdleTime）
6. 首页新增「似了喵？」设备卡片区（与现有监控列表共存，**动森风**，F8）：在线 / 挂机 / 离线 + 最后活跃 + 当前窗口（解锁后）+ 30s 轮询
7. 引入 `animal-island-ui@0.7.7`（锁定版本），`_app.tsx` 引入样式，实测与 Mantine 共存效果并处理全局样式冲突（F8 风险项）

**验收**：
- KDE Wayland 笔记本与 Windows 台式机同时上报，页面同一屏内同时看到设备卡片和原有服务器监控列表
- 设备开机 → 90s 内卡片变绿「活着喵！」；拔网线 / 关机 → 90s–2 分钟内变「似了喵…」并显示最后活跃时间
- Plasma 6 会话中切换窗口，卡片上的当前窗口在 30s 内跟随变化（已解锁时）
- **匿名访问看不到窗口标题**；浏览器输入一次密钥后立即解锁，刷新页面 / 下次访问无需重输；点「锁定」后回到匿名视角
- 设备卡片呈现动森风（Card + Typewriter + 猫猫图标），与下方监控列表同屏无样式互相破坏（字体 / 底色 / 圆角检查）

### M2 — 第二阶段：使用统计（配置项开启，密钥保护）
1. `usageTracking` 配置项生效：心跳写入时按设备开关累加 `usage_daily` / 写 `device_events`
2. `GET /api/device/usage`（**仅 `X-API-Key` 可访问**，无 key 一律 `401`）
3. 设备详情视图（`#device:<id>`）：今日应用排行、24h 时间线、7 天趋势（chart.js）
4. Linux X11 fallback（xdotool + xprintidle，服务已装 X11 的场景）

**验收**：开启统计的设备连续使用一天后，各应用时长与实际感知一致（误差 < interval 粒度），挂机时间不计入；未开启统计的设备不产生 `usage_daily` / `device_events` 数据；**未解锁时详情页统计区为锁定态，不发出（或发出被拒的）数据请求**。

### M3 — 通知与收尾
1. Worker cron 下线 / 上线通知（F6）+ `uptime.config.ts` 新增 `devices` 配置接入通知
2. `device_events` 过期清理
3. `title_filter` 隐私过滤（可选）；headless 服务器 Agent（仅心跳，可选）
4. 其他桌面环境（sway / GNOME / Plasma 5 + kdotool v0.2.x）按需求评估；i18n 文案（zh-CN / en）补齐

---

## 10. 风险与开放问题

| # | 问题 | 现状 / 建议 |
|---|---|---|
| 1 | **Wayland 下拿前台窗口没有统一接口** | **已调研解决（KDE）**：KDE Wayland 走 KWin scripting API，直接依赖 [kdotool](https://github.com/jinliu/kdotool)（见 §5）。sway 可用 `swaymsg -t get_tree`，GNOME 基本不可行，均留 M3 评估 |
| 2 | kdotool v0.3.0+ 移除了 Plasma 5 支持 | Plasma 6 为主场景；Plasma 5 用户需锁 v0.2.x。Agent 启动时探测 kdotool 可用性，失败给出明确报错和安装指引 |
| 3 | `GetSessionIdleTime` 个别场景恒返回 0（KDE 论坛有案例） | Agent 防御性校验（0 ≤ idle < 86400 才采信）+ 异常日志；必要时备选 KIdleTime 方案 |
| 4 | 浏览器窗口标题基数过高（每个标签页一条） | 长期聚合只到 app 粒度；title 只进 14 天滚动的 events 表 |
| 5 | 笔记本合盖睡眠 = 离线，是否算"似了" | M3 可加"计划离线"配置（睡眠时段不算离线不通知）；MVP 接受此行为 |
| 6 | Pages secret 如何随 Terraform 部署 | 优先试 `deployment_configs` 的 secret 绑定；不行则文档化为一次性 `wrangler pages secret put` 手动步骤 |
| 7 | token 泄露风险 | 私有页面 + token 轮换即可，风险可接受；不做 IP 白名单。`USAGE_API_KEY` 存 localStorage 有 XSS 放大面，但 key 仅可读统计接口（无写权限），个人站点可接受；提供「锁定」按钮随时清除 |
| 8 | Agent 上报间隔 vs 电量 / 流量 | 30s 一次 POST（含 3 次 kdotool 子进程调用）对流量 / CPU 可忽略；笔记本用户可调到 60s |
| 9 | 密钥误入前端 bundle | `uptime.config.ts` 会被编译进公开的前端产物，任何密钥只能放 Pages 运行时 secret；代码评审时专项检查 |
| 10 | animal-island-ui 全局样式预设（底色 / 圆角 / 字体）影响现有 Mantine 区块 | M1 实测；冲突则把样式引入收窄到设备区容器，或调 Mantine 主题变量对齐动森色板（F8） |
| 11 | animal-island-ui 为个人学习项目，v0.x API 可能变动 | 锁定 `0.7.7`；其 AI_USAGE.md 承诺文档与版本严格同步，升级时按该文件核对 props |
| 12 | 动森字体（Nunito / Noto Sans SC / Zen Maru Gothic）打进 bundle 增加体积 | CF Pages 静态资源可承受；上线后跑一次 Lighthouse 确认，必要时按需子集化 |
| 13 | 许可证含"仅限个人学习、研究与非商业展示" | 本项目为个人非商业状态页，符合；若未来商用需替换组件库 |

---

## 11. 配置增量（`uptime.config.ts` 新增）

```ts
const workerConfig: WorkerConfig = {
  monitors: [/* 现有不动，与设备监控共存 */],
  // 新增：设备监控
  devices: [
    {
      id: 'riceawa-desktop',
      name: 'Riceawa 的台式机',
      offlineAfterSeconds: 90,   // 超过此时长无心跳判定离线，默认 3 × 心跳间隔
      usageTracking: true,       // 屏幕使用时长统计开关，默认 false（服务器等设备保持关闭）
      publicWindow: false,       // 当前窗口标题是否公开展示，默认 false（需 USAGE_API_KEY 解锁）
    },
  ],
  notification: { /* 复用现有 Resend 配置 */ },
}
```

> 密钥类配置（`AGENT_TOKEN`、`USAGE_API_KEY`）不在此文件中，一律通过 Pages 运行时 secret 注入。

---

## 12. 附录

### 12.1 文件对照

| 需求 | 涉及文件 | 动作 |
|---|---|---|
| 心跳 API | `pages/api/heartbeat.ts`（新） | 新增 |
| 设备状态 / 统计 API | `pages/api/device/status.ts`、`usage.ts`（新） | 新增 |
| 设备卡片区 | `components/DeviceCard.tsx`（新，基于 animal-island-ui `Card` + `Typewriter`），`pages/index.tsx` 加挂载点 | 新增 |
| 猫猫状态图标 | `public/cat/*.svg`（活跃 / 挂机 / 离线三态自制 SVG，动森风格） | 新增 |
| 密钥解锁 | `components/DeviceUnlockModal.tsx`（新）、`util/usageKey.ts`（localStorage 读写，键名 `uf_usage_key`） | 新增 |
| 设备详情（统计图表） | `components/DeviceDetail.tsx`（新），`pages/index.tsx` hash 路由扩展 `#device:<id>` | 新增 |
| 设备配置类型 | `types/config.ts` 增加 `DeviceConfig`、`WorkerConfig.devices` | 追加 |
| Agent | `agent/agent.ps1`、`agent/agent.py`、`agent/agent.json.example`、`agent/README.md`、`agent/systemd/uptimeflare-agent.service` | 新增 |
| 建表 | `init.sql` | 追加 |
| 通知 | `worker/src/index.ts` scheduled 末尾 | 追加 |
| 部署 | `deploy.tf`（Pages secret） | 微调 |
| 现有监控 | `pages/index.tsx` 的 OverallStatus / MonitorList、`worker/` 全部现有逻辑、`pages/api/data.ts`、`pages/incidents.tsx` | **不动** |
| 前端依赖 | `package.json` 加 `animal-island-ui@0.7.7`（锁定），`pages/_app.tsx` 引入 `animal-island-ui/style` | 追加 |

### 12.2 animal-island-ui 参考

- [guokaigdg/animal-island-ui](https://github.com/guokaigdg/animal-island-ui) — 动森风 React 组件库（17 组件，MIT，个人非商业使用）
- [AI_USAGE.md](https://raw.githubusercontent.com/guokaigdg/animal-island-ui/main/AI_USAGE.md) — 机器可读的组件 API 参考（v0.7.7，含 19 条硬性规则，编码时必读）
- 要点：样式经 `import 'animal-island-ui/style'` 引入；字体经 @fontsource 自动打包；`Modal` 自带 typewriter 对话；`Icon` 仅 10 个固定图标无猫

### 12.3 Wayland / KDE 技术参考（调研来源）

- [jinliu/kdotool](https://github.com/jinliu/kdotool) — xdotool 的 KWin 实现，`getactivewindow` / `getwindowname` / `getwindowclassname`；README：基于 KWin scripting API，每次调用动态生成脚本经 D-Bus 加载执行；v0.3.0+ 仅支持 Plasma 6
- [KWin Scripting from 5.x to 6.x — Compatible?（KDE Discuss）](https://discuss.kde.org/t/kwin-scripting-from-5-x-to-6-x-compatible/2905) — Plasma 6 破坏性改名：`workspace.activeClient` → `activeWindow`，`clientList` → `windowList`；`caption` / `resourceClass` 两代通用
- [Plasma 5.27.80 Changelog（KDE 官方）](https://kde.org/announcements/changelogs/plasma/5.27.9-5.27.80/) — 官方确认 "Scripting: Rename Workspace.activeClient to activeWindow"
- [How to get the active window title in KDE Plasma 6 Wayland via Python D-Bus（Stack Overflow）](https://stackoverflow.com/questions/79895649/how-to-get-the-active-window-title-in-kde-plasma-6-wayland-via-python-dbus) — KWin 脚本 + D-Bus 回调取值的完整模式
- [How to get focused window title in a Python or bash script on Wayland（KDE Discuss）](https://discuss.kde.org/t/how-to-get-focused-window-title-in-a-python-or-bash-script-on-wayland/21361) — 屏幕时间追踪器场景的同款讨论
- [ckb-next issue #1012](https://github.com/ckb-next/ckb-next/issues/1012) — 确认 `ScreenSaver.GetSessionIdleTime` 在 KWin / Sway（Wayland）下可用
- [KDE Discuss：Power Management 空闲时间测试](https://discuss.kde.org/t/use-power-management-to-run-xscreensaver-program/47653?page=2) — `GetSessionIdleTime` 个别场景返回 0 的实际案例
- [KWin Scripting API 官方文档](https://develop.kde.org/docs/plasma/kwin/api/) — Plasma 6 API 权威参考
