import { NextRequest, NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/session'
import { clientIp, rateLimit } from '@/lib/rateLimit'
import { searchUsers, usersNear } from '@/lib/community'

export const runtime = 'nodejs'

// GET /api/community/users/search?q=prefix   → handle/name prefix match
// GET /api/community/users/search?near=1     → discoverable users within ~25km
// Discoverable users only; the caller is always excluded. Each result carries
// online status and the connection status relative to the caller.
export async function GET(req: NextRequest) {
  const uid = getSessionUser(req)
  if (!uid) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })
  if (!rateLimit(`community:search:${uid}:${clientIp(req)}`, { capacity: 20, refillPerSec: 1 }).allowed) {
    return NextResponse.json({ error: 'Too many searches. Please wait a moment.' }, { status: 429 })
  }

  try {
    if (req.nextUrl.searchParams.get('near') === '1') {
      // usersNear falls back to [] when the caller isn't sharing a location or
      // the 2dsphere index is missing.
      const users = await usersNear(uid)
      return NextResponse.json({ users })
    }

    const q = (req.nextUrl.searchParams.get('q') ?? '').trim()
    if (!q || q.length > 50) return NextResponse.json({ users: [] })
    const users = await searchUsers(uid, q)
    return NextResponse.json({ users })
  } catch (err) {
    console.error('[community/users/search GET]', err)
    return NextResponse.json({ error: 'Search failed.' }, { status: 500 })
  }
}
