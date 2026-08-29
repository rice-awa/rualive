import i18n from '@/util/i18n'
import { DevicePublicView } from '@/worker/src/deviceStore'

/** 设备三态 */
export type DeviceState = 'online' | 'idle' | 'offline'

/** 无状态判定当前状态：离线 → 在线挂机 → 在线活跃（与服务端判定一致） */
export function deviceStateOf(d: Pick<DevicePublicView, 'online' | 'idle'>, now: number): DeviceState {
  if (!d.online) return 'offline'
  return d.idle ? 'idle' : 'online'
}

export function stateText(state: DeviceState): string {
  switch (state) {
    case 'online':
      return i18n.t('device.state.online')
    case 'idle':
      return i18n.t('device.state.idle')
    default:
      return i18n.t('device.state.offline')
  }
}

/** 相对时间（原型 fmtRel）：刚刚 / X 秒前 / X 分钟前 / X 小时前 */
export function fmtRel(now: number, ts: number | null): string {
  if (ts == null) return '—'
  const dsec = now - ts
  if (dsec < 15) return i18n.t('device.justNow')
  if (dsec < 60) return i18n.t('device.secondsAgo', { n: dsec })
  if (dsec < 3600) return i18n.t('device.minutesAgo', { n: Math.floor(dsec / 60) })
  return i18n.t('device.hoursAgo', { n: Math.floor(dsec / 3600) })
}

/** 时长（原型 fmtDur）：X 秒 / X 分 / X 小时 Y 分 */
export function fmtDur(seconds: number | null): string {
  if (seconds == null) return '—'
  const s = Math.round(seconds)
  if (s < 60) return i18n.t('device.duration.seconds', { n: s })
  const m = Math.floor(s / 60)
  if (m < 60) return i18n.t('device.duration.minutes', { n: m })
  const h = Math.floor(m / 60)
  const rest = m % 60
  return rest === 0
    ? i18n.t('device.duration.hours', { n: h })
    : i18n.t('device.duration.hoursMinutes', { n: h, m: rest })
}

/** app 显示名（原型 appLabel）：org.kde.dolphin → Dolphin */
export function appLabel(app: string | null): string {
  if (!app) return '—'
  const last = app.split('.').pop() ?? app
  return last === 'dolphin' || last === 'konsole' || last === 'kate' || last === 'firefox' ? last : app
}

/** HH:mm:ss 时钟（原型 fmtClock） */
export function fmtClock(ts: number): string {
  const dt = new Date(ts * 1000)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(dt.getHours())}:${pad(dt.getMinutes())}:${pad(dt.getSeconds())}`
}
