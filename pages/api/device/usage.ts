import { NextRequest } from 'next/server'
import { workerConfig } from '@/uptime.config'
import { timingSafeEqual } from '@/util/timingSafeEqual'
import {
  dateInTimeZone,
  dayStartInTimeZone,
  getHourlyToday,
  getUsageDaily,
} from '@/worker/src/deviceStore'

export const runtime = 'edge'

const headers = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-API-Key',
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/**
 * 使用统计读取（PRD F4 / §7.4）。
 * - 仅 X-API-Key 可访问：无 key 或 key 无效一律 401（与 status 接口的字段分级不同，此处用于解锁弹窗验证）
 * - 仅配置内 device_id 可查；设备未开启 usageTracking 时返回空聚合
 * - ?days=N&date=YYYY-MM-DD：daily 从 date-days+1 到 date；hourly_today 为 date 当日逐小时（PRD schema 只有 active_seconds 合计，不做 per-app 拆分）
 */
export default async function handler(req: NextRequest): Promise<Response> {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers })
  }
  if (req.method !== 'GET') {
    return new Response('Method not allowed', { status: 405, headers })
  }

  const expectedKey = process.env.USAGE_API_KEY as string | undefined
  const key = req.headers.get('X-API-Key') ?? ''
  if (!expectedKey || !key || !timingSafeEqual(key, expectedKey)) {
    return new Response('Unauthorized', { status: 401, headers })
  }

  const params = req.nextUrl.searchParams
  const deviceId = params.get('device_id') ?? ''
  const deviceConfig = (workerConfig.devices ?? []).find((d) => d.id === deviceId)
  if (!deviceConfig) {
    return new Response('Unknown device', { status: 404, headers })
  }

  const timeZone = workerConfig.notification?.timeZone ?? 'Asia/Shanghai'
  const now = Math.round(Date.now() / 1000)

  let days = parseInt(params.get('days') ?? '7', 10)
  if (!Number.isFinite(days)) days = 7
  days = Math.min(Math.max(days, 1), 30)

  let date = params.get('date') ?? ''
  if (!DATE_RE.test(date)) date = dateInTimeZone(now, timeZone)

  // 聚合区间 [fromDate, date]
  const from = new Date(`${date}T00:00:00Z`)
  from.setUTCDate(from.getUTCDate() - (days - 1))
  const fromDate = from.toISOString().slice(0, 10)

  // 每日聚合：一次 SQL 拉区间内全部行，JS 归并成 PRD schema（行数少，无性能问题）
  const rows = await getUsageDaily(process.env as any, deviceId, fromDate)
  const byDate = new Map<string, { total_seconds: number; by_app: Record<string, number> }>()
  for (const r of rows) {
    if (r.date > date) continue
    let acc = byDate.get(r.date)
    if (!acc) {
      acc = { total_seconds: 0, by_app: {} }
      byDate.set(r.date, acc)
    }
    acc.total_seconds += r.duration
    acc.by_app[r.app] = (acc.by_app[r.app] ?? 0) + r.duration
  }
  const daily = Array.from(byDate.entries())
    .map(([d, agg]) => ({ date: d, ...agg }))
    .sort((a, b) => (a.date < b.date ? -1 : 1))

  // 当日逐小时（从 device_events 按活跃样本聚合）
  const usageTracking = deviceConfig.usageTracking ?? false
  let hourlyToday: { hour: number; active_seconds: number }[] = []
  if (usageTracking) {
    const dayStart = dayStartInTimeZone(now, timeZone)
    hourlyToday = await getHourlyToday(
      process.env as any,
      deviceId,
      dayStart,
      deviceConfig.idleThreshold ?? 120,
      deviceConfig.intervalSeconds ?? 30
    )
  }

  return new Response(JSON.stringify({ daily, hourly_today: hourlyToday }), {
    status: 200,
    headers,
  })
}
