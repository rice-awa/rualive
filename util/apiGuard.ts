/**
 * API 统一守卫：方法校验、会话/Key 鉴权、安全响应头。
 *
 * WAF 在边缘做“粗筛”（Cookie/Key/Authorization 是否存在），这里做真正的
 * 签名与常量时间比较。所有 /api/* 路由都应通过 withApiGuard 导出。
 */
import type { NextRequest } from 'next/server'
import { timingSafeEqual } from './timingSafeEqual'
import { readSiteSession, verifySiteSession } from './siteSession'

const API_SECURITY_HEADERS: Record<string, string> = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
}

/** 校验 X-API-Key（USAGE_API_KEY）；缺省或错误都返回 false。 */
export function hasValidUsageKey(req: NextRequest): boolean {
  const expected = process.env.USAGE_API_KEY
  const key = req.headers.get('x-api-key') ?? ''
  return !!expected && key.length > 0 && timingSafeEqual(key, expected)
}

/** 校验页面会话 Cookie 的 HMAC 签名。 */
export async function hasValidSiteSession(req: NextRequest): Promise<boolean> {
  const token = readSiteSession(req)
  return !!token && (await verifySiteSession(token))
}

/** 公开读接口：有效会话 或 有效 X-API-Key 任一即可。 */
export async function isAuthorizedRead(req: NextRequest): Promise<boolean> {
  if (hasValidUsageKey(req)) return true
  return hasValidSiteSession(req)
}

type ApiAuth = 'public' | 'session-or-key' | 'key' | 'agent'

type ApiGuardOptions = {
  /** 允许的 HTTP 方法，大小写敏感（Next 传大写）。 */
  methods: string[]
  /** 默认 public。agent 由 handler 自己校验 Bearer token。 */
  auth?: ApiAuth
  /** 默认 no-store；badge 这类公开只读响应可显式放宽。 */
  cacheControl?: string
}

function buildHeaders(cacheControl?: string): Headers {
  const headers = new Headers(API_SECURITY_HEADERS)
  headers.set('Cache-Control', cacheControl ?? 'no-store')
  return headers
}

/**
 * 包装 edge API handler：
 * - 方法不在白名单 → 405 + Allow
 * - 鉴权失败 → 401
 * - 未捕获异常 → 500（不把堆栈返回给客户端）
 * - 统一附加安全头与 Cache-Control
 */
export function withApiGuard(
  handler: (req: NextRequest) => Promise<Response>,
  options: ApiGuardOptions
): (req: NextRequest) => Promise<Response> {
  return async (req: NextRequest): Promise<Response> => {
    const headers = buildHeaders(options.cacheControl)

    if (!options.methods.includes(req.method)) {
      headers.set('Allow', options.methods.join(', '))
      return new Response('Method not allowed', { status: 405, headers })
    }

    try {
      const auth = options.auth ?? 'public'
      if (auth === 'session-or-key' && !(await isAuthorizedRead(req))) {
        return new Response('Unauthorized', { status: 401, headers })
      }
      if (auth === 'key' && !hasValidUsageKey(req)) {
        return new Response('Unauthorized', { status: 401, headers })
      }

      const res = await handler(req)
      // 复制一份再改头，避免 handler 返回的 Response 头不可变。
      const out = new Response(res.body, res)
      headers.forEach((value, name) => out.headers.set(name, value))
      return out
    } catch (err) {
      console.error('[api] unhandled error:', err)
      return new Response('Internal Server Error', { status: 500, headers })
    }
  }
}
