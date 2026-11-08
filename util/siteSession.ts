/**
 * 页面会话 Cookie（WAF 只校验存在性，真正的签名校验在这里）。
 *
 * - Cookie `uf_site` = `v1.<exp>.<base64url(HMAC-SHA256(secret, "v1.<exp>"))>`
 * - 由 middleware 在浏览器文档导航时下发；同源 API 请求自动携带
 * - secret 复用已有的 Pages secret，避免无远端 state 下新增 secret_text 被覆盖
 *
 * edge / Node 运行时通用：只用 Web Crypto，不依赖 Buffer。
 */
import type { NextRequest } from 'next/server'

export const SITE_SESSION_COOKIE = 'uf_site'
export const SITE_SESSION_TTL_SECONDS = 7 * 24 * 60 * 60
const SITE_SESSION_VERSION = 'v1'
const DEV_SECRET = 'rualive-dev-session-secret'

const encoder = new TextEncoder()

function getSessionSecret(): string {
  const explicit = process.env.SITE_SESSION_SECRET
  if (explicit) return explicit

  const agent = process.env.AGENT_TOKEN
  const usage = process.env.USAGE_API_KEY
  if (agent && usage) return `${agent}:${usage}`

  // 本地 `npm run dev` 没有 Cloudflare 绑定；生产环境缺 secret 时 fail closed。
  if (process.env.NODE_ENV !== 'production') return DEV_SECRET
  console.error('[siteSession] no session secret available; refusing to issue/verify sessions')
  return ''
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64Url(value: string): Uint8Array | null {
  try {
    const normalized = value.replace(/-/g, '+').replace(/_/g, '/')
    const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4)
    const binary = atob(padded)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    return bytes
  } catch {
    return null
  }
}

async function importHmacKey(secret: string, usages: KeyUsage[]): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    usages
  )
}

/** 生成新会话 token；没有可用 secret 时返回空串，调用方应跳过下发。 */
export async function createSiteSession(
  nowSeconds: number = Math.floor(Date.now() / 1000)
): Promise<string> {
  const secret = getSessionSecret()
  if (!secret) return ''

  const payload = `${SITE_SESSION_VERSION}.${nowSeconds + SITE_SESSION_TTL_SECONDS}`
  const key = await importHmacKey(secret, ['sign'])
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(payload))
  return `${payload}.${toBase64Url(new Uint8Array(signature))}`
}

/** 校验 token 的版本、过期时间与 HMAC 签名。 */
export async function verifySiteSession(
  token: string,
  nowSeconds: number = Math.floor(Date.now() / 1000)
): Promise<boolean> {
  const secret = getSessionSecret()
  if (!secret) return false

  const parts = token.split('.')
  if (parts.length !== 3 || parts[0] !== SITE_SESSION_VERSION) return false

  const exp = Number(parts[1])
  if (!Number.isFinite(exp) || exp <= nowSeconds) return false

  const signature = fromBase64Url(parts[2])
  if (!signature) return false

  const key = await importHmacKey(secret, ['verify'])
  return crypto.subtle.verify(
    'HMAC',
    key,
    signature,
    encoder.encode(`${SITE_SESSION_VERSION}.${parts[1]}`)
  )
}

/** 是否已过保鲜期（剩余不足一半）；解析失败也返回 true，方便调用方续期。 */
export function shouldRefreshSiteSession(
  token: string,
  nowSeconds: number = Math.floor(Date.now() / 1000)
): boolean {
  const parts = token.split('.')
  if (parts.length !== 3 || parts[0] !== SITE_SESSION_VERSION) return true
  const exp = Number(parts[1])
  if (!Number.isFinite(exp)) return true
  return exp - nowSeconds < SITE_SESSION_TTL_SECONDS / 2
}

/** 从 NextRequest 读取会话 token（无 Cookie 时返回 null）。 */
export function readSiteSession(req: NextRequest): string | null {
  return req.cookies.get(SITE_SESSION_COOKIE)?.value ?? null
}

/**
 * 只对“像浏览器文档导航”的请求下发 Cookie，裸 curl 直接打 / 不会拿到会话。
 * iframe 导航也会带 Accept: text/html，因此 embed 场景仍能拿到。
 */
export function isBrowserNavigation(req: NextRequest): boolean {
  // Next.js 客户端路由会请求 /_next/data/...；同源导航也顺手把会话续上。
  if (req.nextUrl.pathname.startsWith('/_next/data/')) {
    return req.headers.get('sec-fetch-site') === 'same-origin'
  }
  if (req.headers.get('sec-fetch-dest') === 'document') return true
  return (req.headers.get('accept') ?? '').includes('text/html')
}

/**
 * 完整 Set-Cookie 属性。生产环境用 `SameSite=None; Secure; Partitioned`
 * 以支持第三方 iframe；开发环境 localhost 是 HTTP，只能用 Lax。
 * 直接拼字符串是因为 Next 14 的 ResponseCookies 类型不一定有 Partitioned。
 */
export function siteSessionCookie(token: string): string {
  const attrs = [
    `${SITE_SESSION_COOKIE}=${token}`,
    'Path=/',
    `Max-Age=${SITE_SESSION_TTL_SECONDS}`,
    'HttpOnly',
  ]
  if (process.env.NODE_ENV === 'production') {
    attrs.push('Secure', 'SameSite=None', 'Partitioned')
  } else {
    attrs.push('SameSite=Lax')
  }
  return attrs.join('; ')
}
