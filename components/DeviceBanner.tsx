import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { appLabel, deviceStateOf, fmtDur, fmtRel, stateText } from '@/util/deviceFormat'
import { DevicePublicView } from '@/worker/src/deviceStore'
import DeviceCat from '@/components/DeviceCat'
import { AppBars, HourlyChart, Sparkline, useUsageData } from '@/components/DeviceCharts'
import styles from '@/styles/device.module.css'

/**
 * 猫猫日记流横幅（prototype renderFeed 的单条 banner）：
 * 气泡（窗口/锁定/headless）+ 最后心跳 + 今日活跃 + 7 天趋势 + 「使用详情」展开面板（需密钥）。
 */
export default function DeviceBanner({
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
  const [expanded, setExpanded] = useState(false)
  const state = deviceStateOf(device, now)
  const mod =
    state === 'offline' ? styles.bannerOffline : state === 'idle' ? styles.bannerIdle : ''
  const usage = useUsageData(device.device_id, 1, expanded && hasKey && device.usage_tracking)
  const os = device.os ? <span className={styles.chip}>{device.os}</span> : null

  let bubble: React.ReactNode
  if (!device.has_window) {
    bubble = <div className={[styles.bubble, styles.muted].join(' ')}>{t('device.headless')}</div>
  } else if (hasKey || device.public_window) {
    bubble = (
      <div className={styles.bubble}>
        {t('device.usingApp')} <b>{appLabel(device.last_app)}</b>：{device.last_title}
      </div>
    )
  } else {
    bubble = (
      <div className={[styles.bubble, styles.bubbleLocked].join(' ')} onClick={onUnlock} role="button">
        {t('device.bubbleLocked')}
      </div>
    )
  }

  return (
    <article className={[styles.banner, mod].join(' ')}>
      <div className={styles.bannerCat}>
        <DeviceCat state={state} />
      </div>
      <div className={styles.bannerMain}>
        <div className={styles.bannerStatus}>{stateText(state)}</div>
        <div className={styles.bannerName}>
          {device.device_name} {os}
        </div>
        {bubble}
        <div className={styles.bannerMeta}>
          <span>
            {t('device.lastSeen')} <b>{fmtRel(now, device.last_seen)}</b>
          </span>
          {device.usage_tracking ? (
            <>
              <span>
                {t('device.todayActive')} <b>{fmtDur(device.today_total_seconds)}</b>
              </span>
              <span>
                {t('device.trend7')} <Sparkline data={usage} />
              </span>
              <button
                type="button"
                className={styles.tab}
                style={{ padding: '3px 12px', fontSize: 12.5 }}
                onClick={() => setExpanded(!expanded)}
              >
                {expanded ? '收起 ▴' : `${t('device.lockPanelTitle')} ▾`}
              </button>
            </>
          ) : (
            <span>{t('device.usageDisabled')}</span>
          )}
        </div>
        {expanded &&
          (hasKey && device.usage_tracking ? (
            <div className={styles.bpanel}>
              <div className={styles.bpanelRow}>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--ink-soft)', marginBottom: 6 }}>
                    {t('device.hourly24Today')}
                  </div>
                  <HourlyChart hourly={usage?.hourly_today} now={now} compact />
                </div>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--ink-soft)', marginBottom: 6 }}>
                    {t('device.appsTop3')}
                  </div>
                  <AppBars data={usage} top={3} />
                </div>
              </div>
            </div>
          ) : (
            <div className={styles.bpanel}>
              <div className={styles.bpanelLock}>
                {t('device.usageLocked')}
                <span className={styles.spacer} />
                <button type="button" className={styles.tab} style={{ padding: '3px 12px', fontSize: 12.5 }} onClick={onUnlock}>
                  {t('device.unlock')}
                </button>
              </div>
            </div>
          ))}
      </div>
    </article>
  )
}
