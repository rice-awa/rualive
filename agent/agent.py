#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
似了喵？—— Linux (KDE Plasma / Wayland) 设备心跳上报 Agent

每 interval 秒采集一次「前台窗口标题 / 应用标识 / 输入空闲秒数」，
POST 到服务端 /api/heartbeat。

依赖：
  - Python 3.8+
  - requests        pip install requests  或  apt install python3-requests
  - kdotool         可选，取前台窗口；缺失时退化为 headless 模式（只上报心跳）
  - qdbus / qdbus6  可选，取空闲秒数；缺失时 idle 恒为 0

核心设计原则：**采集或上报失败绝不退出进程**。单次出错只记日志，
下个周期照常重试；只有「配置文件缺失/损坏」这类无法自愈的错误才退出。

用法：
  python3 agent.py                  # 读同目录 agent.json，持续运行
  python3 agent.py --once           # 只跑一个周期（联调用）
  python3 agent.py --dry-run        # 只采集不上报（联调用）
  python3 agent.py --config /path/to/agent.json
"""

from __future__ import annotations

import argparse
import json
import os
import platform
import re
import shutil
import signal
import subprocess
import sys
import time
from typing import Dict, Optional, Tuple

# requests 是唯一的第三方依赖，缺失时给出中文安装指引
try:
    import requests
except ImportError:  # pragma: no cover
    sys.stderr.write(
        '[致命] 缺少 requests 库。请先安装：\n'
        '  pip install requests\n'
        '或使用系统包管理器：\n'
        '  sudo apt install python3-requests   # Debian / Ubuntu\n'
        '  sudo pacman -S python-requests      # Arch\n'
        '  sudo dnf install python3-requests   # Fedora\n'
    )
    sys.exit(1)


# ---------------------------------------------------------------------------
# 常量
# ---------------------------------------------------------------------------

DEFAULT_INTERVAL = 30
INTERVAL_MIN = 15
INTERVAL_MAX = 120
DEFAULT_IDLE_THRESHOLD = 120

# 服务端字段上限（pages/api/heartbeat.ts），本地先截断以免白跑一趟网络
MAX_TITLE = 200
MAX_APP = 64

# idle 采信区间（PRD 风险 3）：低于 IDLE_MIN 或无法解析视为未知；
# 达到/超过 IDLE_MAX 收敛到 IDLE_MAX（与服务端 Math.min(86400, …) 一致），而不是归零
IDLE_MIN = 0
IDLE_MAX = 86400

# _parse_idle_seconds 的三种解析状态
IDLE_STATUS_OK = 'ok'
IDLE_STATUS_CLAMPED = 'clamped'
IDLE_STATUS_INVALID = 'invalid'

# 单次子进程调用超时（秒）。kdotool 要经 D-Bus 往返 KWin，给足余量
SUBPROCESS_TIMEOUT = 5
HTTP_TIMEOUT = 10

# 连续多少次 idle 异常值后打警告
IDLE_ANOMALY_WARN_AT = 5
# 连续多少次 idle 恒为 0 后提示「空闲检测可能不可用」（仅提示一次）
IDLE_STUCK_ZERO_WARN_AT = 20

# qdbus 在各发行版 / Qt 版本下的可执行名，按优先级探测
QDBUS_CANDIDATES = ('qdbus6', 'qdbus-qt6', 'qdbus', 'qdbus-qt5')

# 空闲检测模式
IDLE_MODE_SESSION = 'session_idle'  # GetSessionIdleTime 可用，拿到真实空闲秒数
IDLE_MODE_LOCK = 'lock_state'       # 退化：只能靠锁屏状态判断离开
IDLE_MODE_NONE = 'none'             # 完全不可用，idle 恒为 0

KDOTOOL_INSTALL_HINT = (
    '  kdotool 安装指引： https://github.com/jinliu/kdotool\n'
    '  注意版本：v0.2.x 同时支持 Plasma 5 与 6（2026-04 的 v0.2.3 即当前最新）；\n'
    '  未来的 v0.3.0+ 将只支持 Plasma 6。\n'
    '  安装后确认 `kdotool --version` 与 `kdotool getactivewindow` 可正常输出。'
)

# kdotool 的窗口 id 是 KWin 内部 id，形如 {xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx}；
# X11 / 旧版本可能是十六进制或纯数字，这里放宽到「花括号可选的十六进制/连字符串」
_WINDOW_ID_RE = re.compile(r'^\{?[0-9a-fA-F][0-9a-fA-F-]{3,63}\}?$')


# ---------------------------------------------------------------------------
# 日志
# ---------------------------------------------------------------------------

def log(level: str, message: str) -> None:
    """带时间戳输出到 stdout/stderr（不写文件，交给 systemd journal 收集）。"""
    stamp = time.strftime('%Y-%m-%d %H:%M:%S', time.localtime())
    stream = sys.stderr if level in ('ERROR', '致命') else sys.stdout
    stream.write('[{0}] [{1}] {2}\n'.format(stamp, level, message))
    stream.flush()  # systemd 下必须 flush，否则日志会卡在缓冲区


def log_info(message: str) -> None:
    log('INFO', message)


def log_warn(message: str) -> None:
    log('WARN', message)


def log_error(message: str) -> None:
    log('ERROR', message)


# ---------------------------------------------------------------------------
# 配置读取
# ---------------------------------------------------------------------------

class Config:
    """agent.json 的解析结果。校验失败一律抛 ValueError（附中文原因）。"""

    def __init__(self, raw: Dict, source: str):
        self.source = source

        self.endpoint = self._require_str(raw, 'endpoint').rstrip('/')
        if not self.endpoint.startswith(('http://', 'https://')):
            raise ValueError(
                'endpoint 必须以 http:// 或 https:// 开头，当前值：{0}'.format(self.endpoint)
            )

        self.token = self._require_str(raw, 'token')
        if self.token.startswith('<') or '你的' in self.token:
            raise ValueError(
                'token 看起来仍是示例占位符，请填入真实的 AGENT_TOKEN（当前值：{0}）'.format(self.token)
            )

        self.device_id = self._require_str(raw, 'device_id')
        # device_name 仅作日志展示；服务端以 uptime.config.ts 的 devices[].name 为准
        self.device_name = str(raw.get('device_name') or self.device_id).strip()

        self.interval = self._parse_interval(raw.get('interval'))
        self.idle_threshold = self._parse_idle_threshold(raw.get('idle_threshold'))

    @staticmethod
    def _require_str(raw: Dict, key: str) -> str:
        value = raw.get(key)
        if not isinstance(value, str) or not value.strip():
            raise ValueError('缺少必填字段 "{0}"（必须是非空字符串）'.format(key))
        return value.strip()

    @staticmethod
    def _parse_interval(value) -> int:
        if value is None:
            return DEFAULT_INTERVAL
        if not isinstance(value, (int, float)) or isinstance(value, bool):
            raise ValueError('interval 必须是数字（秒），当前值：{0!r}'.format(value))
        interval = int(value)
        if interval < INTERVAL_MIN or interval > INTERVAL_MAX:
            clamped = max(INTERVAL_MIN, min(INTERVAL_MAX, interval))
            log_warn(
                'interval={0} 超出允许范围 {1}-{2}，已自动收敛为 {3}'.format(
                    interval, INTERVAL_MIN, INTERVAL_MAX, clamped
                )
            )
            return clamped
        return interval

    @staticmethod
    def _parse_idle_threshold(value) -> int:
        if value is None:
            return DEFAULT_IDLE_THRESHOLD
        if not isinstance(value, (int, float)) or isinstance(value, bool) or value <= 0:
            raise ValueError('idle_threshold 必须是正数（秒），当前值：{0!r}'.format(value))
        return int(value)

    @property
    def heartbeat_url(self) -> str:
        # endpoint 已在构造时去掉尾部斜杠，这里拼接不会出现双斜杠
        return self.endpoint + '/api/heartbeat'


def default_config_path() -> str:
    """默认配置路径：与本脚本同目录的 agent.json。"""
    return os.path.join(os.path.dirname(os.path.abspath(__file__)), 'agent.json')


def load_config(path: str) -> Config:
    """读取并校验配置。任何问题都以中文报错 + 退出码 1 结束（无法自愈）。"""
    if not os.path.isfile(path):
        log_error('找不到配置文件：{0}'.format(path))
        log_error('请复制示例配置并按注释填写：')
        log_error('  cp {0}.example {0}'.format(path))
        sys.exit(1)

    try:
        with open(path, 'r', encoding='utf-8') as handle:
            raw = json.load(handle)
    except json.JSONDecodeError as exc:
        log_error('配置文件不是合法 JSON：{0}'.format(path))
        log_error('  解析错误：第 {0} 行第 {1} 列 —— {2}'.format(exc.lineno, exc.colno, exc.msg))
        log_error('  提示：JSON 不支持注释和尾随逗号，字符串必须用双引号。')
        sys.exit(1)
    except OSError as exc:
        log_error('无法读取配置文件 {0}：{1}'.format(path, exc))
        sys.exit(1)

    if not isinstance(raw, dict):
        log_error('配置文件顶层必须是 JSON 对象（{{...}}），实际是 {0}'.format(type(raw).__name__))
        sys.exit(1)

    try:
        return Config(raw, path)
    except ValueError as exc:
        log_error('配置文件校验失败（{0}）：{1}'.format(path, exc))
        sys.exit(1)


# ---------------------------------------------------------------------------
# 环境探测
# ---------------------------------------------------------------------------

def run_command(argv) -> Tuple[bool, str, str]:
    """
    执行子进程，返回 (成功, stdout, stderr)。

    任何异常（超时 / 找不到可执行文件 / 权限）都收敛为 (False, '', 原因)，
    调用方不需要 try —— 这是本 Agent「采集失败不崩」的基础。
    """
    try:
        proc = subprocess.run(
            argv,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=SUBPROCESS_TIMEOUT,
        )
    except subprocess.TimeoutExpired:
        return False, '', '子进程超时（>{0}s）：{1}'.format(SUBPROCESS_TIMEOUT, ' '.join(argv))
    except (OSError, ValueError) as exc:
        return False, '', '子进程启动失败：{0}（{1}）'.format(' '.join(argv), exc)

    stdout = proc.stdout.decode('utf-8', errors='replace').strip()
    stderr = proc.stderr.decode('utf-8', errors='replace').strip()
    return proc.returncode == 0, stdout, stderr


def has_graphical_session() -> bool:
    """
    是否处于图形会话。

    SSH 登录、无 DISPLAY/WAYLAND_DISPLAY 的 systemd 环境都会判为 headless，
    此时跳过全部 kdotool / qdbus 调用，只上报心跳。
    """
    return bool(
        os.environ.get('WAYLAND_DISPLAY', '').strip()
        or os.environ.get('DISPLAY', '').strip()
    )


def detect_os_version() -> str:
    """
    组装 os_ver，例如 "KDE Plasma 6 · Wayland"。

    只读环境变量，不额外起子进程（plasmashell --version 又慢又容易输出噪声）。
    """
    desktop = os.environ.get('XDG_CURRENT_DESKTOP', '').strip()
    session = os.environ.get('XDG_SESSION_TYPE', '').strip()
    kde_version = os.environ.get('KDE_SESSION_VERSION', '').strip()

    parts = []
    if desktop:
        if kde_version and 'KDE' in desktop.upper():
            parts.append('KDE Plasma {0}'.format(kde_version))
        else:
            # XDG_CURRENT_DESKTOP 可能是 "KDE:GNOME" 这种冒号分隔列表，取第一段
            parts.append(desktop.split(':')[0])
    if session:
        parts.append(session.capitalize())
    if not parts:
        # headless 兜底：用内核版本，至少能在页面上区分设备
        parts.append('Linux {0}'.format(platform.release() or 'headless'))
    return ' · '.join(parts)[:48]


def probe_kdotool() -> Optional[str]:
    """
    探测 kdotool 可用性，返回可执行路径；不可用返回 None。

    探测失败**不退出**，仅打印明确报错与安装指引，由调用方退化为 headless 模式。
    """
    path = shutil.which('kdotool')
    if not path:
        log_error('未找到 kdotool，无法读取前台窗口，将退化为 headless 模式（title/app 上报空串）。')
        log_error(KDOTOOL_INSTALL_HINT)
        return None

    ok, stdout, stderr = run_command([path, '--version'])
    if not ok:
        log_error('kdotool 存在（{0}）但 `--version` 执行失败，将退化为 headless 模式。'.format(path))
        log_error('  错误输出：{0}'.format(stderr or stdout or '（无输出）'))
        log_error(KDOTOOL_INSTALL_HINT)
        return None

    # kdotool --version 会输出整段 usage 帮助文本，只取第一行版本号，避免刷屏
    version_line = stdout.splitlines()[0].strip() if stdout else '版本未知'
    log_info('kdotool 可用：{0}（{1}）'.format(version_line, path))
    return path


def probe_qdbus() -> Tuple[Optional[str], str]:
    """
    探测 qdbus 与空闲检测能力，返回 (qdbus 路径, 空闲检测模式)。

    分三档降级：
      1. GetSessionIdleTime 可用           -> IDLE_MODE_SESSION，拿真实空闲秒数
      2. 接口存在但返回 NotSupported       -> IDLE_MODE_LOCK，退化为锁屏状态判断
      3. 找不到 qdbus / 完全不可用          -> IDLE_MODE_NONE，idle 恒为 0
    """
    path = None
    for name in QDBUS_CANDIDATES:
        found = shutil.which(name)
        if found:
            path = found
            break

    if not path:
        log_warn(
            '未找到 qdbus（尝试过：{0}），无法检测输入空闲时间，idle 将恒为 0。'.format(
                ', '.join(QDBUS_CANDIDATES)
            )
        )
        log_warn('  可安装：sudo apt install qt6-tools-dev-tools（Debian/Ubuntu）或 qt6-tools（Arch）')
        return None, IDLE_MODE_NONE

    ok, stdout, stderr = run_command(
        [path, 'org.freedesktop.ScreenSaver', '/ScreenSaver', 'GetSessionIdleTime']
    )
    if ok and _parse_idle_seconds(stdout)[1] != IDLE_STATUS_INVALID:
        log_info('空闲检测可用：{0} GetSessionIdleTime（{1}）'.format(os.path.basename(path), path))
        return path, IDLE_MODE_SESSION

    detail = stderr or stdout or '（无输出）'
    log_warn('GetSessionIdleTime 不可用：{0}'.format(detail.replace('\n', ' ')))
    log_warn(
        '  这是 Plasma 6 Wayland 的已知情况（KWin 未实现该接口）。'
        '将退化为「锁屏状态」判断：锁屏视为离开，未锁屏视为在用。'
    )
    log_warn('  影响：无法精确统计挂机时长，屏幕使用统计会把「未锁屏但没操作」也算作活跃。')
    return path, IDLE_MODE_LOCK


# ---------------------------------------------------------------------------
# 采集：前台窗口
# ---------------------------------------------------------------------------

class WindowSampler:
    """
    通过 kdotool 采集前台窗口标题与应用标识。

    每周期 3 次子进程调用（PRD §5 结论）：
      kdotool getactivewindow        -> 窗口 id
      kdotool getwindowname <id>     -> 标题
      kdotool getwindowclassname <id>-> 应用标识（resourceClass）
    """

    def __init__(self, kdotool_path: Optional[str]):
        self.kdotool_path = kdotool_path
        self._logged_no_window = False

    @property
    def available(self) -> bool:
        return self.kdotool_path is not None

    def sample(self) -> Tuple[str, str]:
        """返回 (title, app)。任何失败都返回 ('', '')，绝不抛异常。"""
        if not self.available:
            return '', ''

        window_id = self._get_active_window()
        if not window_id:
            return '', ''

        title = self._get_string('getwindowname', window_id, MAX_TITLE)
        app = self._get_string('getwindowclassname', window_id, MAX_APP)
        return title, app

    def _get_active_window(self) -> Optional[str]:
        """取当前活动窗口 id。无活动窗口（如桌面获焦、锁屏）时返回 None。"""
        ok, stdout, stderr = run_command([self.kdotool_path, 'getactivewindow'])
        if not ok or not stdout:
            # 没有活动窗口是常态（锁屏 / 切到桌面），只在状态变化时记一次日志避免刷屏
            if not self._logged_no_window:
                detail = (stderr or stdout or '（无输出）').replace('\n', ' ')
                log_warn('kdotool getactivewindow 无结果，本周期按无窗口处理：{0}'.format(detail))
                self._logged_no_window = True
            return None

        # kdotool 可能夹带 debug 行，取最后一行非空输出作为 id
        candidate = stdout.splitlines()[-1].strip()
        if not _WINDOW_ID_RE.match(candidate):
            if not self._logged_no_window:
                log_warn('无法解析 kdotool 返回的窗口 id：{0!r}，本周期按无窗口处理'.format(candidate))
                self._logged_no_window = True
            return None

        self._logged_no_window = False
        return candidate

    def _get_string(self, command: str, window_id: str, limit: int) -> str:
        """执行取值类命令并做清洗/截断；失败返回空串。"""
        ok, stdout, stderr = run_command([self.kdotool_path, command, window_id])
        if not ok:
            log_warn(
                'kdotool {0} 执行失败：{1}'.format(
                    command, (stderr or '（无输出）').replace('\n', ' ')
                )
            )
            return ''
        # 标题可能含换行，压成单行后截断（服务端也会截断，这里省流量）
        return ' '.join(stdout.split())[:limit]


# ---------------------------------------------------------------------------
# 采集：空闲时间
# ---------------------------------------------------------------------------

def _parse_idle_seconds(text: str) -> Tuple[Optional[int], str]:
    """
    解析 qdbus 输出的空闲秒数，返回 (秒数, 状态)。

    状态三分（PRD 风险 3）：
      IDLE_STATUS_OK      0 <= v < 86400，原值可信
      IDLE_STATUS_CLAMPED v >= 86400，收敛到 86400 —— **不是异常**：机器真的挂机
                          超过 24h 时这是合法值，服务端同样按 Math.min(86400, …) 存。
                          绝不能归零：归零等于上报「idle=0 正在使用」，会让服务端
                          （heartbeat.ts 用原始 idle 判 `idle < idleThreshold`）把长时间
                          挂机误计为活跃，把使用时长统计抬高。
      IDLE_STATUS_INVALID 无法解析或为负数，秒数为 None（真正的未知，交由调用方按 0 上报）

    注意：freedesktop 规范约定 GetSessionIdleTime 的单位是**秒**，本函数按秒解读，
    不做静默的单位换算猜测。若某实现返回毫秒，值会长期贴着 86400 上限，
    由调用方的 clamp 计数器告警提示。
    """
    if not text:
        return None, IDLE_STATUS_INVALID
    candidate = text.splitlines()[-1].strip()
    try:
        value = int(float(candidate))
    except (TypeError, ValueError):
        return None, IDLE_STATUS_INVALID
    if value < IDLE_MIN:
        return None, IDLE_STATUS_INVALID
    if value >= IDLE_MAX:
        return IDLE_MAX, IDLE_STATUS_CLAMPED
    return value, IDLE_STATUS_OK


class IdleSampler:
    """
    采集输入空闲秒数，并对异常值做防御性校验（PRD 风险 3）。

    连续异常值只记日志，不中断上报；恒为 0 时额外提示一次「空闲检测可能不可用」。
    """

    def __init__(self, qdbus_path: Optional[str], mode: str, idle_threshold: int):
        self.qdbus_path = qdbus_path
        self.mode = mode
        self.idle_threshold = idle_threshold
        self._anomaly_streak = 0
        self._clamped_streak = 0
        self._zero_streak = 0
        self._warned_stuck_zero = False

    def sample(self) -> int:
        """返回空闲秒数；不可用或异常时返回 0（服务端会按 idle_threshold 判活跃）。"""
        if self.mode == IDLE_MODE_SESSION:
            idle = self._sample_session_idle()
        elif self.mode == IDLE_MODE_LOCK:
            idle = self._sample_lock_state()
        else:
            return 0

        self._track_stuck_zero(idle)
        return idle

    def _sample_session_idle(self) -> int:
        ok, stdout, stderr = run_command(
            [self.qdbus_path, 'org.freedesktop.ScreenSaver', '/ScreenSaver', 'GetSessionIdleTime']
        )
        raw = stdout if ok else ''
        idle, status = _parse_idle_seconds(raw)
        if status == IDLE_STATUS_INVALID:
            self._anomaly_streak += 1
            if self._anomaly_streak == IDLE_ANOMALY_WARN_AT:
                detail = (stderr or stdout or '（无输出）').replace('\n', ' ')
                log_warn(
                    '空闲检测已连续 {0} 次返回无法解析的值，期间 idle 按 0 上报。'
                    '最后一次输出：{1}'.format(IDLE_ANOMALY_WARN_AT, detail)
                )
            elif self._anomaly_streak > IDLE_ANOMALY_WARN_AT and \
                    self._anomaly_streak % (IDLE_ANOMALY_WARN_AT * 10) == 0:
                # 长期异常时降频提醒，避免刷满 journal
                log_warn('空闲检测仍持续异常（已 {0} 次），idle 按 0 上报。'.format(self._anomaly_streak))
            return 0

        if status == IDLE_STATUS_CLAMPED:
            self._note_clamped(raw)

        if self._anomaly_streak >= IDLE_ANOMALY_WARN_AT:
            log_info('空闲检测已恢复正常（idle={0}s）。'.format(idle))
        self._anomaly_streak = 0
        return idle

    def _note_clamped(self, raw: str) -> None:
        """
        idle 超过 24h 上限：合法（真挂机）或单位不对（毫秒当秒）两种可能都提示一次。

        无论哪种都按 IDLE_MAX 上报 —— 不归零，避免把挂机误报成「正在使用」。
        """
        self._clamped_streak += 1
        if self._clamped_streak == 1 or self._clamped_streak % 120 == 0:
            log_warn(
                'idle 原始值 {0} 已达/超过 {1}s 上限，按 {1}s 上报（与服务端一致）。'
                '若设备确实挂机超过 24 小时，这是正常的；若此间在使用设备，'
                '说明空闲检测的单位可能不是秒（如返回毫秒）。'.format(
                    raw.replace('\n', ' ').strip() or '（空）', IDLE_MAX
                )
            )

    def _sample_lock_state(self) -> int:
        """
        退化模式：GetSessionIdleTime 不可用时，用锁屏状态近似「离开」。

        锁屏 -> 至少 idle_threshold + 1，确保服务端一定判为挂机；若 GetActiveTime 能给出
                更长的真实锁屏时长则用它（保留量级）。
        未锁屏 -> 返回 0（无从得知真实空闲，按在用处理）。

        为什么锁屏时要兜底到 idle_threshold + 1 而不能直接用 GetActiveTime：
        GetActiveTime 是「锁屏已持续多久」，刚锁上时它很小（比如 60），
        而服务端判活跃用的是 `idle < idleThreshold`（heartbeat.ts:108）——
        直接上报 60 会让「刚锁屏的这一两分钟」被记成正在使用。锁屏是我们**确知**
        用户已离开的信号，所以下限必须越过阈值，不能被锁屏时长的绝对值拉回来。
        """
        ok, stdout, _ = run_command(
            [self.qdbus_path, 'org.freedesktop.ScreenSaver', '/ScreenSaver', 'GetActive']
        )
        if not ok or stdout.strip().lower() != 'true':
            return 0

        # 已锁屏：取「阈值下限」与「真实锁屏时长」的较大者（>24h 会在解析时收敛到上限）
        floor = self.idle_threshold + 1
        ok_time, stdout_time, _ = run_command(
            [self.qdbus_path, 'org.freedesktop.ScreenSaver', '/ScreenSaver', 'GetActiveTime']
        )
        active_time, status = _parse_idle_seconds(stdout_time) if ok_time else (None, IDLE_STATUS_INVALID)
        if status == IDLE_STATUS_INVALID or not active_time:
            return floor
        return max(active_time, floor)

    def _track_stuck_zero(self, idle: int) -> None:
        """恒 0 检测：明显在用却一直 0，说明空闲检测可能失效，提示一次即可。"""
        if idle == 0:
            self._zero_streak += 1
            if self._zero_streak >= IDLE_STUCK_ZERO_WARN_AT and not self._warned_stuck_zero:
                log_warn(
                    'idle 已连续 {0} 个周期为 0。若此间确实在使用设备，说明空闲检测很可能不可用，'
                    '挂机判定将失效（心跳与窗口上报不受影响）。'.format(self._zero_streak)
                )
                self._warned_stuck_zero = True
        else:
            self._zero_streak = 0
            self._warned_stuck_zero = False


# ---------------------------------------------------------------------------
# 上报
# ---------------------------------------------------------------------------

class Reporter:
    """POST 心跳到服务端。所有失败都只记日志，静默跳过本周期。"""

    def __init__(self, config: Config, os_version: str):
        self.config = config
        self.os_version = os_version
        self.session = requests.Session()
        self.session.headers.update({
            'Authorization': 'Bearer ' + config.token,
            'Content-Type': 'application/json',
            'User-Agent': 'uptimeflare-agent-linux/1.0',
        })
        self._consecutive_failures = 0

    def build_payload(self, title: str, app: str, idle: int) -> Dict:
        """按服务端契约组装请求体（title/app 必须是字符串，headless 时为空串）。"""
        return {
            'device_id': self.config.device_id,
            'device_name': self.config.device_name,
            'os': 'linux',
            'os_ver': self.os_version,
            'title': title,
            'app': app,
            'idle': idle,
            'client_time': int(time.time()),
        }

    def send(self, payload: Dict) -> bool:
        try:
            response = self.session.post(
                self.config.heartbeat_url,
                data=json.dumps(payload, ensure_ascii=False).encode('utf-8'),
                timeout=HTTP_TIMEOUT,
            )
        except requests.RequestException as exc:
            self._consecutive_failures += 1
            log_warn(
                '上报失败（网络错误，第 {0} 次连续失败，下个周期重试）：{1}'.format(
                    self._consecutive_failures, exc
                )
            )
            return False

        if response.status_code == 204:
            if self._consecutive_failures:
                log_info('上报已恢复正常（此前连续失败 {0} 次）。'.format(self._consecutive_failures))
            self._consecutive_failures = 0
            return True

        self._consecutive_failures += 1
        self._log_bad_response(response)
        return False

    def _log_bad_response(self, response) -> None:
        """非 204 一律 warning（含响应体），并针对常见错误给出排查方向。"""
        body = (response.text or '').strip().replace('\n', ' ')[:200]
        log_warn('上报返回非 204：HTTP {0} {1}'.format(response.status_code, body or '（空响应体）'))

        if response.status_code == 401:
            log_warn('  401 表示 token 不匹配：请核对 agent.json 的 token 与服务端 AGENT_TOKEN。')
        elif response.status_code == 400:
            log_warn(
                '  400 常见原因：device_id "{0}" 不在服务端 uptime.config.ts 的 devices[] 中，'
                '或请求体超过 4KB。'.format(self.config.device_id)
            )
        elif response.status_code == 404:
            log_warn('  404 表示接口路径不对：请检查 endpoint 是否指向站点根地址（不要带 /api）。')


# ---------------------------------------------------------------------------
# 主循环
# ---------------------------------------------------------------------------

class ShutdownFlag:
    """把 SIGTERM/SIGINT 收敛成一个标志位，让主循环能干净退出（systemd stop 用）。"""

    def __init__(self):
        self.triggered = False
        for sig in (signal.SIGTERM, signal.SIGINT):
            try:
                signal.signal(sig, self._handle)
            except (OSError, ValueError):  # pragma: no cover - 非主线程等极端情况
                pass

    def _handle(self, signum, _frame) -> None:
        self.triggered = True
        log_info('收到信号 {0}，准备退出…'.format(signum))

    def sleep_until(self, deadline: float) -> None:
        """分片睡眠到 deadline，收到信号时立刻返回。"""
        while not self.triggered:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                return
            time.sleep(min(remaining, 0.5))


def run_cycle(
    window_sampler: WindowSampler,
    idle_sampler: IdleSampler,
    reporter: Reporter,
    graphical: bool,
    dry_run: bool,
) -> None:
    """跑一个采集 + 上报周期。内部已吞掉所有可恢复异常。"""
    if graphical and window_sampler.available:
        title, app = window_sampler.sample()
        idle = idle_sampler.sample()
    else:
        # headless（或 kdotool 不可用）：只上报心跳，title/app 为空串
        title, app = '', ''
        idle = idle_sampler.sample() if graphical else 0
        log_warn('headless 模式：本周期只上报心跳，title/app 为空串。')

    payload = reporter.build_payload(title, app, idle)

    if dry_run:
        log_info('[dry-run] 不上报，请求体：{0}'.format(json.dumps(payload, ensure_ascii=False)))
        return

    if reporter.send(payload):
        log_info(
            '上报成功 idle={0}s app={1!r} title={2!r}'.format(
                idle, app or '(空)', title or '(空)'
            )
        )


def parse_args(argv=None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        prog='agent.py',
        description='似了喵？—— Linux (KDE Plasma / Wayland) 设备心跳上报 Agent',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=(
            '示例：\n'
            '  python3 agent.py                   持续运行（读同目录 agent.json）\n'
            '  python3 agent.py --once            只跑一个周期，用于联调\n'
            '  python3 agent.py --once --dry-run  只采集不上报，检查采集是否正常\n'
            '  python3 agent.py -c /etc/uptimeflare/agent.json\n'
        ),
    )
    parser.add_argument(
        '-c', '--config',
        default=default_config_path(),
        help='配置文件路径（默认：与脚本同目录的 agent.json）',
    )
    parser.add_argument('--once', action='store_true', help='只执行一个采集/上报周期后退出')
    parser.add_argument('--dry-run', action='store_true', help='只采集并打印请求体，不实际上报')
    return parser.parse_args(argv)


def main(argv=None) -> int:
    args = parse_args(argv)

    log_info('似了喵 Agent (Linux) 启动中…')
    config = load_config(args.config)

    os_version = detect_os_version()
    graphical = has_graphical_session()

    log_info('配置文件：{0}'.format(config.source))
    log_info(
        '设备：{0}（{1}）  周期：{2}s  挂机阈值：{3}s'.format(
            config.device_name, config.device_id, config.interval, config.idle_threshold
        )
    )
    log_info('上报地址：{0}'.format(config.heartbeat_url))
    log_info('会话环境：{0}（{1}）'.format(os_version, '图形会话' if graphical else 'headless'))

    # 环境探测：全部失败都不退出，只降级
    if graphical:
        kdotool_path = probe_kdotool()
        qdbus_path, idle_mode = probe_qdbus()
    else:
        log_warn('未检测到 WAYLAND_DISPLAY / DISPLAY，按 headless 运行：只上报心跳，跳过窗口与空闲采集。')
        kdotool_path, qdbus_path, idle_mode = None, None, IDLE_MODE_NONE

    window_sampler = WindowSampler(kdotool_path)
    idle_sampler = IdleSampler(qdbus_path, idle_mode, config.idle_threshold)
    reporter = Reporter(config, os_version)

    shutdown = ShutdownFlag()

    if args.once:
        run_cycle(window_sampler, idle_sampler, reporter, graphical, args.dry_run)
        return 0

    log_info('进入主循环（Ctrl-C 或 SIGTERM 退出）。')
    while not shutdown.triggered:
        cycle_start = time.monotonic()
        try:
            run_cycle(window_sampler, idle_sampler, reporter, graphical, args.dry_run)
        except Exception as exc:  # noqa: BLE001 - 兜底：任何漏网异常都不能让守护进程退出
            log_error('本周期出现未预期异常（已跳过，下个周期继续）：{0!r}'.format(exc))
        shutdown.sleep_until(cycle_start + config.interval)

    log_info('已退出。')
    return 0


if __name__ == '__main__':
    sys.exit(main())
