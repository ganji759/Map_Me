import { NextRequest, NextResponse } from 'next/server'
import { GOOGLE_TOKEN_URL, OAUTH_STATE_COOKIE, appUrl, decodeIdToken, redirectUri } from '@/lib/oauth'
import { SESSION_COOKIE, SESSION_COOKIE_OPTS, signSession } from '@/lib/session'
import { findOrCreateUser } from '@/lib/users'

function fail(req: NextRequest, code: string): NextResponse {
  const res = NextResponse.redirect(appUrl(req, `/login?error=${code}`))
  res.cookies.set(OAUTH_STATE_COOKIE, '', { ...SESSION_COOKIE_OPTS, maxAge: 0 })
  return res
}

// Google redirects here with ?code & ?state. Verify state, exchange the code,
// create/load the user, and issue our session cookie.
export async function GET(req: NextRequest) {
  const url = req.nextUrl
  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')
  const cookieState = req.cookies.get(OAUTH_STATE_COOKIE)?.value

  if (url.searchParams.get('error')) return fail(req, 'oauth_denied')
  if (!code || !state || !cookieState || state !== cookieState) return fail(req, 'oauth_state')

  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET
  if (!clientId || !clientSecret) return fail(req, 'oauth_unconfigured')

  try {
    const tokenRes = await fetch(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri(req),
        grant_type: 'authorization_code',
      }),
    })
    if (!tokenRes.ok) return fail(req, 'oauth_token')
    const tokens = await tokenRes.json() as { id_token?: string }
    if (!tokens.id_token) return fail(req, 'oauth_token')

    const claims = decodeIdToken(tokens.id_token)
    if (!claims.email || claims.email_verified === false) return fail(req, 'oauth_email')

    const user = await findOrCreateUser(claims.email, claims.name ?? '')

    const res = NextResponse.redirect(appUrl(req, '/chat'))
    res.cookies.set(OAUTH_STATE_COOKIE, '', { ...SESSION_COOKIE_OPTS, maxAge: 0 })
    res.cookies.set(SESSION_COOKIE, signSession(user.user_id, user.email), SESSION_COOKIE_OPTS)
    return res
  } catch (err) {
    console.error('[auth/google/callback]', err)
    return fail(req, 'oauth_failed')
  }
}
