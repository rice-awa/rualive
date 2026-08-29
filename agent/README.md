# 似了喵？—— 设备心跳上报 Agent

装在你自己的设备上的小程序：每隔几十秒告诉服务端「我还活着」，顺便报一下当前
前台窗口和输入空闲时间，让状态页能显示设备在线状态与屏幕使用时长。

| 平台 | 脚本 | 依赖 |
|---|---|---|
| Linux（KDE Plasma / Wayland） | `agent.py` | Python 3.8+、`requests`、`kdotool`（可选）、`qdbus`（可选） |
| Windows | `agent.ps1` | PowerShell 5.1+（零依赖） |

```
agent/
├── agent.py                          Linux Agent
├── agent.ps1                         Windows Agent
├── install-linux.sh                  Linux 一键安装脚本（自动装 kdotool + systemd 服务）
├── agent.json.example                配置示例（复制为 agent.json 后填写）
├── systemd/
│   └── uptimeflare-agent.service     Linux systemd user unit
└── README.md
```

---

## 配置文件

两个平台共用同一份 `agent.json`，放在脚本同目录。先复制示例再改：

```bash
cp agent.json.example agent.json
```

| 字段 | 必填 | 默认 | 说明 |
|---|---|---|---|
| `endpoint` | 是 | — | 状态页站点根地址，**不要带 `/api`**；尾部斜杠可有可无 |
| `token` | 是 | — | 与服务端 Pages 环境变量 `AGENT_TOKEN` 完全一致 |
| `device_id` | 是 | — | **必须与服务端 `uptime.config.ts` 里 `devices[].id` 完全一致**，否则 400 |
| `device_name` | 否 | Linux 同 `device_id`；Windows 取计算机名 | 仅本地日志展示用；页面展示名以服务端 `devices[].name` 为准 |
| `interval` | 否 | `30` | 上报间隔（秒），允许 `15`–`120`，越界会自动收敛并告警 |
| `idle_threshold` | 否 | `120` | 挂机判定阈值（秒），建议与服务端 `devices[].idleThreshold` 一致 |

> `agent.json` 里有 token，属于密钥文件。仓库的 `.gitignore` 已经排除了
> `/agent/agent.json`，但仍建议 `chmod 600 agent.json` 限制本机读取权限。
> token 只放在这个文件里，不要写进脚本本身。

`agent.json.example` 里的 `_comment_*` 字段只是注释（JSON 不支持真正的注释），
Agent 会忽略所有未知字段，可以保留也可以删掉。

---

## 服务端契约

Agent 每周期发一个请求，两个平台行为完全一致：

```
POST {endpoint}/api/heartbeat
Authorization: Bearer <token>
Content-Type: application/json

{
  "device_id":   "riceawa-laptop",
  "device_name": "riceawa-laptop",
  "os":          "linux",
  "os_ver":      "KDE Plasma 6 · Wayland",
  "title":       "未命名文件夹 - Dolphin",
  "app":         "org.kde.dolphin",
  "idle":        0,
  "client_time": 1787990000
}
```

| 响应 | 含义 |
|---|---|
| `204` | 成功 |
| `401` | token 不匹配 |
| `400` | 缺字段 / `device_id` 未在服务端配置 / 请求体超过 4KB |

几个容易踩的点：

- **`title` / `app` 必须是字符串**。锁屏、无前台窗口、headless 时传空串 `""`，
  不能省略字段、也不能传 `null`（服务端会判 400）。
- `os` 与 `os_ver` 在服务端会被拼成一个字段存，合计超过 64 字符会截断，
  所以 `os_ver` 不要写得太长。
- `client_time` 仅作参考，服务端一律用自己的时间戳判在线，不信任客户端时间。
- 上报失败（网络错误、非 204）**不会退出进程**，只记日志，下个周期照常重试。

---

## Linux（KDE Plasma / Wayland）

### 1. 一键安装（推荐）

KDE 图形会话下最省事的方式：跑一次脚本，自动检测环境、安装 kdotool、部署
`agent.py` 与配置、装好并启用 systemd user 服务，最后跑一次 `--once --dry-run`
验证窗口采集：

