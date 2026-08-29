#Requires -Version 5.1
<#
.SYNOPSIS
    「似了喵？」Windows 心跳 Agent —— 采集前台窗口 / 空闲时长并上报到 UptimeFlare。

.DESCRIPTION
    PowerShell 5.1+ 单文件、零第三方依赖。每 interval 秒 POST 一次心跳到
    {endpoint}/api/heartbeat，采集内容仅限：前台窗口标题、前台进程名、输入空闲秒数。
    不读屏幕内容、不注入进程、无本地持久化。

    配置读自脚本同目录的 agent.json（可用 -Config 覆盖路径）。密钥只存在配置文件里，
    不写入脚本本身。

.PARAMETER Run
    常驻运行（默认行为，计划任务用此参数调用，语义更明确）。

.PARAMETER Once
    只上报一次心跳后退出，用于联调验证配置与网络是否通。

.PARAMETER Install
    注册开机（登录时）自启的计划任务 UptimeFlareAgent，需交互确认。

.PARAMETER Uninstall
    删除该计划任务，需交互确认。

.PARAMETER Config
    agent.json 的路径，默认为脚本同目录下的 agent.json。

.EXAMPLE
    powershell -NoProfile -ExecutionPolicy Bypass -File .\agent.ps1 -Once
    先验证一次上报是否成功（推荐第一步）。

.EXAMPLE
    powershell -NoProfile -ExecutionPolicy Bypass -File .\agent.ps1 -Install
    注册登录自启，之后每次登录自动后台运行。
#>
[CmdletBinding()]
param(
    [switch]$Run,
    [switch]$Once,
    [switch]$Install,
    [switch]$Uninstall,
    [string]$Config
)

# 出错不静默：配置/环境类错误要立刻可见（网络错误在循环内单独 try/catch 兜住）
$ErrorActionPreference = 'Stop'
# 关掉 Invoke-WebRequest 的进度条，PS 5.1 下它会显著拖慢请求
$ProgressPreference = 'SilentlyContinue'

$TaskName = 'UptimeFlareAgent'
$UserAgent = 'UptimeFlare-Agent-Windows/1.0'

# 服务端字段上限（与 pages/api/heartbeat.ts 保持一致），客户端先截断，避免请求体超 4KB 被 400
$MAX_TITLE = 200
$MAX_APP = 64

# ---------------------------------------------------------------------------
# 日志
# ---------------------------------------------------------------------------

function Write-Log {
    param([string]$Message, [string]$Level = 'INFO')
    $ts = (Get-Date).ToString('yyyy-MM-dd HH:mm:ss')
    $line = "[$ts] [$Level] $Message"
    switch ($Level) {
        'WARN'  { Write-Host $line -ForegroundColor Yellow }
        'ERROR' { Write-Host $line -ForegroundColor Red }
        default { Write-Host $line }
    }
}

# ---------------------------------------------------------------------------
# Win32 P/Invoke：前台窗口 + 空闲时长
# ---------------------------------------------------------------------------

