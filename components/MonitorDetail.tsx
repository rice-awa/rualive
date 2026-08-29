import { MonitorState, MonitorTarget } from '@/types/config'
import { maintenances } from '@/uptime.config'
import { useTranslation } from 'react-i18next'
import DetailChart from './DetailChart'
import DetailBar from './DetailBar'
import styles from '@/styles/monitor.module.css'

function uptimeMod(percent: number): string {
  if (percent >= 99) return styles.monUptimeOk
  if (percent >= 95) return styles.monUptimeWarn
  return styles.monUptimeDown
}

/** 单个 HTTP 监控卡（动森面板，原 Mantine MonitorDetail） */
export default function MonitorDetail({
  monitor,
  state,
}: {
  monitor: MonitorTarget
  state: MonitorState
}) {
  const { t } = useTranslation('common')

  // 无数据：卡片仍显示名称，但无条带 / 曲线
  if (!state.latency[monitor.id]) {
    return (
      <article className={styles.monCard}>
        <div className={styles.monHead}>
          <span className={styles.dot} />
          <span className={styles.monName}>{monitor.name}</span>
        </div>
        <div className={styles.monMeta}>
          <span className={styles.muted}>{t('No data available')}</span>
        </div>
      </article>
    )
  }

  const nowDate = new Date()
  const isDown = state.incident[monitor.id].slice(-1)[0].end === undefined

  // 维护中则隐藏真实状态，改显示维护态
  const hasMaintenance = maintenances
    .filter((m) => nowDate >= new Date(m.start) && (!m.end || nowDate <= new Date(m.end)))
    .find((maintenance) => maintenance.monitors?.includes(monitor.id))

  const dotMod = hasMaintenance
    ? styles.dotWarn
    : isDown
      ? styles.dotDown
      : styles.dotUp

  let totalTime = Date.now() / 1000 - state.incident[monitor.id][0].start[0]
  let downTime = 0
  for (let incident of state.incident[monitor.id]) {
    downTime += (incident.end ?? Date.now() / 1000) - incident.start[0]
  }

  const uptimePercent = Number((((totalTime - downTime) / totalTime) * 100).toPrecision(4))

  // —— hover 快捷详情 ——
  // 最新一条响应时间
  const latArr = state.latency[monitor.id]
  const lastPing = latArr && latArr.length ? Number(latArr[latArr.length - 1].ping) : NaN

  // 当前状态已持续时长（离线=当前 incident 起点；在线=最近一次恢复时间；维护中不显示）
  let sinceStr = ''
  if (!hasMaintenance) {
    const last = state.incident[monitor.id].slice(-1)[0]
    const sinceTs = isDown
      ? last.start[0]
      : last.end ?? state.incident[monitor.id][0].start[0]
    const sec = Math.max(0, Math.round(Date.now() / 1000 - sinceTs))
    const d = Math.floor(sec / 86400)
    const h = Math.floor((sec % 86400) / 3600)
    const m = Math.floor((sec % 3600) / 60)
    const parts: string[] = []
    if (d > 0) parts.push(t('mon.dur.days', { n: d }))
    if (h > 0) parts.push(t('mon.dur.hours', { n: h }))
    if (d === 0 && h === 0 && m > 0) parts.push(t('mon.dur.minutes', { n: m }))
    if (parts.length) sinceStr = t('mon.quick.since', { duration: parts.join(' ') })
  }

  const statusText = hasMaintenance
    ? t('mon.quick.maint')
    : isDown
      ? t('mon.quick.down')
      : t('mon.quick.up')

  const nameEl = monitor.statusPageLink ? (
    <a
      className={styles.monName}
      href={monitor.statusPageLink}
      target="_blank"
      rel="noreferrer"
    >
      {monitor.name}
    </a>
  ) : (
    <span className={styles.monName}>{monitor.name}</span>
  )

  return (
    <article className={styles.monCard}>
      <div className={styles.monHead}>
        <span className={[styles.dot, dotMod].join(' ')} title={hasMaintenance ? t('Scheduled Maintenance') : undefined} />
        {monitor.tooltip ? (
          <span title={monitor.tooltip}>{nameEl}</span>
        ) : (
          nameEl
        )}
        <span className={styles.spacer} />
        <span className={[styles.monUptime, uptimeMod(uptimePercent)].join(' ')}>
          {t('Overall', { percent: uptimePercent })}
        </span>
      </div>
      <div className={styles.monMeta}>
        <span className={styles.monUrl}>{monitor.target}</span>
      </div>

      <DetailBar monitor={monitor} state={state} />
      {!monitor.hideLatencyChart && <DetailChart monitor={monitor} state={state} />}

      <div className={styles.monQuick}>
        <div className={styles.monQuickRow}>
          <span>{statusText}</span>
          {sinceStr && <span className={styles.monQuickVal}>{sinceStr}</span>}
        </div>
        <div className={styles.monQuickRow}>
          <span>{t('mon.quick.latency')}</span>
          <span className={styles.monQuickVal}>
            {Number.isNaN(lastPing) ? t('No Data') : `${lastPing} ms`}
          </span>
        </div>
        <div className={styles.monQuickRow}>
          <span>{t('mon.quick.uptime')}</span>
          <span className={styles.monQuickVal}>{uptimePercent}%</span>
        </div>
      </div>
    </article>
  )
}
