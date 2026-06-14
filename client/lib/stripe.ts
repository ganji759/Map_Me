/**
 * Lazy Stripe client + price lookup. Initialised on first use so the app still
 * boots (and the free tier still works) when Stripe keys aren't configured —
 * only the checkout/webhook routes hard-require them.
 */
import Stripe from 'stripe'

let _stripe: Stripe | null = null

export function stripe(): Stripe {
  if (_stripe) return _stripe
  const key = process.env.STRIPE_SECRET_KEY
  if (!key) throw new Error('STRIPE_SECRET_KEY is not configured')
  _stripe = new Stripe(key)
  return _stripe
}

export function stripeConfigured(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY)
}

/**
 * The Stripe Price id for a credit pack, from env (e.g. STRIPE_PRICE_STARTER).
 * Keeping prices in Stripe (not the code) lets you change pricing without a
 * deploy; the credit AMOUNT each pack grants stays authoritative in billing.ts.
 */
export function priceIdFor(packId: string): string | undefined {
  return process.env[`STRIPE_PRICE_${packId.toUpperCase()}`]
}

export const STRIPE_WEBHOOK_SECRET = () => process.env.STRIPE_WEBHOOK_SECRET ?? ''
