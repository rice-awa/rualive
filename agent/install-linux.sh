#!/usr/bin/env bash
# -*- coding: utf-8 -*-
# 似了喵？—— Linux (KDE Plasma / Wayland) Agent 一键安装脚本
#
# 用途：自动检测环境 → 安装 kdotool → 检查 python3/requests/qdbus → 部署
#       agent.py 与配置 → 安装并启用 systemd user 服务 → 跑一次 --once --dry-run 验证。
#
# 用法：
#   bash install-linux.sh [选项]
#
# 选项：
#   --kdotool-tarball PATH   指定本地 kdotool 压缩包（默认自动找 ~/Downloads 里最新的
#                            kdotool-*.tar.gz；都没有才走 GitHub 下载）
#   --endpoint URL           直接指定状态页地址（跳过交互）
#   --token TOKEN            直接指定 AGENT_TOKEN（跳过交互）
#   --device-id ID           直接指定 device_id（跳过交互）
#   --yes                    全程不交互：缺少配置项时直接报错退出，不询问
#   --no-kdotool             跳过 kdotool 安装（只上报心跳，无窗口信息）
#   -h, --help               显示帮助
#
# 也支持环境变量 UPTIMEFLARE_ENDPOINT / UPTIMEFLARE_TOKEN / UPTIMEFLARE_DEVICE_ID。
#
# 设计原则：重复执行安全（幂等）。已存在的 agent.json 与已启用的服务不会被动；
# 只会补齐缺失的 kdotool / agent.py / unit，并按需重启服务让新配置生效。
#
# 安装位置：
#   kdotool        ~/.local/bin/kdotool
#   agent.py       ~/.local/share/uptimeflare-agent/agent.py
#   agent.json     ~/.local/share/uptimeflare-agent/agent.json
#   systemd unit   ~/.config/systemd/user/uptimeflare-agent.service

set -euo pipefail

# 需要联网下载 kdotool 时锁定的版本（2026-04-03 release，同时支持 Plasma 5 与 6）。
# 若以后有新版，直接改这里即可；也欢迎顺手更新 agent/README.md 里的说明。
KDOTOOL_VERSION="v0.2.3"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AGENT_SRC="$SCRIPT_DIR/agent.py"
UNIT_SRC="$SCRIPT_DIR/systemd/uptimeflare-agent.service"

AGENT_DIR="$HOME/.local/share/uptimeflare-agent"
BIN_DIR="$HOME/.local/bin"
UNIT_DIR="$HOME/.config/systemd/user"
UNIT_FILE="$UNIT_DIR/uptimeflare-agent.service"
CONFIG_FILE="$AGENT_DIR/agent.json"

# ---- 命令行参数 ----
KDOTOOL_TARBALL=""
ARG_ENDPOINT="${UPTIMEFLARE_ENDPOINT:-}"
ARG_TOKEN="${UPTIMEFLARE_TOKEN:-}"
ARG_DEVICE_ID="${UPTIMEFLARE_DEVICE_ID:-}"
ASSUME_YES=0
SKIP_KDOTOOL=0

usage() {
  sed -n '3,30p' "$0" | sed 's/^# \{0,1\}//'
}

while [ $# -gt 0 ]; do
  case "$1" in
    --kdotool-tarball) KDOTOOL_TARBALL="${2:?--kdotool-tarball 需要参数}"; shift 2 ;;
    --endpoint) ARG_ENDPOINT="${2:?--endpoint 需要参数}"; shift 2 ;;
    --token) ARG_TOKEN="${2:?--token 需要参数}"; shift 2 ;;
    --device-id) ARG_DEVICE_ID="${2:?--device-id 需要参数}"; shift 2 ;;
    --yes) ASSUME_YES=1; shift ;;
    --no-kdotool) SKIP_KDOTOOL=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) printf '未知参数：%s\n' "$1"; usage; exit 1 ;;
  esac
done

# ---- 输出辅助（全部中文，与项目一致） ----
info() { printf '\033[1;32m[安装]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[警告]\033[0m %s\n' "$*"; }
err()  { printf '\033[1;31m[错误]\033[0m %s\n' "$*" >&2; }

has_cmd() { command -v "$1" >/dev/null 2>&1; }

# ---- 环境检测 ----

detect_arch() {
  case "$(uname -m)" in
    x86_64) echo "x86_64" ;;
    aarch64|arm64) echo "aarch64" ;;
    *) echo "unsupported" ;;
  esac
}

