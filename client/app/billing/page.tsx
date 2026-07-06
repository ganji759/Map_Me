'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import {
  ArrowLeft,
  Check,
  CheckCircle2,
  Info,
  Loader2,
  LogIn,
  Sparkles,
  Zap,
} from 'lucide-react'
import {
  EASE,
  HodariLogo,
  RollText,
  ThemeToggle,
  useLandingTheme,
} from '@/components/landing/bits'

interface Pack {
  id: string
  credits: number
  label: string
  priceDisplay: string
}

interface Entitlement {
  authed: boolean
  unlimited?: boolean
  kind?: 'user' | 'guest'
  freeRemaining: number
  freeLimit: number
  credits: number
  gate: 'login' | 'paywall' | null
  paymentsEnabled: boolean
  packs: Pack[]
}

/** The middle pack reads as the default choice. */
const FEATURED_PACK = 'explorer'

/** Fan-friendly framing for each pack, keyed by id (falls back gracefully). */
const PACK_BLURB: Record<string, string> = {
  starter: 'A weekend of matchday plans.',
  explorer: 'Plan the whole group stage.',
  tournament: 'All the way to the final.',
}

export default function BillingPage() {
  const { dark, toggle } = useLandingTheme()
  const [ent, setEnt] = useState<Entitlement | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<'success' | 'cancel' | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError(false)
    try {
      const r = await fetch('/api/billing/me', { cache: 'no-store' })
      if (!r.ok) throw new Error(String(r.status))
      setEnt(await r.json())
    } catch {
      setLoadError(true)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  // Acknowledge a return from Stripe Checkout, then strip the query param so a
  // refresh doesn't re-fire it. Credits arrive via the webhook and may lag a
  // beat, so we refetch the entitlement after a successful return.
  useEffect(() => {
    if (typeof window === 'undefined') return
    const purchase = new URLSearchParams(window.location.search).get('purchase')
    if (purchase === 'success') {
      setNotice('success')
      setTimeout(load, 1500)
    } else if (purchase === 'cancel') {
      setNotice('cancel')
    }
    if (purchase) window.history.replaceState({}, '', window.location.pathname)
  }, [load])

  async function buy(packId: string) {
    setBusy(packId)
    setError(null)
    try {
      const res = await fetch('/api/billing/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ packId, returnTo: '/billing' }),
      })
      const data = await res.json().catch(() => ({}))
      if (res.status === 401) {
        window.location.href = '/api/auth/google'
        return
      }
      if (!res.ok || !data.url) {
        setError(data.error ?? 'Could not start checkout. Please try again.')
        setBusy(null)
        return
      }
      window.location.href = data.url
    } catch {
      setError('Network error. Please try again.')
      setBusy(null)
    }
  }

  const isGuest = ent ? !ent.authed : false
  const unlimited = ent?.unlimited === true
  const canBuy = ent?.authed && ent?.paymentsEnabled && !unlimited

  return (
    <div className="relative min-h-screen overflow-x-hidden bg-[#EFEFEF] dark:bg-[#0a0a0d]">
      {/* Nav — same floating pill as login */}
      <header className="relative z-20 mx-auto w-full max-w-[1440px] p-2 sm:p-3">
        <nav className="flex items-center justify-between rounded-full bg-white p-[5px] shadow-[0_2px_12px_rgba(0,0,0,0.06)] dark:bg-[#15151a] dark:shadow-[0_2px_12px_rgba(0,0,0,0.5)]">
          <Link href="/" className="flex items-center gap-2.5 pl-1">
            <HodariLogo />
            <span className="text-[14px] font-semibold tracking-tight text-gray-900 dark:text-gray-100">
              Hodari
            </span>
          </Link>
          <div className="flex items-center gap-3 sm:gap-4">
            <ThemeToggle dark={dark} onToggle={toggle} />
            <Link
              href="/chat"
              className="group flex items-center gap-2 rounded-full bg-gray-900 py-2 pl-3 pr-4 text-[13px] font-medium text-white dark:bg-white dark:text-gray-900"
            >
              <ArrowLeft
                size={13}
                className={`transition-transform duration-500 ${EASE} group-hover:-translate-x-0.5`}
              />
              <RollText>Back to chat</RollText>
            </Link>
          </div>
        </nav>
      </header>

      <main className="relative z-10 mx-auto w-full max-w-[1080px] px-5 pb-20 pt-8 sm:px-8 sm:pt-12">
        {/* Heading */}
        <div className="max-w-[620px]">
          <p className="text-[13px] tracking-wide text-gray-500 dark:text-gray-400">
            Hodari · Credits &amp; usage
          </p>
          <h1 className="mt-3 font-display text-[clamp(1.9rem,4.4vw,3rem)] font-semibold leading-[1.08] tracking-[-0.02em] text-gray-900 dark:text-gray-50">
            Keep planning without limits.
          </h1>
          <p className="mt-4 max-w-[52ch] text-[14px] leading-relaxed text-gray-600 dark:text-gray-300 sm:text-[15px]">
            Every plan spends real map and reasoning credits. You get free
            generations to start, then top up with a one-time credit pack
            whenever you want more. No subscription.
          </p>
        </div>

        {/* Return-from-Stripe banner */}
        {notice && (
          <div
            role="status"
            className={`mt-8 flex items-start gap-3 rounded-2xl border p-4 text-[13px] leading-relaxed ${
              notice === 'success'
                ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-800 dark:text-emerald-300'
                : 'border-gray-300/70 bg-white/60 text-gray-600 dark:border-white/10 dark:bg-white/5 dark:text-gray-300'
            }`}
          >
            {notice === 'success' ? (
              <CheckCircle2 size={18} className="mt-0.5 shrink-0" />
            ) : (
              <Info size={18} className="mt-0.5 shrink-0" />
            )}
            <span>
              {notice === 'success'
                ? 'Payment received — your credits are being added and will appear here in a moment.'
                : 'Checkout canceled. No charge was made — you can pick a pack whenever you’re ready.'}
            </span>
          </div>
        )}

        {/* Status card */}
        <section className="mt-8">
          {loading ? (
            <StatusSkeleton />
          ) : loadError || !ent ? (
            <div className="flex flex-col items-start gap-3 rounded-3xl bg-white p-6 shadow-[0_18px_60px_rgba(0,0,0,0.10),0_1px_6px_rgba(0,0,0,0.05)] ring-1 ring-black/5 dark:bg-[#131318] dark:shadow-[0_18px_60px_rgba(0,0,0,0.6)] dark:ring-white/10 sm:p-8">
              <p className="text-[14px] text-gray-700 dark:text-gray-200">
                We couldn’t load your usage right now.
              </p>
              <button
                onClick={load}
                className="rounded-full bg-gray-900 px-4 py-2 text-[13px] font-medium text-white transition-colors hover:bg-black dark:bg-white dark:text-gray-900 dark:hover:bg-gray-100"
              >
                Try again
              </button>
            </div>
          ) : (
            <StatusCard ent={ent} unlimited={unlimited} isGuest={isGuest} />
          )}
        </section>

        {/* Packs / CTA */}
        {!loading && ent && !unlimited && (
          <section className="mt-12">
            <div className="flex items-baseline justify-between gap-4">
              <h2 className="font-display text-[20px] font-semibold tracking-[-0.01em] text-gray-900 dark:text-gray-50 sm:text-[22px]">
                Credit packs
              </h2>
              <span className="text-[12px] text-gray-500 dark:text-gray-400">
                One-time · never expires
              </span>
            </div>

            {isGuest ? (
              <div className="mt-5 flex flex-col items-start gap-4 rounded-3xl bg-white p-6 shadow-[0_18px_60px_rgba(0,0,0,0.10)] ring-1 ring-black/5 dark:bg-[#131318] dark:shadow-[0_18px_60px_rgba(0,0,0,0.6)] dark:ring-white/10 sm:flex-row sm:items-center sm:justify-between sm:p-8">
                <div>
                  <p className="text-[15px] font-semibold text-gray-900 dark:text-gray-50">
                    Sign in to buy credits
                  </p>
                  <p className="mt-1 max-w-[46ch] text-[13px] leading-relaxed text-gray-600 dark:text-gray-300">
                    Credits attach to your account, so you’ll need to be signed
                    in. Members also get {ent.freeLimit} free generations every
                    day.
                  </p>
                </div>
                <a
                  href="/api/auth/google"
                  className="inline-flex shrink-0 items-center justify-center gap-2 rounded-full bg-[#F56A00] px-5 py-3 text-[14px] font-semibold text-white transition-colors hover:bg-[#e05a1a]"
                >
                  <LogIn size={16} /> Continue with Google
                </a>
              </div>
            ) : !ent.paymentsEnabled ? (
              <div className="mt-5 rounded-3xl border border-dashed border-gray-300 bg-white/60 p-6 text-[14px] text-gray-600 dark:border-white/10 dark:bg-white/5 dark:text-gray-300 sm:p-8">
                Payments aren’t enabled yet. Your free daily generations are
                still active — check back soon to top up.
              </div>
            ) : (
              <>
                <div className="mt-5 grid gap-4 sm:grid-cols-3">
                  {ent.packs.map((p) => {
                    const featured = p.id === FEATURED_PACK
                    return (
                      <div
                        key={p.id}
                        className={`relative flex flex-col rounded-3xl p-6 ring-1 transition-shadow ${
                          featured
                            ? 'bg-white shadow-[0_24px_70px_rgba(245,106,0,0.18)] ring-[#F56A00]/40 dark:bg-[#161119]'
                            : 'bg-white shadow-[0_12px_40px_rgba(0,0,0,0.08)] ring-black/5 hover:shadow-[0_18px_54px_rgba(0,0,0,0.12)] dark:bg-[#131318] dark:shadow-[0_12px_40px_rgba(0,0,0,0.5)] dark:ring-white/10'
                        }`}
                      >
                        {featured && (
                          <span className="absolute -top-3 left-6 inline-flex items-center gap-1 rounded-full bg-[#F56A00] px-2.5 py-1 text-[11px] font-semibold text-white shadow-sm">
                            <Zap size={12} /> Most popular
                          </span>
                        )}
                        <p className="text-[14px] font-semibold text-gray-900 dark:text-gray-50">
                          {p.label}
                        </p>
                        <p className="mt-3 flex items-baseline gap-1">
                          <span className="font-display text-[34px] font-semibold tracking-[-0.02em] text-gray-900 dark:text-gray-50">
                            {p.priceDisplay}
                          </span>
                        </p>
                        <p className="mt-1 flex items-center gap-1.5 text-[13px] font-medium text-[#F56A00]">
                          <Sparkles size={14} /> {p.credits} generations
                        </p>
                        <p className="mt-3 text-[13px] leading-relaxed text-gray-500 dark:text-gray-400">
                          {PACK_BLURB[p.id] ?? `${p.credits} plans, ready when you are.`}
                        </p>
                        <button
                          disabled={busy !== null}
                          onClick={() => buy(p.id)}
                          className={`mt-6 flex items-center justify-center gap-2 rounded-full px-4 py-3 text-[14px] font-semibold transition-colors disabled:cursor-wait disabled:opacity-60 ${
                            featured
                              ? 'bg-[#F56A00] text-white hover:bg-[#e05a1a]'
                              : 'bg-gray-900 text-white hover:bg-black dark:bg-white dark:text-gray-900 dark:hover:bg-gray-100'
                          }`}
                        >
                          {busy === p.id ? (
                            <>
                              <Loader2 size={16} className="animate-spin" /> Redirecting…
                            </>
                          ) : (
                            <>Buy {p.label}</>
                          )}
                        </button>
                      </div>
                    )
                  })}
                </div>

                {error && (
                  <p className="mt-4 text-[13px] text-[#e05a1a]" role="alert">
                    {error}
                  </p>
                )}

                <ul className="mt-6 flex flex-wrap gap-x-6 gap-y-2 text-[12px] text-gray-500 dark:text-gray-400">
                  {[
                    'Secure checkout via Stripe',
                    'Credits never expire',
                    'Used only after your daily free runs',
                  ].map((t) => (
                    <li key={t} className="flex items-center gap-1.5">
                      <Check size={13} className="text-[#F56A00]" /> {t}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </section>
        )}
      </main>
    </div>
  )
}

/** Usage summary: remaining free runs today + purchased credit balance. */
function StatusCard({
  ent,
  unlimited,
  isGuest,
}: {
  ent: Entitlement
  unlimited: boolean
  isGuest: boolean
}) {
  const planLabel = unlimited ? 'Unlimited' : isGuest ? 'Guest' : 'Member'
  const totalNow = unlimited ? Infinity : ent.freeRemaining + ent.credits

  return (
    <div className="overflow-hidden rounded-3xl bg-white shadow-[0_18px_60px_rgba(0,0,0,0.10),0_1px_6px_rgba(0,0,0,0.05)] ring-1 ring-black/5 dark:bg-[#131318] dark:shadow-[0_18px_60px_rgba(0,0,0,0.6)] dark:ring-white/10">
      <div className="flex flex-col gap-6 p-6 sm:flex-row sm:items-center sm:justify-between sm:p-8">
        <div>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-[#F56A00]/10 px-2.5 py-1 text-[12px] font-semibold text-[#F56A00]">
            <Sparkles size={12} /> {planLabel} plan
          </span>
          <p className="mt-3 font-display text-[28px] font-semibold tracking-[-0.02em] text-gray-900 dark:text-gray-50 sm:text-[32px]">
            {unlimited
              ? 'Unlimited generations'
              : `${totalNow} generation${totalNow === 1 ? '' : 's'} available`}
          </p>
          <p className="mt-1 text-[13px] text-gray-500 dark:text-gray-400">
            {unlimited
              ? 'This account isn’t metered.'
              : isGuest
                ? 'Free previews for visitors — sign in for a daily allowance and credits.'
                : 'Free runs refresh daily; credits are used only after they run out.'}
          </p>
        </div>

        {!unlimited && (
          <div className="flex shrink-0 gap-3">
            <Stat
              label={isGuest ? 'Free left' : 'Free today'}
              value={ent.freeRemaining}
              sub={`of ${ent.freeLimit}`}
            />
            {!isGuest && (
              <Stat label="Credits" value={ent.credits} sub="purchased" accent />
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function Stat({
  label,
  value,
  sub,
  accent = false,
}: {
  label: string
  value: number
  sub: string
  accent?: boolean
}) {
  return (
    <div
      className={`min-w-[104px] rounded-2xl px-4 py-3 text-center ${
        accent
          ? 'bg-[#F56A00]/10'
          : 'bg-gray-100 dark:bg-white/5'
      }`}
    >
      <p
        className={`font-display text-[26px] font-semibold leading-none ${
          accent ? 'text-[#F56A00]' : 'text-gray-900 dark:text-gray-50'
        }`}
      >
        {value}
      </p>
      <p className="mt-1.5 text-[11px] font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">
        {label}
      </p>
      <p className="text-[11px] text-gray-400 dark:text-gray-500">{sub}</p>
    </div>
  )
}

function StatusSkeleton() {
  return (
    <div className="animate-pulse rounded-3xl bg-white p-6 ring-1 ring-black/5 dark:bg-[#131318] dark:ring-white/10 sm:p-8">
      <div className="h-6 w-28 rounded-full bg-gray-200 dark:bg-white/10" />
      <div className="mt-4 h-9 w-64 rounded-lg bg-gray-200 dark:bg-white/10" />
      <div className="mt-3 h-4 w-80 max-w-full rounded bg-gray-200 dark:bg-white/10" />
    </div>
  )
}
