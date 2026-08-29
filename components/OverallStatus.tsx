import { MaintenanceConfig, MonitorTarget } from '@/types/config'
import { useEffect, useState } from 'react'
import MaintenanceAlert from './MaintenanceAlert'
import { pageConfig } from '@/uptime.config'
import { useTranslation } from 'react-i18next'
import styles from '@/styles/monitor.module.css'

function useWindowVisibility() {
  const [isVisible, setIsVisible] = useState(true)
  useEffect(() => {
    const handleVisibilityChange = () => setIsVisible(document.visibilityState === 'visible')
    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange)
  }, [])
  return isVisible
}

/** 总体状态横幅（动森风，原型 .ov-banner）：状态文案 + 最后更新 + 维护提醒 */
export default function OverallStatus({
  state,
  maintenances,
  monitors,
}: {
  state: { overallUp: number; overallDown: number; lastUpdate: number }
  maintenances: MaintenanceConfig[]
  monitors: MonitorTarget[]
}) {
  const { t } = useTranslation('common')
  let group = pageConfig.group
  let groupedMonitor = (group && Object.keys(group).length > 0) || false

  let statusString = ''
  let bannerMod = styles.ovNone
  let icon = '❔'
  if (state.overallUp === 0 && state.overallDown === 0) {
    statusString = t('No data yet')
  } else if (state.overallUp === 0) {
    statusString = t('All systems not operational')
    bannerMod = styles.ovDown
    icon = '✗'
  } else if (state.overallDown === 0) {
    statusString = t('All systems operational')
    bannerMod = styles.ovOk
    icon = '✓'
  } else {
    statusString = t('Some systems not operational', {
      down: state.overallDown,
      total: state.overallUp + state.overallDown,
    })
    bannerMod = styles.ovWarn
    icon = '⚠'
  }

  const [openTime] = useState(Math.round(Date.now() / 1000))
  const [currentTime, setCurrentTime] = useState(Math.round(Date.now() / 1000))
  const isWindowVisible = useWindowVisibility()
  const [expandUpcoming, setExpandUpcoming] = useState(false)

  useEffect(() => {
    const interval = setInterval(() => {
      if (!isWindowVisible) return
      if (currentTime - state.lastUpdate > 300 && currentTime - openTime > 30) {
        window.location.reload()
      }
      setCurrentTime(Math.round(Date.now() / 1000))
    }, 1000)
    return () => clearInterval(interval)
  })

  const now = new Date()

  const activeMaintenances: (Omit<MaintenanceConfig, 'monitors'> & {
    monitors?: MonitorTarget[]
  })[] = maintenances
    .filter((m) => now >= new Date(m.start) && (!m.end || now <= new Date(m.end)))
    .map((maintenance) => ({
      ...maintenance,
      monitors: maintenance.monitors?.map(
        (monitorId) => monitors.find((mon) => monitorId === mon.id)!
      ),
    }))

  const upcomingMaintenances: (Omit<MaintenanceConfig, 'monitors'> & {
    monitors?: (MonitorTarget | undefined)[]
  })[] = maintenances
    .filter((m) => now < new Date(m.start))
    .map((maintenance) => ({
      ...maintenance,
      monitors: maintenance.monitors?.map(
        (monitorId) => monitors.find((mon) => monitorId === mon.id)!
      ),
    }))

  return (
    <section className={styles.section}>
      <div className={[styles.ovBanner, bannerMod].join(' ')}>
        <span className={styles.ovIcon}>{icon}</span>
        <span>{statusString}</span>
        <small>
          · {t('Last updated on', {
            date: new Date(state.lastUpdate * 1000).toLocaleString(),
            seconds: currentTime - state.lastUpdate,
          })}
        </small>
      </div>

      {upcomingMaintenances.length > 0 && (
        <div style={{ textAlign: 'center', marginTop: 12 }}>
          <button
            type="button"
            className={[styles.btn, styles.btnGhost, styles.btnSm].join(' ')}
            onClick={() => setExpandUpcoming(!expandUpcoming)}
          >
            {expandUpcoming ? t('Hide') : t('Show')}{' '}
            {t('upcoming maintenance', { count: upcomingMaintenances.length })}
          </button>
        </div>
      )}

      {expandUpcoming &&
        upcomingMaintenances.map((maintenance, idx) => (
          <MaintenanceAlert
            key={`upcoming-${idx}`}
            maintenance={maintenance}
            style={{ maxWidth: groupedMonitor ? '897px' : '865px' }}
            upcoming
          />
        ))}

      {activeMaintenances.map((maintenance, idx) => (
        <MaintenanceAlert
          key={`active-${idx}`}
          maintenance={maintenance}
          style={{ maxWidth: groupedMonitor ? '897px' : '865px' }}
        />
      ))}
    </section>
  )
}
