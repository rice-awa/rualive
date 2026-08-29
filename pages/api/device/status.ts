import { NextRequest } from 'next/server'
import { workerConfig } from '@/uptime.config'
import { timingSafeEqual } from '@/util/timingSafeEqual'
import { buildDeviceViews, dateInTimeZone } from '@/worker/src/deviceStore'

export const runtime = 'edge'

const headers = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-API-Key',
}

/**
 * 设备状态读取（PRD F7 数据分级）。
 * - 公开：在线/挂机/离线、最后活跃时间、设备名、今日活跃总时长（仅开启统计的设备）
 * - 需密钥：当前活动窗口（app + title），除非设备配置 publicWindow: true
 * - 无 key 与 key 无效表现一致（字段为 null），不做区分防枚举
 * - 在线判定无状态：按 now - last_seen 实时计算，不依赖写库时更新状态
 */
export default async function handler(req: NextRequest): Promise<Response> {
  // OPTIONS 预检（浏览器跨域 fetch 带 X-API-Key 头时需要）
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers })
  }
  if (req.method !== 'GET') {
    return new Response('Method not allowed', { status: 405, headers })
  }

  // 有效 key → 可读窗口字段；无效与无 key 一致
  const expectedKey = process.env.USAGE_API_KEY as string | undefined
  const key = req.headers.get('X-API-Key') ?? ''
  const hasValidKey = !!expectedKey && timingSafeEqual(key, expectedKey)

  const now = Math.round(Date.now() / 1000)
  const timeZone = workerConfig.notification?.timeZone ?? 'Asia/Shanghai'

  const devices = await buildDeviceViews(
    process.env as any,
    workerConfig.devices ?? [],
    now,
    timeZone,
    hasValidKey
  )

  return new Response(
    JSON.stringify({ now, devices }),
    { status: 200, headers }
  )
}
