import Head from 'next/head'

import { MonitorTarget } from '@/types/config'
import { maintenances, pageConfig, workerConfig } from '@/uptime.config'
import OverallStatus from '@/components/OverallStatus'
import Header from '@/components/Header'
import MonitorList from '@/components/MonitorList'
import MonitorDetail from '@/components/MonitorDetail'
import Footer from '@/components/Footer'
import DeviceSection from '@/components/DeviceSection'
import LeafDivider from '@/components/LeafDivider'
import { DeviceProvider } from '@/util/useDeviceStatus'
import { buildDeviceViews, DevicePublicView } from '@/worker/src/deviceStore'
import { useTranslation } from 'react-i18next'
import { CompactedMonitorStateWrapper, getFromStore } from '@/worker/src/store'
import styles from '@/styles/monitor.module.css'

export const runtime = 'experimental-edge'

export default function Home({
  compactedStateStr,
  monitors,
  devices,
}: {
  compactedStateStr: string
  monitors: MonitorTarget[]
  devices: DevicePublicView[]
  tooltip?: string
  statusPageLink?: string
}) {
  const { t } = useTranslation('common')
  let state = new CompactedMonitorStateWrapper(compactedStateStr).uncompact()
  const hasMonitorState = state.lastUpdate !== 0

  // Specify monitorId in URL hash to view a specific monitor (can be used in iframe)
  // `#device:<id>` 属于设备区（DeviceSection 内部处理），不进入监控直达逻辑
  const monitorId = window.location.hash.substring(1)
  if (monitorId && !monitorId.startsWith('device:')) {
    const monitor = monitors.find((monitor) => monitor.id === monitorId)
    if (!monitor || !state) {
      return (
        <div className={styles.section} style={{ paddingTop: 60 }}>
          <div className={styles.emptyState}>
            <div className={styles.big}>🔍</div>
            <div className={styles.title}>{t('Monitor not found', { id: monitorId })}</div>
          </div>
        </div>
      )
    }
    return (
      <div className={styles.section} style={{ paddingTop: 40 }}>
        <MonitorDetail monitor={monitor} state={state} />
      </div>
    )
  }

  return (
    <>
      <Head>
        <title>{pageConfig.title}</title>
        <link rel="icon" href={pageConfig.favicon ?? '/favicon.png'} />
      </Head>

      <main>
        <Header />

        {hasMonitorState ? (
          <OverallStatus state={state} monitors={monitors} maintenances={maintenances} />
        ) : (
          <div className={styles.section}>
            <div className={styles.emptyState}>
              <div className={styles.big}>🌫️</div>
              <div className={styles.title}>{t('Monitor State not defined')}</div>
            </div>
          </div>
        )}

        {/* 「似了喵？」设备区：与监控区平级，worker 状态与设备状态互不依赖；无设备配置时不渲染 */}
        <DeviceProvider initial={devices}>
          <DeviceSection />
        </DeviceProvider>

        {hasMonitorState && (
          <>
            <LeafDivider />
            <MonitorList monitors={monitors} state={state} />
          </>
        )}

        <Footer />
      </main>
    </>
  )
}

export async function getServerSideProps() {
  // Read state as string from storage, to avoid hitting server-side cpu time limit
  const compactedStateStr = await getFromStore(process.env as any, 'state')

  // Only present these values to client
  const monitors = workerConfig.monitors.map((monitor) => {
    return {
      id: monitor.id,
      name: monitor.name,
      // @ts-ignore
      tooltip: monitor?.tooltip,
      // @ts-ignore
      statusPageLink: monitor?.statusPageLink,
      // @ts-ignore
      hideLatencyChart: monitor?.hideLatencyChart,
    }
  })

  // 设备区 SSR：只传公开字段（hasValidKey=false），窗口等密钥字段不在首屏 HTML 里
  const now = Math.round(Date.now() / 1000)
  const timeZone = workerConfig.notification?.timeZone ?? 'Asia/Shanghai'
  const devices = await buildDeviceViews(
    process.env as any,
    workerConfig.devices ?? [],
    now,
    timeZone,
    false
  )

  return { props: { compactedStateStr, monitors, devices } }
}
