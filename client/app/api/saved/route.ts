import { NextRequest, NextResponse } from 'next/server'

const MCP_URL = process.env.MONGODB_MCP_URL ?? 'http://localhost:3100/mcp'
const DB = process.env.MONGODB_DATABASE ?? 'hodari'

async function mcpSession(): Promise<string> {
  const res = await fetch(MCP_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 0,
      method: 'initialize',
      params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'hodari-client', version: '1.0' } },
    }),
  })
  const sid = res.headers.get('mcp-session-id')
  if (!sid) throw new Error('MCP did not return a session ID')
  return sid
}

async function mcpCall(sid: string, name: string, args: Record<string, unknown>): Promise<unknown[]> {
  const res = await fetch(MCP_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', 'mcp-session-id': sid },
    body: JSON.stringify({ jsonrpc: '2.0', id: '1', method: 'tools/call', params: { name, arguments: args } }),
  })
  const body = await res.text()
  const payloads = body.includes('data:')
    ? body.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim())
    : [body]
  for (const payload of payloads) {
    try {
      const msg = JSON.parse(payload) as { result?: { content?: Array<{ type: string; text?: string }> } }
      if (msg.result?.content) {
        for (const c of msg.result.content) {
          if (c.type === 'text' && c.text) {
            try { const parsed = JSON.parse(c.text); if (Array.isArray(parsed)) return parsed } catch { /* ok */ }
          }
        }
      }
    } catch { /* ok */ }
  }
  return []
}

// GET /api/saved?userId=X — fetch saved interactions
export async function GET(req: NextRequest) {
  const userId = req.nextUrl.searchParams.get('userId')
  if (!userId) return NextResponse.json({ saved: [] })

  try {
    const sid = await mcpSession()
    const uri = process.env.MONGODB_URI
    if (uri) {
      try { await mcpCall(sid, 'connect', { connectionString: uri }) } catch { /* ok */ }
    }
    const docs = await mcpCall(sid, 'find', {
      database: DB,
      collection: 'interactions',
      filter: { user_id: userId, action: { $in: ['saved', 'reminder'] } },
      sort: { timestamp: -1 },
      limit: 200,
    })
    return NextResponse.json({ saved: docs })
  } catch (err) {
    console.error('[api/saved GET]', err)
    return NextResponse.json({ saved: [] })
  }
}

// POST /api/saved — upsert a reminder with a visitDate
export async function POST(req: NextRequest) {
  const { userId, placeId, placeName, city, visitDate, note } = await req.json()
  if (!userId || !placeId) return NextResponse.json({ error: 'Missing userId or placeId' }, { status: 400 })

  try {
    const sid = await mcpSession()
    const uri = process.env.MONGODB_URI
    if (uri) {
      try { await mcpCall(sid, 'connect', { connectionString: uri }) } catch { /* ok */ }
    }
    await mcpCall(sid, 'update-many', {
      database: DB,
      collection: 'interactions',
      filter: { user_id: userId, place_id: placeId, action: 'reminder' },
      update: {
        $set: {
          user_id: userId,
          place_id: placeId,
          place_name: placeName ?? '',
          city: city ?? '',
          action: 'reminder',
          visit_date: visitDate ?? null,
          note: note ?? '',
          updated_at: new Date().toISOString(),
        },
      },
      upsert: true,
    })
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[api/saved POST]', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
