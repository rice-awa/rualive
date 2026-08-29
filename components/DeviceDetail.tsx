import { useEffect, useState } from 'react'
import i18n from '@/util/i18n'
import { deviceStateOf, fmtDur, fmtRel, stateText } from '@/util/deviceFormat'
import { DevicePublicView } from '@/worker/src/deviceStore'
import DeviceCat from '@/components/DeviceCat'
import DeviceWindowLine from '@/components/DeviceWindowLine'
import { AppBars, DailyChart, HourlyChart, UsageNotes, useUsageData } from '@/components/DeviceCharts'
import styles from '@/styles/device.module.css'

type Tab = 'today' | '7d' | '30d'

/**
 * 设备详情 overlay（prototype detailOverlay）：
 * 头部（状态/窗口/解锁锁定）+ 统计 Tab（今日应用排行 / 24h 时间线 / 7·30 天趋势，需密钥）。
 * Escape 返回；父级负责 hash 同步。
 */
export default function DeviceDetail({
  device,
  now,
  hasKey,
  onClose,
  onUnlock,
  onLock,
}: {
  device: DevicePublicView
  now: number
  hasKey: boolean
  onClose: () => void
  onUnlock: () => void
  onLock: () => void
}) {
  const [tab, setTab] = useState<Tab>('today')
  const state = deviceStateOf(device, now)
  const days = tab === 'today' ? 1 : tab === '7d' ? 7 : 30
  // 锁定态不发请求（PRD M2 验收）
  const usage = useUsageData(device.device_id, days, hasKey && device.usage_tracking)
  const os = device.os ? <span className={styles.chip}>{device.os}</span> : null

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  let body: React.ReactNode
  if (!device.usage_tracking) {
    body = (
      <div className={[styles.panel, styles.lockPanel].join(' ')}>
        <div className={styles.big}>📴</div>
        <div style={{ fontWeight: 800 }}>{i18n.t('device.usageDisabledDetail')}</div>
        <div className={styles.muted} style={{ fontSize: 12.5 }}>
          {i18n.t('device.usageDisabledHint')}
        </div>
      </div>
    )
  } else if (!hasKey) {
    body = (
      <div className={styles.panel}>
        <div className={styles.lockPanel}>
          <div className={styles.big}>🔒</div>
          <div style={{ fontWeight: 800 }}>{i18n.t('device.usageLocked')}</div>
          <button type="button" className={styles.tab} onClick={onUnlock}>
            {i18n.t('device.unlock')}
          </button>
        </div>
      </div>
    )
  } else if (tab === 'today') {
    body = (
      <>
        <div className={styles.chartGrid}>
          <div className={styles.panel}>
            <h3 className={styles.panelTitle}>{i18n.t('device.appsTop10')}</h3>
            <AppBars data={usage} />
          </div>
          <div className={styles.panel}>
            <h3 className={styles.panelTitle}>{i18n.t('device.hourly24')}</h3>
            <HourlyChart hourly={usage?.hourly_today} now={now} />
          </div>
        </div>
        <UsageNotes />
      </>
    )
  } else {
    body = (
      <>
        <div className={styles.panel}>
          <h3 className={styles.panelTitle}>
            {tab === '7d' ? i18n.t('device.trend7') : i18n.t('device.trend30')}
          </h3>
          <DailyChart data={usage} days={days} />
        </div>
        <UsageNotes />
      </>
    )
  }

  return (
    <div className={styles.detail}>
      <div className={styles.detailInner}>
        <button type="button" className={[styles.tab, styles.btnGhost].join(' ')} onClick={onClose}>
          {i18n.t('device.back')}
        </button>
        <div className={styles.detailHead}>
          <div className={styles.detailCat}>
            <DeviceCat state={state} />
          </div>
          <div>
            <h2 className={styles.detailTitle}>
              {device.device_name} {os}
            </h2>
            <div className={styles.detailSub}>
              <b>{stateText(state)}</b> · {i18n.t('device.lastSeen')}{' '}
              <b>{fmtRel(now, device.last_seen)}</b>
              {device.usage_tracking ? (
                <>
                  {' '}
                  · {i18n.t('device.todayActive')}{' '}
                  <b>{fmtDur(device.today_total_seconds)}</b>
                </>
              ) : (
                <> · {i18n.t('device.usageDisabled')}</>
              )}
            </div>
          </div>
          <span className={styles.spacer} />
          {hasKey ? (
            <button type="button" className={styles.tab} onClick={onLock}>
              {i18n.t('device.unlockedBtn')}
            </button>
          ) : (
            <button type="button" className={[styles.tab, styles.btnOrange].join(' ')} onClick={onUnlock}>
              {i18n.t('device.unlockShort')}
            </button>
          )}
        </div>
        {device.has_window && (
          <div style={{ marginTop: 14, maxWidth: 560 }}>
            <DeviceWindowLine device={device} hasKey={hasKey} onUnlock={onUnlock} />
          </div>
        )}
        {device.usage_tracking && (
          <div className={styles.tabs}>
            {(['today', '7d', '30d'] as Tab[]).map((t) => (
              <button
                key={t}
                type="button"
                className={[styles.tab, tab === t ? styles.tabOn : ''].join(' ')}
                onClick={() => setTab(t)}
              >
                {t === 'today'
                  ? i18n.t('device.tab.today')
                  : t === '7d'
                    ? i18n.t('device.tab.sevenDays')
                    : i18n.t('device.tab.thirtyDays')}
              </button>
            ))}
          </div>
        )}
        {body}
      </div>
    </div>
  )
}
