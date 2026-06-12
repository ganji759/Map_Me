import { NextRequest, NextResponse } from 'next/server'

const MCP_URL = process.env.MONGODB_MCP_URL ?? 'http://localhost:3100/mcp'
const DB = process.env.MONGODB_DATABASE ?? 'hodari'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

async function mcpSession(): Promise<string> {
  const res = await fetch(MCP_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 0,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'hodari-client', version: '1.0' },
      },
    }),
  })
  const sid = res.headers.get('mcp-session-id')
  if (!sid) throw new Error('MCP did not return a session ID')
  return sid
}

/**
 * Call an MCP tool and return its text content items (SSE or plain JSON body).
 * Throws on a JSON-RPC error OR a tool-level error (`result.isError`) — the
 * mongodb-mcp-server reports "not connected" / write failures via isError, and
 * silently swallowing those is what makes a failed sign-in look successful.
 */
async function mcpCall(sid: string, name: string, args: Record<string, unknown>): Promise<string[]> {
  const res = await fetch(MCP_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      'mcp-session-id': sid,
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: '1',
      method: 'tools/call',
      params: { name, arguments: args },
    }),
  })
  const body = await res.text()
  const payloads = body.includes('data:')
    ? body.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim())
    : [body]
  for (const payload of payloads) {
    let msg: { result?: { content?: Array<{ type: string; text?: string }>; isError?: boolean }; error?: { message?: string } }
    try {
      msg = JSON.parse(payload)
    } catch {
      continue
    }
    if (msg.error) throw new Error(msg.error.message ?? 'MCP tool error')
    if (msg.result?.content) {
      const texts = msg.result.content.filter((c) => c.type === 'text' && c.text).map((c) => c.text as string)
      if (msg.result.isError) throw new Error(texts.join(' ') || 'MongoDB MCP returned an error')
      return texts
    }
  }
  return []
}

/**
 * If the server was started without a connection string, try to connect it with
 * MONGODB_URI when that is available to the Next process. A no-op otherwise; the
 * next call then surfaces a clear "not connected" error.
 */
async function ensureConnected(sid: string): Promise<void> {
  const uri = process.env.MONGODB_URI
  if (!uri) return
  try {
    await mcpCall(sid, 'connect', { connectionString: uri })
  } catch {
    /* already connected, or connect unsupported — ignore and let real calls report */
  }
}

/** The mongodb-mcp-server returns docs as a JSON array inside one text item. */
function extractDocs(texts: string[]): Array<Record<string, unknown>> {
  for (const t of texts) {
    try {
      const parsed = JSON.parse(t)
      if (Array.isArray(parsed)) return parsed
    } catch { /* summary lines are not JSON — skip */ }
  }
  return []
}

function publicUser(doc: Record<string, unknown>) {
  return {
    user_id: doc.user_id,
    name: doc.name ?? null,
    email: doc.email,
    home_country: doc.home_country ?? null,
    languages: doc.languages ?? ['en'],
    budget_tier: doc.budget_tier ?? 'moderate',
  }
}

/** Turn a chosen name/handle into a stable, URL-safe user_id. */
function slugifyId(name: string, email: string): string {
  const base = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
  return base || email.split('@')[0].replace(/[^a-z0-9_]/g, '') || 'fan'
}

export async function POST(req: NextRequest) {
  let email: string
  let name: string
  try {
    const body = await req.json()
    email = String(body.email ?? '').trim().toLowerCase()
    name = String(body.name ?? '').trim()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }
  if (!name || name.length < 2) {
    return NextResponse.json({ error: 'Enter your name or a username (at least 2 characters).' }, { status: 400 })
  }
  if (!EMAIL_RE.test(email)) {
    return NextResponse.json({ error: 'Enter a valid email address.' }, { status: 400 })
  }

  try {
    const sid = await mcpSession()
    await ensureConnected(sid)

    // Returning user: match on email, keep their stable user_id, refresh the name.
    const existing = extractDocs(
      await mcpCall(sid, 'find', { database: DB, collection: 'users', filter: { email }, limit: 1 }),
    )
    if (existing.length > 0) {
      const doc = existing[0]
      if (doc.name !== name) {
        await mcpCall(sid, 'update-many', {
          database: DB,
          collection: 'users',
          filter: { email },
          update: { $set: { name } },
        })
        doc.name = name
      }
      return NextResponse.json({ user: publicUser(doc), isNew: false })
    }

    // First sign-in: create a profile matching the existing users schema.
    let userId = slugifyId(name, email)
    const clash = extractDocs(
      await mcpCall(sid, 'find', { database: DB, collection: 'users', filter: { user_id: userId }, limit: 1 }),
    )
    if (clash.length > 0) {
      userId = `${userId}_${Math.random().toString(36).slice(2, 6)}`
    }

    const doc = {
      user_id: userId,
      name,
      email,
      home_country: null,
      languages: ['en'],
      dietary: [],
      budget_tier: 'moderate',
      accessibility: [],
      created_at: new Date().toISOString(),
    }
    await mcpCall(sid, 'insert-many', { database: DB, collection: 'users', documents: [doc] })

    return NextResponse.json({ user: publicUser(doc), isNew: true })
  } catch (err) {
    console.error('[auth/login]', err)
    const detail = 'Sign-in is temporarily unavailable. Please try again in a moment.'
    return NextResponse.json({ error: detail }, { status: 502 })
  }
}
