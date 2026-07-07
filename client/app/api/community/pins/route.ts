import { NextRequest, NextResponse } from 'next/server'
import { getSessionUser, asIdOrNull } from '@/lib/session'
import { clientIp, rateLimit } from '@/lib/rateLimit'
import { listVisiblePins, sharePin, deletePin, MAX_PIN_NOTE, type SharePinInput } from '@/lib/community'

export const runtime = 'nodejs'

// GET /api/community/pins — every pin visible to the caller (own, shared with
// them, or in one of their conversations), with owner attribution.
export async function GET(req: NextRequest) {
  const uid = getSessionUser(req)
  if (!uid) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })

  try {
    const pins = await listVisiblePins(uid)
    return NextResponse.json({ pins })
  } catch (err) {
    console.error('[community/pins GET]', err)
    return NextResponse.json({ error: 'Could not load pins.' }, { status: 500 })
  }
}

// POST /api/community/pins { place, note?, shared_with? | conversation_id? }
export async function POST(req: NextRequest) {
  const uid = getSessionUser(req)
  if (!uid) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })
  if (!rateLimit(`community:pins:${uid}:${clientIp(req)}`, { capacity: 10, refillPerSec: 0.2 }).allowed) {
    return NextResponse.json({ error: 'Too many pins. Please wait a moment.' }, { status: 429 })
  }

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })
  }

  const place = body.place as SharePinInput['place'] | undefined
  const note = typeof body.note === 'string' ? body.note : ''
  if (note.length > MAX_PIN_NOTE) {
    return NextResponse.json({ error: `Notes are limited to ${MAX_PIN_NOTE} characters.` }, { status: 400 })
  }

  const conversationId = asIdOrNull(body.conversation_id) ?? undefined
  const rawShared = Array.isArray(body.shared_with) ? body.shared_with : []
  const sharedWith = rawShared
    .map((v) => asIdOrNull(v))
    .filter((v): v is string => Boolean(v))
    .slice(0, 50)

  try {
    const result = await sharePin(uid, { place: place as SharePinInput['place'], note, sharedWith, conversationId })
    if (!result.ok) {
      const messages: Record<string, string> = {
        invalid_place: 'A valid place (place_id, name, lat, lng) is required.',
        not_conversation_member: 'You are not a member of that conversation.',
        no_audience: 'Share with at least one accepted connection or a conversation.',
      }
      return NextResponse.json({ error: messages[result.reason] ?? 'Could not share the pin.' }, { status: 400 })
    }
    return NextResponse.json({ ok: true, pin: result.pin })
  } catch (err) {
    console.error('[community/pins POST]', err)
    return NextResponse.json({ error: 'Could not share the pin.' }, { status: 500 })
  }
}

// DELETE /api/community/pins?pin_id=… — remove a pin the caller owns.
export async function DELETE(req: NextRequest) {
  const uid = getSessionUser(req)
  if (!uid) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })

  const pinId = asIdOrNull(req.nextUrl.searchParams.get('pin_id'))
  if (!pinId) return NextResponse.json({ error: 'Missing pin_id.' }, { status: 400 })

  try {
    const deleted = await deletePin(uid, pinId)
    if (!deleted) return NextResponse.json({ error: 'Pin not found.' }, { status: 404 })
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[community/pins DELETE]', err)
    return NextResponse.json({ error: 'Could not delete the pin.' }, { status: 500 })
  }
}
