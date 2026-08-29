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
    </article>
  )
}
