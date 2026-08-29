import { Env } from '.'
import { DeviceConfig } from '../../types/config'

/**
 * 「似了喵？」设备监控数据层（worker 与 pages 共用）
 * - worker cron 调用：listDeviceStatus / getNotifyState / setNotifyState / cleanupDeviceEvents
 * - pages API 调用：upsertDeviceStatus / appendDeviceEvent / incrementUsageDaily / sumToday / getUsageDaily / getHourlyToday / listDeviceStatus
 * 不要复制到 pages 侧，直接 import 本模块。
 */

export type DeviceStatusRecord = {
  device_id: string
  device_name: string
  os: string | null
  last_seen: number
  last_title: string | null
  last_app: string | null
  last_idle: number
}

export type DeviceEventRecord = {
  device_id: string
  ts: number
  app: string | null
  title: string | null
  idle: number
}

export type UsageDailyRow = {
  device_id: string
  date: string
  app: string
  duration: number
}

/** 心跳 UPSERT device_status */
export async function upsertDeviceStatus(
  env: Env,
  d: {
    device_id: string
    device_name: string
    os: string | null
    last_seen: number
    last_title: string | null
    last_app: string | null
    last_idle: number
  }
): Promise<void> {
  await env.UPTIMEFLARE_D1.prepare(
    `INSERT INTO device_status (device_id, device_name, os, last_seen, last_title, last_app, last_idle)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(device_id) DO UPDATE SET
       device_name = excluded.device_name,
       os = excluded.os,
       last_seen = excluded.last_seen,
       last_title = excluded.last_title,
       last_app = excluded.last_app,
       last_idle = excluded.last_idle`
  )
    .bind(d.device_id, d.device_name, d.os, d.last_seen, d.last_title, d.last_app, d.last_idle)
    .run()
}

/** 追加一条原始采样；INSERT OR IGNORE 防同秒重试冲突（(device_id, ts) 主键） */
export async function appendDeviceEvent(
  env: Env,
  d: { device_id: string; ts: number; app: string | null; title: string | null; idle: number }
): Promise<void> {
  await env.UPTIMEFLARE_D1.prepare(
    `INSERT OR IGNORE INTO device_events (device_id, ts, app, title, idle) VALUES (?, ?, ?, ?, ?)`
  )
    .bind(d.device_id, d.ts, d.app, d.title, d.idle)
    .run()
}

/** 原子累加 usage_daily（当日该 app 时长） */
export async function incrementUsageDaily(
  env: Env,
  deviceId: string,
  date: string,
  app: string,
  seconds: number
): Promise<void> {
  await env.UPTIMEFLARE_D1.prepare(
    `INSERT INTO usage_daily (device_id, date, app, duration) VALUES (?, ?, ?, ?)
     ON CONFLICT(device_id, date, app) DO UPDATE SET duration = duration + excluded.duration`
  )
    .bind(deviceId, date, app, seconds)
    .run()
}

/** 全部设备状态（M3 通知 + 前端 SSR 用） */
export async function listDeviceStatus(env: Env): Promise<DeviceStatusRecord[]> {
  const res = await env.UPTIMEFLARE_D1.prepare(`SELECT * FROM device_status`).all<DeviceStatusRecord>()
  return res.results ?? []
}

/** 今日活跃总时长（秒）；无数据返回 0 */
export async function sumToday(env: Env, deviceId: string, date: string): Promise<number> {
  const res = await env.UPTIMEFLARE_D1.prepare(
    `SELECT SUM(duration) AS total FROM usage_daily WHERE device_id = ? AND date = ?`
  )
    .bind(deviceId, date)
    .first<{ total: number | null }>()
  return res?.total ?? 0
}

/** 从 fromDate（含）起的每日聚合 */
export async function getUsageDaily(
  env: Env,
  deviceId: string,
  fromDate: string
): Promise<UsageDailyRow[]> {
  const res = await env.UPTIMEFLARE_D1.prepare(
    `SELECT device_id, date, app, duration FROM usage_daily
     WHERE device_id = ? AND date >= ? ORDER BY date ASC`
  )
    .bind(deviceId, fromDate)
    .all<UsageDailyRow>()
  return res.results ?? []
}

/** 当日逐小时活跃秒数（从 device_events 按小时桶聚合，仅统计 idle < idleThreshold 的活跃样本） */
export async function getHourlyToday(
  env: Env,
  deviceId: string,
  dayStartTs: number,
  idleThreshold: number,
  intervalSeconds: number
): Promise<{ hour: number; active_seconds: number }[]> {
  const res = await env.UPTIMEFLARE_D1.prepare(
    `SELECT CAST((ts - ?) / 3600 AS INTEGER) AS hour, COUNT(*) * ? AS active_seconds
     FROM device_events
     WHERE device_id = ? AND ts >= ? AND ts < ? AND idle < ?
     GROUP BY hour`
  )
    .bind(dayStartTs, intervalSeconds, deviceId, dayStartTs, dayStartTs + 86400, idleThreshold)
    .all<{ hour: number; active_seconds: number }>()
  return res.results ?? []
}

/** 最近一次通知时的在线状态（-1 离线 / 1 在线）；从未通知过返回 null */
export async function getNotifyState(
  env: Env,
  deviceId: string
): Promise<{ last_online: number } | null> {
  const res = await env.UPTIMEFLARE_D1.prepare(
    `SELECT last_online FROM device_notify_state WHERE device_id = ?`
  )
    .bind(deviceId)
    .first<{ last_online: number }>()
  return res ?? null
}

