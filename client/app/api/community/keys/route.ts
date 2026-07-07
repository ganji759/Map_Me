import { NextRequest, NextResponse } from 'next/server'
import { getSessionUser, asIdOrNull } from '@/lib/session'
import { clientIp, rateLimit } from '@/lib/rateLimit'
import { getPubkeys } from '@/lib/community'

export const runtime = 'nodejs'

// GET /api/community/keys?ids=a,b,c — published E2EE public keys (JWKs).
// Public keys are public by design: any authenticated user can fetch them,
// since they're required to wrap a conversation key for a new chat.
export async function GET(req: NextRequest) {
  const uid = getSessionUser(req)
  if (!uid) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })
  if (!rateLimit(`community:keys:${uid}:${clientIp(req)}`, { capacity: 20, refillPerSec: 1 }).allowed) {
    return NextResponse.json({ error: 'Too many requests. Please wait a moment.' }, { status: 429 })
  }

  const ids = (req.nextUrl.searchParams.get('ids') ?? '')
    .split(',')
    .map((s) => asIdOrNull(s.trim()))
    .filter((s): s is string => Boolean(s))
    .slice(0, 50)
  if (ids.length === 0) return NextResponse.json({ keys: {} })

  try {
    const keys = await getPubkeys(ids)
    return NextResponse.json({ keys })
  } catch (err) {
    console.error('[community/keys GET]', err)
    return NextResponse.json({ error: 'Could not load keys.' }, { status: 500 })
  }
}
