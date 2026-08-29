import { useEffect, useState } from 'react'
import i18n from '@/util/i18n'
import { appLabel, fmtDur } from '@/util/deviceFormat'
import { fetchWithUsageKey } from '@/util/usageKey'
import styles from '@/styles/device.module.css'

/** 动森色板（prototype PALETTE，10 色循环） */
const PALETTE = [
  '#AFD46A',
  '#F0A852',
  '#9CD3E8',
  '#F2A9A2',
  '#F5D98B',
  '#8FD3B6',
  '#C9A6E8',
  '#E8C39A',
  '#A8C6E8',
  '#F0BFBF',
]

export type UsageResponse = {
  daily: { date: string; total_seconds: number; by_app: Record<string, number> }[]
  hourly_today: { hour: number; active_seconds: number }[]
}

/**
 * 拉取 /api/device/usage（带本地 key 自动附加 X-API-Key）。
 * enabled=false（未解锁）时不发请求 —— PRD M2 验收：锁定态不发出数据请求。
 */
export function useUsageData(deviceId: string, days: number, enabled: boolean): UsageResponse | null {
  const [data, setData] = useState<UsageResponse | null>(null)
  useEffect(() => {
    if (!enabled) {
      setData(null)
      return
    }
    let cancelled = false
    fetchWithUsageKey(`/api/device/usage?device_id=${encodeURIComponent(deviceId)}&days=${days}`)
      .then((res) => (res.ok ? (res.json() as Promise<UsageResponse>) : null))
      .then((d) => {
        if (!cancelled && d) setData(d)
      })
      .catch(() => {
        // 网络错误：保持旧数据，下个 tab 切换时重试
      })
    return () => {
      cancelled = true
    }
  }, [deviceId, days, enabled])
  return data
}

/** 今日应用排行水平条形图（prototype appBars） */
export function AppBars({ data, top = 10 }: { data: UsageResponse | null; top?: number }) {
  const byApp = data?.daily[data.daily.length - 1]?.by_app
  if (!byApp) return null
  const rows = Object.entries(byApp).sort((a, b) => b[1] - a[1]).slice(0, top)
  const max = rows[0]?.[1] ?? 1
  return (
    <div className={styles.appBars}>
      {rows.map(([app, sec], i) => (
        <div className={styles.barRow} key={app}>
          <span className={styles.app} title={app}>
            {appLabel(app)}
          </span>
          <div className={styles.barTrack}>
            <div
              className={styles.barFill}
              style={{ width: `${Math.max(3, (sec / max) * 100)}%`, background: PALETTE[i % PALETTE.length] }}
            />
          </div>
          <span className={styles.du}>{fmtDur(sec)}</span>
        </div>
      ))}
    </div>
  )
}

/** 24 小时逐小时活跃柱状图（prototype hourlyChart）；hourly_today 缺桶补 0 */
export function HourlyChart({
  hourly,
  now,
  compact = false,
}: {
  hourly: { hour: number; active_seconds: number }[] | null | undefined
  now: number
  compact?: boolean
}) {
  if (!hourly) return null
  const vals = new Array(24).fill(0)
  for (const h of hourly) if (h.hour >= 0 && h.hour < 24) vals[h.hour] = h.active_seconds
  const max = Math.max(...vals, 1)
  const cur = new Date(now * 1000).getHours()
  const cols = vals.map((v, h) => (
    <div
      key={h}
      className={[styles.hcol, h === cur ? styles.hcolNow : ''].join(' ')}
      style={{ height: `${Math.max(2, (v / max) * 100)}%` }}
      title={i18n.t('device.barTip', { hour: String(h).padStart(2, '0'), dur: fmtDur(v) })}
    />
  ))
  return (
    <div className={[styles.hchart, compact ? styles.hchartSm : ''].join(' ')}>
      <div className={styles.hcols}>{cols}</div>
      <div className={styles.hlabels}>
        <span>0</span>
        <span>6</span>
        <span>12</span>
        <span>18</span>
        <span>23</span>
      </div>
    </div>
  )
}

/** 近 n 天每日活跃柱状图（prototype dailyChart），含日均 */
export function DailyChart({ data, days }: { data: UsageResponse | null; days: number }) {
  const daily = data?.daily ?? []
  if (!daily.length) return null
  const max = Math.max(...daily.map((x) => x.total_seconds), 1)
  const DOW = ['日', '一', '二', '三', '四', '五', '六']
  const cols = daily.map((x) => (
    <div key={x.date} className={styles.dcol}>
      <i
        style={{ height: `${Math.max(3, (x.total_seconds / max) * 100)}%` }}
        title={`${x.date} · ${fmtDur(x.total_seconds)}`}
      />
    </div>
  ))
  const labels = daily.map((x, i) => {
    const show = days <= 7 || i % 5 === 0 || i === daily.length - 1
    return (
      <span key={x.date}>
        {show ? (days <= 7 ? DOW[new Date(`${x.date}T00:00:00Z`).getUTCDay()] : x.date.slice(5)) : ''}
      </span>
    )
  })
  const avg = daily.reduce((a, b) => a + b.total_seconds, 0) / daily.length
  return (
    <div className={styles.dchart}>
      <div className={styles.dcols}>{cols}</div>
      <div className={styles.dlabels}>{labels}</div>
      <div className={styles.dchartAvg}>{i18n.t('device.avgDaily', { dur: fmtDur(avg) })}</div>
    </div>
  )
}

/** 迷你 7 天趋势折线（prototype sparkline），日记流横幅用 */
export function Sparkline({ data }: { data: UsageResponse | null }) {
  const vals = (data?.daily ?? []).map((x) => x.total_seconds)
  if (!vals.length) return null
  const max = Math.max(...vals, 1)
  const pts = vals
    .map((v, i) => `${((i / (vals.length - 1)) * 100).toFixed(1)},${(26 - (v / max) * 22).toFixed(1)}`)
    .join(' ')
  return (
    <svg className={styles.spark} viewBox="0 0 100 28" preserveAspectRatio="none">
      <polyline
        points={pts}
        fill="none"
        stroke="#8FB94E"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

/** 数据口径说明折叠（prototype collapseNote），仅 zh 语系可见完整语义 */
export function UsageNotes() {
  return (
    <details className={styles.collapseNote}>
      <summary>📏 {i18n.t('device.notes')}</summary>
      <span>{i18n.t('device.note1')}</span>
      <br />
      <span>{i18n.t('device.note2')}</span>
    </details>
  )
}
