import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/session'
import { getGoogleRefreshToken } from '@/lib/users'
import { GOOGLE_TOKEN_URL } from '@/lib/oauth'
import { toCalendarApiEvent, type CalendarEvent } from '@/lib/calendar'

export const runtime = 'nodejs'

const CALENDAR_API = 'https://www.googleapis.com/calendar/v3/calendars/primary/events'

/** Exchange the stored refresh token for a short-lived access token. */
async function accessTokenFromRefresh(refreshToken: string): Promise<string | null> {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET
  if (!clientId || !clientSecret) return null
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  })
  if (!res.ok) return null
  const data = (await res.json()) as { access_token?: string }
  return data.access_token ?? null
}

/**
 * Insert a planned visit into the user's primary Google Calendar.
 * Requires a connected calendar (refresh token). If not connected, returns
 * `{ added: false, needsConnect: true }` so the client falls back to the
 * "add to calendar" template link (which works for everyone).
 */
export async function POST(req: NextRequest) {
  const session = getSession(req)
  if (!session) return NextResponse.json({ added: false, needsConnect: true, authed: false }, { status: 401 })

  const body = (await req.json().catch(() => ({}))) as Partial<CalendarEvent>
  if (!body.title || !body.date) {
    return NextResponse.json({ error: 'title and date are required' }, { status: 400 })
  }

  const refresh = await getGoogleRefreshToken(session.uid).catch(() => null)
  if (!refresh) return NextResponse.json({ added: false, needsConnect: true }, { status: 200 })

  const accessToken = await accessTokenFromRefresh(refresh)
  if (!accessToken) {
    // Token revoked/expired — ask the user to reconnect.
    return NextResponse.json({ added: false, needsConnect: true }, { status: 200 })
  }

  const tz = typeof body.startTime === 'string' ? 'UTC' : 'UTC'
  const event = toCalendarApiEvent(body as CalendarEvent, tz)
  const res = await fetch(CALENDAR_API, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(event),
  })
  if (!res.ok) {
    const detail = (await res.text().catch(() => '')).slice(0, 200)
    console.error('[calendar/add] insert failed', res.status, detail)
    return NextResponse.json({ added: false, error: 'Calendar insert failed' }, { status: 502 })
  }
  const created = (await res.json()) as { htmlLink?: string }
  return NextResponse.json({ added: true, htmlLink: created.htmlLink })
}
