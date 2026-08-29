import Link from 'next/link'
import classes from '@/styles/Header.module.css'
import { pageConfig } from '@/uptime.config'
import { PageConfigLink } from '@/types/config'
import { useTranslation } from 'react-i18next'

/** 动森页头：🐾 站点标题 + 圆角胶囊导航（原型 .phead）。无配置 logo 时直接用标题文字。 */
export default function Header({ style }: { style?: React.CSSProperties }) {
  const { t } = useTranslation('common')
  const linkToElement = (link: PageConfigLink, i: number) => {
    const active = link.highlight || link.link.startsWith('/')
    return (
      <a
        key={i}
        href={link.link}
        target={link.link.startsWith('/') ? undefined : '_blank'}
        className={[classes.link, active ? classes.linkActive : ''].join(' ')}
        data-active={link.highlight}
      >
        {link.label}
      </a>
    )
  }

  const links = [{ label: t('Incidents'), link: '/incidents' }, ...(pageConfig.links || [])]

  return (
    <header className={classes.header} style={style}>
      <div className={classes.inner}>
        <Link href="/" className={classes.brand}>
          {pageConfig.logo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={pageConfig.logo} className={classes.logo} alt="logo" />
          ) : (
            <h1 className={classes.title}>
              🐾 {pageConfig.title}
              <small>{t('header.tagline')}</small>
            </h1>
          )}
        </Link>

        <nav className={classes.links}>{links?.map(linkToElement)}</nav>
      </div>
    </header>
  )
}
