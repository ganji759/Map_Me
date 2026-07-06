import { NextRequest, NextResponse } from 'next/server'
import { verifyUserPassword } from '@/lib/users'
import { isValidEmail } from '@/lib/password'
import { SESSION_COOKIE, SESSION_COOKIE_OPTS, signSession } from '@/lib/session'
import { clientIp, rateLimit } from '@/lib/rateLimit'

// Email/password login. A wrong email, wrong password, or a Google-only account
// (no password set) all return the same generic error so we never reveal which
// emails exist or how they signed up.
const GENERIC_ERROR = 'Wrong email or password.'

export async function POST(req: NextRequest) {
  if (!rateLimit(`login:${clientIp(req)}`, { capacity: 10, refillPerSec: 0.2 }).allowed) {
    return NextResponse.json({ error: 'Too many attempts. Please wait a moment.' }, { status: 429 })
  }

  let body: { email?: unknown; password?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })
  }

  const email = typeof body.email === 'string' ? body.email.trim() : ''
  const password = typeof body.password === 'string' ? body.password : ''

  if (!isValidEmail(email) || !password) {
    return NextResponse.json({ error: GENERIC_ERROR }, { status: 401 })
  }

  try {
    const user = await verifyUserPassword(email, password)
    if (!user) return NextResponse.json({ error: GENERIC_ERROR }, { status: 401 })
    const res = NextResponse.json({ ok: true, user: { name: user.name, email: user.email } })
    res.cookies.set(SESSION_COOKIE, signSession(user.user_id, user.email), SESSION_COOKIE_OPTS)
    return res
  } catch (err) {
    console.error('[auth/login]', err)
    return NextResponse.json({ error: 'Sign-in failed. Please try again.' }, { status: 500 })
  }
}
