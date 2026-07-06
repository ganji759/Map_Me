import { NextRequest, NextResponse } from 'next/server'
import { createUserWithPassword } from '@/lib/users'
import { isValidEmail } from '@/lib/password'
import { SESSION_COOKIE, SESSION_COOKIE_OPTS, signSession } from '@/lib/session'
import { clientIp, rateLimit } from '@/lib/rateLimit'

const MIN_PASSWORD = 8

// Register a new email/password user, then issue our session cookie so sign-up
// logs them straight in. Mirrors the Google callback's session handling.
export async function POST(req: NextRequest) {
  if (!rateLimit(`signup:${clientIp(req)}`, { capacity: 8, refillPerSec: 0.2 }).allowed) {
    return NextResponse.json({ error: 'Too many attempts. Please wait a moment.' }, { status: 429 })
  }

  let body: { name?: unknown; email?: unknown; password?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })
  }

  const name = typeof body.name === 'string' ? body.name.trim() : ''
  const email = typeof body.email === 'string' ? body.email.trim() : ''
  const password = typeof body.password === 'string' ? body.password : ''

  if (!name || name.length > 120) return NextResponse.json({ error: 'Please enter your name.' }, { status: 400 })
  if (!isValidEmail(email)) return NextResponse.json({ error: 'Please enter a valid email address.' }, { status: 400 })
  if (password.length < MIN_PASSWORD) {
    return NextResponse.json({ error: `Password must be at least ${MIN_PASSWORD} characters.` }, { status: 400 })
  }

  try {
    const result = await createUserWithPassword(email, name, password)
    if (!result.ok) {
      return NextResponse.json({ error: 'An account with this email already exists. Try signing in.' }, { status: 409 })
    }
    const res = NextResponse.json({ ok: true, user: { name: result.user.name, email: result.user.email } })
    res.cookies.set(SESSION_COOKIE, signSession(result.user.user_id, result.user.email), SESSION_COOKIE_OPTS)
    return res
  } catch (err) {
    console.error('[auth/signup]', err)
    return NextResponse.json({ error: 'Could not create your account. Please try again.' }, { status: 500 })
  }
}
