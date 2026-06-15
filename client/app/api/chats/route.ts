import { NextRequest, NextResponse } from 'next/server'
import { asId, getSessionUser } from '@/lib/session'
import { listChats, upsertChat, deleteChat } from '@/lib/chats'

export const runtime = 'nodejs'

/**
 * Per-user chat history. Identity is server-authoritative (session cookie).
 * Guests get `{ authed: false }` and fall back to localStorage on the client.
 */
export async function GET(req: NextRequest) {
  const uid = getSessionUser(req)
  if (!uid) return NextResponse.json({ authed: false, chats: [] })
  try {
    return NextResponse.json({ authed: true, chats: await listChats(uid) })
  } catch (err) {
    console.error('[chats GET]', err)
    return NextResponse.json({ authed: true, chats: [] })
  }
}

export async function POST(req: NextRequest) {
  const uid = getSessionUser(req)
  if (!uid) return NextResponse.json({ ok: false, authed: false }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  let sessionId: string
  try {
    sessionId = asId(body.sessionId, 'sessionId')
  } catch {
    return NextResponse.json({ error: 'Invalid sessionId' }, { status: 400 })
  }
  const messages = Array.isArray(body.messages) ? body.messages : []
  const title = typeof body.title === 'string' && body.title.trim() ? body.title : 'Untitled chat'

  try {
    await upsertChat(uid, { sessionId, title, messages, updatedAt: Date.now() })
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[chats POST]', err)
    return NextResponse.json({ ok: false }, { status: 502 })
  }
}

export async function DELETE(req: NextRequest) {
  const uid = getSessionUser(req)
  if (!uid) return NextResponse.json({ ok: false }, { status: 401 })
  let sessionId: string
  try {
    sessionId = asId(req.nextUrl.searchParams.get('sessionId'), 'sessionId')
  } catch {
    return NextResponse.json({ error: 'Invalid sessionId' }, { status: 400 })
  }
  try {
    await deleteChat(uid, sessionId)
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[chats DELETE]', err)
    return NextResponse.json({ ok: false }, { status: 502 })
  }
}
