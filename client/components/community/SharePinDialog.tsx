'use client'

/**
 * SharePinDialog — minimal share-a-place picker over POST /api/community/pins.
 *
 * Two modes, by which prop is set:
 *  - `place`          — share THIS place: pick accepted connections (optional —
 *    none selected keeps the pin private to you) + a short note.
 *  - `conversationId` — share INTO this chat (CommunityPanel's share-a-pin
 *    button): pick one of the currently visible map places, then the pin is
 *    scoped to the conversation so every member sees it.
 *
 * The server is the authority: shared_with is silently filtered to accepted
 * connections and conversation membership is validated — this UI is
 * convenience only.
 */
import { useEffect, useMemo, useState } from 'react'
import { Check, MapPin, Share2 } from 'lucide-react'
import { cn } from '@/lib/design/cn'
import { focusRing } from '@/lib/design/tokens'
import { Sheet } from '@/components/ui/Sheet'
import { EmojiAvatar } from './EmojiAvatar'
import { getConnections, type ConnectionEdge } from '@/lib/communityClient'
import type { Place } from '@/lib/types'

/** Mirrors lib/community MAX_PIN_NOTE (value import would pull in server code). */
const MAX_NOTE = 500

export interface SharePinDialogProps {
  /** Place mode: the place being shared with connections. */
  place?: Place | null
  /** Conversation mode: share a picked place into this pin-scoped chat. */
  conversationId?: string | null
  /** Pickable places in conversation mode (current map results / stops). */
  candidatePlaces?: Place[]
  onClose: () => void
  /** Fired after a successful POST (host refreshes the map pin layer). */
  onShared?: () => void
}

function placePayload(p: Place) {
  return {
    place_id: p.place_id,
    name: p.name,
    lat: p.coordinates.lat,
    lng: p.coordinates.lng,
    address: p.address || undefined,
    photo_url: p.photo_url || undefined,
    rating: p.rating,
  }
}

