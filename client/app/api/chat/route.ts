import { NextRequest } from 'next/server'
import { asId, getSession } from '@/lib/session'
import { clientIp, rateLimit } from '@/lib/rateLimit'
import { consume, refund, type Identity } from '@/lib/billing'
import { adkAuthHeaders } from '@/lib/gcpAuth'

// Full pipeline (Planner → Explorer → Itinerary) can exceed 2 minutes locally.
export const maxDuration = 300
export const runtime = 'nodejs'

const ADK_BASE = process.env.ADK_BASE_URL ?? 'http://localhost:8000'
const APP_NAME = process.env.ADK_APP_NAME ?? 'hodari'

export async function POST(req: NextRequest) {
  // Chat runs the agent pipeline (Gemini + Maps tokens) — throttle per IP so a
  // single client can't drive runaway cost.
  const rl = rateLimit(`chat:${clientIp(req)}`, { capacity: 12, refillPerSec: 0.2 })
  if (!rl.allowed) {
    return new Response('Too many requests. Please slow down.', {
      status: 429,
      headers: { 'Retry-After': String(rl.retryAfterSec) },
    })
  }

  const body = await req.json().catch(() => ({}))
  const message = typeof body.message === 'string' ? body.message : ''

  // Identity is server-authoritative: a signed-in member from the session
  // cookie, otherwise an anonymous guest keyed by IP. The body userId is only a
  // session-scoping fallback for the ADK run; it never grants entitlement.
  const session = getSession(req)
  let userId: string
  let sessionId: string
  try {
    userId = session?.uid ?? asId(body.userId, 'userId')
    sessionId = asId(body.sessionId, 'sessionId')
  } catch {
    return new Response('Missing or invalid userId/sessionId', { status: 400 })
  }

  const identity: Identity = session
    ? { kind: 'user', userId: session.uid }
    : { kind: 'guest', key: `guest:${clientIp(req)}` }

  // ── Metering: spend one generation (or refuse with a gate) ────────────────
  const spend = await consume(identity)
  if (!spend.ok) {
    const status = spend.gate === 'login' ? 401 : 402
    return new Response(
      JSON.stringify({
        error:
          spend.gate === 'login'
            ? 'You’ve used your free previews. Sign in to keep exploring.'
            : 'You’re out of generations. Add credits to continue.',
        gate: spend.gate,
        entitlement: spend.entitlement,
      }),
      { status, headers: { 'Content-Type': 'application/json' } },
    )
  }

  const adkHeaders = await adkAuthHeaders({ 'Content-Type': 'application/json' })

  // Ensure the session exists before running.
  await fetch(
    `${ADK_BASE}/apps/${APP_NAME}/users/${encodeURIComponent(userId)}/sessions/${encodeURIComponent(sessionId)}`,
    { method: 'POST', headers: adkHeaders, body: '{}' },
  ).catch(() => {/* session may already exist */})

  const adkRes = await fetch(`${ADK_BASE}/run_sse`, {
    method: 'POST',
    headers: adkHeaders,
    // Propagate client aborts (Stop button) so the upstream agent run is cancelled too.
    signal: req.signal,
    body: JSON.stringify({
      app_name: APP_NAME,
      user_id: userId,
      session_id: sessionId,
      new_message: { role: 'user', parts: [{ text: message }] },
      streaming: true,
    }),
  }).catch(() => null)

  if (!adkRes || !adkRes.ok || !adkRes.body) {
    // The run never started — give the generation back (unless we failed open).
    if (!spend.degraded) await refund(identity, spend.usedCredit)
    const detail = !adkRes
      ? 'no response from agent'
      : adkRes.ok
        ? 'no stream body from agent'
        : (await adkRes.text().catch(() => '')).slice(0, 300)
    return new Response(
      `Agent unreachable (${adkRes?.status ?? 0}${detail ? `: ${detail}` : ''})`,
      { status: 502 },
    )
  }

  return new Response(adkRes.body, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no',
      // Let the client update its quota pill without a refetch.
      'X-Hodari-Free-Remaining': String(spend.entitlement.freeRemaining),
      'X-Hodari-Credits': String(spend.entitlement.credits),
    },
  })
}
