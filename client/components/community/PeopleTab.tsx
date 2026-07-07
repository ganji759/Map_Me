'use client'

/**
 * PeopleTab — connections management inside the Community panel:
 * - search travellers by handle/name prefix, or "near me" (~25km, requires
 *   the caller to be sharing their location),
 * - incoming invites with accept/decline, outgoing invites,
 * - accepted connections with presence dots and a "Message" shortcut that
 *   opens (or creates) the encrypted DM.
 *
 * All mutations go through /api/community/connections; this component only
 * holds UI state and re-syncs via onChanged().
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { Loader2, MapPin, MessageSquare, Search, UserCheck, UserPlus, Users } from 'lucide-react'
import { cn } from '@/lib/design/cn'
import { focusRing } from '@/lib/design/tokens'
import type { UserAttribution, UserSummary, PresenceInfo, RelationStatus } from '@/lib/community'
import {
  CommunityApiError,
  connectionAction,
  searchNearby,
  searchUsers,
  type ConnectionsView,
  type ConnectionAction,
} from '@/lib/communityClient'
import { EmojiAvatar } from './EmojiAvatar'

export interface PeopleTabProps {
  currentUserId: string
  /** Panel-owned connections snapshot (null while first loading). */
  connections: ConnectionsView | null
  /** Panel-owned presence map (accepted connections + self). */
  presence: Record<string, PresenceInfo>
  /** False while E2EE is unavailable — disables starting new DMs. */
  canMessage: boolean
  /** Ask the panel to re-fetch connections after a mutation. */
  onChanged: () => void
  /** Open (or create) a DM with this user. */
  onMessage: (user: UserAttribution) => void
  /** user_id of the DM currently being opened (renders a spinner). */
  openingDm?: string | null
  /** Optional hook into the profile sheet (wired by the integration agent). */
  onOpenProfile?: (handle: string) => void
}

type SearchMode = 'query' | 'near'

const SECTION = 'mb-2 font-mono text-[11px] uppercase tracking-[0.14em] text-text3'
const ROW = 'flex w-full items-center gap-2.5 rounded-xl border border-border bg-surface px-3 py-2.5'

