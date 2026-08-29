import Head from 'next/head'

import { MaintenanceConfig, MonitorTarget } from '@/types/config'
import { maintenances, pageConfig, workerConfig } from '@/uptime.config'
import Header from '@/components/Header'
import Footer from '@/components/Footer'
import MaintenanceAlert from '@/components/MaintenanceAlert'
import NoIncidentsAlert from '@/components/NoIncidents'
import { useTranslation } from 'react-i18next'
import { useEffect, useState } from 'react'
import styles from '@/styles/monitor.module.css'

export const runtime = 'experimental-edge'

function getSelectedMonth() {
  const hash = window.location.hash.replace('#', '')
  if (!hash) {
    const now = new Date()
    return now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0')
  }
  return hash.split('-').splice(0, 2).join('-')
}

function filterIncidentsByMonth(
  incidents: MaintenanceConfig[],
  monthStr: string
): (Omit<MaintenanceConfig, 'monitors'> & { monitors: MonitorTarget[] })[] {
  return incidents
    .filter((incident) => {
      const d = new Date(incident.start)
      const incidentMonth = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0')
      return incidentMonth === monthStr
    })
    .map((e) => ({
      ...e,
      monitors: (e.monitors || []).map((e) => workerConfig.monitors.find((mon) => mon.id === e)!),
    }))
    .sort((a, b) => (new Date(a.start) > new Date(b.start) ? -1 : 1))
}

function getPrevNextMonth(monthStr: string) {
  const [year, month] = monthStr.split('-').map(Number)
  const date = new Date(year, month - 1)
  const prev = new Date(date)
  prev.setMonth(prev.getMonth() - 1)
  const next = new Date(date)
  next.setMonth(next.getMonth() + 1)
  return {
    prev: prev.getFullYear() + '-' + String(prev.getMonth() + 1).padStart(2, '0'),
    next: next.getFullYear() + '-' + String(next.getMonth() + 1).padStart(2, '0'),
  }
}

export default function IncidentsPage() {
  const { t } = useTranslation('common')
  const [selectedMonitor, setSelectedMonitor] = useState<string | null>('')
  const [selectedMonth, setSelectedMonth] = useState(getSelectedMonth())

  useEffect(() => {
    const onHashChange = () => setSelectedMonth(getSelectedMonth())
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])

  const filteredIncidents = filterIncidentsByMonth(maintenances, selectedMonth)
  const monitorFilteredIncidents = selectedMonitor
    ? filteredIncidents.filter((i) => i.monitors.find((e) => e.id === selectedMonitor))
    : filteredIncidents

  const { prev, next } = getPrevNextMonth(selectedMonth)

  return (
    <>
      <Head>
        <title>{`${pageConfig.title} · ${t('incidents.title')}`}</title>
        <link rel="icon" href={pageConfig.favicon ?? '/favicon.png'} />
      </Head>

      <main>
        <Header />

        <section className={styles.section}>
          <div className={styles.areaHead}>
            <h2>{t('incidents.title')}</h2>
            <span className={styles.sub}>{t('incidents.sub')}</span>
          </div>

          <div className={styles.monthNav}>
            <button type="button" className={[styles.btn, styles.btnGhost].join(' ')} onClick={() => (window.location.hash = prev)}>
              {t('Backwards')}
            </button>
            <span className={styles.monthPill}>{selectedMonth}</span>
            <button type="button" className={[styles.btn, styles.btnGhost].join(' ')} onClick={() => (window.location.hash = next)}>
              {t('Forward')}
            </button>
          </div>

          {workerConfig.monitors.length > 0 && (
            <div className={styles.filterRow}>
              <span>{t('incidents.filter')}</span>
              <select
                className={styles.select}
                value={selectedMonitor ?? ''}
                onChange={(e) => setSelectedMonitor(e.target.value || null)}
              >
                <option value="">{t('All')}</option>
                {workerConfig.monitors.map((monitor) => (
                  <option key={monitor.id} value={monitor.id}>
                    {monitor.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          {monitorFilteredIncidents.length === 0 ? (
            <NoIncidentsAlert />
          ) : (
            monitorFilteredIncidents.map((incident, i) => (
              <MaintenanceAlert key={i} maintenance={incident} style={{ maxWidth: '100%' }} />
            ))
          )}
        </section>

        <Footer />
      </main>
    </>
  )
}
