import { useTranslation } from 'react-i18next'
import { deviceStateOf, fmtDur, fmtRel, stateText } from '@/util/deviceFormat'
import { DevicePublicView } from '@/worker/src/deviceStore'
import DeviceCat from '@/components/DeviceCat'
import DeviceWindowLine from '@/components/DeviceWindowLine'
import styles from '@/styles/device.module.css'

/** 卡片墙单卡（prototype cardWall），点击进入设备详情 */
export default function DeviceCard({
  device,
  now,
  hasKey,
  onOpen,
  onUnlock,
}: {
  device: DevicePublicView
  now: number
  hasKey: boolean
  onOpen: () => void
  onUnlock: () => void
}) {
  const { t } = useTranslation('common')
  const state = deviceStateOf(device, now)
  const mod =
    state === 'offline' ? styles.acardOffline : state === 'idle' ? styles.acardIdle : ''
  const os = device.os ? <span className={styles.chip}>{device.os}</span> : null

  return (
    <article
      className={[styles.acard, mod].join(' ')}
      onClick={onOpen}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') onOpen()
      }}
    >
      <div className={styles.acardCat}>
        <DeviceCat state={state} />
      </div>
      <div className={styles.acardMain}>
        <div className={styles.acardStatus}>{stateText(state)}</div>
        <div className={styles.acardName}>
          {device.device_name} {os}
        </div>
        <div className={styles.acardMeta}>
          {t('device.lastSeen')}{' '}
          <b>{fmtRel(now, device.last_seen)}</b>
          {device.usage_tracking ? (
            <>
              {' '}
              · {t('device.todayActive')}{' '}
              <b>{fmtDur(device.today_total_seconds)}</b>
            </>
          ) : (
            <> · {t('device.usageDisabled')}</>
          )}
        </div>
        <DeviceWindowLine device={device} hasKey={hasKey} onUnlock={onUnlock} />
      </div>
      <span className={styles.acardMore}>{t('device.more')}</span>
    </article>
  )
}
