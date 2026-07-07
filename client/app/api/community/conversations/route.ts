import { NextRequest, NextResponse } from 'next/server'
import { getSessionUser, asIdOrNull } from '@/lib/session'
import { clientIp, rateLimit } from '@/lib/rateLimit'
import { listConversations, createConversation, type ConversationType } from '@/lib/community'

export const runtime = 'nodejs'

const TYPES: ConversationType[] = ['dm', 'group', 'pin']

// GET /api/community/conversations — the caller's conversations with member
// profiles, last message seq, and an unread hint (last_seq vs read cursor).
export async function GET(req: NextRequest) {
  const uid = getSessionUser(req)
  if (!uid) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })

  try {
    const conversations = await listConversations(uid)
    return NextResponse.json({ conversations })
  } catch (err) {
    console.error('[community/conversations GET]', err)
    return NextResponse.json({ error: 'Could not load conversations.' }, { status: 500 })
  }
}

// POST /api/community/conversations
// { type: 'dm'|'group'|'pin', member_ids, title?, pin_id?, wrapped_keys? }
// Every member must be an accepted connection of the creator. DMs dedupe to
// one conversation per pair. wrapped_keys are opaque E2EE key blobs per member.
export async function POST(req: NextRequest) {
  const uid = getSessionUser(req)
  if (!uid) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })
  if (!rateLimit(`community:conversations:${uid}:${clientIp(req)}`, { capacity: 10, refillPerSec: 0.2 }).allowed) {
    return NextResponse.json({ error: 'Too many requests. Please wait a moment.' }, { status: 429 })
  }

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })
  }

  const type = body.type as ConversationType
  if (!TYPES.includes(type)) return NextResponse.json({ error: 'Invalid conversation type.' }, { status: 400 })

  const rawMembers = Array.isArray(body.member_ids) ? body.member_ids : []
  const memberIds = rawMembers
    .map((v) => asIdOrNull(v))
    .filter((v): v is string => Boolean(v))
    .slice(0, 20)
  if (memberIds.length === 0) return NextResponse.json({ error: 'Add at least one member.' }, { status: 400 })

  const title = typeof body.title === 'string' ? body.title.trim().slice(0, 120) : undefined
  const pinId = asIdOrNull(body.pin_id) ?? undefined

  let wrappedKeys: Record<string, string> | undefined
  if (body.wrapped_keys !== undefined) {
    if (typeof body.wrapped_keys !== 'object' || body.wrapped_keys === null || Array.isArray(body.wrapped_keys)) {
      return NextResponse.json({ error: 'Invalid wrapped_keys.' }, { status: 400 })
    }
    wrappedKeys = {}
    for (const [k, v] of Object.entries(body.wrapped_keys as Record<string, unknown>)) {
      if (typeof v === 'string') wrappedKeys[k] = v
    }
  }

  try {
    const result = await createConversation(uid, { type, memberIds, title, pinId, wrappedKeys })
    if (!result.ok) {
      const messages: Record<string, string> = {
        invalid: 'Invalid conversation.',
        not_connected: 'Everyone in a conversation must be one of your accepted connections.',
        pin_not_visible: 'Pin not found.',
      }
      const status = result.reason === 'not_connected' ? 403 : result.reason === 'pin_not_visible' ? 404 : 400
      return NextResponse.json({ error: messages[result.reason] }, { status })
    }
    return NextResponse.json({ ok: true, conversation: result.conversation, existing: result.existing })
  } catch (err) {
    console.error('[community/conversations POST]', err)
    return NextResponse.json({ error: 'Could not create the conversation.' }, { status: 500 })
  }
}
