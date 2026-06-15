import { NextRequest, NextResponse } from 'next/server'
import crypto from 'node:crypto'
import { GOOGLE_AUTH_URL, OAUTH_STATE_COOKIE, appUrl, redirectUri } from '@/lib/oauth'
import { clientIp, rateLimit } from '@/lib/rateLimit'

// Start of Google sign-in: redirect the user to Google's consent screen.
export async function GET(req: NextRequest) {
  if (!rateLimit(`oauth-start:${clientIp(req)}`, { capacity: 20, refillPerSec: 0.5 }).allowed) {
    return NextResponse.redirect(appUrl(req, '/login?error=rate'))
  }

  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID
  if (!clientId) {
    return NextResponse.redirect(appUrl(req, '/login?error=oauth_unconfigured'))
  }

  // `?calendar=1` requests the Calendar scope too (incremental auth) so the user
  // can grant calendar access without re-doing base sign-in. Needs offline +
  // consent to receive a refresh token. See lib/calendar.ts / api/calendar/*.
  const wantsCalendar = req.nextUrl.searchParams.get('calendar') === '1'
  const next = req.nextUrl.searchParams.get('next') || (wantsCalendar ? '/saved' : '/chat')

  const state = crypto.randomBytes(16).toString('hex')
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri(req),
    response_type: 'code',
    scope: wantsCalendar
      ? 'openid email profile https://www.googleapis.com/auth/calendar.events'
      : 'openid email profile',
    state,
    access_type: wantsCalendar ? 'offline' : 'online',
    prompt: wantsCalendar ? 'consent' : 'select_account',
    include_granted_scopes: 'true',
  })

  const cookieOpts = { httpOnly: true, secure: true, sameSite: 'lax' as const, path: '/', maxAge: 600 }
  const res = NextResponse.redirect(`${GOOGLE_AUTH_URL}?${params.toString()}`)
  res.cookies.set(OAUTH_STATE_COOKIE, state, cookieOpts)
  res.cookies.set('hodari_oauth_next', next, cookieOpts)
  return res
}