export function SharePinDialog({ place, conversationId, candidatePlaces = [], onClose, onShared }: SharePinDialogProps) {
  const conversationMode = !!conversationId
  const [chosenPlace, setChosenPlace] = useState<Place | null>(place ?? null)
  const [connections, setConnections] = useState<ConnectionEdge[] | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  // Connections list only matters in place mode (conversation pins go to members).
  useEffect(() => {
    if (conversationMode) return
    let cancelled = false
    getConnections()
      .then((c) => { if (!cancelled) setConnections(c.accepted.filter((e) => e.user)) })
      .catch(() => { if (!cancelled) setConnections([]) })
    return () => { cancelled = true }
  }, [conversationMode])

  const candidates = useMemo(
    () => candidatePlaces.filter((p) => p.place_id && !p.place_id.startsWith('__')),
    [candidatePlaces],
  )

  const toggle = (userId: string) =>
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(userId)) next.delete(userId)
      else next.add(userId)
      return next
    })

  const share = async () => {
    if (!chosenPlace || busy) return
    setBusy(true)
    setError(null)
    try {
      const body: Record<string, unknown> = {
        place: placePayload(chosenPlace),
        note: note.trim() || undefined,
      }
      if (conversationMode) body.conversation_id = conversationId
      else if (selected.size > 0) body.shared_with = [...selected]
      const res = await fetch('/api/community/pins', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) {
        setError(typeof data.error === 'string' ? data.error : 'Could not share this place.')
        return
      }
      setDone(true)
      onShared?.()
      setTimeout(onClose, 900)
    } catch {
      setError('Could not share this place.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet open onClose={onClose} side="right" title="Share a place">
      <div className="flex flex-col gap-4">
        {/* Place: fixed summary in place mode, picker in conversation mode */}
        {chosenPlace && !conversationMode ? (
          <div className="flex items-start gap-2.5 rounded-xl border border-border bg-surface px-3 py-2.5">
            <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-gold" />
            <div className="min-w-0">
              <p className="truncate text-[13px] font-medium text-text">{chosenPlace.name}</p>
              {chosenPlace.address && (
                <p className="mt-0.5 truncate text-[11.5px] text-text3">{chosenPlace.address}</p>
              )}
            </div>
          </div>
        ) : (
          <section aria-label="Pick a place">
            <p className="mb-2 font-mono text-[11px] uppercase tracking-[0.14em] text-text3">
              Pick a place
            </p>
            {candidates.length === 0 ? (
              <p className="text-[12.5px] leading-relaxed text-text3">
                No places yet. Ask Hodari to find some first.
              </p>
            ) : (
              <ul className="flex max-h-64 flex-col gap-2 overflow-y-auto scrollbar-hide">
                {candidates.map((p) => {
                  const active = chosenPlace?.place_id === p.place_id
                  return (
                    <li key={p.place_id}>
                      <button
                        type="button"
                        aria-pressed={active}
                        onClick={() => setChosenPlace(p)}
                        className={cn(
                          'flex w-full items-start gap-2.5 rounded-xl border px-3 py-2.5 text-left transition-colors',
                          active ? 'border-gold/60 bg-gold/5' : 'border-border bg-surface hover:border-gold/40',
                          focusRing,
                        )}
                      >
                        <MapPin className={cn('mt-0.5 h-3.5 w-3.5 shrink-0', active ? 'text-gold' : 'text-text3')} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[13px] font-medium text-text">{p.name}</span>
                          {p.address && (
                            <span className="mt-0.5 block truncate text-[11.5px] text-text3">{p.address}</span>
                          )}
                        </span>
                        {active && <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-gold" />}
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </section>
        )}

        {/* Audience (place mode only) */}
        {!conversationMode && (
          <section aria-label="Share with">
            <p className="mb-2 font-mono text-[11px] uppercase tracking-[0.14em] text-text3">Share with</p>
            {connections === null ? (
              <div className="flex items-center gap-2.5 py-2">
                <div className="thinking-ring" />
                <span className="text-[11px] tracking-wide text-text2">Loading connections…</span>
              </div>
            ) : connections.length === 0 ? (
              <p className="text-[12.5px] leading-relaxed text-text3">
                No connections yet. The pin stays private to you.
              </p>
            ) : (
              <>
                <ul className="flex max-h-56 flex-col gap-1.5 overflow-y-auto scrollbar-hide">
                  {connections.map((edge) => {
                    const u = edge.user!
                    const active = selected.has(u.user_id)
                    return (
                      <li key={u.user_id}>
                        <button
                          type="button"
                          aria-pressed={active}
                          onClick={() => toggle(u.user_id)}
                          className={cn(
                            'flex w-full items-center gap-2.5 rounded-xl border px-2.5 py-2 text-left transition-colors',
                            active ? 'border-gold/60 bg-gold/5' : 'border-border bg-surface hover:border-gold/40',
                            focusRing,
                          )}
                        >
                          <EmojiAvatar emoji={u.avatar_emoji} name={u.name ?? u.handle} size="sm" />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[13px] font-medium text-text">
                              {u.name ?? `@${u.handle}`}
                            </span>
                            <span className="block truncate font-mono text-[11px] text-text3">@{u.handle}</span>
                          </span>
                          {active && <Check className="h-3.5 w-3.5 shrink-0 text-gold" />}
                        </button>
                      </li>
                    )
                  })}
                </ul>
                <p className="mt-1.5 text-[11px] leading-relaxed text-text3">
                  Optional. Unselected pins stay private.
                </p>
              </>
            )}
          </section>
        )}

        {/* Note */}
        <section aria-label="Note">
          <label htmlFor="share-pin-note" className="mb-2 block font-mono text-[11px] uppercase tracking-[0.14em] text-text3">
            Note
          </label>
          <textarea
            id="share-pin-note"
            value={note}
            onChange={(e) => setNote(e.target.value.slice(0, MAX_NOTE))}
            rows={2}
            placeholder="Why this place? (optional)"
            className="w-full resize-none rounded-xl border border-border bg-surface px-3 py-2 text-[13px] text-text outline-none transition-[border-color,box-shadow] placeholder:text-text3 focus:border-gold/60 focus:ring-2 focus:ring-gold/20 motion-reduce:transition-none"
          />
        </section>

        {error && <p className="text-[12px] text-danger" role="alert">{error}</p>}

        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={!chosenPlace || busy || done}
            onClick={() => void share()}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-full bg-gold px-4 py-2 text-[12px] font-medium text-white transition-colors hover:bg-brand-dark disabled:opacity-60',
              focusRing,
            )}
          >
            {done ? <Check className="h-3.5 w-3.5" /> : <Share2 className="h-3.5 w-3.5" />}
            {done ? 'Shared' : busy ? 'Sharing…' : conversationMode ? 'Share to chat' : 'Share pin'}
          </button>
          <button
            type="button"
            onClick={onClose}
            className={cn('rounded-full border border-border px-3.5 py-2 text-[12px] text-text2 transition-colors hover:border-gold/40 hover:text-text', focusRing)}
          >
            Cancel
          </button>
        </div>
      </div>
    </Sheet>
  )
}
