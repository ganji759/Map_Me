/**
 * Server-side identity + input hardening (see SECURITY_HARDENING.md, P0.1/P0.2).
 *
 * - `asId()` coerces untrusted ids to safe strings, blocking NoSQL operator
 *   injection (e.g. `{ "$ne": null }`) in Mongo filters.
 * - The session helpers issue and verify a stateless HMAC-signed token stored in
 *   an httpOnly cookie, so a user's identity is derived server-side from the
 *   cookie rather than trusted from a client-supplied `userId` (closes IDOR).
 *
 * Node runtime only (uses `node:crypto`). All API routes here run in Node.
 */
import crypto from 'node:crypto'
import type { NextRequest } from 'next/server'

const SECRET = process.env.HODARI_SESSION_SECRET ?? ''
export const SESSION_COOKIE = 'hodari_session'
export const SESSION_MAX_AGE = 60 * 60 * 24 * 30 // 30 days, seconds

/**
 * Coerce an untrusted value to a safe id string. Throws on non-strings
 * (objects/arrays would become Mongo query operators) and on empty/oversized
 * input. Use on EVERY user-supplied id before building a database filter.
 */
export function asId(value: unknown, field = 'id'): string {
  if (typeof value !== 'string') throw new Error(`Invalid ${field}`)
  const v = value.trim()
  if (!v || v.length > 200) throw new Error(`Invalid ${field}`)
  return v
}

/** Like `asId` but returns null instead of throwing — for optional values. */
export function asIdOrNull(value: unknown): string | null {
  try {
    return asId(value)
  } catch {
    return null
  }
}

interface SessionPayload {
  uid: string
  email?: string
  iat: number
}

export function signSession(uid: string, email?: string): string {
  if (!SECRET) throw new Error('HODARI_SESSION_SECRET is not configured')
  const body = Buffer.from(JSON.stringify({ uid, email, iat: Date.now() } satisfies SessionPayload)).toString('base64url')
  const sig = crypto.createHmac('sha256', SECRET).update(body).digest('base64url')
  return `${body}.${sig}`
}

export function verifySession(token: string | undefined | null): SessionPayload | null {
  if (!token || !SECRET) return null
  const dot = token.indexOf('.')
  if (dot < 1) return null
  const body = token.slice(0, dot)
  const sig = token.slice(dot + 1)
  const expected = crypto.createHmac('sha256', SECRET).update(body).digest('base64url')
  const a = Buffer.from(sig)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as SessionPayload
    if (!payload.uid || typeof payload.uid !== 'string') return null
    if (Date.now() - payload.iat > SESSION_MAX_AGE * 1000) return null
    return payload
  } catch {
    return null
  }
}

/** The authenticated user id from the session cookie, or null if unauthenticated. */
export function getSessionUser(req: NextRequest): string | null {
  return verifySession(req.cookies.get(SESSION_COOKIE)?.value)?.uid ?? null
}

/** The full verified session payload (uid + email), or null. */
export function getSession(req: NextRequest): { uid: string; email?: string } | null {
  const p = verifySession(req.cookies.get(SESSION_COOKIE)?.value)
  return p ? { uid: p.uid, email: p.email } : null
}

export const SESSION_COOKIE_OPTS = {
  httpOnly: true as const,
  secure: true as const,
  sameSite: 'lax' as const,
  path: '/',
  maxAge: SESSION_MAX_AGE,
}