/** 记录 / 更新最近一次通知时的在线状态 */
export async function setNotifyState(
  env: Env,
  deviceId: string,
  online: boolean
): Promise<void> {
  await env.UPTIMEFLARE_D1.prepare(
    `INSERT INTO device_notify_state (device_id, last_online) VALUES (?, ?)
     ON CONFLICT(device_id) DO UPDATE SET last_online = excluded.last_online`
  )
    .bind(deviceId, online ? 1 : -1)
    .run()
}

/** 清理过期原始采样 */
export async function cleanupDeviceEvents(env: Env, beforeTs: number): Promise<void> {
  await env.UPTIMEFLARE_D1.prepare(`DELETE FROM device_events WHERE ts < ?`).bind(beforeTs).run()
}

/* ================= 设备公开视图（SSR 与 GET /api/device/status 共用） ================= */

/** 前端展示用的设备视图（PRD §7 响应 schema + public_window / has_window 配置与真相标记） */
export type DevicePublicView = {
  device_id: string
  device_name: string
  os: string | null
  online: boolean
  idle: boolean
  last_seen: number | null
  last_title: string | null
  last_app: string | null
  /** 该设备是否存在图形会话窗口（服务端真相；headless 时 title 为空串） */
  has_window: boolean
  usage_tracking: boolean
  public_window: boolean
  today_total_seconds: number | null
}

/**
 * 配置驱动的设备列表 + device_status join，无状态计算在线/挂机/离线。
 * hasValidKey 控制窗口字段（last_title/last_app）是否可见；SSR 侧固定传 false（公开字段只进 props）。
 */
export async function buildDeviceViews(
  env: Env,
  devices: DeviceConfig[],
  now: number,
  timeZone: string,
  hasValidKey: boolean
): Promise<DevicePublicView[]> {
  const statusRows = await listDeviceStatus(env)
  const byId = new Map(statusRows.map((s) => [s.device_id, s]))

  const views: DevicePublicView[] = []
  for (const cfg of devices) {
    const status = byId.get(cfg.id)
    const offlineAfterSeconds = cfg.offlineAfterSeconds ?? 90
    const idleThreshold = cfg.idleThreshold ?? 120
    const usageTracking = cfg.usageTracking ?? false

    const online = !!status && now - status.last_seen <= offlineAfterSeconds
    const idle = online && (status?.last_idle ?? 0) >= idleThreshold
    const windowVisible = !!status && (hasValidKey || cfg.publicWindow === true)
    const today = usageTracking && status ? await sumToday(env, cfg.id, dateInTimeZone(now, timeZone)) : null

    views.push({
      device_id: cfg.id,
      device_name: cfg.name,
      os: cfg.os ?? status?.os ?? null,
      online,
      idle,
      last_seen: status?.last_seen ?? null,
      last_title: windowVisible ? status?.last_title ?? null : null,
      last_app: windowVisible ? status?.last_app ?? null : null,
      has_window: !!status && status.last_title !== null && status.last_title !== '',
      usage_tracking: usageTracking,
      public_window: cfg.publicWindow === true,
      today_total_seconds: today,
    })
  }
  return views
}

/* ================= 时区工具（edge/worker 运行时用 Intl，不要用服务器时区猜） ================= */

const dateFmtCache = new Map<string, Intl.DateTimeFormat>()
function getDateFmt(timeZone: string): Intl.DateTimeFormat {
  let fmt = dateFmtCache.get(timeZone)
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' })
    dateFmtCache.set(timeZone, fmt)
  }
  return fmt
}

/** 返回 ts 在指定时区的 'YYYY-MM-DD' */
export function dateInTimeZone(ts: number, timeZone: string): string {
  return getDateFmt(timeZone).format(new Date(ts * 1000))
}

const offsetFmtCache = new Map<string, Intl.DateTimeFormat>()
/** 取 ts 所在时刻的时区偏移（秒） */
function tzOffsetSeconds(ts: number, timeZone: string): number {
  let fmt = offsetFmtCache.get(timeZone)
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    })
    offsetFmtCache.set(timeZone, fmt)
  }
  const parts = fmt.formatToParts(new Date(ts * 1000))
  const map: Record<string, string> = {}
  for (const p of parts) map[p.type] = p.value
  const asUTC = Date.UTC(+map.year, +map.month - 1, +map.day, +map.hour, +map.minute, +map.second)
  return (asUTC - ts * 1000) / 1000
}

/** ts 所在「本地日」的 0 点时间戳（Unix 秒）。DST 边界由单次校验修正。 */
export function dayStartInTimeZone(ts: number, timeZone: string): number {
  const dateStr = dateInTimeZone(ts, timeZone)
  const [y, m, d] = dateStr.split('-').map(Number)
  const utcMidnight = Date.UTC(y, m - 1, d) / 1000
  const dayStart = utcMidnight - tzOffsetSeconds(utcMidnight, timeZone)
  // DST 修正：偏移在午夜与白天不同时，向正确方向挪一天
  const got = dateInTimeZone(dayStart, timeZone)
  if (got < dateStr) return dayStart + 86400
  if (got > dateStr) return dayStart - 86400
  return dayStart
}
