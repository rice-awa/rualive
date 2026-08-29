import { NextRequest } from 'next/server'
import { workerConfig } from '@/uptime.config'
import { timingSafeEqual } from '@/util/timingSafeEqual'
import {
  appendDeviceEvent,
  dateInTimeZone,
  incrementUsageDaily,
  upsertDeviceStatus,
} from '@/worker/src/deviceStore'

export const runtime = 'edge'

/** 请求体上限 4KB（PRD §8）；字段截断上限 */
const MAX_BODY = 4096
const MAX_TITLE = 200
const MAX_APP = 64
const MAX_OS = 64

/**
 * Agent 心跳上报（PRD F1）。
 * - 鉴权：Authorization: Bearer <AGENT_TOKEN>，常量时间比较，失败一律 401
 * - device_id / title / app 字段必须存在（headless 设备的 title/app 可为空串）
 * - 服务端一律使用自己的时间戳，不信任 client_time
 * - usageTracking 设备：追加 device_events 采样；idle < idleThreshold 时原子累加 usage_daily
 * - 不回 CORS 头（非浏览器调用方）
 */
export default async function handler(req: NextRequest): Promise<Response> {
  const token = process.env.AGENT_TOKEN as string | undefined
  if (!token) {
    console.error('[heartbeat] AGENT_TOKEN not configured on Pages env')
    return new Response('Unauthorized', { status: 401 })
  }
  const auth = req.headers.get('Authorization') ?? ''
  if (!timingSafeEqual(auth, 'Bearer ' + token)) {
    return new Response('Unauthorized', { status: 401 })
  }

  // 请求体大小限制：content-length 预检 + 实际读取后复检
  const contentLength = Number(req.headers.get('content-length') ?? 0)
  if (contentLength > MAX_BODY) {
    return new Response('Request body too large', { status: 400 })
  }
  let raw: string
  try {
    raw = await req.text()
  } catch {
    return new Response('Bad request', { status: 400 })
  }
  if (raw.length > MAX_BODY) {
    return new Response('Request body too large', { status: 400 })
  }

  let body: any
  try {
    body = JSON.parse(raw)
  } catch {
    return new Response('Invalid JSON', { status: 400 })
  }

  const deviceId = typeof body.device_id === 'string' ? body.device_id.trim() : ''
  const title = typeof body.title === 'string' ? body.title.trim().slice(0, MAX_TITLE) : null
  const app = typeof body.app === 'string' ? body.app.trim().slice(0, MAX_APP) : null
  if (!deviceId || title === null || app === null) {
    return new Response('Missing device_id / title / app', { status: 400 })
  }
  const idle = typeof body.idle === 'number' && Number.isFinite(body.idle) ? body.idle : 0
  const osVer = typeof body.os_ver === 'string' ? body.os_ver.trim() : ''
  const os = [typeof body.os === 'string' ? body.os.trim() : '', osVer]
    .filter(Boolean)
    .join(' ')
    .slice(0, MAX_OS) || null

  // 只接受配置过的设备（device_id 与 uptime.config.ts devices 一致）
  const deviceConfig = workerConfig.devices?.find((d) => d.id === deviceId)
  if (!deviceConfig) {
    console.error(`[heartbeat] Unknown device_id "${deviceId}", not in workerConfig.devices`)
    return new Response('Unknown device', { status: 400 })
  }

  const now = Math.round(Date.now() / 1000)

  await upsertDeviceStatus(process.env as any, {
    device_id: deviceId,
    device_name: deviceConfig.name,
    os,
    last_seen: now,
    last_title: title,
    last_app: app,
    last_idle: Math.max(0, Math.min(86400, Math.round(idle))),
  })

  // 使用统计写入（M2，由 usageTracking 配置开关决定；M1 阶段默认全关）
  if (deviceConfig.usageTracking) {
    const idleThreshold = deviceConfig.idleThreshold ?? 120
    const intervalSeconds = deviceConfig.intervalSeconds ?? 30
    const timeZone = workerConfig.notification?.timeZone ?? 'Asia/Shanghai'

    // 原始采样（所有心跳都记，聚合时按 idle 过滤活跃样本）
    await appendDeviceEvent(process.env as any, {
      device_id: deviceId,
      ts: now,
      app,
      title,
      idle: Math.round(idle),
    })

    // 活跃样本计入当日该 app 时长（原子累加）
    if (idle < idleThreshold) {
      const date = dateInTimeZone(now, timeZone)
      await incrementUsageDaily(process.env as any, deviceId, date, app || 'unknown', intervalSeconds)
    }
  }

  return new Response(null, { status: 204 })
}
