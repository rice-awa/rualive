import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { workerConfig } from './uptime.config'
import {
  createSiteSession,
  isBrowserNavigation,
  readSiteSession,
  shouldRefreshSiteSession,
  siteSessionCookie,
  verifySiteSession,
} from './util/siteSession'

/** 允许嵌入状态页的父页面（同源 + rice-awa.top 子域）；需要更多来源时改这里。 */
const FRAME_ANCESTORS = "'self' https://*.rice-awa.top"

function contentSecurityPolicy(): string {
  const scriptSrc =
    process.env.NODE_ENV === 'production'
      ? "'self' 'unsafe-inline'"
      : // next dev 使用 eval，生产构建不需要
        "'self' 'unsafe-inline' 'unsafe-eval'"

  return [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    `frame-ancestors ${FRAME_ANCESTORS}`,
    `script-src ${scriptSrc}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "form-action 'self'",
    'upgrade-insecure-requests',
  ].join('; ')
}

/**
 * 页面响应的安全头。
 * 注意：Cloudflare Pages 的 public/_headers 不作用于 Functions/SSR 响应，
 * 所以 SSR 页面必须在这里加；静态资源由 public/_headers 覆盖。
 */
function applySecurityHeaders(res: NextResponse): void {
  res.headers.set('Content-Security-Policy', contentSecurityPolicy())
  res.headers.set('X-Content-Type-Options', 'nosniff')
  res.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin')
  res.headers.set(
    'Permissions-Policy',
    'camera=(), microphone=(), geolocation=(), payment=(), usb=()'
  )
  res.headers.set('Cross-Origin-Opener-Policy', 'same-origin-allow-popups')
  if (process.env.NODE_ENV === 'production') {
    res.headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains')
  }
}

let warnedAboutConfigPassword = false

function getPasswordProtection(): string | undefined {
  // 优先运行时 secret；workerConfig.passwordProtection 会编译进前端 bundle，
  // 仅作为上游兼容回退保留，启用时会在构建日志里留下警告。
  if (process.env.BASIC_AUTH) return process.env.BASIC_AUTH
  if (workerConfig.passwordProtection && !warnedAboutConfigPassword) {
    warnedAboutConfigPassword = true
    console.warn(
      '[middleware] passwordProtection in uptime.config.ts is bundled into the client. ' +
        'Prefer the BASIC_AUTH Pages secret instead.'
    )
  }
  return workerConfig.passwordProtection
}

export async function middleware(request: NextRequest) {
  const passwordProtection = getPasswordProtection()
  if (passwordProtection) {
    const authHeader = request.headers.get('Authorization')
    const expected = 'Basic ' + btoa(passwordProtection)

    let authenticated = false
    if (authHeader && authHeader.length === expected.length) {
      authenticated = true
      for (let i = 0; i < authHeader.length; i++) {
        if (authHeader[i] !== expected[i]) authenticated = false
      }
    }

    if (!authenticated) {
      const res = NextResponse.json(
        { code: 401, message: 'Not authenticated' },
        { status: 401, headers: { 'WWW-Authenticate': 'Basic' } }
      )
      applySecurityHeaders(res)
      return res
    }
  }

  const res = NextResponse.next()
  applySecurityHeaders(res)

  // 只给浏览器文档导航下发/续期；API 路由被 matcher 排除，不会走到这里。
  if (isBrowserNavigation(request)) {
    const token = readSiteSession(request)
    const needsSession =
      !token || !(await verifySiteSession(token)) || shouldRefreshSiteSession(token)
    if (needsSession) {
      const fresh = await createSiteSession()
      if (fresh) res.headers.append('Set-Cookie', siteSessionCookie(fresh))
    }
  }

  return res
}

/**
 * 排除 API、Next 静态资源与带扩展名的文件；页面路由才需要会话 Cookie 与安全头。
 * API 的鉴权/安全头由 util/apiGuard.ts 负责。
 */
export const config = {
  matcher: ['/((?!api/|_next/static|_next/image|favicon.ico|.*\\..*).*)'],
}
