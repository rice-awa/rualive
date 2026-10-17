import { useTranslation } from 'react-i18next'
import { appLabel } from '@/util/deviceFormat'
import { DevicePublicView } from '@/worker/src/deviceStore'
import styles from '@/styles/device.module.css'

/**
 * 当前窗口行（F7 字段分级，prototype windowLine）：
 * - 当前无窗口标题 → 提示行
 * - 已解锁 → app + title
 * - 未解锁但设备配置 publicApp → 仅 app（窗口标题始终保密）
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
  if (hasKey && device.last_title) {
    return (
      <div className={styles.winLine}>
        💬 <b>{appLabel(device.last_app)}</b> · {device.last_title}
      </div>
    )
  }
  if (device.public_app && device.last_app) {
    return (
      <div className={styles.winLine}>
        💬 <b>{appLabel(device.last_app)}</b>
      </div>
    )
  }
  return (
    <button type="button" className={styles.lockPill} onClick={onUnlock}>
      {t('device.windowLocked')}
    </button>
  )
}
