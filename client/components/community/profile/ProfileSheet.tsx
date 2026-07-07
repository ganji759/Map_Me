'use client'

/**
 * ProfileSheet — slide-over showing a traveller's community profile.
 *
 * Accepts a handle OR a user_id (`userIdOrHandle`): tries the handle lookup
 * first, then resolves an unknown id through the caller's connection edges
 * (pins/reviews attribute users by both, so either arrives here). Shows
 * avatar + name + @handle + presence, bio, the connection action (invite /
 * accept / pending / connected / block), a stats row, the pins they've shared
 * that are visible to the viewer (tap → onFocusPlace), and their reviews.
 *
 * Own profile swaps the connection controls for an "Edit profile" view
 * (EditProfile). All data comes from the community API routes — identity and
 * visibility are enforced server-side.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { MapPin, Pencil, ShieldOff, UserCheck, UserPlus } from 'lucide-react'
import { cn } from '@/lib/design/cn'
import { focusRing } from '@/lib/design/tokens'
import { Sheet } from '@/components/ui/Sheet'
import type { RelationStatus, SharedPin, PinReview, UserAttribution } from '@/lib/community'
import { StarRating } from './Stars'
import { EditProfile } from './EditProfile'

/** Projection returned by GET /api/community/profile. */
export interface ProfileView {
  user_id: string
  handle: string
  name: string | null
  bio: string
  avatar_emoji: string
  discoverable: boolean
  share_location: boolean
  location: { type: 'Point'; coordinates: [number, number] } | null
  online: boolean
  last_seen_at: string | null
  pubkey: Record<string, unknown> | null
}

export interface FocusPlace {
  place_id: string
  name: string
  lat: number
  lng: number
}

export interface ProfileSheetProps {
  /** Handle (preferred) or user_id of the profile to show. */
  userIdOrHandle: string
  onClose: () => void
  /** Tap on one of their shared pins — center the map on it. */
  onFocusPlace?: (place: FocusPlace) => void
}

type VisiblePin = SharedPin & { owner: UserAttribution | null }
type AuthoredReview = PinReview & { author?: UserAttribution | null }

interface ConnectionEdgeView {
  requester_id: string
  recipient_id: string
  status: string
  user: UserAttribution | null
}
interface ConnectionsView {
  accepted: ConnectionEdgeView[]
  pending_in: ConnectionEdgeView[]
  pending_out: ConnectionEdgeView[]
  blocked: ConnectionEdgeView[]
}

function relationFromEdges(edges: ConnectionsView, otherId: string): RelationStatus {
  if (edges.accepted.some((e) => e.user?.user_id === otherId)) return 'accepted'
  if (edges.pending_in.some((e) => e.user?.user_id === otherId)) return 'pending_in'
  if (edges.pending_out.some((e) => e.user?.user_id === otherId)) return 'pending_out'
  if (edges.blocked.some((e) => e.user?.user_id === otherId)) return 'blocked'
  return 'none'
}

