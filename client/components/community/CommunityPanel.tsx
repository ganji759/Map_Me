'use client'

/**
 * CommunityPanel — the single entry point for Hodari's community layer
 * (people + encrypted chats). Mounted by the integration agent; everything
 * inside is self-contained (data fetching, E2EE bootstrap, polling).
 *
 * Props contract:
 *   open           — panel visibility (slide-over Sheet; renders nothing while closed)
 *   onClose        — close the panel
 *   currentUserId  — the signed-in user's user_id. Display/E2EE bookkeeping only:
 *                    authorization always comes from the httpOnly session cookie
 *                    server-side.
 *   onFocusPlace?  — (lat, lng, name) center the main map on a place. Reserved
 *                    pass-through for shared-pin cards (not fired yet).
 *   onSharePin?    — (conversationId) fired by the thread composer's share-a-pin
 *                    button; the host opens its pin picker for that conversation.
 *   onOpenProfile? — (handle) open the full profile sheet for a user.
 *
 * Lifecycle while open:
 * - Mount: ensureKeypair() and publish the public JWK via profile PUT when it
 *   differs from the stored one. If E2EE is unavailable (insecure context, no
 *   key storage) an inline notice is shown and composing is disabled — the
 *   panel never falls back to plaintext.
 * - Poll conversations + connections + presence every 10s.
 * - Presence heartbeat POST every 30s while the document is visible.
 * - An open thread additionally polls its messages every 3s (see
 *   ConversationThread). All intervals are cleaned up on close/unmount.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ChevronRight, ShieldAlert } from 'lucide-react'
import { Sheet } from '@/components/ui/Sheet'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/Tabs'
import type { Conversation, ConversationSummary, PresenceInfo, UserAttribution } from '@/lib/community'
import {
  CommunityApiError,
  getConnections,
  getMyProfile,
  getPresence,
  getPubkeys,
  listConversations,
  sendHeartbeat,
  updateMyProfile,
  createConversation,
  type ConnectionsView,
  type ProfileView,
} from '@/lib/communityClient'
import { ensureKeypair, createConversationKey, E2EEUnavailableError } from '@/lib/e2ee'
import { registerConversationKey } from './conversationKeys'
import { EmojiAvatar } from './EmojiAvatar'
import { PeopleTab } from './PeopleTab'
import { ConversationList } from './ConversationList'
import { ConversationThread } from './ConversationThread'
import { NewGroupPanel } from './NewGroupPanel'

const REFRESH_MS = 10_000
const HEARTBEAT_MS = 30_000

export interface CommunityPanelProps {
  open: boolean
  onClose: () => void
  /** Signed-in user's user_id (from the server session, not user input). */
  currentUserId: string
  /** Center the main map on a place — reserved for shared-pin cards. */
  onFocusPlace?: (lat: number, lng: number, name: string) => void
  /** Share-a-pin affordance in the thread composer. */
  onSharePin?: (conversationId: string) => void
  /** Open the full profile sheet (components/community/profile/ProfileSheet). */
  onOpenProfile?: (handle: string) => void
  /**
   * Fires whenever the pending-invite count is known, so the host can badge
   * the entry point (e.g. the chat header's Users icon) even before this
   * panel has ever been mounted — see LandingPage's standalone poll, which
   * this callback supersedes once the panel is open.
   */
  onInviteCountChange?: (count: number) => void
}

type E2eeState =
  | { status: 'init' }
  | { status: 'ready'; pubkey: JsonWebKey }
  | { status: 'unavailable'; message: string }

/** Compare the identifying fields of two EC public JWKs (property order varies). */
function samePubkey(stored: Record<string, unknown> | null, local: JsonWebKey): boolean {
  if (!stored) return false
  return stored.kty === local.kty && stored.crv === local.crv && stored.x === local.x && stored.y === local.y
}

/**
 * Presence heartbeat: POST /api/community/presence every 30s while `enabled`
 * and the document is visible. Exported so the host app can also run it
 * app-wide (outside the panel) if desired.
 */
export function usePresenceHeartbeat(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return
    const beat = () => {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return
      void sendHeartbeat().catch(() => {
        /* best-effort */
      })
    }
    beat()
    const interval = setInterval(beat, HEARTBEAT_MS)
    const onVisible = () => {
      if (document.visibilityState === 'visible') beat()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearInterval(interval)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [enabled])
}

