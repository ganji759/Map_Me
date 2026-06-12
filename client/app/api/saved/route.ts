import { NextRequest, NextResponse } from 'next/server'
import { asId, asIdOrNull, getSessionUser } from '@/lib/session'

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

/**
 * Extract a document array from an MCP tool result. The MongoDB MCP `find`
 * tool returns rows as text wrapped in <untrusted-user-data-…> security tags
 * (NOT raw JSON), and some builds use `structuredContent` instead — handle all
 * shapes, mirroring the agent-side parser in agents/hodari/tools/mongo_tools.py.
 */
function extractDocs(result: {
  content?: Array<{ type: string; text?: string }>
  structuredContent?: unknown
}): unknown[] {
  const sc = result.structuredContent
  if (Array.isArray(sc)) return sc
  if (sc && typeof sc === 'object' && Array.isArray((sc as { documents?: unknown }).documents)) {
    return (sc as { documents: unknown[] }).documents
  }
  for (const c of result.content ?? []) {
    if (c.type !== 'text' || !c.text) continue
    // Pure JSON array?
    try { const p = JSON.parse(c.text); if (Array.isArray(p)) return p } catch { /* ok */ }
    // JSON array embedded in one or more <untrusted-user-data-…>…</…> blocks.
    const blocks = c.text.match(/<untrusted-user-data-[^>]+>([\s\S]*?)<\/untrusted-user-data-[^>]+>/g) ?? []
    for (const block of blocks) {
      const inner = block.replace(/<untrusted-user-data-[^>]+>/, '').replace(/<\/untrusted-user-data-[^>]+>/, '').trim()
      try { const p = JSON.parse(inner); if (Array.isArray(p)) return p } catch { /* ok */ }
    }
  }
  return []
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
      const msg = JSON.parse(payload) as {
        result?: { content?: Array<{ type: string; text?: string }>; structuredContent?: unknown }
      }
      if (msg.result) {
        const docs = extractDocs(msg.result)
        if (docs.length) return docs
      }
    } catch { /* ok */ }
  }
  return []
}

// GET /api/saved — fetch saved interactions for the authenticated user.
// Identity comes from the signed session cookie; the ?userId= param is only a
// fallback for clients that predate the cookie (see SECURITY_HARDENING.md P0.1).
export async function GET(req: NextRequest) {
  const userId = getSessionUser(req) ?? asIdOrNull(req.nextUrl.searchParams.get('userId'))
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
  const body = await req.json().catch(() => ({}))
  let userId: string
  let placeId: string
  try {
    userId = getSessionUser(req) ?? asId(body.userId, 'userId')
    placeId = asId(body.placeId, 'placeId')
  } catch {
    return NextResponse.json({ error: 'Missing or invalid userId/placeId' }, { status: 400 })
  }
  const { placeName, city, visitDate, note } = body

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
