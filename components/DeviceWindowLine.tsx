import { useTranslation } from 'react-i18next'
import { appLabel } from '@/util/deviceFormat'
import { DevicePublicView } from '@/worker/src/deviceStore'
import styles from '@/styles/device.module.css'

/**
 * 当前窗口行（F7 字段分级，prototype windowLine）：
 * - headless 无窗口 → 提示行
 * - 已解锁或设备配置 publicWindow → app + title（publicWindow 且未解锁时附「公开」chip）
 * - 其余 → 🔒 锁定占位按钮（点击打开解锁弹窗）
 */
export default function DeviceWindowLine({
  device,
  hasKey,
  onUnlock,
}: {
  device: DevicePublicView
  hasKey: boolean
  onUnlock: () => void
}) {
  const { t } = useTranslation('common')
  if (!device.has_window) {
    return <div className={[styles.winLine, styles.muted].join(' ')}>{t('device.noSession')}</div>
  }
  if (hasKey || device.public_window) {
    return (
      <div className={styles.winLine}>
        💬 <b>{appLabel(device.last_app)}</b> · {device.last_title}
        {device.public_window && !hasKey && (
          <span className={styles.chip} title="publicWindow: true">
            {t('device.publicChip')}
          </span>
        )}
      </div>
    )
  }
  return (
    <button type="button" className={styles.lockPill} onClick={onUnlock}>
      {t('device.windowLocked')}
    </button>
  )
}
