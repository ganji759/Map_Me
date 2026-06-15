import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/session'
import { clientIp } from '@/lib/rateLimit'
import { getEntitlement, isUnlimited, unlimitedEntitlement, PACKS, type Identity } from '@/lib/billing'
import { stripeConfigured } from '@/lib/stripe'

export const runtime = 'nodejs'

/** Entitlement snapshot for the UI: remaining free runs, credit balance, packs. */
export async function GET(req: NextRequest) {
  const session = getSession(req)
  const identity: Identity = session
    ? { kind: 'user', userId: session.uid }
    : { kind: 'guest', key: `guest:${clientIp(req)}` }

  if (session && isUnlimited(session.email)) {
    return NextResponse.json({
      authed: true,
      unlimited: true,
      ...unlimitedEntitlement(),
      paymentsEnabled: stripeConfigured(),
      packs: PACKS,
    })
  }

  try {
    const ent = await getEntitlement(identity)
    return NextResponse.json({
      authed: identity.kind === 'user',
      ...ent,
      paymentsEnabled: stripeConfigured(),
      packs: PACKS,
    })
  } catch (err) {
    console.error('[billing/me]', err)
    // Fail open: don't let a Mongo blip hard-block the UI.
    return NextResponse.json({ authed: identity.kind === 'user', freeRemaining: 1, freeLimit: 1, credits: 0, gate: null, paymentsEnabled: stripeConfigured(), packs: PACKS })
  }
}
