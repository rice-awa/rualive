import { Typewriter } from 'animal-island-ui'
import { useTranslation } from 'react-i18next'
import { deviceStateOf, fmtDur, fmtRel, stateText } from '@/util/deviceFormat'
import { DevicePublicView } from '@/worker/src/deviceStore'
import DeviceCat from '@/components/DeviceCat'
import DeviceWindowLine from '@/components/DeviceWindowLine'
import { HourlyChart, useUsageData } from '@/components/DeviceCharts'
import styles from '@/styles/device.module.css'

/**
 * 指挥台 hero（prototype heroPanel）——聚焦配置的第一个设备（主设备）：
 * 大猫 + 打字机状态 + 当前窗口；下方今日总时长（公开）+ 今日 24 小时分布（需密钥）。
 */
export default function DeviceHero({
  device,
  now,
  hasKey,
  onUnlock,
}: {
  device: DevicePublicView
  now: number
  hasKey: boolean
  onUnlock: () => void
}) {
  const { t } = useTranslation('common')
  const state = deviceStateOf(device, now)
  // 仅主设备开启统计且已解锁时才拉取逐小时分布；锁定态不发请求（PRD M2 验收）
  const usage = useUsageData(device.device_id, 1, hasKey && device.usage_tracking)
  const os = device.os ? <span className={styles.chip}>{device.os}</span> : null

  return (
    <div className={styles.hero}>
      <div className={styles.heroTop}>
        <div className={styles.heroCat}>
          <DeviceCat state={state} />
        </div>
        <div style={{ flex: 1, minWidth: 220 }}>
          <div className={styles.heroStatus}>
            <Typewriter trigger={`${device.device_id}:${state}`}>{stateText(state)}</Typewriter>
          </div>
          <div className={styles.heroName}>
            {device.device_name} {os} <span className={styles.chip}>{t('device.primary')}</span>
          </div>
          <div className={styles.heroSub}>
            {t('device.lastSeen')} <b>{fmtRel(now, device.last_seen)}</b>
          </div>
          <div className={styles.heroWin}>
            <DeviceWindowLine device={device} hasKey={hasKey} onUnlock={onUnlock} />
          </div>
        </div>
      </div>
      <div className={styles.heroStats}>
        <div className={styles.statBox}>
          <div className={styles.statLbl}>{t('device.todayTotal')}</div>
          <div className={styles.statVal}>
            {device.usage_tracking ? fmtDur(device.today_total_seconds) : '—'}
          </div>
        </div>
        <div className={styles.statBox}>
          <div className={styles.statLbl}>
            {t('device.hourly24Today')}
            {hasKey || !device.usage_tracking ? '' : '（🔒 ' + t('device.lockPanelTitle') + '）'}
          </div>
          {device.usage_tracking ? (
            hasKey ? (
              <div style={{ marginTop: 8 }}>
                <HourlyChart hourly={usage?.hourly_today} now={now} compact />
              </div>
            ) : (
              <div className={styles.lockPanel} style={{ padding: '12px 0 4px' }}>
                <button type="button" className={styles.tab} onClick={onUnlock}>
                  {t('device.lockHourly')}
                </button>
              </div>
            )
          ) : (
            <div className={styles.muted} style={{ fontSize: 12, fontWeight: 700, paddingTop: 14 }}>
              {t('device.usageDisabled')}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
