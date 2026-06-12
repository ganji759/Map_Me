/**
 * Google OAuth 2.0 (authorization-code flow) helpers. No external dependency:
 * the id_token is fetched by a direct server-to-server HTTPS call to Google's
 * token endpoint, so per Google's guidance its payload can be trusted without
 * re-verifying the signature.
 */
import type { NextRequest } from 'next/server'

export const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
export const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'
export const OAUTH_STATE_COOKIE = 'hodari_oauth_state'

/** Public origin of the app, from the proxy headers Cloud Run sets. */
export function baseUrl(req: NextRequest): string {
  const envBase = process.env.PUBLIC_BASE_URL
  if (envBase) return envBase.replace(/\/$/, '')
  const proto = req.headers.get('x-forwarded-proto') ?? 'https'
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host') ?? req.nextUrl.host
  return `${proto}://${host}`
}

export function redirectUri(req: NextRequest): string {
  return `${baseUrl(req)}/api/auth/google/callback`
}

/**
 * Absolute app URL for a redirect. MUST be used instead of
 * `new URL(path, req.url)` for redirects: behind the Cloud Run proxy `req.url`
 * resolves to the container's internal address (0.0.0.0:8080), which the
 * browser cannot reach (ERR_CONNECTION_CLOSED).
 */
export function appUrl(req: NextRequest, path: string): string {
  return `${baseUrl(req)}${path.startsWith('/') ? path : `/${path}`}`
}

/** Decode the payload of a JWT (id_token) without signature verification. */
export function decodeIdToken(idToken: string): { email?: string; email_verified?: boolean; name?: string; sub?: string } {
  const part = idToken.split('.')[1]
  if (!part) return {}
  try {
    return JSON.parse(Buffer.from(part, 'base64url').toString('utf8'))
  } catch {
    return {}
  }
}
