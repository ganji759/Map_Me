import { NextRequest, NextResponse } from 'next/server'
import { rateLimit, type RateLimitRule } from './lib/rateLimit'

/**
 * Per-route rate limits, keyed by client IP. Tighter buckets guard the
 * expensive AI routes (each /api/chat run fans out to Gemini + Maps); cheap
 * proxy routes get a loose default. `capacity` is the burst allowance,
 * `refillPerSec` the sustained rate.
 */
const RULES: Array<{ prefix: string; name: string; rule: RateLimitRule }> = [
  // Full Planner → Explorer → Itinerary pipeline. Slow and costly: keep it tight.
  { prefix: '/api/chat', name: 'chat', rule: { capacity: 5, refillPerSec: 5 / 60 } },
  // Speech-to-speech (Vertex STT/TTS) — frequent within a session, still metered.
  { prefix: '/api/voice', name: 'voice', rule: { capacity: 20, refillPerSec: 20 / 60 } },
  // Account creation / sign-in: throttle to blunt user-spam and credential probing.
  { prefix: '/api/auth/login', name: 'login', rule: { capacity: 8, refillPerSec: 6 / 60 } },
  { prefix: '/api/feedback', name: 'feedback', rule: { capacity: 30, refillPerSec: 30 / 60 } },
  { prefix: '/api/saved', name: 'saved', rule: { capacity: 40, refillPerSec: 40 / 60 } },
]

// Everything else under /api (place photos, directions, session bootstrap).
const DEFAULT_RULE: RateLimitRule = { capacity: 60, refillPerSec: 1 }

function matchRule(pathname: string): { name: string; rule: RateLimitRule } {
  // Longest prefix wins so /api/auth/login beats a hypothetical /api/auth.
  const hit = RULES
    .filter((r) => pathname === r.prefix || pathname.startsWith(`${r.prefix}/`))
    .sort((a, b) => b.prefix.length - a.prefix.length)[0]
  return hit ? { name: hit.name, rule: hit.rule } : { name: 'api', rule: DEFAULT_RULE }
}

/** First hop in X-Forwarded-For is the real client when behind Cloud Run's proxy. */
function clientIp(req: NextRequest): string {
  const xff = req.headers.get('x-forwarded-for')
  if (xff) return xff.split(',')[0].trim()
  return req.headers.get('x-real-ip')?.trim() || 'unknown'
}

export function middleware(req: NextRequest) {
  // Don't meter CORS preflights — they carry no payload and no cost.
  if (req.method === 'OPTIONS') return NextResponse.next()

  const { name, rule } = matchRule(req.nextUrl.pathname)
  const key = `${clientIp(req)}:${name}`
  const result = rateLimit(key, rule)

  const headers = new Headers()
  headers.set('RateLimit-Limit', String(result.limitPerMin))
  headers.set('RateLimit-Remaining', String(result.remaining))

  if (!result.allowed) {
    headers.set('Retry-After', String(result.retryAfterSec))
    return NextResponse.json(
      { error: 'Too many requests. Please slow down and try again shortly.' },
      { status: 429, headers },
    )
  }

  const res = NextResponse.next()
  headers.forEach((value, k) => res.headers.set(k, value))
  return res
}

export const config = {
  // Only meter API routes — never static assets, the map tiles, or page loads.
  matcher: '/api/:path*',
}
