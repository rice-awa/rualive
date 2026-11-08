import { NextRequest } from 'next/server'
import { getFromStore } from '@/worker/src/store'
import { withApiGuard } from '@/util/apiGuard'

export const runtime = 'edge'

/**
 * 返回原始压缩监控状态串，前端拿到后就地解包更新（无整页刷新，替代旧的重载逻辑）。
 * 鉴权：页面会话 Cookie 或 X-API-Key；WAF 在边缘还会做一次存在性检查。
 */
async function handler(req: NextRequest): Promise<Response> {
  const compactedStateStr = await getFromStore(process.env as any, 'state')

  if (!compactedStateStr) {
    return new Response(JSON.stringify({ error: 'No data available' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  return new Response(JSON.stringify({ compactedStateStr }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

export default withApiGuard(handler, {
  methods: ['GET'],
  auth: 'session-or-key',
})