# 读 /etc/os-release 得到发行版族（ubuntu/debian、arch、fedora、opensuse、…），用于安装提示
distro_family() {
  local id="" id_like=""
  # shellcheck disable=SC1091
  [ -r /etc/os-release ] && . /etc/os-release
  id="${ID:-}"; id_like="${ID_LIKE:-}"
  for key in "$id_like" "$id"; do
    case "$key" in
      ubuntu|debian|linuxmint) echo "apt"; return ;;
      arch|manjaro)            echo "pacman"; return ;;
      fedora|rhel|centos)      echo "dnf"; return ;;
      opensuse*)               echo "zypper"; return ;;
    esac
  done
  echo "unknown"
}

detect_env() {
  # 图形会话：Wayland 或 X11 有一个就算
  if [ -n "${WAYLAND_DISPLAY:-}" ] || [ -n "${DISPLAY:-}" ]; then
    info "检测到图形会话（${XDG_SESSION_TYPE:-?} / ${XDG_CURRENT_DESKTOP:-?}）"
  else
    warn "未检测到 DISPLAY / WAYLAND_DISPLAY，Agent 将按 headless 运行：只有心跳、无窗口信息。"
    warn "  若想采集窗口，请在图形会话的终端里运行本脚本，而不是通过 SSH / 无头终端。"
  fi

  # KDE 专属：kdotool 依赖 KWin scripting，非 KDE 桌面拿不到前台窗口
  case "${XDG_CURRENT_DESKTOP:-}" in
    *KDE*)
      local kde_ver="${KDE_SESSION_VERSION:-}"
      info "KDE Plasma${kde_ver:+ ${kde_ver}} 环境，kdotool 可用。"
      ;;
    *)
      warn "当前桌面不是 KDE（XDG_CURRENT_DESKTOP=${XDG_CURRENT_DESKTOP:-空}）。"
      warn "  kdotool 依赖 KWin scripting API，非 KDE 下无法读取前台窗口；心跳仍可正常上报。"
      ;;
  esac
}

# ---- 依赖检查 ----

check_python() {
  if ! has_cmd python3; then
    err "找不到 python3。请先安装（Debian/Ubuntu：sudo apt install python3）。"
    exit 1
  fi
  info "python3：$(command -v python3)（$(python3 --version 2>&1 | cut -d' ' -f2)）"
}

check_requests() {
  if python3 -c 'import requests' >/dev/null 2>&1; then
    return 0
  fi
  local fam; fam="$(distro_family)"
  warn "缺少 Python 的 requests 库，Agent 将无法上报。请安装："
  case "$fam" in
    apt)     warn "  sudo apt install python3-requests" ;;
    pacman)  warn "  sudo pacman -S python-requests" ;;
    dnf)     warn "  sudo dnf install python3-requests" ;;
    *)       warn "  pip install requests   （或系统包管理器对应的 python3-requests）" ;;
  esac
}

check_qdbus() {
  for c in qdbus6 qdbus-qt6 qdbus qdbus-qt5; do
    if has_cmd "$c"; then
      info "qdbus：$c（$(command -v "$c")）"
      return 0
    fi
  done
  local fam; fam="$(distro_family)"
  warn "未找到 qdbus，输入空闲时间将恒为 0（挂机统计不准，窗口采集不受影响）。"
  case "$fam" in
    apt)     warn "  可安装：sudo apt install qt6-tools-dev-tools   # 提供 qdbus6" ;;
    pacman)  warn "  可安装：sudo pacman -S qt6-tools" ;;
    *)       warn "  可安装对应发行版 Qt6 工具包（提供 qdbus6 / qdbus）" ;;
  esac
}

# ---- kdotool 安装 ----

install_from_tarball() {
  local tarball="$1"
  info "从本地压缩包安装 kdotool：$tarball"
  local tmp; tmp="$(mktemp -d)"
  tar -xzf "$tarball" -C "$tmp"
  if [ ! -f "$tmp/kdotool" ]; then
    rm -rf "$tmp"
    err "压缩包内未找到 kdotool 可执行文件：$tarball"
    return 1
  fi
  install -m 0755 "$tmp/kdotool" "$BIN_DIR/kdotool"
  rm -rf "$tmp"
  info "kdotool 已安装：$BIN_DIR/kdotool"
}

download_kdotool() {
  local arch; arch="$(detect_arch)"
  if [ "$arch" = "unsupported" ]; then
    warn "架构 $(uname -m) 没有官方 release 二进制，请改用源码安装：cargo install kdotool"
    return 1
  fi
  if ! has_cmd curl && ! has_cmd wget; then
    err "下载 kdotool 需要 curl 或 wget，请先安装，或用 --kdotool-tarball 指定本地包。"
    return 1
  fi
  local url="https://github.com/jinliu/kdotool/releases/download/${KDOTOOL_VERSION}/kdotool-${KDOTOOL_VERSION#v}-${arch}-unknown-linux-gnu.tar.gz"
  info "从 GitHub 下载 kdotool ${KDOTOOL_VERSION}（${url}）…"
  local tmp; tmp="$(mktemp -d)"
  if has_cmd curl; then
    curl -fL --retry 3 -o "$tmp/kdotool.tar.gz" "$url" || { rm -rf "$tmp"; return 1; }
  else
    wget -q -O "$tmp/kdotool.tar.gz" "$url" || { rm -rf "$tmp"; return 1; }
  fi
  tar -xzf "$tmp/kdotool.tar.gz" -C "$tmp"
  install -m 0755 "$tmp/kdotool" "$BIN_DIR/kdotool"
  rm -rf "$tmp"
  info "kdotool 已安装：$BIN_DIR/kdotool"
}