```bash
cd agent
bash install-linux.sh
```

脚本会：

- 检测图形会话 / KDE Plasma 版本 / 架构 / 发行版（apt / pacman / dnf / …）；
- 安装 `kdotool`：优先用 `~/Downloads` 里已有的 `kdotool-*.tar.gz`，没有则从
  GitHub 下载官方 release（默认锁 v0.2.3，同时支持 Plasma 5 与 6）；
- 检查 `python3` / `requests` / `qdbus`，缺失时按你的发行版给出安装命令；
- 把 `agent.py` 与配置部署到 `~/.local/share/uptimeflare-agent/`；
- 已有 `agent.json` 则复用；没有则交互式询问 endpoint / token / device_id，
  也可用 `--endpoint` / `--token` / `--device-id` 参数或同名环境变量跳过交互；
- 安装并启用 `uptimeflare-agent.service`（systemd user，绑定图形会话）。

常用参数：

| 参数 | 说明 |
|---|---|
| `--endpoint URL` / `--token TOKEN` / `--device-id ID` | 跳过对应项的交互询问 |
| `--kdotool-tarball PATH` | 指定本地 kdotool 压缩包，不自动搜 `~/Downloads` |
| `--yes` | 全程不交互（配置项缺失时直接报错） |
| `--no-kdotool` | 不装 kdotool，只跑心跳 |

> 脚本**幂等**，重复执行安全：已有配置与已启用的服务不会被破坏。
> 装完看实时日志：`journalctl --user -u uptimeflare-agent -f`。
> kdotool 安装在 `~/.local/bin`，脚本会把该目录写进服务 unit 的 `PATH`，
> 所以服务内一定找得到；手动装到其它位置请相应调整 unit。

### 2. 安装依赖（手动）

```bash
# requests：唯一的 Python 第三方依赖
sudo apt install python3-requests      # Debian / Ubuntu
sudo pacman -S python-requests         # Arch
sudo dnf install python3-requests      # Fedora
# 或： pip install requests

# qdbus：读取输入空闲时间（可选，缺失则 idle 恒为 0）
sudo apt install qt6-tools-dev-tools   # Debian / Ubuntu，提供 qdbus6
sudo pacman -S qt6-tools               # Arch
```