# 同一会话里重复 dot-source 本脚本时不要重复 Add-Type（否则报类型已存在）
if (-not ('UptimeFlare.Native' -as [type])) {
    Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;

namespace UptimeFlare {
    public static class Native {
        [DllImport("user32.dll")]
        public static extern IntPtr GetForegroundWindow();

        [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        public static extern int GetWindowTextW(IntPtr hWnd, StringBuilder lpString, int nMaxCount);

        [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        public static extern int GetWindowTextLengthW(IntPtr hWnd);

        [DllImport("user32.dll", SetLastError = true)]
        public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);

        [StructLayout(LayoutKind.Sequential)]
        public struct LASTINPUTINFO {
            public uint cbSize;
            public uint dwTime;
        }

        [DllImport("user32.dll")]
        [return: MarshalAs(UnmanagedType.Bool)]
        public static extern bool GetLastInputInfo(ref LASTINPUTINFO plii);

        [DllImport("kernel32.dll")]
        public static extern uint GetTickCount();

        /// <summary>前台窗口标题；无前台窗口（如锁屏）返回 null。</summary>
        public static string GetForegroundTitle(out uint processId) {
            processId = 0;
            IntPtr hWnd = GetForegroundWindow();
            if (hWnd == IntPtr.Zero) return null;
            GetWindowThreadProcessId(hWnd, out processId);
            int len = GetWindowTextLengthW(hWnd);
            if (len <= 0) return string.Empty;
            StringBuilder sb = new StringBuilder(len + 1);
            int copied = GetWindowTextW(hWnd, sb, sb.Capacity);
            if (copied <= 0) return string.Empty;
            return sb.ToString();
        }

        /// <summary>
        /// 输入空闲秒数。GetTickCount 约 49.7 天回绕，用 uint 无符号减法可自动得到正确差值。
        /// </summary>
        public static uint GetIdleSeconds() {
            LASTINPUTINFO lii = new LASTINPUTINFO();
            lii.cbSize = (uint)Marshal.SizeOf(typeof(LASTINPUTINFO));
            if (!GetLastInputInfo(ref lii)) return 0;
            uint diff = GetTickCount() - lii.dwTime;
            return diff / 1000u;
        }
    }
}
'@
}

# 锁屏 / 安全桌面时的前台进程，视同「无窗口」，避免把锁屏时间计入使用统计
$LockAppProcesses = @('LockApp', 'LogonUI')

# Win32 调用连续失败次数，仅用于日志节流
$WinApiFailStreak = 0

function Limit-Length {
    param([string]$Value, [int]$Max)
    if ([string]::IsNullOrEmpty($Value)) { return '' }
    if ($Value.Length -le $Max) { return $Value }
    return $Value.Substring(0, $Max)
}

<#
    采集一次前台窗口与空闲时长。
    返回 @{ title; app; idle }：
      - 有前台窗口 → 真实标题 / 进程名（不含 .exe）/ GetLastInputInfo 空闲秒数
      - 无前台窗口或锁屏 → title/app 为空串，idle 为 99999（服务端按 idle_threshold 判挂机）
#>
function Get-Sample {
    # 类型必须与 C# 的 out uint 完全一致，否则 PowerShell 绑定 out 参数会失败
    $procId = [uint32]0
    $title = $null
    try {
        $title = [UptimeFlare.Native]::GetForegroundTitle([ref]$procId)
        $script:WinApiFailStreak = 0
    } catch {
        # 正常 Windows 桌面会话不该走到这里（非交互式会话 / 会话 0 才会持续失败），
        # 节流打印避免每个周期刷一条告警
        $script:WinApiFailStreak++
        if ($script:WinApiFailStreak -le 3 -or ($script:WinApiFailStreak % 60) -eq 0) {
            Write-Log "读取前台窗口失败（第 $($script:WinApiFailStreak) 次）：$($_.Exception.Message)" 'WARN'
        }
        $title = $null
    }

    # GetForegroundWindow 返回 0：锁屏、切换用户、或本进程不在交互式桌面会话中
    if ($null -eq $title) {
        return @{ title = ''; app = ''; idle = 99999 }
    }

    $app = ''
    if ($procId -gt 0) {
        try {
            # ProcessName 本身不含 .exe 后缀，与 Linux 侧 resourceClass 的粒度对齐
            $app = [System.Diagnostics.Process]::GetProcessById([int]$procId).ProcessName
        } catch {
            # 进程可能在读取间隙退出，或权限不足（提权进程）；留空不影响心跳
            $app = ''
        }
    }

    # 锁屏界面：当前台是 LockApp/LogonUI 时按「无窗口 + 挂机」上报
    if ($app -and ($LockAppProcesses -contains $app)) {
        return @{ title = ''; app = ''; idle = 99999 }
    }

    $idle = 0
    try {
        $idle = [int][UptimeFlare.Native]::GetIdleSeconds()
    } catch {
        $idle = 0
    }
    # 上限收敛到 86400（与服务端 clamp 一致）而不是归零：
    # 真的挂机超过一天时 idle 本来就会很大，归零会把「离开」误报成「在用」，
    # 直接抬高使用时长统计。GetTickCount 回绕上限约 49.7 天，不会溢出 int32。
    if ($idle -lt 0) { $idle = 0 }
    if ($idle -gt 86400) { $idle = 86400 }

    return @{
        title = (Limit-Length ($title.Trim()) $MAX_TITLE)
        app   = (Limit-Length ($app.Trim()) $MAX_APP)
        idle  = $idle
    }
}

# ---------------------------------------------------------------------------
# 系统信息（启动时算一次即可）
# ---------------------------------------------------------------------------

<# Windows 营销版本号：11 / 10 / 8.1 …（Win10 与 Win11 的 OSVersion 都是 10.0，靠 build 区分） #>
function Get-WindowsVersion {
    try {
        $key = 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion'
        $build = [int](Get-ItemProperty -Path $key -Name CurrentBuildNumber -ErrorAction Stop).CurrentBuildNumber
        if ($build -ge 22000) { return '11' }
        if ($build -ge 10240) { return '10' }
    } catch {
        # registry 读不到就退回 OSVersion
    }
    try {
        $v = [Environment]::OSVersion.Version
        if ($v.Major -eq 10) { return '10' }
        return "$($v.Major).$($v.Minor)"
    } catch {
        return ''
    }
}

function Get-UnixTime {
    $epoch = [datetime]::SpecifyKind([datetime]'1970-01-01', 'Utc')
    return [int64]([datetime]::UtcNow - $epoch).TotalSeconds
}

# ---------------------------------------------------------------------------
# 配置
# ---------------------------------------------------------------------------

function Get-Prop {
    param($Object, [string]$Name)
    if ($null -eq $Object) { return $null }
    $p = $Object.PSObject.Properties[$Name]
    if ($p) { return $p.Value }
    return $null
}

function Show-ConfigHelp {
    param([string]$Path)
    Write-Host ''
    Write-Host '请在脚本同目录创建 agent.json，内容形如：' -ForegroundColor Cyan
    Write-Host ''
    Write-Host '{'
    Write-Host '  "endpoint": "https://uptimeflare.example.com",'
    Write-Host '  "token": "你的 AGENT_TOKEN",'
    Write-Host '  "device_id": "riceawa-desktop",'
    Write-Host '  "interval": 30,'
    Write-Host '  "idle_threshold": 120'
    Write-Host '}'
    Write-Host ''
    Write-Host "可直接复制同目录的 agent.json.example 改名为 agent.json。期望路径：$Path" -ForegroundColor Cyan
    Write-Host 'device_id 必须与服务端 uptime.config.ts 里 devices[].id 完全一致，否则服务端返回 400。' -ForegroundColor Cyan
    Write-Host ''
}

function Read-AgentConfig {
    param([string]$Path)

    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        Write-Log "找不到配置文件：$Path" 'ERROR'
        Show-ConfigHelp $Path
        exit 1
    }

    $raw = $null
    try {
        $raw = Get-Content -LiteralPath $Path -Raw -Encoding UTF8
    } catch {
        Write-Log "配置文件读取失败：$($_.Exception.Message)" 'ERROR'
        exit 1
    }

    # 去掉可能残留的 UTF-8 BOM，PS 5.1 的 ConvertFrom-Json 会因为它解析失败
    if ($raw.Length -gt 0 -and [int]$raw[0] -eq 0xFEFF) { $raw = $raw.Substring(1) }

    if ([string]::IsNullOrWhiteSpace($raw)) {
        Write-Log "配置文件为空：$Path" 'ERROR'
        Show-ConfigHelp $Path
        exit 1
    }

    $cfg = $null
    try {
        $cfg = $raw | ConvertFrom-Json
    } catch {
        Write-Log "配置文件不是合法 JSON：$Path" 'ERROR'
        Write-Log "解析错误：$($_.Exception.Message)" 'ERROR'
        Show-ConfigHelp $Path
        exit 1
    }

    $endpoint = [string](Get-Prop $cfg 'endpoint')
    $token    = [string](Get-Prop $cfg 'token')
    $deviceId = [string](Get-Prop $cfg 'device_id')

    $missing = @()
    if ([string]::IsNullOrWhiteSpace($endpoint)) { $missing += 'endpoint' }
    if ([string]::IsNullOrWhiteSpace($token))    { $missing += 'token' }
    if ([string]::IsNullOrWhiteSpace($deviceId)) { $missing += 'device_id' }
    if ($missing.Count -gt 0) {
        Write-Log "配置缺少必填项：$($missing -join '、')" 'ERROR'
        Show-ConfigHelp $Path
        exit 1
    }
    if ($token -match '^<' -or $token -match '你的') {
        Write-Log "token 看起来仍是示例占位符，请填入真实的 AGENT_TOKEN（当前值：$token）" 'ERROR'
        exit 1
    }

    $endpoint = $endpoint.Trim().TrimEnd('/')
    if ($endpoint -notmatch '^https?://') {
        Write-Log "endpoint 必须以 http:// 或 https:// 开头，当前值：$endpoint" 'ERROR'
        exit 1
    }
    if ($endpoint -match '^http://' ) {
        Write-Log 'endpoint 使用了明文 http，token 会以明文经过网络，建议改用 https。' 'WARN'
    }

    # interval 默认 30，限制在 15–120（PRD §7）
    $interval = 30
    $rawInterval = Get-Prop $cfg 'interval'
    if ($null -ne $rawInterval -and $rawInterval -ne '') {
        try {
            $interval = [int]$rawInterval
        } catch {
            Write-Log "interval 不是数字（$rawInterval），回退默认 30 秒。" 'WARN'
            $interval = 30
        }
        if ($interval -lt 15) {
            Write-Log "interval=$interval 小于下限，按 15 秒处理。" 'WARN'
            $interval = 15
        } elseif ($interval -gt 120) {
            Write-Log "interval=$interval 超过上限，按 120 秒处理。" 'WARN'
            $interval = 120
        }
    }

    # idle_threshold 仅用于本地日志展示；是否计入使用时长由服务端配置决定
    $idleThreshold = 120
    $rawIdle = Get-Prop $cfg 'idle_threshold'
    if ($null -ne $rawIdle -and $rawIdle -ne '') {
        try {
            $idleThreshold = [int]$rawIdle
        } catch {
            Write-Log "idle_threshold 不是数字（$rawIdle），回退默认 120 秒。" 'WARN'
            $idleThreshold = 120
        }
        if ($idleThreshold -lt 1) { $idleThreshold = 120 }
    }

    return @{
        endpoint      = $endpoint
        url           = "$endpoint/api/heartbeat"
        token         = $token.Trim()
        deviceId      = $deviceId.Trim()
        deviceName    = [string](Get-Prop $cfg 'device_name')
        interval      = $interval
        idleThreshold = $idleThreshold
    }
}

