import { NextRequest, NextResponse } from 'next/server'
import { asId, getSessionUser } from '@/lib/session'

const ADK_BASE = process.env.ADK_BASE_URL ?? 'http://localhost:8000'
const APP_NAME = process.env.ADK_APP_NAME ?? 'hodari'

// Returns session state (plan, candidates, itinerary) after agent finishes.
// Identity comes from the session cookie; the ?userId= param is a legacy
// fallback. Path ids are validated + encoded to prevent path injection.
export async function GET(req: NextRequest) {
  let userId: string
  let sessionId: string
  try {
    userId = getSessionUser(req) ?? asId(req.nextUrl.searchParams.get('userId'), 'userId')
    sessionId = asId(req.nextUrl.searchParams.get('sessionId'), 'sessionId')
  } catch {
    return NextResponse.json({ error: 'Missing or invalid params' }, { status: 400 })
  }

  const res = await fetch(
    `${ADK_BASE}/apps/${APP_NAME}/users/${encodeURIComponent(userId)}/sessions/${encodeURIComponent(sessionId)}`,
  )

  if (!res.ok) return NextResponse.json({}, { status: 200 })

  const session = await res.json()
  // Return only the output_key values written by sub-agents
  return NextResponse.json({
    plan: session?.state?.plan,
    candidates: session?.state?.candidates,
    itinerary: session?.state?.itinerary,
    intent_type: session?.state?.intent_type,
    map_actions: session?.state?.map_actions,
    suppress_gps_context: session?.state?.suppress_gps_context,
  })
}
