import { NextRequest } from 'next/server'
import { asId, getSessionUser } from '@/lib/session'
import { clientIp, rateLimit } from '@/lib/rateLimit'

// Full pipeline (Planner → Explorer → Itinerary) can exceed 2 minutes locally.
export const maxDuration = 300

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
  // Identity comes from the session cookie; the body userId is a legacy
  // fallback so the agent always writes under the right (validated) user.
  let userId: string
  let sessionId: string
  try {
    userId = getSessionUser(req) ?? asId(body.userId, 'userId')
    sessionId = asId(body.sessionId, 'sessionId')
  } catch {
    return new Response('Missing or invalid userId/sessionId', { status: 400 })
  }

  // Ensure the session exists before running
  await fetch(
    `${ADK_BASE}/apps/${APP_NAME}/users/${encodeURIComponent(userId)}/sessions/${encodeURIComponent(sessionId)}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' },
  ).catch(() => {/* session may already exist */})

  const adkRes = await fetch(`${ADK_BASE}/run_sse`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    // Propagate client aborts (Stop button) so the upstream agent run is cancelled too.
    signal: req.signal,
    body: JSON.stringify({
      app_name: APP_NAME,
      user_id: userId,
      session_id: sessionId,
      new_message: {
        role: 'user',
        parts: [{ text: message }],
      },
      streaming: true,
    }),
  })

  if (!adkRes.ok || !adkRes.body) {
    const detail = adkRes.ok
      ? 'no stream body from agent'
      : (await adkRes.text().catch(() => '')).slice(0, 300)
    return new Response(
      `Agent unreachable (${adkRes.status}${detail ? `: ${detail}` : ''})`,
      { status: 502 },
    )
  }

  return new Response(adkRes.body, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no',
    },
  })
}
