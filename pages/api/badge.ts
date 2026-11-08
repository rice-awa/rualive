import { NextRequest } from 'next/server'
import { workerConfig } from '@/uptime.config'
import { CompactedMonitorStateWrapper, getFromStore } from '@/worker/src/store'
import { withApiGuard } from '@/util/apiGuard'

export const runtime = 'edge'

type BadgePayload = {
  schemaVersion: 1
  label: string
  message: string
  color: string
  isError?: boolean
}

const MAX_ID = 64
const MAX_TEXT = 64

function cap(value: string | null, max: number): string {
  return (value ?? '').slice(0, max)
}

function errorBadge(label: string, message: string): BadgePayload {
  return {
    schemaVersion: 1,
    label,
    message,
    color: 'lightgrey',
    isError: true,
  }
}

function json(payload: BadgePayload, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

/**
 * shields.io badge 数据（公开，供外部服务抓取）。
 * 参数全部截断上限；未知 monitor id 返回 error badge，而不是误报 UP。
 */
async function handler(req: NextRequest): Promise<Response> {
  try {
    const url = new URL(req.url)

    const monitorId = cap(url.searchParams.get('id'), MAX_ID)
    const label = cap(url.searchParams.get('label'), MAX_TEXT) || monitorId || 'UptimeFlare'

    const upMsg = cap(url.searchParams.get('up'), MAX_TEXT) || 'UP'
    const downMsg = cap(url.searchParams.get('down'), MAX_TEXT) || 'DOWN'
    const colorUp = cap(url.searchParams.get('colorUp'), MAX_TEXT) || 'brightgreen'
    const colorDown = cap(url.searchParams.get('colorDown'), MAX_TEXT) || 'red'

    if (!monitorId) {
      return json(errorBadge(label, 'no-monitor'), 400)
    }
    if (!workerConfig.monitors.some((monitor) => monitor.id === monitorId)) {
      return json(errorBadge(label, 'unknown-monitor'), 404)
    }

    const compactedState = new CompactedMonitorStateWrapper(
      await getFromStore(process.env as any, 'state')
    )

    const lastIncident = compactedState.getIncident(
      monitorId,
      compactedState.incidentLen(monitorId) - 1
    )
    const isUp = lastIncident?.end !== null

    return json({
      schemaVersion: 1,
      label,
      message: isUp ? upMsg : downMsg,
      color: isUp ? colorUp : colorDown,
    })
  } catch (err) {
    console.error('Error rendering badge API:', err)
    return json(errorBadge('status', 'error'), 500)
  }
}

export default withApiGuard(handler, {
  methods: ['GET'],
  auth: 'public',
  // badge 是公开只读数据，允许边缘缓存 60s 降低 D1 读压力
  cacheControl: 'public, max-age=60, s-maxage=60',
})