# ---------------------------------------------------------------------------
# 上报
# ---------------------------------------------------------------------------

<#
    发送一次心跳。返回 $true 表示服务端 204 接收成功。
    任何失败都只记日志、不抛出 —— 调用方下个周期照常重试。
#>
function Send-Heartbeat {
    param($Cfg, $Sample, [string]$Os, [string]$OsVer, [string]$DeviceName)

    # 用有序 hashtable 保证字段顺序稳定，便于日志/抓包比对
    $payload = [ordered]@{
        device_id   = $Cfg.deviceId
        device_name = $DeviceName
        os          = $Os
        os_ver      = $OsVer
        title       = $Sample.title
        app         = $Sample.app
        idle        = $Sample.idle
        client_time = Get-UnixTime
    }

    $json = $payload | ConvertTo-Json -Compress
    # 关键：PS 5.1 的 Invoke-WebRequest 对 string body 默认用 Latin-1 编码，
    # 中文窗口标题会被写坏；必须自己转成 UTF-8 字节数组再发。
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)

    $headers = @{
        'Authorization' = 'Bearer ' + $Cfg.token
    }

    # 请求超时不能长于一个周期，否则循环会被拖住
    $timeout = [Math]::Max(5, [Math]::Min(15, $Cfg.interval - 2))

    try {
        $resp = Invoke-WebRequest -Uri $Cfg.url -Method Post -Headers $headers `
            -ContentType 'application/json; charset=utf-8' -Body $bytes `
            -UseBasicParsing -TimeoutSec $timeout -UserAgent $UserAgent
        $code = [int]$resp.StatusCode
        if ($code -eq 204 -or $code -eq 200) { return $true }
        Write-Log "服务端返回意外状态码 $code：$($resp.Content)" 'WARN'
        return $false
    } catch {
        # 先把错误记录存下来：switch 语句会把 $_ 重绑为 switch 的条件值，
        # 嵌套的 try/catch 也会覆盖 $_，后面一律用 $err 而不是 $_。
        $err = $_
        # PS 5.1 抛 System.Net.WebException，PS 7 抛 HttpResponseException，
        # 两者的 Response.StatusCode 都是枚举，可统一取整；
        # 响应体优先用 ErrorDetails.Message（两个版本都会填），拿不到再读响应流。
        $code = -1
        $body = ''
        $webResp = $null
        try { $webResp = $err.Exception.Response } catch { }
        if ($null -ne $webResp) {
            try { $code = [int]$webResp.StatusCode } catch { }
        }
        if ($null -ne $err.ErrorDetails -and $err.ErrorDetails.Message) {
            $body = $err.ErrorDetails.Message
        } elseif ($null -ne $webResp) {
            try {
                $stream = $webResp.GetResponseStream()
                $reader = New-Object System.IO.StreamReader($stream)
                $body = $reader.ReadToEnd()
                $reader.Close()
            } catch { }
        }

        switch ($code) {
            401 {
                Write-Log "401 鉴权失败：请检查 agent.json 的 token 是否与服务端 AGENT_TOKEN 一致。$body" 'WARN'
            }
            400 {
                Write-Log "400 请求被拒：device_id「$($Cfg.deviceId)」可能未在服务端 devices 中配置，或请求体超过 4KB。$body" 'WARN'
            }
            -1 {
                # 没有 HTTP 响应：DNS 失败 / 连接超时 / 断网
                Write-Log "上报失败（网络不可达或超时）：$($err.Exception.Message)" 'WARN'
            }
            default {
                Write-Log "上报失败，HTTP $code：$body" 'WARN'
            }
        }
        return $false
    }
}

