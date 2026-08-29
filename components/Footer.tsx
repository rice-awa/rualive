import { pageConfig } from '@/uptime.config'
import { useTranslation } from 'react-i18next'
import styles from '@/styles/monitor.module.css'

/** 动森页脚（原型 .pfoot）。有 customFooter 时原样渲染（其自身带内联样式），否则显示默认文案。 */
export default function Footer() {
  const { t } = useTranslation('common')

  return (
    <footer className={styles.pfoot}>
      {pageConfig.customFooter ? (
        <div dangerouslySetInnerHTML={{ __html: pageConfig.customFooter }} />
      ) : (
        <div dangerouslySetInnerHTML={{ __html: t('footer.default') }} />
      )}
    </footer>
  )
}
