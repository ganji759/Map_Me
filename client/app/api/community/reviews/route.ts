import { NextRequest, NextResponse } from 'next/server'
import { getSessionUser, asIdOrNull } from '@/lib/session'
import { clientIp, rateLimit } from '@/lib/rateLimit'
import { listReviewsForViewer, createReview, MAX_REVIEW_TEXT } from '@/lib/community'

export const runtime = 'nodejs'

// GET /api/community/reviews?place_id=… | ?pin_id=… | ?author_id=…
// Closed network: only reviews written by the caller or their accepted
// connections are ever returned, regardless of the filter.
export async function GET(req: NextRequest) {
  const uid = getSessionUser(req)
  if (!uid) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })

  const placeId = asIdOrNull(req.nextUrl.searchParams.get('place_id')) ?? undefined
  const pinId = asIdOrNull(req.nextUrl.searchParams.get('pin_id')) ?? undefined
  const authorId = asIdOrNull(req.nextUrl.searchParams.get('author_id')) ?? undefined
  if (!placeId && !pinId && !authorId) {
    return NextResponse.json({ error: 'Provide place_id, pin_id, or author_id.' }, { status: 400 })
  }

  try {
    const reviews = await listReviewsForViewer(uid, { placeId, pinId, authorId })
    return NextResponse.json({ reviews })
  } catch (err) {
    console.error('[community/reviews GET]', err)
    return NextResponse.json({ error: 'Could not load reviews.' }, { status: 500 })
  }
}

// POST /api/community/reviews { pin_id?, place_id, rating (1-5), text }
// pin_id-less reviews are standalone place reviews (they feed future AI recs).
export async function POST(req: NextRequest) {
  const uid = getSessionUser(req)
  if (!uid) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })
  if (!rateLimit(`community:reviews:${uid}:${clientIp(req)}`, { capacity: 10, refillPerSec: 0.2 }).allowed) {
    return NextResponse.json({ error: 'Too many reviews. Please wait a moment.' }, { status: 429 })
  }

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })
  }

  const placeId = asIdOrNull(body.place_id)
  const pinId = asIdOrNull(body.pin_id) ?? undefined
  const rating = typeof body.rating === 'number' ? body.rating : NaN
  const text = typeof body.text === 'string' ? body.text : ''

  if (!placeId) return NextResponse.json({ error: 'Missing place_id.' }, { status: 400 })
  if (!Number.isFinite(rating) || rating < 1 || rating > 5) {
    return NextResponse.json({ error: 'Rating must be between 1 and 5.' }, { status: 400 })
  }
  if (text.length > MAX_REVIEW_TEXT) {
    return NextResponse.json({ error: `Reviews are limited to ${MAX_REVIEW_TEXT} characters.` }, { status: 400 })
  }

  try {
    const result = await createReview(uid, { pinId, placeId, rating, text })
    if (!result.ok) {
      const status = result.reason === 'pin_not_visible' ? 404 : 400
      return NextResponse.json({ error: result.reason === 'pin_not_visible' ? 'Pin not found.' : 'Invalid review.' }, { status })
    }
    return NextResponse.json({ ok: true, review: result.review })
  } catch (err) {
    console.error('[community/reviews POST]', err)
    return NextResponse.json({ error: 'Could not save the review.' }, { status: 500 })
  }
}
