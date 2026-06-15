import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/session'
import { isCalendarConnected } from '@/lib/users'

export const runtime = 'nodejs'

/** Whether the signed-in user has connected Google Calendar (for one-click sync). */
export async function GET(req: NextRequest) {
  const session = getSession(req)
  if (!session) return NextResponse.json({ connected: false, authed: false })
  try {
    return NextResponse.json({ connected: await isCalendarConnected(session.uid), authed: true })
  } catch {
    return NextResponse.json({ connected: false, authed: true })
  }
}
