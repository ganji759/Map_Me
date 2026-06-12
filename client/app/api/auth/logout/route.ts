import { NextResponse } from 'next/server'
import { SESSION_COOKIE } from '@/lib/session'

/** Clears the session cookie. The client also clears its localStorage. */
export async function POST() {
  const res = NextResponse.json({ ok: true })
  res.cookies.set(SESSION_COOKIE, '', {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  })
  return res
}
