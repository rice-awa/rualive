import { NextRequest } from 'next/server'
import { getFromStore } from '@/worker/src/store'

export const runtime = 'edge'

const headers = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Cache-Control': 'no-store',
}

/** 返回原始压缩监控状态串，前端拿到后就地解包更新（无整页刷新，替代旧的重载逻辑） */
export default async function handler(req: NextRequest): Promise<Response> {
  const compactedStateStr = await getFromStore(process.env as any, 'state')

  if (!compactedStateStr) {
    return new Response(JSON.stringify({ error: 'No data available' }), {
      status: 500,
      headers,
    })
  }

  return new Response(JSON.stringify({ compactedStateStr }), {
    status: 200,
    headers,
  })
}