export function PeopleTab({
  currentUserId,
  connections,
  presence,
  canMessage,
  onChanged,
  onMessage,
  openingDm,
  onOpenProfile,
}: PeopleTabProps) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<UserSummary[] | null>(null)
  const [searching, setSearching] = useState(false)
  const [searchMode, setSearchMode] = useState<SearchMode>('query')
  const [searchError, setSearchError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [actingOn, setActingOn] = useState<string | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const searchGen = useRef(0)

  // Debounced prefix search.
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    const q = query.trim()
    if (!q) {
      if (searchMode === 'query') {
        setResults(null)
        setSearching(false)
        setSearchError(null)
      }
      return
    }
    setSearchMode('query')
    const gen = ++searchGen.current
    debounceRef.current = setTimeout(async () => {
      setSearching(true)
      setSearchError(null)
      try {
        const users = await searchUsers(q)
        if (searchGen.current === gen) setResults(users)
      } catch (err) {
        if (searchGen.current === gen) {
          setSearchError(err instanceof CommunityApiError ? err.message : 'Search failed. Try again.')
        }
      } finally {
        if (searchGen.current === gen) setSearching(false)
      }
    }, 350)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query])

  const runNearMe = useCallback(async () => {
    const gen = ++searchGen.current
    setQuery('')
    setSearchMode('near')
    setSearching(true)
    setSearchError(null)
    setResults(null)
    try {
      const users = await searchNearby()
      if (searchGen.current !== gen) return
      setResults(users)
      if (users.length === 0) {
        setSearchError('No travellers nearby — this needs location sharing on (yours and theirs).')
      }
    } catch (err) {
      if (searchGen.current === gen) {
        setSearchError(err instanceof CommunityApiError ? err.message : 'Nearby search failed.')
      }
    } finally {
      if (searchGen.current === gen) setSearching(false)
    }
  }, [])

  const act = useCallback(
    async (action: ConnectionAction, userId: string) => {
      setActingOn(userId)
      setActionError(null)
      try {
        const conn = await connectionAction(action, userId)
        // Reflect the new relation in any visible search results.
        setResults((prev) =>
          prev
            ? prev.map((u) => {
                if (u.user_id !== userId) return u
                const next: RelationStatus =
                  action === 'invite'
                    ? conn.status === 'accepted' ? 'accepted' : 'pending_out'
                    : action === 'accept' ? 'accepted'
                    : action === 'block' ? 'blocked'
                    : 'none'
                return { ...u, connection: next }
              })
            : prev,
        )
        onChanged()
      } catch (err) {
        setActionError(err instanceof CommunityApiError ? err.message : 'Something went wrong.')
      } finally {
        setActingOn(null)
      }
    },
    [onChanged],
  )

  const accepted = connections?.accepted ?? []
  const pendingIn = connections?.pending_in ?? []
  const pendingOut = connections?.pending_out ?? []
  const showResults = results !== null || searching || !!searchError

  const nameOf = (u: UserAttribution) => u.name || `@${u.handle}`

  const messageButton = (user: UserAttribution) => (
    <button
      type="button"
      disabled={!canMessage || openingDm === user.user_id}
      onClick={() => onMessage(user)}
      title={canMessage ? `Message ${nameOf(user)}` : 'Encrypted chat unavailable on this device'}
      className={cn(
        'inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border border-border px-3 text-[12px] text-text2 transition-colors hover:border-gold/40 hover:text-gold disabled:cursor-not-allowed disabled:opacity-40',
        focusRing,
      )}
    >
      {openingDm === user.user_id ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" aria-hidden />
      ) : (
        <MessageSquare className="h-3.5 w-3.5" aria-hidden />
      )}
      Message
    </button>
  )

  const identity = (user: UserAttribution, sub?: string | null, online?: PresenceInfo | null) => (
    <>
      <EmojiAvatar emoji={user.avatar_emoji} name={nameOf(user)} size="md" presence={online} />
      <span className="min-w-0 flex-1">
        {onOpenProfile ? (
          <button
            type="button"
            onClick={() => onOpenProfile(user.handle)}
            className={cn('block max-w-full truncate text-left text-[13px] font-medium text-text hover:text-gold', focusRing)}
          >
            {nameOf(user)}
          </button>
        ) : (
          <span className="block truncate text-[13px] font-medium text-text">{nameOf(user)}</span>
        )}
        <span className="block truncate font-mono text-[11px] text-text3">
          @{user.handle}
          {sub ? <span className="ml-1.5 text-text3">· {sub}</span> : null}
        </span>
      </span>
    </>
  )

  return (
    <div className="flex flex-col gap-5">
      {/* Search */}
      <div>
        <div
          className={cn(
            'flex items-center gap-2 rounded-xl border border-border bg-surface/80 px-3.5 transition-colors',
            'focus-within:border-gold/40 focus-within:ring-2 focus-within:ring-gold/30',
          )}
        >
          <Search className="h-4 w-4 shrink-0 text-text3" aria-hidden />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Find travellers by handle or name…"
            aria-label="Search travellers"
            className="min-w-0 flex-1 bg-transparent py-2.5 font-sans text-sm text-text outline-none placeholder:text-text3"
          />
          <button
            type="button"
            onClick={() => void runNearMe()}
            title="Discoverable travellers within ~25km of your shared location"
            className={cn(
              'inline-flex h-7 shrink-0 items-center gap-1 rounded-full border border-border px-2.5 text-[11px] text-text2 transition-colors hover:border-gold/40 hover:text-gold',
              searchMode === 'near' && showResults && 'border-gold/40 text-gold',
              focusRing,
            )}
          >
            <MapPin className="h-3 w-3" aria-hidden />
            Near me
          </button>
        </div>

        {showResults && (
          <div className="mt-3">
            <p className={SECTION}>{searchMode === 'near' ? 'Travellers near you' : 'Results'}</p>
            {searching && (
              <div className="flex items-center gap-2.5 py-3">
                <div className="thinking-ring" />
                <span className="text-[11px] tracking-wide text-text2">Searching…</span>
              </div>
            )}
            {!searching && searchError && <p className="py-1 text-[12.5px] text-text3">{searchError}</p>}
            {!searching && !searchError && results?.length === 0 && (
              <p className="py-1 text-[12.5px] text-text3">No one matches that yet.</p>
            )}
            {!searching && (results?.length ?? 0) > 0 && (
              <ul className="flex flex-col gap-2">
                {results!.map((u) => (
                  <li key={u.user_id} className={ROW}>
                    {identity(u, u.bio || null, { online: u.online, last_seen_at: u.last_seen_at })}
                    {u.connection === 'accepted' ? (
                      messageButton(u)
                    ) : u.connection === 'pending_out' ? (
                      <span className="shrink-0 rounded-full border border-border px-2.5 py-1 text-[11px] text-text3">
                        Invited
                      </span>
                    ) : u.connection === 'pending_in' ? (
                      <button
                        type="button"
                        disabled={actingOn === u.user_id}
                        onClick={() => void act('accept', u.user_id)}
                        className={cn(
                          'inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full bg-gold px-3 text-[12px] font-medium text-white transition-colors hover:bg-brand-dark disabled:opacity-60',
                          focusRing,
                        )}
                      >
                        <UserCheck className="h-3.5 w-3.5" aria-hidden />
                        Accept
                      </button>
                    ) : (
                      <button
                        type="button"
                        disabled={actingOn === u.user_id}
                        onClick={() => void act('invite', u.user_id)}
                        className={cn(
                          'inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border border-gold/40 px-3 text-[12px] font-medium text-gold transition-colors hover:bg-gold/10 disabled:opacity-60',
                          focusRing,
                        )}
                      >
                        <UserPlus className="h-3.5 w-3.5" aria-hidden />
                        Invite
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      {actionError && (
        <p className="text-[12px] text-danger" role="alert">
          {actionError}
        </p>
      )}

      {/* Incoming invites */}
      {pendingIn.length > 0 && (
        <section aria-label="Invites">
          <p className={SECTION}>Invites</p>
          <ul className="flex flex-col gap-2">
            {pendingIn.map((e) =>
              e.user ? (
                <li key={e.user.user_id} className={cn(ROW, 'border-gold/30')}>
                  {identity(e.user)}
                  <span className="flex shrink-0 items-center gap-1.5">
                    <button
                      type="button"
                      disabled={actingOn === e.user.user_id}
                      onClick={() => void act('accept', e.user!.user_id)}
                      className={cn(
                        'inline-flex h-8 items-center rounded-full bg-gold px-3 text-[12px] font-medium text-white transition-colors hover:bg-brand-dark disabled:opacity-60',
                        focusRing,
                      )}
                    >
                      Accept
                    </button>
                    <button
                      type="button"
                      disabled={actingOn === e.user.user_id}
                      onClick={() => void act('decline', e.user!.user_id)}
                      className={cn(
                        'inline-flex h-8 items-center rounded-full border border-border px-3 text-[12px] text-text2 transition-colors hover:border-danger/50 hover:text-danger disabled:opacity-60',
                        focusRing,
                      )}
                    >
                      Decline
                    </button>
                  </span>
                </li>
              ) : null,
            )}
          </ul>
        </section>
      )}

      {/* Connections */}
      <section aria-label="Connections">
        <p className={SECTION}>Connections</p>
        {connections === null ? (
          <div className="flex items-center gap-2.5 py-3">
            <div className="thinking-ring" />
            <span className="text-[11px] tracking-wide text-text2">Loading…</span>
          </div>
        ) : accepted.length === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border px-4 py-6 text-center">
            <Users className="h-5 w-5 text-text3" aria-hidden />
            <p className="text-[12.5px] leading-relaxed text-text3">
              No connections yet — search for fellow travellers above and send an invite.
            </p>
          </div>
        ) : (
          <ul className="flex flex-col gap-2">
            {accepted.map((e) =>
              e.user ? (
                <li key={e.user.user_id} className={ROW}>
                  {identity(e.user, null, presence[e.user.user_id] ?? { online: false, last_seen_at: null })}
                  {messageButton(e.user)}
                </li>
              ) : null,
            )}
          </ul>
        )}
      </section>

      {/* Outgoing invites */}
      {pendingOut.length > 0 && (
        <section aria-label="Sent invites">
          <p className={SECTION}>Sent invites</p>
          <ul className="flex flex-col gap-2">
            {pendingOut.map((e) =>
              e.user ? (
                <li key={e.user.user_id} className={cn(ROW, 'opacity-80')}>
                  {identity(e.user)}
                  <span className="shrink-0 rounded-full border border-border px-2.5 py-1 text-[11px] text-text3">
                    Pending
                  </span>
                </li>
              ) : null,
            )}
          </ul>
        </section>
      )}
    </div>
  )
}
