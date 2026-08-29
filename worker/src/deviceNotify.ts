import type { Env } from '.'
import { workerConfig } from '../../uptime.config'
import { webhookNotify } from './util'
import { getNotifyState, listDeviceStatus, setNotifyState } from './deviceStore'

/** HH:mm（指定时区，PRD F6 下线文案用） */
function fmtHHmm(ts: number, timeZone: string): string {
  const fmt = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit' })
  return fmt.format(new Date(ts * 1000))
}

/** 时长（分钟/小时+分钟） */
function fmtDur(sec: number): string {
  const m = Math.round(sec / 60)
  if (m < 60) return `${m} 分钟`
  const h = Math.floor(m / 60)
  return `${h} 小时 ${m % 60} 分`
}

/**
 * M3 设备上下线通知（PRD F6）：
 * - Worker cron 每分钟末尾调用；对 workerConfig.devices 逐个做无状态在线判定（与前端一致）
 * - 状态翻转（在线→离线 / 离线→在线）时复用现有 notification.webhook（Resend 邮件）
 * - 翻转状态记录在 device_notify_state，首次运行（prev 为 null）只建立基线不通知，
 *   避免部署时对存量设备全量轰炸
 */
export async function checkDeviceNotifications(env: Env): Promise<void> {
  const devices = workerConfig.devices ?? []
  const webhook = workerConfig.notification?.webhook
  if (!devices.length || !webhook) return

  const timeZone = workerConfig.notification?.timeZone ?? 'Asia/Shanghai'
  const now = Math.round(Date.now() / 1000)
  const rows = await listDeviceStatus(env)
  const byId = new Map(rows.map((s) => [s.device_id, s]))

  for (const cfg of devices) {
    const status = byId.get(cfg.id)
    const offlineAfter = cfg.offlineAfterSeconds ?? 90
    const online = !!status && now - status.last_seen <= offlineAfter

    const prev = await getNotifyState(env, cfg.id)
    if (prev === null) {
      // 首次运行：建立基线，不通知
      await setNotifyState(env, cfg.id, online)
      continue
    }
    const wasOnline = prev.last_online === 1
    if (online === wasOnline) continue

    const msg = online
      ? `「${cfg.name}」活着喵！（离线时长 ${fmtDur(status ? now - status.last_seen : 0)}）`
      : `「${cfg.name}」似了喵…（最后活跃 ${status ? fmtHHmm(status.last_seen, timeZone) : '—'}）`
    console.log(`[devices] ${cfg.id}: ${online ? 'up' : 'down'} transition, notifying`)
    await webhookNotify(env, webhook, msg)
    await setNotifyState(env, cfg.id, online)
  }
}
