'use client'

import { useEffect, useState } from 'react'
import { X, Sparkles, Check, LogIn, Loader2 } from 'lucide-react'

export interface GateState {
  type: 'login' | 'paywall'
  message?: string
}

interface Pack {
  id: string
  credits: number
  label: string
  priceDisplay: string
}

interface Entitlement {
  authed: boolean
  freeRemaining: number
  freeLimit: number
  credits: number
  paymentsEnabled: boolean
  packs: Pack[]
}

/**
 * Quota gate. Shown when /api/chat refuses a run:
 *  - 'login'   → guest used their free previews → prompt Google sign-in
 *  - 'paywall' → member out of free + credits → sell a credit pack via Stripe
 */
export default function Paywall({ gate, onClose }: { gate: GateState | null; onClose: () => void }) {
  const [ent, setEnt] = useState<Entitlement | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!gate) return
    setError(null)
    if (gate.type === 'paywall') {
      fetch('/api/billing/me')
        .then((r) => r.json())
        .then(setEnt)
        .catch(() => setEnt(null))
    }
  }, [gate])

  useEffect(() => {
    if (!gate) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [gate, onClose])

  if (!gate) return null

  async function buy(packId: string) {
    setBusy(packId)
    setError(null)
    try {
      const res = await fetch('/api/billing/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ packId }),
      })
      const data = await res.json().catch(() => ({}))
      if (res.status === 401) {
        // Lost session — bounce to sign-in.
        window.location.href = '/api/auth/google'
        return
      }
      if (!res.ok || !data.url) {
        setError(data.error ?? 'Could not start checkout.')
        setBusy(null)
        return
      }
      window.location.href = data.url
    } catch {
      setError('Network error. Please try again.')
      setBusy(null)
    }
  }

  const isLogin = gate.type === 'login'

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-md rounded-2xl border border-white/10 bg-neutral-900 text-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          aria-label="Close"
          className="absolute right-3 top-3 rounded-full p-1.5 text-white/60 hover:bg-white/10 hover:text-white"
        >
          <X size={18} />
        </button>

        <div className="p-6">
          <div className="mb-4 flex items-center gap-2">
            <span className="grid h-9 w-9 place-items-center rounded-full bg-orange-500/15 text-orange-400">
              <Sparkles size={18} />
            </span>
            <h2 className="text-lg font-semibold">
              {isLogin ? 'Keep exploring' : 'Out of generations'}
            </h2>
          </div>

          <p className="mb-5 text-sm text-white/70">
            {gate.message ??
              (isLogin
                ? 'You’ve used your free previews. Sign in with Google to unlock more — it’s free.'
                : 'You’ve used today’s free generations. Top up with a credit pack to keep planning.')}
          </p>

          {isLogin ? (
            <a
              href="/api/auth/google"
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-orange-500 px-4 py-3 text-sm font-semibold text-white transition hover:bg-orange-600"
            >
              <LogIn size={16} /> Continue with Google
            </a>
          ) : ent && !ent.paymentsEnabled ? (
            <p className="rounded-xl border border-white/10 bg-white/5 p-4 text-sm text-white/60">
              Payments aren’t enabled yet. Please check back soon.
            </p>
          ) : (
            <div className="space-y-2.5">
              {(ent?.packs ?? []).map((p) => (
                <button
                  key={p.id}
                  disabled={busy !== null}
                  onClick={() => buy(p.id)}
                  className="flex w-full items-center justify-between rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-left transition hover:border-orange-400/50 hover:bg-white/10 disabled:opacity-50"
                >
                  <span>
                    <span className="block text-sm font-semibold">{p.label}</span>
                    <span className="flex items-center gap-1 text-xs text-white/60">
                      <Check size={12} className="text-orange-400" /> {p.credits} generations
                    </span>
                  </span>
                  <span className="flex items-center gap-2">
                    <span className="text-base font-bold text-orange-400">{p.priceDisplay}</span>
                    {busy === p.id && <Loader2 size={16} className="animate-spin text-white/60" />}
                  </span>
                </button>
              ))}
            </div>
          )}

          {error && <p className="mt-3 text-xs text-red-400">{error}</p>}

          {!isLogin && ent && (
            <p className="mt-4 text-center text-xs text-white/40">
              {ent.credits > 0
                ? `${ent.credits} credit${ent.credits === 1 ? '' : 's'} left · resets ${ent.freeLimit} free daily`
                : `${ent.freeLimit} free generations every day`}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
