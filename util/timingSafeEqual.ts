/**
 * 常量时间字符串比较（沿用 middleware.ts 的 timing-safe 写法）。
 * 供 pages/api/heartbeat（AGENT_TOKEN）与 pages/api/device/*（USAGE_API_KEY）共用。
 */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  }
  return diff === 0
}
