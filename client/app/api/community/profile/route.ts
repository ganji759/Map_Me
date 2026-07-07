import { NextRequest, NextResponse } from 'next/server'
import { getSessionUser, asIdOrNull } from '@/lib/session'
import { clientIp, rateLimit } from '@/lib/rateLimit'
import {
  getCommunityProfile,
  getProfileByHandle,
  updateCommunityProfile,
  areConnected,
  isOnline,
  HANDLE_RE,
  MAX_BIO,
  type CommunityProfile,
  type ProfilePatch,
} from '@/lib/community'

export const runtime = 'nodejs'

/**
 * Public projection of a profile. `location` is only exposed to the owner or an
 * accepted connection (and only while the user is actively sharing it) — being
 * discoverable must not leak coordinates.
 */
function projectProfile(p: CommunityProfile, viewerCanSeeLocation: boolean) {
  return {
    user_id: p.user_id,
    handle: p.handle,
    name: p.name,
    bio: p.bio,
    avatar_emoji: p.avatar_emoji,
    discoverable: p.discoverable,
    share_location: p.share_location,
    location: viewerCanSeeLocation && p.share_location ? p.location : null,
    online: isOnline(p.last_seen_at),
    last_seen_at: p.last_seen_at,
    pubkey: p.pubkey,
  }
}

// GET /api/community/profile          → the caller's own profile
// GET /api/community/profile?handle=x → someone else's, if connected or discoverable
export async function GET(req: NextRequest) {
  const uid = getSessionUser(req)
  if (!uid) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })

  try {
    const handle = asIdOrNull(req.nextUrl.searchParams.get('handle'))
    if (!handle) {
      const me = await getCommunityProfile(uid)
      if (!me) return NextResponse.json({ error: 'Profile not found.' }, { status: 404 })
      return NextResponse.json({ profile: projectProfile(me, true) })
    }

    const other = await getProfileByHandle(handle.toLowerCase())
    if (!other) return NextResponse.json({ error: 'Profile not found.' }, { status: 404 })
    if (other.user_id === uid) return NextResponse.json({ profile: projectProfile(other, true) })

    const connected = await areConnected(uid, other.user_id)
    if (!connected && !other.discoverable) {
      // Indistinguishable from a missing profile — don't confirm hidden users.
      return NextResponse.json({ error: 'Profile not found.' }, { status: 404 })
    }
    return NextResponse.json({ profile: projectProfile(other, connected) })
  } catch (err) {
    console.error('[community/profile GET]', err)
    return NextResponse.json({ error: 'Could not load the profile.' }, { status: 500 })
  }
}

// PUT /api/community/profile — update own bio / handle / avatar / privacy / pubkey.
export async function PUT(req: NextRequest) {
  const uid = getSessionUser(req)
  if (!uid) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })
  if (!rateLimit(`community:profile:${uid}:${clientIp(req)}`, { capacity: 10, refillPerSec: 0.5 }).allowed) {
    return NextResponse.json({ error: 'Too many updates. Please wait a moment.' }, { status: 429 })
  }

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })
  }

  const patch: ProfilePatch = {}

  if (body.handle !== undefined) {
    if (typeof body.handle !== 'string' || !HANDLE_RE.test(body.handle)) {
      return NextResponse.json({ error: 'Handles are 3-24 characters: lowercase letters, digits, underscores.' }, { status: 400 })
    }
    patch.handle = body.handle
  }
  if (body.bio !== undefined) {
    if (typeof body.bio !== 'string' || body.bio.length > MAX_BIO) {
      return NextResponse.json({ error: `Bio must be at most ${MAX_BIO} characters.` }, { status: 400 })
    }
    patch.bio = body.bio
  }
  if (body.avatar_emoji !== undefined) {
    if (typeof body.avatar_emoji !== 'string' || body.avatar_emoji.length === 0 || body.avatar_emoji.length > 16) {
      return NextResponse.json({ error: 'Invalid avatar.' }, { status: 400 })
    }
    patch.avatar_emoji = body.avatar_emoji
  }
  if (body.discoverable !== undefined) {
    if (typeof body.discoverable !== 'boolean') return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })
    patch.discoverable = body.discoverable
  }
  if (body.share_location !== undefined) {
    if (typeof body.share_location !== 'boolean') return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })
    patch.share_location = body.share_location
  }
  if (body.location !== undefined) {
    if (body.location === null) {
      patch.location = null
    } else {
      const loc = body.location as { lat?: unknown; lng?: unknown }
      if (typeof loc?.lat !== 'number' || typeof loc?.lng !== 'number' ||
          !Number.isFinite(loc.lat) || !Number.isFinite(loc.lng) ||
          Math.abs(loc.lat) > 90 || Math.abs(loc.lng) > 180) {
        return NextResponse.json({ error: 'Invalid location.' }, { status: 400 })
      }
      patch.location = { lat: loc.lat, lng: loc.lng }
    }
  }
  if (body.pubkey !== undefined) {
    if (body.pubkey === null) {
      patch.pubkey = null
    } else {
      // Opaque JWK from lib/e2ee.ts — just bound its shape/size.
      if (typeof body.pubkey !== 'object' || Array.isArray(body.pubkey) || JSON.stringify(body.pubkey).length > 2048) {
        return NextResponse.json({ error: 'Invalid public key.' }, { status: 400 })
      }
      patch.pubkey = body.pubkey as Record<string, unknown>
    }
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: 'Nothing to update.' }, { status: 400 })
  }

  try {
    const result = await updateCommunityProfile(uid, patch)
    if (!result.ok) {
      if (result.reason === 'handle_taken') {
        return NextResponse.json({ error: 'That handle is already taken.' }, { status: 409 })
      }
      return NextResponse.json({ error: 'Profile not found.' }, { status: 404 })
    }
    return NextResponse.json({ profile: projectProfile(result.profile, true) })
  } catch (err) {
    console.error('[community/profile PUT]', err)
    return NextResponse.json({ error: 'Could not save your profile.' }, { status: 500 })
  }
}