`kdotool` 用来读取前台窗口标题，需要单独安装 —— 见
[jinliu/kdotool](https://github.com/jinliu/kdotool)（Rust 项目，可 `cargo install`
或下载 release 二进制放进 `PATH`）。

> **版本要求**：kdotool **v0.2.x 同时支持 Plasma 5 与 6**（2026-04 的 v0.2.3 即当前
> 最新）；按计划未来的 v0.3.0+ 将只支持 Plasma 6。装好后确认这两条命令有正常输出：
> ```bash
> kdotool --version
> kdotool getactivewindow
> ```

**kdotool 不装也能跑**：Agent 启动时会探测，探测失败时打印安装指引并退化为
headless 模式 —— 心跳照常上报（设备在线状态正常工作），只是 `title` / `app`
为空串，没有窗口和使用时长统计。

### 3. 为什么 Wayland 下要靠 kdotool

Wayland 出于安全设计移除了「全局读取前台窗口」的接口，KDE 下唯一可靠路径是
KWin 的 scripting API。kdotool 已经把这套机制（动态生成 KWin 脚本 → 经 D-Bus
加载执行 → 回调取值 → 卸载）封装好了，所以直接依赖它，不自研。

Agent 每周期做 3 次 kdotool 调用：

```
kdotool getactivewindow           → 窗口 id，形如 {4711b7f6-1c2d-4e3f-9a8b-0c1d2e3f4a5b}
kdotool getwindowname <id>        → 标题
kdotool getwindowclassname <id>   → 应用标识（resourceClass，如 code、org.kde.dolphin）
```

30 秒一次、每次 3 个短命子进程，CPU 与流量开销可忽略。

### 4. 先手动验证

在图形会话的终端里跑一次，确认采集正常（`--dry-run` 只采集不上报）：

```bash
python3 agent.py --once --dry-run
```

你应该看到请求体里 `title` / `app` 是当前窗口的真实值。再去掉 `--dry-run`
验证能打通服务端（成功会打印「上报成功」）：

```bash
python3 agent.py --once
```

可用参数：

| 参数 | 说明 |
|---|---|
| `-c, --config PATH` | 指定配置文件路径（默认脚本同目录 `agent.json`） |
| `--once` | 只跑一个周期后退出，用于联调 |
| `--dry-run` | 只采集并打印请求体，不实际发请求 |
| `-h, --help` | 帮助 |

### 5. 装成 systemd user 服务

unit 绑定 `graphical-session.target`，只在图形会话内运行，登录即起、登出即停。

> 上面第 1 节的一键脚本会自动完成以下所有步骤；本节保留手动步骤供参考。

```bash
# 1) 放置脚本与配置
mkdir -p ~/.local/share/uptimeflare-agent
cp agent.py ~/.local/share/uptimeflare-agent/
cp agent.json.example ~/.local/share/uptimeflare-agent/agent.json
chmod 600 ~/.local/share/uptimeflare-agent/agent.json
$EDITOR ~/.local/share/uptimeflare-agent/agent.json     # 填 endpoint / token / device_id

# 2) 安装 unit
mkdir -p ~/.config/systemd/user
cp systemd/uptimeflare-agent.service ~/.config/systemd/user/

# 3) 确认 ExecStart 里的 python3 绝对路径与你的系统一致
which python3                                            # 若不是 /usr/bin/python3 就改 unit
$EDITOR ~/.config/systemd/user/uptimeflare-agent.service

# 4) 启用
systemctl --user daemon-reload
systemctl --user enable --now uptimeflare-agent

# 5) 看状态与日志
systemctl --user status uptimeflare-agent
journalctl --user -u uptimeflare-agent -f
```

> systemd **不做 PATH 查找、不展开 `~`**，`ExecStart` 必须是绝对路径。unit 里用
> 了 `%h` 指代家目录（systemd 自己的占位符，可用）。若把脚本放在别处，记得同步改
> `ExecStart`。

停用：

```bash
systemctl --user disable --now uptimeflare-agent
```

### 6. 已知限制：空闲时间在 Plasma 6 Wayland 上不可用

PRD 里选定的空闲检测方案是
`qdbus org.freedesktop.ScreenSaver /ScreenSaver GetSessionIdleTime`，
但**在 Plasma 6 Wayland 上实测该方法返回错误**：

```
$ qdbus6 org.freedesktop.ScreenSaver /ScreenSaver GetSessionIdleTime
Error: org.freedesktop.DBus.Error.NotSupported
GetSessionIdleTime is not supported on this platform
```

D-Bus 接口上方法签名是存在的，但 KWin 在 Wayland 下没有实现它。因此 Agent 做了
三档降级，启动日志会明确告诉你当前处于哪一档：

| 档 | 条件 | idle 取值 |
|---|---|---|
| `GetSessionIdleTime` 可用 | 通常是 X11 会话 | 真实输入空闲秒数 |
| 返回 `NotSupported` | Plasma 6 Wayland | **退化为锁屏状态**：已锁屏 → `max(锁屏时长, idle_threshold + 1)` 视为离开；未锁屏 → `0`（按在用处理） |
| 找不到 `qdbus` | 未装 Qt tools | 恒 `0` |

**这一档降级的实际影响**：未锁屏但人不在电脑前的时间，会被算作「在用」，屏幕使用
时长统计会偏高。设备在线状态与前台窗口不受影响。想让统计更准，可以把系统设成
较短时间自动锁屏。

其它相关防御（PRD 风险 3）：

- **无法解析的返回值**（D-Bus 报错文本、负数、空输出）视为未知，按 `0` 上报并计入
  异常计数；连续 5 次异常打一条 WARN，之后降频提醒，**不会中断上报**。
- **`idle` 达到或超过 86400（24h）时收敛到 86400，不归零**。这与服务端
  `Math.min(86400, …)` 的处理一致。这里不能归零：机器真的挂机过夜/过周末时
  `idle > 86400` 是**合法值**，归零等于上报「idle=0 正在使用」，而服务端判定使用时长
  用的是请求体里的原始 `idle`（`idle < idleThreshold`），会把长时间挂机误计成活跃、
  把使用时长统计抬高 —— 与这个字段的用途正好相反。
- **锁屏时的下限**：锁屏那一刻 `GetActiveTime`（锁屏已持续多久）很小，直接上报会让
  「刚锁屏的头一两分钟」被服务端记成正在使用（判定用的是 `idle < idleThreshold`）。
  锁屏是**确知**用户已离开的信号，所以锁屏时上报值下限为 `idle_threshold + 1`，
  锁得更久时用真实时长（保留量级）。
- 若 `idle` 连续 20 个周期恒为 0，会额外提示一次「空闲检测很可能不可用」——
  这正是 KDE 论坛上报告过的恒 0 现象。
- `GetSessionIdleTime` 规范单位是**秒**，Agent 按秒解读，不做静默的单位换算猜测。
  若某实现返回毫秒，数值会长期贴着 86400 上限，此时 clamp 告警会同时列出两种可能
  （真挂机 / 单位不是秒）供你判断。

### 7. qdbus 可执行文件名

不同发行版 / Qt 版本下名字不一样，Agent 会按 `qdbus6` → `qdbus-qt6` → `qdbus`
→ `qdbus-qt5` 顺序自动探测。例如 Ubuntu 上装的 qt6-tools 提供的是 `qdbus6`，
并没有 `qdbus`。启动日志里会打印实际用的是哪一个。

### 8. headless / 无图形会话

通过 SSH 登录、或在没有 `DISPLAY` / `WAYLAND_DISPLAY` 的环境里运行时，Agent 判为
headless：跳过所有 kdotool / qdbus 调用，只上报心跳，`title` / `app` 为空串，
`idle` 为 0，并每周期打一条 WARN。

服务器常规监控走项目原有的 HTTP 探测就够了，headless 跑 Agent 只是可选形态。

### 9. 故障排查

| 现象 | 原因与处理 |
|---|---|
| `找不到配置文件` | 按提示 `cp agent.json.example agent.json` 并填写 |
| `配置文件不是合法 JSON` | JSON 不支持注释和尾随逗号；日志里有出错的行列号 |
| `token 看起来仍是示例占位符` | `agent.json` 里的 token 还没换成真实值 |
| HTTP `401` | token 与服务端 `AGENT_TOKEN` 不一致 |
| HTTP `400 Unknown device` | `device_id` 不在服务端 `uptime.config.ts` 的 `devices[]` 里 |
| HTTP `404` | `endpoint` 写错，应是站点根地址，不要带 `/api` |
| `未找到 kdotool` | 见上面第 2 节；不装也能跑，只是没有窗口信息 |
| 页面上窗口标题一直为空 | 确认在图形会话内运行（systemd user 服务而非 root/system 服务），且 `kdotool getactivewindow` 手动能出结果 |
| 页面显示「无图形会话（headless，仅心跳）」 | 两种可能：① 真的没有图形会话（SSH / 无 `DISPLAY`）；② **有图形会话但 kdotool 缺失**。Agent 对这两种情况统一退化为 headless。看启动日志区分：若打印「未找到 kdotool」就是 ②，装好 kdotool（一键脚本或上面第 2 节）后 `systemctl --user restart uptimeflare-agent` |
| 服务不自启 | 部分发行版的 user systemd 不会拉起 `graphical-session.target`。先查 `systemctl --user status graphical-session.target`；若确实没起，把 unit 的 `WantedBy` 改成 `default.target` 后 `daemon-reload` 重新 enable |
| 日志里没有输出 | 脚本已按行 flush；用 `journalctl --user -u uptimeflare-agent -f` 看 |

---

## Windows

Windows 10 / 11 自带 PowerShell 5.1，**不需要安装任何东西**，也不需要管理员权限。
`agent.ps1` 用 `Add-Type` 现场编译一小段 C# 调用 Win32 API，零第三方依赖。

### 1. 放置脚本与配置

把 `agent.ps1` 和 `agent.json` 放在同一个目录（下面以 `C:\Tools\uptimeflare` 为例）：

```powershell
mkdir C:\Tools\uptimeflare
# 从仓库复制 agent.ps1 与 agent.json.example 到该目录，然后：
cd C:\Tools\uptimeflare
Copy-Item agent.json.example agent.json
notepad agent.json        # 填 endpoint / token / device_id
```

`device_id` 填服务端 `uptime.config.ts` 里对应这台机器的 `devices[].id`（例如
`riceawa-desktop`），填错会收到 `400 Unknown device`。

### 2. 先手动验证一次

`-Once` 只上报一次就退出，用来确认配置和网络通不通：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\agent.ps1 -Once
```

成功时输出类似：

```
[2026-08-29 10:42:15] [INFO] 似了喵 Agent 启动：device_id=riceawa-desktop device_name=DESKTOP-AB12CD os=windows 11
[2026-08-29 10:42:15] [INFO] 上报地址：https://uptimeflare.example.com/api/heartbeat  间隔：30s  挂机阈值：120s
[2026-08-29 10:42:15] [INFO] 采样：app=Code idle=3s title=PRD.md - Visual Studio Code
[2026-08-29 10:42:15] [INFO] 单次上报成功（服务端 204）。
```

请确认 `title` / `app` 是你当前真实的前台窗口。成功退出码为 `0`，失败为 `1`。

> **关于执行策略**：命令里带了 `-ExecutionPolicy Bypass`，只对这一次调用生效，
> 不用去改系统全局的执行策略。如果直接双击或在已有 PowerShell 窗口里 `.\agent.ps1`
> 报「禁止运行脚本」，就按上面的完整命令来调用。

前台运行（不带参数）即常驻上报，`Ctrl+C` 停止：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\agent.ps1
```

### 3. 可用参数

| 参数 | 说明 |
|---|---|
| `-Once` | 只上报一次后退出，用于联调验证 |
| `-Run` | 常驻运行（与不带参数等价，计划任务用它让语义更明确） |
| `-Install` | 注册「登录时自启」计划任务（需交互确认） |
| `-Uninstall` | 删除该计划任务（需交互确认） |
| `-Config <路径>` | 指定配置文件路径，默认脚本同目录 `agent.json` |

### 4. 装成登录自启的计划任务

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\agent.ps1 -Install
```

会先打印将要创建的内容并要求输入 `y` 确认，然后调用 `schtasks` 创建名为
`UptimeFlareAgent` 的任务：当前用户每次登录时以隐藏窗口后台启动，**不需要管理员权限**。

常用操作：

```powershell
schtasks /run   /tn UptimeFlareAgent          # 立即启动（不用等下次登录）
schtasks /query /tn UptimeFlareAgent /v /fo list   # 查看状态与实际命令行
schtasks /end   /tn UptimeFlareAgent          # 停止本次运行
powershell -NoProfile -ExecutionPolicy Bypass -File .\agent.ps1 -Uninstall   # 卸载
```

> 触发器是**登录时**（`onlogon`），不是开机时。开机后停在登录界面是不会上报的 ——
> 这符合「屏幕使用时长」的语义：没人登录就等于没在用。
>
> 装好之后不要再移动 `agent.ps1` 的位置，任务里记录的是绝对路径；移动了就重新
> `-Install` 一次（`/f` 会覆盖同名任务）。

### 5. 采集原理

每周期通过 P/Invoke 调用 Win32 API，只读窗口标题这一个字符串，不读屏幕内容、不注入进程：

```
GetForegroundWindow()                → 前台窗口句柄，锁屏 / 无前台窗口时为 0
GetWindowTextW(hWnd)                 → 窗口标题       → title
GetWindowThreadProcessId(hWnd)       → 进程 id
  → Process.GetProcessById().ProcessName → 进程名     → app
GetLastInputInfo() 与 GetTickCount() 之差 → 输入空闲秒数 → idle
```

几个实现细节：

- `app` 是**不含 `.exe` 后缀**的进程名（`Code`、`chrome`、`explorer`），与 Linux 侧
  `resourceClass` 的粒度对齐，便于服务端按 app 聚合统计。
- `GetTickCount` 约 49.7 天回绕，空闲时长在 C# 侧用 `uint` 无符号减法计算，
  回绕当天不会算出负数或超大值。
- `title` 客户端先截断到 200 字符、`app` 截断到 64 字符，保证请求体远小于服务端 4KB 上限。
- 请求体自行编码为 UTF-8 字节再发送 —— PowerShell 5.1 的 `Invoke-WebRequest` 对
  字符串 body 默认按 Latin-1 编码，**中文窗口标题会被写坏**，这里绕开了该行为。
- 强制 TLS 1.2（部分系统上 PS 5.1 默认仍是 TLS 1.0，直连 Cloudflare 会握手失败）。

### 6. 锁屏与挂机

| 场景 | `title` / `app` | `idle` |
|---|---|---|
| 正常使用 | 真实窗口标题 / 进程名 | `GetLastInputInfo` 的真实空闲秒数 |
| 锁屏、切换用户、登录界面 | 空串 `""` | `99999`（服务端按 `idle_threshold` 判挂机） |
| 有前台窗口但标题为空 | `""` / 真实进程名 | 真实空闲秒数 |

锁屏判定有两条路径：`GetForegroundWindow` 返回 0，或前台进程是 `LockApp` /
`LogonUI`。后者是为了不把锁屏界面的停留时间计入使用统计。

### 7. 已知限制

- **必须在交互式桌面会话里运行**。如果做成 Windows 服务或用 SYSTEM 账户在会话 0
  里跑，`GetForegroundWindow` 永远返回 0，`title` / `app` 会恒为空 —— 请用上面的
  登录时计划任务方案，不要改成服务。
- 前台窗口属于**以管理员权限运行的进程**时，`Process.GetProcessById` 可能因权限
  不足拿不到进程名，此时 `app` 为空串、`title` 仍正常。
- 远程桌面（RDP）断开连接后会话被挂起，期间不产生心跳，设备会被判离线。

### 8. 故障排查

| 现象 | 原因与处理 |
|---|---|
| 「禁止运行脚本」/ `UnauthorizedAccess` | 用完整命令 `powershell -NoProfile -ExecutionPolicy Bypass -File .\agent.ps1`，不要直接双击 |
| `找不到配置文件` | 按提示 `Copy-Item agent.json.example agent.json` 并填写；脚本读的是**脚本同目录**，不是当前工作目录 |
| `配置文件不是合法 JSON` | JSON 不支持注释和尾随逗号；日志里有出错位置 |
| `配置缺少必填项` | 日志会列出缺哪个字段（`endpoint` / `token` / `device_id`） |
| HTTP `401` | token 与服务端 `AGENT_TOKEN` 不一致 |
| HTTP `400 Unknown device` | `device_id` 不在服务端 `uptime.config.ts` 的 `devices[]` 里 |
| HTTP `404` | `endpoint` 写错，应是站点根地址，不要带 `/api` |
| `网络不可达或超时` | 断网、DNS 或防火墙拦截；Agent 会每周期自动重试，恢复后会打印「上报恢复正常」 |
| SSL / 握手失败 | 系统过旧导致 TLS 1.2 不可用，需装系统更新 / .NET Framework 4.6+ |
| 页面上窗口标题一直为空 | 大概率跑在非交互式会话（服务 / SYSTEM / 会话 0），见上面「已知限制」；或者机器正处于锁屏 |
| `idle` 一直是 `99999` | 处于锁屏状态，或前台窗口读取失败（日志里有对应 WARN） |
| 计划任务不运行 | `schtasks /query /tn UptimeFlareAgent /v /fo list` 看上次运行结果；确认 `agent.ps1` 没被移动过 |
| 想看常驻运行的日志 | 脚本只写控制台、不写日志文件。排查时用 `schtasks /end` 停掉任务，改成前台跑一段观察 |
