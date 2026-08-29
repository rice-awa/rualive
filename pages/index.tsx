import Head from 'next/head'

import { Inter } from 'next/font/google'
import { MonitorTarget } from '@/types/config'
import { maintenances, pageConfig, workerConfig } from '@/uptime.config'
import OverallStatus from '@/components/OverallStatus'
import Header from '@/components/Header'
import MonitorList from '@/components/MonitorList'
import { Center, Text } from '@mantine/core'
import MonitorDetail from '@/components/MonitorDetail'
import Footer from '@/components/Footer'
import DeviceSection from '@/components/DeviceSection'
import { DeviceProvider } from '@/util/useDeviceStatus'
import { buildDeviceViews, DevicePublicView } from '@/worker/src/deviceStore'
import { useTranslation } from 'react-i18next'
import { CompactedMonitorStateWrapper, getFromStore } from '@/worker/src/store'

export const runtime = 'experimental-edge'
const inter = Inter({ subsets: ['latin'] })

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

  // Specify monitorId in URL hash to view a specific monitor (can be used in iframe)
  // `#device:<id>` 属于设备区（DeviceSection 内部处理），不进入监控直达逻辑
  const monitorId = window.location.hash.substring(1)
  if (monitorId && !monitorId.startsWith('device:')) {
    const monitor = monitors.find((monitor) => monitor.id === monitorId)
    if (!monitor || !state) {
      return <Text fw={700}>{t('Monitor not found', { id: monitorId })}</Text>
    }
    return (
      <div style={{ maxWidth: '810px' }}>
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

      <main className={inter.className}>
        <Header />

        {/* 「似了喵？」设备区：与监控区平级，worker 状态与设备状态互不依赖；无设备配置时不渲染 */}
        <DeviceProvider initial={devices}>
          <DeviceSection />
        </DeviceProvider>

        {state.lastUpdate === 0 ? (
          <Center>
            <Text fw={700}>{t('Monitor State not defined')}</Text>
          </Center>
        ) : (
          <div>
            <OverallStatus state={state} monitors={monitors} maintenances={maintenances} />
            <MonitorList monitors={monitors} state={state} />
          </div>
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
