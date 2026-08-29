import { MaintenanceConfig, MonitorTarget } from '@/types/config'
import { pageConfig } from '@/uptime.config'
import { maintenanceColor } from '@/util/monitorFormat'
import { useTranslation } from 'react-i18next'
import styles from '@/styles/monitor.module.css'

/**
 * 维护 / 历史故障条目（动森面板，原型无对应块 —— 由 Mantine Alert 迁移）。
 * incidents 页与主页 OverallStatus 共用；upcoming 时左侧边为灰色虚线态。
 */
export default function MaintenanceAlert({
  maintenance,
  style,
  upcoming = false,
}: {
  maintenance: Omit<MaintenanceConfig, 'monitors'> & { monitors?: (MonitorTarget | undefined)[] }
  style?: React.CSSProperties
  upcoming?: boolean
}) {
  const { t } = useTranslation('common')
  const accent = maintenanceColor(upcoming ? pageConfig.maintenances?.upcomingColor ?? 'gray' : maintenance.color)

  return (
    <article
      className={styles.mtnAlert}
      style={{ ...style, borderLeftColor: accent } as React.CSSProperties}
    >
      <div className={styles.mtnHead}>
        <span className={styles.mtnChip}>{upcoming ? t('mtn.upcoming') : t('mtn.active')}</span>
        <b className={styles.mtnTitle}>{maintenance.title || t('Scheduled Maintenance')}</b>
        <div className={styles.mtnDate}>
          <div>
            <b>{upcoming ? t('Scheduled for') : t('From')}</b>
            <span>{new Date(maintenance.start).toLocaleString()}</span>
            <b>{upcoming ? t('Expected end') : t('To')}</b>
            <span>
              {maintenance.end ? new Date(maintenance.end).toLocaleString() : t('Until further notice')}
            </span>
          </div>
        </div>
      </div>

      <div className={styles.mtnBody}>{maintenance.body}</div>

      {maintenance.monitors && maintenance.monitors.length > 0 && (
        <div className={styles.mtnAffected}>
          <b>{t('Affected components')}</b>
          <ul>
            {maintenance.monitors.map((comp, compIdx) => (
              <li key={compIdx}>{comp?.name ?? t('MONITOR ID NOT FOUND')}</li>
            ))}
          </ul>
        </div>
      )}
    </article>
  )
}
