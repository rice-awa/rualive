import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { DevicePublicView } from '@/worker/src/deviceStore'
import { reloadOnceForSession } from '@/util/sessionReload'
import { clearUsageKey, fetchWithUsageKey, getUsageKey, setUsageKey } from '@/util/usageKey'

/** 轮询间隔：30s（PRD F3 自动刷新） */
const POLL_INTERVAL_MS = 30_000
/** 相对时间刷新 tick：1s（与原型一致，仅影响设备区消费者） */
const TICK_INTERVAL_MS = 1_000

export type DeviceStatusState = {
  devices: DevicePublicView[]
  /** 服务端 now（来自最近一次轮询），用于无状态在线判定与相对时间 */
  now: number
  /** 本地是否缓存了（曾验证有效的）USAGE_API_KEY */
  hasKey: boolean
  /** 立即重新轮询 */
  refresh: () => void
  /** 解锁成功后调用（key 已由 DeviceUnlockModal 验证） */
  unlock: (key: string) => void
  /** 「锁定」按钮：清除 localStorage 缓存并回访客视角 */
  lock: () => void
}

const DeviceContext = createContext<DeviceStatusState | null>(null)

/**
 * 设备数据层（主页 / 猫猫日记 / 设备详情共用）：
 * - SSR props 作为初始公开数据（首屏不白屏）
 * - 每 30s 轮询 GET /api/device/status（带本地 key 时自动附 X-API-Key，补齐窗口等详细字段）
 * - 每 1s tick 刷新相对时间（最后心跳 "X 分钟前"、状态色随 now 变化）
 */
export function DeviceProvider({
  initial,
  children,
}: {
  initial: DevicePublicView[]
  children: React.ReactNode
}) {
  const [devices, setDevices] = useState<DevicePublicView[]>(initial)
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000))
  const [hasKey, setHasKey] = useState(() => !!getUsageKey())

  const poll = useCallback(async () => {
    try {
      const res = await fetchWithUsageKey('/api/device/status')
      if (res.status === 401 || res.status === 403) {
        // 401/403 说明页面会话 Cookie 缺失或过期，不是 usage key 失效；
        // 不能 clearUsageKey，否则会把用户有效密钥误删。整页 reload 重新拿 Cookie。
        reloadOnceForSession()
        return
      }
      if (!res.ok) return
      const data = (await res.json()) as { devices?: DevicePublicView[]; now?: number }
      if (Array.isArray(data.devices)) {
        setDevices(data.devices)
        setNow(typeof data.now === 'number' ? data.now : Math.floor(Date.now() / 1000))
      }
    } catch {
      // 网络错误：下个周期照常重试
    }
  }, [])

  // 首次 + 每 30s 轮询
  useEffect(() => {
    poll()
    const timer = setInterval(poll, POLL_INTERVAL_MS)
    return () => clearInterval(timer)
  }, [poll, hasKey])

  // 1s tick 刷新相对时间（纯客户端行为）
  useEffect(() => {
    const timer = setInterval(() => {
      setNow(Math.floor(Date.now() / 1000))
    }, TICK_INTERVAL_MS)
    return () => clearInterval(timer)
  }, [])

  const refresh = useCallback(() => {
    poll()
  }, [poll])

  const unlock = useCallback((key: string) => {
    setUsageKey(key)
    setHasKey(true)
    refresh()
  }, [refresh])

  const lock = useCallback(() => {
    clearUsageKey()
    setHasKey(false)
    refresh()
  }, [refresh])

  return (
    <DeviceContext.Provider
      value={{ devices, now, hasKey, refresh, unlock, lock }}
    >
      {children}
    </DeviceContext.Provider>
  )
}

export function useDeviceStatus(): DeviceStatusState {
  const ctx = useContext(DeviceContext)
  if (!ctx) throw new Error('useDeviceStatus must be used within <DeviceProvider>')
  return ctx
}