install_kdotool() {
  if has_cmd kdotool; then
    info "kdotool 已在 PATH：$(command -v kdotool)"
    return 0
  fi
  # 已装到 ~/.local/bin 但当前 shell PATH 里没有（脚本内用显式路径调用）
  if [ -x "$BIN_DIR/kdotool" ]; then
    info "kdotool 已安装：$BIN_DIR/kdotool"
    return 0
  fi

  mkdir -p "$BIN_DIR"
  local tarball="$KDOTOOL_TARBALL"
  if [ -z "$tarball" ]; then
    # 自动找 ~/Downloads 下最新的 kdotool-*.tar.gz（按文件名版本排序，取最新）
    tarball="$(find "$HOME/Downloads" -maxdepth 1 -name 'kdotool-*.tar.gz' 2>/dev/null | sort -V | tail -1 || true)"
  fi
  if [ -n "$tarball" ] && [ -f "$tarball" ]; then
    install_from_tarball "$tarball" || true
  else
    download_kdotool || true
  fi

  # 装完验证一下能不能跑；不行就提醒，但不阻断（Agent 会自行退化为 headless）
  if [ -x "$BIN_DIR/kdotool" ] && "$BIN_DIR/kdotool" --version >/dev/null 2>&1; then
    info "kdotool 可执行文件可用。"
  else
    warn "kdotool 安装后执行失败（可能缺依赖），Agent 将退化为 headless：只有心跳、无窗口信息。"
  fi
}

# ---- 部署 agent.py 与配置 ----

deploy_files() {
  mkdir -p "$AGENT_DIR"
  if [ -f "$AGENT_SRC" ]; then
    install -m 0644 "$AGENT_SRC" "$AGENT_DIR/agent.py"
    info "已部署 agent.py → $AGENT_DIR/agent.py"
  elif [ -f "$AGENT_DIR/agent.py" ]; then
    info "本目录没有 agent.py，沿用已部署副本：$AGENT_DIR/agent.py"
  else
    err "找不到 $AGENT_SRC，也没有已部署的 $AGENT_DIR/agent.py。"
    err "请把 install-linux.sh 放在 agent/ 目录（与 agent.py 同级）后重新运行。"
    exit 1
  fi
  install -m 0644 "$SCRIPT_DIR/agent.json.example" "$AGENT_DIR/agent.json.example" 2>/dev/null || true
}

# JSON 值转义（用 python3 保证与 agent.py 的 json 解析一致）
json_escape() {
  python3 -c 'import json,sys; print(json.dumps(sys.argv[1], ensure_ascii=False))' "$1"
}

# 生成 agent.json（含与 agent.json.example 一致的 _comment_* 注释字段）
write_config() {
  local endpoint="$1" token="$2" device_id="$3" device_name="$4"
  cat > "$CONFIG_FILE" <<EOF
{
  "_comment_endpoint": "状态页站点根地址，不要带 /api，尾部斜杠可有可无",
  "endpoint": $(json_escape "$endpoint"),
  "_comment_token": "服务端 Pages 环境变量 AGENT_TOKEN 的值，必须完全一致；请勿提交到 git",
  "token": $(json_escape "$token"),
  "_comment_device_id": "必须与服务端 uptime.config.ts 中 devices[].id 完全一致，否则服务端返回 400",
  "device_id": $(json_escape "$device_id"),
  "_comment_device_name": "可选，仅用于本地日志展示；页面展示名以服务端 devices[].name 为准",
  "device_name": $(json_escape "$device_name"),
  "_comment_interval": "上报间隔（秒），允许 15-120，默认 30",
  "interval": 30,
  "_comment_idle_threshold": "挂机判定阈值（秒），默认 120",
  "idle_threshold": 120
}
EOF
  chmod 600 "$CONFIG_FILE"
}

prompt() { # prompt <提示文本> <默认值> → 输出用户输入（含默认）
  local text="$1" default="$2" ans
  if [ -n "$default" ]; then
    printf '  %s [%s] > ' "$text" "$default"
  else
    printf '  %s > ' "$text"
  fi
  IFS= read -r ans || ans=""
  if [ -z "$ans" ]; then ans="$default"; fi
  printf '%s' "$ans"
}

