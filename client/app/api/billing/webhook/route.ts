import { NextRequest, NextResponse } from 'next/server'
import { addCredits } from '@/lib/billing'
import { stripe, STRIPE_WEBHOOK_SECRET } from '@/lib/stripe'
import type Stripe from 'stripe'

// Node runtime + raw body: Stripe signature verification needs the unparsed text.
export const runtime = 'nodejs'

/**
 * Stripe webhook: the ONLY trusted source of "payment succeeded". We verify the
 * signature against the raw body, then grant credits from the session metadata.
 * `addCredits` is idempotent per event id, so Stripe's retries never double-pay.
 */
export async function POST(req: NextRequest) {
  const secret = STRIPE_WEBHOOK_SECRET()
  if (!secret) return NextResponse.json({ error: 'webhook not configured' }, { status: 503 })

  const sig = req.headers.get('stripe-signature')
  if (!sig) return NextResponse.json({ error: 'missing signature' }, { status: 400 })

  const raw = await req.text()
  let event: Stripe.Event
  try {
    event = stripe().webhooks.constructEvent(raw, sig, secret)
  } catch (err) {
    console.error('[billing/webhook] signature verification failed', err)
    return NextResponse.json({ error: 'bad signature' }, { status: 400 })
  }

  if (event.type === 'checkout.session.completed') {
    const s = event.data.object as Stripe.Checkout.Session
    const userId = s.client_reference_id ?? s.metadata?.userId
    const credits = Number(s.metadata?.credits ?? 0)
    if (userId && credits > 0 && s.payment_status === 'paid') {
      try {
        const applied = await addCredits(userId, credits, event.id)
        console.log(`[billing/webhook] ${applied ? 'credited' : 'duplicate'} ${credits} → ${userId}`)
      } catch (err) {
        // Return 500 so Stripe retries — better to retry than silently lose a paid purchase.
        console.error('[billing/webhook] credit grant failed', err)
        return NextResponse.json({ error: 'grant failed' }, { status: 500 })
      }
    }
  }

  return NextResponse.json({ received: true })
}
