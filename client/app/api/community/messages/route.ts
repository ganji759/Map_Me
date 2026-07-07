import { NextRequest, NextResponse } from 'next/server'
import { getSessionUser, asIdOrNull } from '@/lib/session'
import { clientIp, rateLimit } from '@/lib/rateLimit'
import { getConversation, listMessages, appendMessage, markRead, MAX_CIPHERTEXT_B64 } from '@/lib/community'

export const runtime = 'nodejs'

// GET /api/community/messages?conversation_id=…&after_seq=N — polling reads.
// Members only; returns up to 100 ciphertext messages ordered by seq and
// advances the caller's read cursor (the unread hint in the conversation list).
export async function GET(req: NextRequest) {
  const uid = getSessionUser(req)
  if (!uid) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })
  if (!rateLimit(`community:messages:get:${uid}`, { capacity: 30, refillPerSec: 2 }).allowed) {
    return NextResponse.json({ error: 'Polling too fast. Please slow down.' }, { status: 429 })
  }

  const conversationId = asIdOrNull(req.nextUrl.searchParams.get('conversation_id'))
  if (!conversationId) return NextResponse.json({ error: 'Missing conversation_id.' }, { status: 400 })
  const afterSeqRaw = Number(req.nextUrl.searchParams.get('after_seq') ?? 0)
  const afterSeq = Number.isFinite(afterSeqRaw) && afterSeqRaw > 0 ? afterSeqRaw : 0

  try {
    const conv = await getConversation(conversationId)
    if (!conv || !conv.member_ids.includes(uid)) {
      // Same response for "missing" and "not a member" — don't confirm ids.
      return NextResponse.json({ error: 'Conversation not found.' }, { status: 404 })
    }
    const messages = await listMessages(conversationId, afterSeq, 100)
    if (messages.length > 0) {
      await markRead(conversationId, uid, messages[messages.length - 1].seq)
    }
    return NextResponse.json({ messages, last_seq: conv.last_seq })
  } catch (err) {
    console.error('[community/messages GET]', err)
    return NextResponse.json({ error: 'Could not load messages.' }, { status: 500 })
  }
}

// POST /api/community/messages { conversation_id, ciphertext, iv, msg_type }
// The server stores ONLY ciphertext — plaintext never reaches this route.
// Image messages are the encrypted image bytes; payload capped at 400KB base64.
export async function POST(req: NextRequest) {
  const uid = getSessionUser(req)
  if (!uid) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })
  if (!rateLimit(`community:messages:post:${uid}:${clientIp(req)}`, { capacity: 30, refillPerSec: 1 }).allowed) {
    return NextResponse.json({ error: 'Sending too fast. Please slow down.' }, { status: 429 })
  }

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })
  }

  const conversationId = asIdOrNull(body.conversation_id)
  if (!conversationId) return NextResponse.json({ error: 'Missing conversation_id.' }, { status: 400 })
  const ciphertext = typeof body.ciphertext === 'string' ? body.ciphertext : ''
  const iv = typeof body.iv === 'string' ? body.iv : ''
  const msgType = body.msg_type === 'image' ? 'image' : body.msg_type === 'text' ? 'text' : null
  if (!ciphertext || !iv || !msgType) {
    return NextResponse.json({ error: 'ciphertext, iv and msg_type are required.' }, { status: 400 })
  }
  if (ciphertext.length > MAX_CIPHERTEXT_B64) {
    return NextResponse.json({ error: 'Message too large (max 400KB encrypted).' }, { status: 413 })
  }

  try {
    const conv = await getConversation(conversationId)
    if (!conv || !conv.member_ids.includes(uid)) {
      return NextResponse.json({ error: 'Conversation not found.' }, { status: 404 })
    }
    const result = await appendMessage(conv, uid, ciphertext, iv, msgType)
    if (!result.ok) {
      const status = result.reason === 'too_large' ? 413 : 400
      return NextResponse.json({ error: result.reason === 'too_large' ? 'Message too large.' : 'Invalid message payload.' }, { status })
    }
    return NextResponse.json({ ok: true, message: result.message })
  } catch (err) {
    console.error('[community/messages POST]', err)
    return NextResponse.json({ error: 'Could not send the message.' }, { status: 500 })
  }
}
