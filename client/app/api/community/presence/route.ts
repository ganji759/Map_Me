import { NextRequest, NextResponse } from 'next/server'
import { getSessionUser, asIdOrNull } from '@/lib/session'
import { clientIp, rateLimit } from '@/lib/rateLimit'
import { heartbeat, getPresenceFor } from '@/lib/community'

export const runtime = 'nodejs'

// POST /api/community/presence — heartbeat. Bumps last_seen_at; if the caller
// has share_location enabled and sends { lat, lng }, refreshes their location.
export async function POST(req: NextRequest) {
  const uid = getSessionUser(req)
  if (!uid) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })
  if (!rateLimit(`community:presence:${uid}:${clientIp(req)}`, { capacity: 10, refillPerSec: 0.5 }).allowed) {
    return NextResponse.json({ error: 'Heartbeating too fast.' }, { status: 429 })
  }

  let loc: { lat: number; lng: number } | undefined
  try {
    const body = (await req.json().catch(() => ({}))) as { lat?: unknown; lng?: unknown }
    if (typeof body.lat === 'number' && typeof body.lng === 'number' &&
        Number.isFinite(body.lat) && Number.isFinite(body.lng) &&
        Math.abs(body.lat) <= 90 && Math.abs(body.lng) <= 180) {
      loc = { lat: body.lat, lng: body.lng }
    }
  } catch { /* heartbeat without a body is fine */ }

  try {
    await heartbeat(uid, loc)
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[community/presence POST]', err)
    return NextResponse.json({ error: 'Heartbeat failed.' }, { status: 500 })
  }
}

// GET /api/community/presence?ids=a,b,c — online status for accepted
// connections only (ids outside the caller's network are silently omitted).
export async function GET(req: NextRequest) {
  const uid = getSessionUser(req)
  if (!uid) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })

  const ids = (req.nextUrl.searchParams.get('ids') ?? '')
    .split(',')
    .map((s) => asIdOrNull(s.trim()))
    .filter((s): s is string => Boolean(s))
    .slice(0, 50)
  if (ids.length === 0) return NextResponse.json({ presence: {} })

  try {
    const presence = await getPresenceFor(uid, ids)
    return NextResponse.json({ presence })
  } catch (err) {
    console.error('[community/presence GET]', err)
    return NextResponse.json({ error: 'Could not load presence.' }, { status: 500 })
  }
}