export function CommunityPanel(props: CommunityPanelProps) {
  const { open, onClose, currentUserId, onSharePin, onOpenProfile, onInviteCountChange } = props

  const [tab, setTab] = useState<'people' | 'chats'>('people')
  const [e2ee, setE2ee] = useState<E2eeState>({ status: 'init' })
  const [me, setMe] = useState<ProfileView | null>(null)
  const [connections, setConnections] = useState<ConnectionsView | null>(null)
  const [conversations, setConversations] = useState<ConversationSummary[] | null>(null)
  const [presence, setPresence] = useState<Record<string, PresenceInfo>>({})
  const [activeConv, setActiveConv] = useState<ConversationSummary | null>(null)
  const [groupOpen, setGroupOpen] = useState(false)
  const [openingDm, setOpeningDm] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const e2eeReady = e2ee.status === 'ready'
  const myPubkey = e2ee.status === 'ready' ? e2ee.pubkey : null

  usePresenceHeartbeat(open)

  // ── E2EE bootstrap: device keypair + publish pubkey when changed ───────────
  useEffect(() => {
    if (!open || e2ee.status !== 'init') return
    let cancelled = false
    ;(async () => {
      try {
        const pubkey = await ensureKeypair()
        try {
          const profile = await getMyProfile()
          if (cancelled) return
          setMe(profile)
          if (!samePubkey(profile.pubkey, pubkey)) {
            const updated = await updateMyProfile({ pubkey: pubkey as Record<string, unknown> })
            if (!cancelled) setMe(updated)
          }
        } catch {
          /* profile sync failed — keys still work locally; next open retries */
        }
        if (!cancelled) setE2ee({ status: 'ready', pubkey })
      } catch (err) {
        if (cancelled) return
        setE2ee({
          status: 'unavailable',
          message:
            err instanceof E2EEUnavailableError
              ? err.message
              : 'End-to-end encryption could not be set up on this device.',
        })
      }
    })()
    return () => {
      cancelled = true
    }
  }, [open, e2ee.status])

  // ── Data refresh: connections + conversations + presence ───────────────────
  const refreshInFlight = useRef(false)
  const refresh = useCallback(async () => {
    if (refreshInFlight.current) return
    refreshInFlight.current = true
    try {
      const [conns, convs] = await Promise.all([getConnections(), listConversations()])
      setConnections(conns)
      setConversations(convs)
      // Keep the open thread's summary fresh (members, wrapped keys, seq).
      setActiveConv((prev) =>
        prev ? (convs.find((c) => c.conversation_id === prev.conversation_id) ?? prev) : prev,
      )
      const ids = new Set<string>()
      for (const e of conns.accepted) if (e.user) ids.add(e.user.user_id)
      for (const c of convs) for (const id of c.member_ids) if (id !== currentUserId) ids.add(id)
      if (ids.size > 0) {
        const p = await getPresence([...ids])
        setPresence(p)
      }
    } catch {
      /* transient — the next tick retries */
    } finally {
      refreshInFlight.current = false
    }
  }, [currentUserId])

  useEffect(() => {
    if (!open) return
    void refresh()
    const interval = setInterval(() => void refresh(), REFRESH_MS)
    return () => clearInterval(interval)
  }, [open, refresh])

  // Reset transient view state whenever the panel is (re)opened.
  useEffect(() => {
    if (!open) return
    setNotice(null)
    setGroupOpen(false)
  }, [open])

  const myAttribution = useMemo<UserAttribution>(
    () => ({
      user_id: currentUserId,
      handle: me?.handle ?? currentUserId,
      name: me?.name ?? null,
      avatar_emoji: me?.avatar_emoji ?? '🧭',
    }),
    [currentUserId, me],
  )

  /** Conversation (create response) → summary the thread can render. */
  const toSummary = useCallback(
    (conv: Conversation, others: UserAttribution[]): ConversationSummary => ({
      ...conv,
      members: [myAttribution, ...others.filter((u) => conv.member_ids.includes(u.user_id))],
      unread: false,
    }),
    [myAttribution],
  )

  const openConversation = useCallback((conv: ConversationSummary) => {
    setActiveConv(conv)
    setGroupOpen(false)
    setTab('chats')
    setNotice(null)
  }, [])

  // ── Open-or-create an encrypted DM from the People tab ─────────────────────
  const openDm = useCallback(
    async (user: UserAttribution) => {
      setNotice(null)
      const existing = conversations?.find(
        (c) => c.type === 'dm' && c.member_ids.includes(user.user_id),
      )
      if (existing) {
        openConversation(existing)
        return
      }
      if (!myPubkey) {
        setNotice('Encrypted chat is unavailable on this device, so new conversations are disabled.')
        return
      }
      setOpeningDm(user.user_id)
      try {
        const keys = await getPubkeys([user.user_id])
        const theirPub = keys[user.user_id]
        if (!theirPub) {
          setNotice(`@${user.handle} hasn’t set up encrypted chat yet.`)
          return
        }
        const { key, wrappedKeys } = await createConversationKey({
          [currentUserId]: myPubkey,
          [user.user_id]: theirPub,
        })
        const { conversation, existing: deduped } = await createConversation({
          type: 'dm',
          member_ids: [user.user_id],
          wrapped_keys: wrappedKeys,
        })
        // A deduped DM keeps its original wrapped keys — ours would be wrong.
        if (!deduped) registerConversationKey(conversation.conversation_id, key)
        openConversation(toSummary(conversation, [user]))
        void refresh()
      } catch (err) {
        setNotice(err instanceof CommunityApiError ? err.message : 'Could not open that conversation.')
      } finally {
        setOpeningDm(null)
      }
    },
    [conversations, myPubkey, currentUserId, openConversation, toSummary, refresh],
  )

  const onGroupCreated = useCallback(
    (conversation: Conversation) => {
      const known = new Map<string, UserAttribution>()
      for (const e of connections?.accepted ?? []) if (e.user) known.set(e.user.user_id, e.user)
      const others = conversation.member_ids
        .filter((id) => id !== currentUserId)
        .map((id) => known.get(id))
        .filter((u): u is UserAttribution => Boolean(u))
      openConversation(toSummary(conversation, others))
      void refresh()
    },
    [connections, currentUserId, openConversation, toSummary, refresh],
  )

  const hasUnread = useMemo(
    () =>
      (conversations ?? []).some(
        (c) => c.unread && c.conversation_id !== activeConv?.conversation_id,
      ),
    [conversations, activeConv],
  )
  const pendingInviteCount = connections?.pending_in.length ?? 0

  useEffect(() => {
    onInviteCountChange?.(pendingInviteCount)
  }, [pendingInviteCount, onInviteCountChange])

  const e2eeNotice = e2ee.status === 'unavailable' ? e2ee.message : null

  return (
    <Sheet open={open} onClose={onClose} side="right" title="Community" className="sm:max-w-md">
      {activeConv ? (
        <ConversationThread
          conversation={activeConv}
          currentUserId={currentUserId}
          canCompose={e2eeReady}
          e2eeNotice={e2eeNotice}
          presence={presence}
          onBack={() => setActiveConv(null)}
          onSharePin={onSharePin}
        />
      ) : groupOpen && myPubkey ? (
        <NewGroupPanel
          currentUserId={currentUserId}
          myPubkey={myPubkey}
          accepted={connections?.accepted ?? []}
          onBack={() => setGroupOpen(false)}
          onCreated={onGroupCreated}
        />
      ) : (
        <div className="flex flex-col gap-3">
          {e2eeNotice && (
            <p className="flex items-start gap-2 rounded-xl border border-danger/30 bg-danger/5 px-3 py-2.5 text-[12px] leading-relaxed text-text2">
              <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-danger" aria-hidden />
              <span>
                {e2eeNotice} You can still browse. Sending stays off, Hodari never sends unencrypted
                messages.
              </span>
            </p>
          )}
          {notice && (
            <p className="rounded-xl border border-border bg-surface2/60 px-3 py-2.5 text-[12px] leading-relaxed text-text2" role="status">
              {notice}
            </p>
          )}

          {me && onOpenProfile && (
            <button
              type="button"
              onClick={() => onOpenProfile(me.handle)}
              className="flex w-full items-center gap-2.5 rounded-xl border border-border bg-surface px-3 py-2.5 text-left transition-colors hover:border-gold/40"
            >
              <EmojiAvatar emoji={me.avatar_emoji} name={me.name || `@${me.handle}`} size="md" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-medium text-text">
                  {me.name || `@${me.handle}`}
                </span>
                <span className="block truncate font-mono text-[11px] text-text3">
                  @{me.handle} · Edit
                </span>
              </span>
              <ChevronRight className="h-4 w-4 shrink-0 text-text3" aria-hidden />
            </button>
          )}

          <Tabs value={tab} onValueChange={(v) => setTab(v === 'chats' ? 'chats' : 'people')}>
            <TabsList>
              <TabsTrigger value="people">
                <span className="relative inline-flex items-center gap-1.5">
                  People
                  {pendingInviteCount > 0 && (
                    <span aria-label="Pending invites" role="img" className="h-1.5 w-1.5 rounded-full bg-gold" />
                  )}
                </span>
              </TabsTrigger>
              <TabsTrigger value="chats">
                <span className="relative inline-flex items-center gap-1.5">
                  Chats
                  {hasUnread && (
                    <span aria-label="Unread messages" role="img" className="h-1.5 w-1.5 rounded-full bg-gold" />
                  )}
                </span>
              </TabsTrigger>
            </TabsList>
            <TabsContent value="people">
              <PeopleTab
                currentUserId={currentUserId}
                connections={connections}
                presence={presence}
                canMessage={e2eeReady}
                onChanged={() => void refresh()}
                onMessage={(user) => void openDm(user)}
                openingDm={openingDm}
                onOpenProfile={onOpenProfile}
              />
            </TabsContent>
            <TabsContent value="chats">
              <ConversationList
                conversations={conversations}
                presence={presence}
                currentUserId={currentUserId}
                onOpen={openConversation}
                onNewGroup={() => setGroupOpen(true)}
                canCompose={e2eeReady}
              />
            </TabsContent>
          </Tabs>
        </div>
      )}
    </Sheet>
  )
}
