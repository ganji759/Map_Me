import { NextRequest, NextResponse } from 'next/server'
import crypto from 'node:crypto'
import { GOOGLE_AUTH_URL, OAUTH_STATE_COOKIE, redirectUri } from '@/lib/oauth'
import { clientIp, rateLimit } from '@/lib/rateLimit'

// Start of Google sign-in: redirect the user to Google's consent screen.
export async function GET(req: NextRequest) {
  if (!rateLimit(`oauth-start:${clientIp(req)}`, { capacity: 20, refillPerSec: 0.5 }).allowed) {
    return NextResponse.redirect(new URL('/login?error=rate', req.url))
  }

  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID
  if (!clientId) {
    return NextResponse.redirect(new URL('/login?error=oauth_unconfigured', req.url))
  }

  const state = crypto.randomBytes(16).toString('hex')
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri(req),
    response_type: 'code',
    scope: 'openid email profile',
    state,
    access_type: 'online',
    prompt: 'select_account',
  })

  const res = NextResponse.redirect(`${GOOGLE_AUTH_URL}?${params.toString()}`)
  res.cookies.set(OAUTH_STATE_COOKIE, state, {
    httpOnly: true, secure: true, sameSite: 'lax', path: '/', maxAge: 600,
  })
  return res
}
