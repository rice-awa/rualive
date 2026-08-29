import { useEffect, useRef, useState } from 'react'
import i18n from '@/util/i18n'
import { fmtClock } from '@/util/deviceFormat'
import { useDeviceStatus } from '@/util/useDeviceStatus'
import DeviceHero from '@/components/DeviceHero'
import DeviceCard from '@/components/DeviceCard'
import DeviceBanner from '@/components/DeviceBanner'
import DeviceDetail from '@/components/DeviceDetail'
import DeviceUnlockModal from '@/components/DeviceUnlockModal'
import styles from '@/styles/device.module.css'

type View = 'home' | 'feed'

/**
 * 「似了喵？」设备区（PRD F3）：
 * - 主页变体：指挥台 hero（主设备）+ 全部设备卡片墙
 * - 猫猫日记流变体：一屏读完的横幅流（无二级页）
 * - URL hash `#device:<id>` 直达设备详情 overlay（与现有 `#<monitorId>` 机制并存）
 * - 时钟 pill + 视图切换 + 解锁弹窗 + toast 编排
 */
export default function DeviceSection() {
  const { devices, now, hasKey, unlock, lock } = useDeviceStatus()
  const [view, setView] = useState<View>('home')
  const [detailId, setDetailId] = useState<string | null>(null)
  const [modalOpen, setModalOpen] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const toastTimer = useRef<number | null>(null)

  // #device:<id> hash 路由：初始解析 + hashchange 同步（不打断现有 #<monitorId> 逻辑）
  useEffect(() => {
    const match = (hash: string): string | null => {
      const m = hash.match(/^#device:(.+)$/)
      return m ? decodeURIComponent(m[1]) : null
    }
    const id = match(window.location.hash)
    if (id && devices.some((d) => d.device_id === id)) setDetailId(id)
    const onHash = () => {
      const next = match(window.location.hash)
      if (next && devices.some((d) => d.device_id === next)) setDetailId(next)
      else setDetailId(null)
    }
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [devices])

  const openDetail = (id: string) => {
    setDetailId(id)
    try {
      window.location.hash = `device:${id}`
    } catch {
      // 某些 iframe 环境禁改 hash，UI 状态仍然生效
    }
  }
  const closeDetail = () => {
    setDetailId(null)
    try {
      history.pushState(null, '', location.pathname + location.search)
    } catch {
      window.location.hash = ''
    }
  }

  const showToast = (msg: string) => {
    setToast(msg)
    if (toastTimer.current) window.clearTimeout(toastTimer.current)
    toastTimer.current = window.setTimeout(() => setToast(null), 2600)
  }
  const onUnlocked = (key: string) => {
    unlock(key)
    setModalOpen(false)
    showToast(i18n.t('device.unlockedToast'))
  }
  const onLocked = () => {
    lock()
    showToast(i18n.t('device.lockedToast'))
  }

  if (!devices.length) return null
  const detail = detailId ? devices.find((d) => d.device_id === detailId) : null
  const primary = devices[0]

  return (
    <section className={styles.section}>
      <div className={styles.head}>
        <h2>
          {i18n.t('device.section.title')}
          <span className={styles.sub}>{i18n.t('device.section.sub')}</span>
        </h2>
        <div className={styles.headRight}>
          <div className={styles.viewToggle}>
            <button
              type="button"
              className={[styles.vtBtn, view === 'home' ? styles.vtBtnOn : ''].join(' ')}
              onClick={() => setView('home')}
            >
              {i18n.t('device.view.home')}
            </button>
            <button
              type="button"
              className={[styles.vtBtn, view === 'feed' ? styles.vtBtnOn : ''].join(' ')}
              onClick={() => setView('feed')}
            >
              {i18n.t('device.view.diary')}
            </button>
          </div>
          <div className={styles.clockPill}>{fmtClock(now)}</div>
        </div>
      </div>

      {view === 'home' ? (
        <>
          <DeviceHero device={primary} now={now} hasKey={hasKey} onUnlock={() => setModalOpen(true)} />
          <div className={[styles.areaHead, styles.areaHeadSmall].join(' ')}>
            <h3>{i18n.t('device.allDevices')}</h3>
            <span className={styles.sub}>{i18n.t('device.allDevices.sub')}</span>
          </div>
          <div className={styles.cardRow}>
            {devices.map((d) => (
              <DeviceCard
                key={d.device_id}
                device={d}
                now={now}
                hasKey={hasKey}
                onOpen={() => openDetail(d.device_id)}
                onUnlock={() => setModalOpen(true)}
              />
            ))}
          </div>
        </>
      ) : (
        <>
          <div className={styles.areaHead}>
            <h3>{i18n.t('device.feed.title')}</h3>
            <span className={styles.sub}>{i18n.t('device.feed.sub')}</span>
          </div>
          {devices.map((d) => (
            <DeviceBanner
              key={d.device_id}
              device={d}
              now={now}
              hasKey={hasKey}
              onUnlock={() => setModalOpen(true)}
            />
          ))}
        </>
      )}

      {detail && (
        <DeviceDetail
          device={detail}
          now={now}
          hasKey={hasKey}
          onClose={closeDetail}
          onUnlock={() => setModalOpen(true)}
          onLock={onLocked}
        />
      )}

      <DeviceUnlockModal open={modalOpen} onClose={() => setModalOpen(false)} onUnlocked={onUnlocked} />

      <div className={[styles.toast, toast ? styles.toastShow : ''].join(' ')} role="status">
        {toast}
      </div>
    </section>
  )
}