# ---------------------------------------------------------------------------
# 计划任务（登录自启）
# ---------------------------------------------------------------------------

function Get-ScriptPath {
    if ($PSCommandPath) { return $PSCommandPath }
    return $MyInvocation.MyCommand.Path
}

function Install-AgentTask {
    param([string]$ScriptPath, [string]$ConfigPath)

    Write-Host ''
    Write-Host '即将注册「登录时自启」计划任务：' -ForegroundColor Cyan
    Write-Host "  任务名称：$TaskName"
    Write-Host "  脚本路径：$ScriptPath"
    Write-Host "  触发时机：当前用户($env:USERNAME)每次登录"
    Write-Host '  运行方式：后台隐藏窗口，无需管理员权限'
    if (-not (Test-Path -LiteralPath $ConfigPath -PathType Leaf)) {
        Write-Host "  注意：尚未找到 $ConfigPath，安装后仍需创建配置文件才能正常上报。" -ForegroundColor Yellow
    }
    Write-Host ''
    $answer = Read-Host '确认注册？(y/N)'
    if ($answer -notmatch '^[yY]') {
        Write-Log '已取消。'
        return
    }

    # /tr 的值内部需要真正的双引号包住脚本路径（路径可能含空格）。
    # PowerShell 传原生命令参数时会整体加引号，内层用 \" 转义才能被 schtasks 正确解析。
    $tr = 'powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File \"' + $ScriptPath + '\" -Run'

    try {
        $output = & schtasks.exe /create /tn $TaskName /tr $tr /sc onlogon /f 2>&1
        if ($LASTEXITCODE -ne 0) {
            Write-Log "计划任务注册失败（exit $LASTEXITCODE）：$output" 'ERROR'
            exit 1
        }
        Write-Log "计划任务已注册：$TaskName"
        Write-Host ''
        Write-Host '常用操作：' -ForegroundColor Cyan
        Write-Host "  立即启动： schtasks /run /tn $TaskName"
        Write-Host "  查看状态： schtasks /query /tn $TaskName /v /fo list"
        Write-Host "  停止运行： schtasks /end /tn $TaskName"
        Write-Host "  卸载任务： powershell -NoProfile -ExecutionPolicy Bypass -File `"$ScriptPath`" -Uninstall"
        Write-Host ''
    } catch {
        Write-Log "计划任务注册异常：$($_.Exception.Message)" 'ERROR'
        exit 1
    }
}

function Uninstall-AgentTask {
    Write-Host ''
    $answer = Read-Host "确认删除计划任务「$TaskName」？(y/N)"
    if ($answer -notmatch '^[yY]') {
        Write-Log '已取消。'
        return
    }
    try {
        $output = & schtasks.exe /delete /tn $TaskName /f 2>&1
        if ($LASTEXITCODE -ne 0) {
            Write-Log "删除失败（exit $LASTEXITCODE）：$output" 'ERROR'
            exit 1
        }
        Write-Log "计划任务已删除：$TaskName"
        Write-Log '注意：本次已在运行的 Agent 进程不会被终止，可在任务管理器结束 powershell.exe 或重启系统。'
    } catch {
        Write-Log "删除异常：$($_.Exception.Message)" 'ERROR'
        exit 1
    }
}

# ---------------------------------------------------------------------------
# 主流程
# ---------------------------------------------------------------------------

$scriptPath = Get-ScriptPath
$scriptDir = Split-Path -Parent $scriptPath
if ([string]::IsNullOrWhiteSpace($Config)) {
    $configPath = Join-Path $scriptDir 'agent.json'
} else {
    # 相对路径按当前工作目录解析；计划任务的工作目录不确定，建议传绝对路径
    $configPath = $Config
}

if ($Install -and $Uninstall) {
    Write-Log '-Install 与 -Uninstall 不能同时使用。' 'ERROR'
    exit 1
}
if ($Install) { Install-AgentTask -ScriptPath $scriptPath -ConfigPath $configPath; exit 0 }
if ($Uninstall) { Uninstall-AgentTask; exit 0 }

# PS 5.1 在部分系统上默认 TLS 1.0，Cloudflare 只接受 TLS 1.2+
try {
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
} catch {
    Write-Log "设置 TLS 1.2 失败，若上报报 SSL 错误请升级系统 .NET：$($_.Exception.Message)" 'WARN'
}

$cfg = Read-AgentConfig -Path $configPath
$osVer = Get-WindowsVersion
# device_name 只用于日志与上报参考，页面展示名以服务端 devices[].name 为准
$deviceName = $cfg.deviceName
if ([string]::IsNullOrWhiteSpace($deviceName)) { $deviceName = $env:COMPUTERNAME }
if ([string]::IsNullOrWhiteSpace($deviceName)) { $deviceName = 'windows-host' }

Write-Log "似了喵 Agent 启动：device_id=$($cfg.deviceId) device_name=$deviceName os=windows $osVer"
Write-Log "上报地址：$($cfg.url)  间隔：$($cfg.interval)s  挂机阈值：$($cfg.idleThreshold)s"

if ($Once) {
    $sample = Get-Sample
    Write-Log "采样：app=$($sample.app) idle=$($sample.idle)s title=$($sample.title)"
    $ok = Send-Heartbeat -Cfg $cfg -Sample $sample -Os 'windows' -OsVer $osVer -DeviceName $deviceName
    if ($ok) {
        Write-Log '单次上报成功（服务端 204）。'
        exit 0
    }
    Write-Log '单次上报失败，见上面的告警信息。' 'ERROR'
    exit 1
}

# 常驻循环：按「周期起点 + interval」对时，避免请求耗时累积成漂移
$sw = [System.Diagnostics.Stopwatch]::StartNew()
$nextTick = 0.0
$failStreak = 0

while ($true) {
    try {
        $sample = Get-Sample
        $ok = Send-Heartbeat -Cfg $cfg -Sample $sample -Os 'windows' -OsVer $osVer -DeviceName $deviceName

        if ($ok) {
            if ($failStreak -gt 0) {
                Write-Log "上报恢复正常（此前连续失败 $failStreak 次）。"
                $failStreak = 0
            }
            $idleMark = ''
            if ($sample.idle -ge $cfg.idleThreshold) { $idleMark = ' [挂机]' }
            $shown = $sample.title
            if ([string]::IsNullOrEmpty($shown)) { $shown = '(无前台窗口)' }
            Write-Log "OK idle=$($sample.idle)s$idleMark app=$($sample.app) title=$shown"
        } else {
            $failStreak++
            # 失败静默重试，只在头几次和每 20 次提醒一次，避免刷屏
            if ($failStreak -le 3 -or ($failStreak % 20) -eq 0) {
                Write-Log "连续第 $failStreak 次上报失败，下个周期继续重试。" 'WARN'
            }
        }
    } catch {
        # 兜底：采样或上报漏网异常不能打死常驻进程（计划任务无自动重启），记日志下周期继续
        $failStreak++
        Write-Log "采样/上报异常：$($_.Exception.Message)" 'WARN'
    }

    # 对时：下一次触发点 = 上一个触发点 + interval；落后过多时直接对齐到当前时间
    $nextTick += $cfg.interval
    $now = $sw.Elapsed.TotalSeconds
    if ($nextTick -lt $now) { $nextTick = $now }
    $sleepMs = [int](($nextTick - $now) * 1000)
    if ($sleepMs -gt 0) { Start-Sleep -Milliseconds $sleepMs }
}
