import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/session'
import { appUrl } from '@/lib/oauth'
import { packById } from '@/lib/billing'
import { stripe, stripeConfigured, priceIdFor } from '@/lib/stripe'

// Node runtime: Stripe SDK + session crypto.
export const runtime = 'nodejs'

/**
 * Create a Stripe Checkout Session for a credit pack and return its URL.
 * Requires a signed-in user — credits are attributed to the cookie's uid, never
 * a client-supplied id, so a buyer can't credit someone else's account. The
 * granted credit amount is fixed server-side by `packId`; the client only picks
 * which pack.
 */
export async function POST(req: NextRequest) {
  const session = getSession(req)
  if (!session) {
    return NextResponse.json({ error: 'Sign in to buy credits.', gate: 'login' }, { status: 401 })
  }
  if (!stripeConfigured()) {
    return NextResponse.json({ error: 'Payments are not configured yet.' }, { status: 503 })
  }

  const body = await req.json().catch(() => ({}))
  const pack = typeof body.packId === 'string' ? packById(body.packId) : undefined
  if (!pack) return NextResponse.json({ error: 'Unknown pack' }, { status: 400 })

  const price = priceIdFor(pack.id)
  if (!price) return NextResponse.json({ error: `Pack ${pack.id} has no price configured.` }, { status: 503 })

  try {
    const checkout = await stripe().checkout.sessions.create({
      mode: 'payment',
      line_items: [{ price, quantity: 1 }],
      success_url: appUrl(req, '/chat?purchase=success'),
      cancel_url: appUrl(req, '/chat?purchase=cancel'),
      client_reference_id: session.uid,
      customer_email: session.email,
      // The webhook reads these back to know who/how-much to credit.
      metadata: { userId: session.uid, packId: pack.id, credits: String(pack.credits) },
    })
    return NextResponse.json({ url: checkout.url })
  } catch (err) {
    console.error('[billing/checkout]', err)
    return NextResponse.json({ error: 'Could not start checkout.' }, { status: 502 })
  }
}