function lastSeenLabel(iso: string | null): string {
  if (!iso) return 'Not seen recently'
  const mins = Math.max(1, Math.round((Date.now() - new Date(iso).getTime()) / 60_000))
  if (mins < 60) return `Active ${mins}m ago`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `Active ${hours}h ago`
  return `Active ${Math.round(hours / 24)}d ago`
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T | null> {
  try {
    const res = await fetch(url, init)
    if (!res.ok) return null
    return (await res.json()) as T
  } catch {
    return null
  }
}

export function ProfileSheet({ userIdOrHandle, onClose, onFocusPlace }: ProfileSheetProps) {
  const [status, setStatus] = useState<'loading' | 'ok' | 'not_found' | 'error'>('loading')
  const [me, setMe] = useState<ProfileView | null>(null)
  const [profile, setProfile] = useState<ProfileView | null>(null)
  const [relation, setRelation] = useState<RelationStatus>('none')
  const [pins, setPins] = useState<VisiblePin[]>([])
  const [reviews, setReviews] = useState<AuthoredReview[]>([])
  const [editing, setEditing] = useState(false)
  const [acting, setActing] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

  const isSelf = !!me && !!profile && me.user_id === profile.user_id

  useEffect(() => {
    let cancelled = false

    async function load() {
      setStatus('loading')
      setEditing(false)

      const meRes = await fetchJson<{ profile: ProfileView }>('/api/community/profile')
      if (cancelled) return
      if (!meRes) { setStatus('error'); return }
      setMe(meRes.profile)

      const needle = userIdOrHandle.trim()
      let target: ProfileView | null = null

      if (needle === meRes.profile.user_id || needle.toLowerCase() === meRes.profile.handle) {
        target = meRes.profile
      } else {
        const byHandle = await fetchJson<{ profile: ProfileView }>(
          `/api/community/profile?handle=${encodeURIComponent(needle.toLowerCase())}`,
        )
        target = byHandle?.profile ?? null
      }

      // Someone else's profile also needs the caller's edges for the relation.
      const edges = await fetchJson<ConnectionsView>('/api/community/connections')
      if (cancelled) return

      // Not a handle → maybe a user_id we're connected (or pending) with.
      if (!target && edges) {
        const all = [...edges.accepted, ...edges.pending_in, ...edges.pending_out, ...edges.blocked]
        const edge = all.find((e) => e.user?.user_id === needle)
        if (edge?.user?.handle) {
          const byId = await fetchJson<{ profile: ProfileView }>(
            `/api/community/profile?handle=${encodeURIComponent(edge.user.handle)}`,
          )
          if (cancelled) return
          target = byId?.profile ?? null
        }
      }

      if (!target) { setStatus('not_found'); return }
      setProfile(target)
      setRelation(edges ? relationFromEdges(edges, target.user_id) : 'none')

      // Pins visible to me, filtered to this owner; reviews they authored
      // (the API already restricts reviews to my closed network).
      const [pinsRes, reviewsRes] = await Promise.all([
        fetchJson<{ pins: VisiblePin[] }>('/api/community/pins'),
        fetchJson<{ reviews: AuthoredReview[] }>(
          `/api/community/reviews?author_id=${encodeURIComponent(target.user_id)}`,
        ),
      ])
      if (cancelled) return
      setPins((pinsRes?.pins ?? []).filter((p) => p.owner?.user_id === target.user_id))
      setReviews(reviewsRes?.reviews ?? [])
      setStatus('ok')
    }

    void load()
    return () => { cancelled = true }
  }, [userIdOrHandle])

  const act = useCallback(
    async (action: 'invite' | 'accept' | 'decline' | 'block') => {
      if (!profile || acting) return
      setActing(true)
      setActionError(null)
      try {
        const res = await fetch('/api/community/connections', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action, user_id: profile.user_id }),
        })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) {
          setActionError(typeof data.error === 'string' ? data.error : 'Something went wrong.')
          return
        }
        const next: Record<typeof action, RelationStatus> = {
          invite: 'pending_out',
          accept: 'accepted',
          decline: 'none',
          block: 'blocked',
        }
        // An invite of a reciprocal pending invite auto-accepts server-side.
        const conn = data.connection as { status?: string } | undefined
        setRelation(action === 'invite' && conn?.status === 'accepted' ? 'accepted' : next[action])
      } catch {
        setActionError('Something went wrong.')
      } finally {
        setActing(false)
      }
    },
    [profile, acting],
  )

  // Name pins so reviews can reference a place by title, not opaque id.
  const placeNames = useMemo(() => {
    const names: Record<string, string> = {}
    for (const p of pins) names[p.place.place_id] = p.place.name
    return names
  }, [pins])

  const stats = useMemo(() => {
    const visited = new Set(reviews.map((r) => r.place_id))
    return [
      { label: 'Saved', value: pins.length },
      { label: 'Visited', value: visited.size },
      { label: 'Reviews', value: reviews.length },
    ]
  }, [pins, reviews])

  const title = editing ? 'Edit profile' : 'Profile'

  return (
    <Sheet open onClose={onClose} side="right" title={title}>
      {status === 'loading' && (
        <div className="flex items-center gap-2.5 py-8">
          <div className="thinking-ring" />
          <span className="text-[11px] tracking-wide text-text2">Loading profile…</span>
        </div>
      )}

      {status === 'not_found' && (
        <p className="py-8 text-[13px] text-text2">
          This profile isn&apos;t available — it may be private or no longer exist.
        </p>
      )}
      {status === 'error' && (
        <p className="py-8 text-[13px] text-text2">Could not load the profile. Try again shortly.</p>
      )}

      {status === 'ok' && profile && editing && (
        <EditProfile
          initial={profile}
          onCancel={() => setEditing(false)}
          onSaved={(p) => { setProfile(p); setMe(p) }}
        />
      )}

      {status === 'ok' && profile && !editing && (
        <div className="flex flex-col gap-5">
          {/* Identity */}
          <div className="flex items-start gap-3.5">
            <div className="relative shrink-0">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-border bg-surface2 text-3xl">
                {profile.avatar_emoji}
              </div>
              <span
                title={profile.online ? 'Online' : lastSeenLabel(profile.last_seen_at)}
                aria-label={profile.online ? 'Online' : 'Offline'}
                role="img"
                className={cn(
                  'absolute -bottom-0.5 -right-0.5 h-3.5 w-3.5 rounded-full border-2 border-surface',
                  profile.online ? 'bg-green' : 'bg-surface3',
                )}
              />
            </div>
            <div className="min-w-0 flex-1">
              <h3 className="truncate font-display text-lg font-semibold leading-tight text-text">
                {profile.name ?? `@${profile.handle}`}
              </h3>
              <p className="mt-0.5 font-mono text-[12px] text-gold">@{profile.handle}</p>
              <p className="mt-0.5 text-[11px] text-text3">
                {profile.online ? 'Online now' : lastSeenLabel(profile.last_seen_at)}
              </p>
            </div>
          </div>

          {profile.bio && (
            <p className="text-[13px] leading-relaxed text-text2">{profile.bio}</p>
          )}

          {/* Connection actions */}
          <div className="flex flex-wrap items-center gap-2">
            {isSelf ? (
              <button
                type="button"
                onClick={() => setEditing(true)}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-full bg-gold px-4 py-2 text-[12px] font-medium text-white transition-colors hover:bg-brand-dark',
                  focusRing,
                )}
              >
                <Pencil className="h-3.5 w-3.5" />
                Edit profile
              </button>
            ) : relation === 'accepted' ? (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-green/40 bg-green/10 px-3.5 py-2 text-[12px] font-medium text-green">
                <UserCheck className="h-3.5 w-3.5" />
                Connected
              </span>
            ) : relation === 'pending_out' ? (
              <span className="inline-flex items-center rounded-full border border-border px-3.5 py-2 text-[12px] text-text2">
                Invite sent
              </span>
            ) : relation === 'pending_in' ? (
              <>
                <button
                  type="button"
                  disabled={acting}
                  onClick={() => void act('accept')}
                  className={cn(
                    'inline-flex items-center gap-1.5 rounded-full bg-gold px-4 py-2 text-[12px] font-medium text-white transition-colors hover:bg-brand-dark disabled:opacity-60',
                    focusRing,
                  )}
                >
                  <UserCheck className="h-3.5 w-3.5" />
                  Accept invite
                </button>
                <button
                  type="button"
                  disabled={acting}
                  onClick={() => void act('decline')}
                  className={cn(
                    'rounded-full border border-border px-3.5 py-2 text-[12px] text-text2 transition-colors hover:border-danger/50 hover:text-danger disabled:opacity-60',
                    focusRing,
                  )}
                >
                  Decline
                </button>
              </>
            ) : relation === 'blocked' ? (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-border px-3.5 py-2 text-[12px] text-text3">
                <ShieldOff className="h-3.5 w-3.5" />
                Blocked
              </span>
            ) : (
              <button
                type="button"
                disabled={acting}
                onClick={() => void act('invite')}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-full bg-gold px-4 py-2 text-[12px] font-medium text-white transition-colors hover:bg-brand-dark disabled:opacity-60',
                  focusRing,
                )}
              >
                <UserPlus className="h-3.5 w-3.5" />
                Connect
              </button>
            )}

            {!isSelf && relation !== 'blocked' && (
              <button
                type="button"
                disabled={acting}
                onClick={() => void act('block')}
                className={cn(
                  'rounded-full border border-border px-3.5 py-2 text-[12px] text-text3 transition-colors hover:border-danger/50 hover:text-danger disabled:opacity-60',
                  focusRing,
                )}
              >
                Block
              </button>
            )}
          </div>
          {actionError && <p className="text-[12px] text-danger" role="alert">{actionError}</p>}

          {/* Stats */}
          <div className="grid grid-cols-3 divide-x divide-border rounded-xl border border-border bg-surface">
            {stats.map((s) => (
              <div key={s.label} className="px-2 py-3 text-center">
                <p className="font-display text-lg font-semibold text-text">{s.value}</p>
                <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-text3">{s.label}</p>
              </div>
            ))}
          </div>

          {/* Shared pins */}
          <section aria-label="Shared places">
            <p className="mb-2 font-mono text-[11px] uppercase tracking-[0.14em] text-text3">
              {isSelf ? 'Your pins' : 'Shared with you'}
            </p>
            {pins.length === 0 ? (
              <p className="text-[12.5px] text-text3">
                {isSelf ? 'No pins yet — save a place from the map.' : 'No shared places yet.'}
              </p>
            ) : (
              <ul className="flex flex-col gap-2">
                {pins.map((pin) => (
                  <li key={pin.pin_id}>
                    <button
                      type="button"
                      onClick={() =>
                        onFocusPlace?.({
                          place_id: pin.place.place_id,
                          name: pin.place.name,
                          lat: pin.place.lat,
                          lng: pin.place.lng,
                        })
                      }
                      className={cn(
                        'flex w-full items-start gap-2.5 rounded-xl border border-border bg-surface px-3 py-2.5 text-left transition-colors hover:border-gold/40',
                        focusRing,
                      )}
                    >
                      <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-gold" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] font-medium text-text">
                          {pin.place.name}
                        </span>
                        {pin.note && (
                          <span className="mt-0.5 block text-[11.5px] leading-relaxed text-text2 line-clamp-2">
                            {pin.note}
                          </span>
                        )}
                      </span>
                      {pin.place.rating != null && (
                        <span className="mt-0.5 shrink-0 font-mono text-[11px] text-text2">
                          {pin.place.rating.toFixed(1)}
                        </span>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* Reviews */}
          <section aria-label="Reviews">
            <p className="mb-2 font-mono text-[11px] uppercase tracking-[0.14em] text-text3">Reviews</p>
            {reviews.length === 0 ? (
              <p className="text-[12.5px] text-text3">No reviews yet.</p>
            ) : (
              <ul className="flex flex-col gap-2.5">
                {reviews.map((r) => (
                  <li key={r.review_id} className="rounded-xl border border-border bg-surface px-3 py-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <StarRating value={r.rating} />
                      <span className="font-mono text-[10px] text-text3">
                        {new Date(r.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                      </span>
                    </div>
                    {placeNames[r.place_id] && (
                      <p className="mt-1 truncate text-[12px] font-medium text-text">
                        {placeNames[r.place_id]}
                      </p>
                    )}
                    {r.text && (
                      <p className="mt-1 text-[12.5px] leading-relaxed text-text2">{r.text}</p>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
    </Sheet>
  )
}
