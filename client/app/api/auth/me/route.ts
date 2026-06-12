import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/session'
import { mcpSession, mcpCall, ensureConnected, extractDocs } from '@/lib/mcp'

const DB = process.env.MONGODB_DATABASE ?? 'hodari'

// Returns the signed-in user from the session cookie (used to hydrate the
// client after the OAuth redirect, which can't set localStorage). Best-effort
// name lookup; falls back to the cookie's uid/email if the DB is unreachable.
export async function GET(req: NextRequest) {
  const session = getSession(req)
  if (!session) return NextResponse.json({ authed: false }, { status: 401 })

  let name: string | null = session.email ? session.email.split('@')[0] : null
  try {
    const sid = await mcpSession()
    await ensureConnected(sid)
    const docs = extractDocs(
      await mcpCall(sid, 'find', { database: DB, collection: 'users', filter: { user_id: session.uid }, limit: 1 }),
    )
    if (docs[0]?.name) name = String(docs[0].name)
  } catch { /* fall back to email local-part */ }

  return NextResponse.json({
    authed: true,
    user: { user_id: session.uid, email: session.email ?? null, name },
  })
}
