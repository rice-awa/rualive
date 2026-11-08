import { maintenances, workerConfig } from '@/uptime.config'
import { NextRequest } from 'next/server'
import { CompactedMonitorStateWrapper, getFromStore } from '@/worker/src/store'
import { withApiGuard } from '@/util/apiGuard'

export const runtime = 'edge'

/**
 * 监控状态 JSON API（legacy）。
 * 鉴权：页面会话 Cookie 或 X-API-Key；跨域消费方请显式带 X-API-Key。
 */
async function handler(req: NextRequest): Promise<Response> {
  const compactedState = new CompactedMonitorStateWrapper(
    await getFromStore(process.env as any, 'state')
  )

  if (compactedState.data.lastUpdate === 0) {
    return new Response(JSON.stringify({ error: 'No data available' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  let monitors: any = {}

  for (let monitor of workerConfig.monitors) {
    const lastIncident = compactedState.getIncident(
      monitor.id,
      compactedState.incidentLen(monitor.id) - 1
    )

    const isUp = lastIncident?.end !== null
    const latency = compactedState.getLastLatency(monitor.id)
    monitors[monitor.id] = {
      up: isUp,
      latency: latency.ping,
      location: latency.loc,
      message: isUp ? 'OK' : lastIncident?.error[lastIncident.error.length - 1],
    }
  }

  let ret = {
    up: compactedState.data.overallUp,
    down: compactedState.data.overallDown,
    updatedAt: compactedState.data.lastUpdate,
    monitors,
    maintenances,
  }

  return new Response(JSON.stringify(ret), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

export default withApiGuard(handler, {
  methods: ['GET'],
  auth: 'session-or-key',
})