ensure_config() {
  if [ -f "$CONFIG_FILE" ]; then
    info "已存在配置，复用：$CONFIG_FILE（要改就编辑这个文件后重启服务）"
    return 0
  fi

  local endpoint="$ARG_ENDPOINT" token="$ARG_TOKEN" device_id="$ARG_DEVICE_ID"
  local device_name="$(hostname)"

  # 交互式询问缺失项
  if [ "$ASSUME_YES" -ne 1 ]; then
    printf '\033[1;34m填写 agent.json（服务端信息）\033[0m\n'
    printf '  提示：endpoint 是状态页根地址（不要带 /api）；token 是服务端 AGENT_TOKEN 的值；\n'
    printf '  device_id 必须与 uptime.config.ts 里 devices[].id 完全一致，否则服务端返回 400。\n'
    [ -n "$endpoint" ] || endpoint="$(prompt '状态页地址 (endpoint)' '')"
    [ -n "$token" ] || token="$(prompt 'AGENT_TOKEN' '')"
    [ -n "$device_id" ] || device_id="$(prompt 'device_id' "$(hostname)")"
    device_name="$(prompt 'device_name（可选，默认同 device_id）' "$device_id")"
  fi

  if [ -z "$endpoint" ] || [ -z "$token" ] || [ -z "$device_id" ]; then
    err "缺少配置项：endpoint / token / device_id 都必须提供（可用 --endpoint/--token/--device-id 指定）。"
    exit 1
  fi
  if [[ "$endpoint" != http://* && "$endpoint" != https://* ]]; then
    err "endpoint 必须以 http:// 或 https:// 开头，当前值：$endpoint"
    exit 1
  fi
  if [[ "$token" == *'<'* || "$token" == *'你的'* ]]; then
    err "token 看起来仍是示例占位符，请填真实值。"
    exit 1
  fi

  write_config "$endpoint" "$token" "$device_id" "$device_name"
  info "已生成配置：$CONFIG_FILE（权限 600）"
}

# ---- systemd user 服务 ----

install_unit() {
  if ! systemctl --user show-environment >/dev/null 2>&1; then
    warn "systemd user 服务不可用（非 systemd 环境？）。跳过服务安装，改为前台运行："
    warn "  cd $AGENT_DIR && python3 agent.py"
    return 1
  fi
  if [ ! -f "$UNIT_SRC" ]; then
    err "找不到 unit 模板：$UNIT_SRC（install-linux.sh 应与 systemd/ 目录同级）。"
    exit 1
  fi

  mkdir -p "$UNIT_DIR"
  cp "$UNIT_SRC" "$UNIT_FILE"
  # python3 路径可能不是 /usr/bin/python3，按实际路径修正 ExecStart
  local py; py="$(command -v python3)"
  if [ "$py" != "/usr/bin/python3" ]; then
    sed -i "s#/usr/bin/python3#$py#" "$UNIT_FILE"
    info "unit ExecStart 的 python3 已修正为 $py"
  fi
  chmod 644 "$UNIT_FILE"

  systemctl --user daemon-reload
  systemctl --user enable uptimeflare-agent >/dev/null 2>&1 || true
  systemctl --user restart uptimeflare-agent
  if [ "$(systemctl --user is-active uptimeflare-agent)" = "active" ]; then
    info "服务已运行：uptimeflare-agent（systemd --user）"
  else
    warn "服务启动失败，看日志：journalctl --user -u uptimeflare-agent -e"
  fi
}

# ---- 验证 ----

verify() {
  info "验证窗口采集（--once --dry-run，只采集不上报）…"
  cd "$AGENT_DIR"
  python3 agent.py --once --dry-run 2>&1 || true
}

# ---- 主流程 ----

main() {
  info "似了喵 Linux Agent 一键安装开始"
  info "仓库脚本目录：$SCRIPT_DIR"

  detect_env
  check_python
  check_requests
  check_qdbus

  if [ "$SKIP_KDOTOOL" -eq 0 ]; then
    install_kdotool
  else
    warn "已跳过 kdotool 安装（--no-kdotool）：只有心跳，无窗口信息。"
  fi

  deploy_files
  ensure_config
  install_unit || true
  verify

  printf '\n\033[1;32m安装完成。\033[0m\n'
  printf '  服务状态： systemctl --user status uptimeflare-agent\n'
  printf '  实时日志： journalctl --user -u uptimeflare-agent -f\n'
  printf '  立即上报： cd %s && python3 agent.py --once\n' "$AGENT_DIR"
  printf '  停用服务： systemctl --user disable --now uptimeflare-agent\n'
}

main "$@"
