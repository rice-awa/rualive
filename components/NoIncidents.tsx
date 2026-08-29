import { useTranslation } from 'react-i18next'
import styles from '@/styles/monitor.module.css'

/** 无故障空状态（动森面板，原 Mantine Alert） */
export default function NoIncidentsAlert({ style }: { style?: React.CSSProperties }) {
  const { t } = useTranslation('common')
  return (
    <div className={styles.emptyState} style={style}>
      <div className={styles.big}>🎉</div>
      <div className={styles.title}>{t('No incidents in this month')}</div>
      <div className={styles.body}>{t('There are no incidents for this month')}</div>
    </div>
  )
}
