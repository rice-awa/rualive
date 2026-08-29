import { useTranslation } from 'react-i18next'
import styles from '@/styles/monitor.module.css'

/** 叶子分隔线（原型 .leaf-div）：设备区 ｜ HTTP 监控区 */
export default function LeafDivider() {
  const { t } = useTranslation('common')
  return (
    <div className={styles.leafDiv}>
      <span>🍃 {t('divider.text')}</span>
    </div>
  )
}
