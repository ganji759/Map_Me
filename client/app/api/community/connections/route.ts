import { NextRequest, NextResponse } from 'next/server'
import { getSessionUser, asIdOrNull } from '@/lib/session'
import { clientIp, rateLimit } from '@/lib/rateLimit'
import {
  listConnections,
  inviteConnection,
  respondConnection,
  getAttributions,
  type Connection,
} from '@/lib/community'

export const runtime = 'nodejs'

const ACTIONS = ['invite', 'accept', 'decline', 'block', 'cancel', 'remove', 'unblock'] as const
type Action = (typeof ACTIONS)[number]

// GET /api/community/connections — the caller's edges, split into accepted +
// pending (incoming/outgoing), with the other party's public attribution.
export async function GET(req: NextRequest) {
  const uid = getSessionUser(req)
  if (!uid) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })

  try {
    const edges = await listConnections(uid)
    const otherIds = edges.map((e) => (e.requester_id === uid ? e.recipient_id : e.requester_id))
    const users = await getAttributions(otherIds)

    const decorate = (e: Connection) => {
      const otherId = e.requester_id === uid ? e.recipient_id : e.requester_id
      return { ...e, user: users[otherId] ?? null }
    }

    return NextResponse.json({
      accepted: edges.filter((e) => e.status === 'accepted').map(decorate),
      pending_in: edges.filter((e) => e.status === 'pending' && e.recipient_id === uid).map(decorate),
      pending_out: edges.filter((e) => e.status === 'pending' && e.requester_id === uid).map(decorate),
      blocked: edges.filter((e) => e.status === 'blocked' && e.requester_id === uid).map(decorate),
    })
  } catch (err) {
    console.error('[community/connections GET]', err)
    return NextResponse.json({ error: 'Could not load connections.' }, { status: 500 })
  }
}

// POST /api/community/connections { action: 'invite'|'accept'|'decline'|'block', user_id }
export async function POST(req: NextRequest) {
  const uid = getSessionUser(req)
  if (!uid) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })
  if (!rateLimit(`community:connections:${uid}:${clientIp(req)}`, { capacity: 20, refillPerSec: 0.5 }).allowed) {
    return NextResponse.json({ error: 'Too many requests. Please wait a moment.' }, { status: 429 })
  }

  let body: { action?: unknown; user_id?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })
  }

  const action = body.action as Action
  const otherId = asIdOrNull(body.user_id)
  if (!ACTIONS.includes(action) || !otherId) {
    return NextResponse.json({ error: 'Invalid action or user.' }, { status: 400 })
  }

  try {
    const result =
      action === 'invite'
        ? await inviteConnection(uid, otherId)
        : await respondConnection(uid, otherId, action)

    if (!result.ok) {
      const messages: Record<string, string> = {
        self: 'You cannot connect with yourself.',
        not_found: 'User not found.',
        already_connected: 'You are already connected.',
        already_pending: 'Invite already sent.',
        blocked: 'This connection is unavailable.',
        no_pending: 'No pending invite from this user.',
        no_connection: 'You are not connected.',
        no_block: 'This user is not blocked.',
      }
      return NextResponse.json({ error: messages[result.reason] ?? 'Request failed.' }, { status: 409 })
    }
    return NextResponse.json({ ok: true, connection: result.connection })
  } catch (err) {
    console.error('[community/connections POST]', err)
    return NextResponse.json({ error: 'Request failed.' }, { status: 500 })
  }
}
