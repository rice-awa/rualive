import { NextRequest } from 'next/server'
import { workerConfig } from '@/uptime.config'
import { hasValidUsageKey, withApiGuard } from '@/util/apiGuard'
import { buildDeviceViews } from '@/worker/src/deviceStore'

export const runtime = 'edge'

/**
 * 设备状态读取（PRD F7 数据分级）。
 * - 鉴权：页面会话 Cookie 或 X-API-Key；两者都没有 → 401
 * - 公开：在线/挂机/离线、最后活跃时间、设备名、今日活跃总时长（仅开启统计的设备）
 * - 需密钥：当前窗口标题；应用名默认公开，设备配置 publicApp: false 可隐藏
 * - 无 key 与 key 无效表现一致（字段为 null），不做区分防枚举
 * - 在线判定无状态：按 now - last_seen 实时计算，不依赖写库时更新状态
 */
async function handler(req: NextRequest): Promise<Response> {
  // 有效 key → 可读窗口字段；无效与无 key 一致
  const hasValidKey = hasValidUsageKey(req)

  const now = Math.round(Date.now() / 1000)
  const timeZone = workerConfig.notification?.timeZone ?? 'Asia/Shanghai'

  const devices = await buildDeviceViews(
    process.env as any,
    workerConfig.devices ?? [],
    now,
    timeZone,
    hasValidKey
  )

  return new Response(JSON.stringify({ now, devices }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

export default withApiGuard(handler, {
  methods: ['GET'],
  auth: 'session-or-key',
})
