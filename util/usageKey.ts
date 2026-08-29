/**
 * USAGE_API_KEY 的浏览器端缓存（PRD F7）。
 * 存储位置：localStorage 键名 `uf_usage_key`，跨会话持久——输入一次，之后访问自动解锁。
 * 所有 /api/device/* 请求统一从这里取 key 附加 X-API-Key 头。
 */
const LS_KEY = 'uf_usage_key'

export function getUsageKey(): string | null {
  try {
    return localStorage.getItem(LS_KEY)
  } catch {
    return null
  }
}

export function hasUsageKey(): boolean {
  return !!getUsageKey()
}

/** 解锁成功后落盘（仅当 key 已被服务端验证有效，见 DeviceUnlockModal） */
export function setUsageKey(key: string): void {
  try {
    localStorage.setItem(LS_KEY, key)
  } catch {
    // 隐私模式等场景写入失败时静默，仅在本次会话有效
  }
}

/** 「锁定」按钮 / 收到 401（密钥轮换后失效）时清除缓存 */
export function clearUsageKey(): void {
  try {
    localStorage.removeItem(LS_KEY)
  } catch {
    // ignore
  }
}

/** 带 X-API-Key 的 fetch 封装（本地有 key 就自动附带） */
export function fetchWithUsageKey(url: string, init?: RequestInit): Promise<Response> {
  const key = getUsageKey()
  const headers = new Headers(init?.headers)
  if (key) headers.set('X-API-Key', key)
  return fetch(url, { ...init, headers })
}
