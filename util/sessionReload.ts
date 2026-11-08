/**
 * 会话 Cookie 缺失/过期时的客户端兜底。
 *
 * API 返回 401/403 时，可能是 middleware 还没来得及下发 `uf_site`（例如从
 * `#device` 深链、跨站 iframe、长期打开的标签页）。整页 reload 会重新走
 * middleware 拿 Cookie；用 sessionStorage 节流，避免 WAF 拦截时反复刷新。
 */
const RELOAD_KEY = 'uf_session_reload_at'
const MIN_INTERVAL_MS = 60_000

export function reloadOnceForSession(): void {
  try {
    const last = Number(sessionStorage.getItem(RELOAD_KEY) ?? 0)
    if (Number.isFinite(last) && Date.now() - last < MIN_INTERVAL_MS) return
    sessionStorage.setItem(RELOAD_KEY, String(Date.now()))
    window.location.reload()
  } catch {
    // sessionStorage 不可用（隐私模式等）：宁可停止轮询，也不要造成刷新循环。
  }
}
