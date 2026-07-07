/**
 * Community data layer for Hodari's social features: profiles, connections,
 * shared pins, closed-network reviews, and E2EE conversations/messages.
 *
 * All database access goes through the MongoDB MCP HTTP sidecar (localhost:3100)
 * via the shared helpers in lib/mcp.ts — the same pattern as lib/users.ts and
 * lib/billing.ts. Never import mongodb/mongoose directly.
 *
 * Privacy invariants enforced here:
 * - Messages store ONLY ciphertext + IV (encrypted client-side by lib/e2ee.ts).
 *   No plaintext message field exists anywhere in this module.
 * - Reviews are a closed network: readable only by users connected (accepted)
 *   to the author, plus the author themselves.
 * - `location` is only persisted while `share_location` is true.
 *
 * Authorization contract: every function that takes a "viewer"/"owner" user id
 * expects a SERVER-VERIFIED id (from the session cookie via getSessionUser) —
 * routes must never pass a client-supplied id for the acting user.
 */
import { mcpConnected, mcpCall, extractDocs } from '@/lib/mcp'

const DB = process.env.MONGODB_DATABASE ?? 'hodari'

// ── Validation constants (shared with the API routes) ───────────────────────

export const HANDLE_RE = /^[a-z0-9_]{3,24}$/
export const MAX_BIO = 280
export const MAX_PIN_NOTE = 500
export const MAX_REVIEW_TEXT = 1000
/** Hard cap on an encrypted payload (base64 chars) — ~300KB of raw image. */
export const MAX_CIPHERTEXT_B64 = 400 * 1024
/** A user is "online" if their last heartbeat is younger than this. */
export const ONLINE_WINDOW_MS = 90_000
/** Radius for the "travellers near me" search. */
export const NEARBY_RADIUS_M = 25_000

const BASE64_RE = /^[A-Za-z0-9+/_=-]+$/

// ── Types ────────────────────────────────────────────────────────────────────

export interface GeoPoint {
  type: 'Point'
  coordinates: [number, number] // [lng, lat]
}

export interface CommunityProfile {
  user_id: string
  handle: string
  name: string | null
  bio: string
  avatar_emoji: string
  discoverable: boolean
  share_location: boolean
  location: GeoPoint | null
  last_seen_at: string | null
  pubkey: Record<string, unknown> | null
}

/** Minimal public attribution attached to pins/reviews/conversations. */
export interface UserAttribution {
  user_id: string
  handle: string
  name: string | null
  avatar_emoji: string
}

export type ConnectionStatus = 'pending' | 'accepted' | 'blocked'

export interface Connection {
  requester_id: string
  recipient_id: string
  status: ConnectionStatus
  created_at: string
  responded_at: string | null
}

/** Where `other` stands relative to the caller. */
export type RelationStatus = 'none' | 'pending_out' | 'pending_in' | 'accepted' | 'blocked'

export interface SharedPinPlace {
  place_id: string
  name: string
  lat: number
  lng: number
  address: string | null
  photo_url: string | null
  rating: number | null
}

export interface SharedPin {
  pin_id: string
  owner_id: string
  place: SharedPinPlace
  note: string
  shared_with: string[]
  conversation_id: string | null
  created_at: string
}

export interface PinReview {
  review_id: string
  pin_id: string | null
  place_id: string
  author_id: string
  rating: number
  text: string
  created_at: string
}

export type ConversationType = 'dm' | 'group' | 'pin'

export interface Conversation {
  conversation_id: string
  type: ConversationType
  member_ids: string[]
  title: string | null
  pin_id: string | null
  /** Per-member conversation key, wrapped client-side (base64). Opaque to us. */
  wrapped_keys: Record<string, string>
  created_by: string
  created_at: string
  /** Seq of the newest message — denormalized so listing needs no message scan. */
  last_seq: number
  last_message_at: string | null
  /** Highest seq each member has fetched — powers the unread hint. */
  read_cursors: Record<string, number>
}

export interface EncryptedMessage {
  conversation_id: string
  sender_id: string
  /** Base64 AES-GCM ciphertext. For images this IS the encrypted image bytes. */
  ciphertext: string
  iv: string
  msg_type: 'text' | 'image'
  created_at: string
  seq: number
}

// ── MCP session + lazy index bootstrap ───────────────────────────────────────

let indexesOnce: Promise<void> | null = null

/**
 * Idempotently create the community indexes. Best-effort: each create-index is
 * wrapped in its own try/catch (the MCP tool may not support every option, and
 * a missing index only degrades performance — handle uniqueness is re-checked
 * at the application level in updateCommunityProfile).
 */
export function ensureCommunityIndexes(): Promise<void> {
  if (indexesOnce) return indexesOnce
  indexesOnce = (async () => {
    const sid = await mcpConnected()
    const specs: Array<{ collection: string; keys: Record<string, unknown>; name: string }> = [
      { collection: 'users', keys: { handle: 1 }, name: 'community_handle' },
      { collection: 'users', keys: { location: '2dsphere' }, name: 'community_location_2dsphere' },
      { collection: 'connections', keys: { requester_id: 1, recipient_id: 1 }, name: 'community_edge' },
      { collection: 'messages', keys: { conversation_id: 1, seq: 1 }, name: 'community_msg_seq' },
      { collection: 'shared_pins', keys: { owner_id: 1 }, name: 'community_pin_owner' },
    ]
    for (const spec of specs) {
      try {
        await mcpCall(sid, 'create-index', {
          database: DB,
          collection: spec.collection,
          definition: [{ type: 'classic', keys: spec.keys }],
          name: spec.name,
        })
      } catch (err) {
        console.warn(`[community] create-index ${spec.collection}.${spec.name} failed (non-fatal)`, err)
      }
    }
  })().catch((err) => {
    console.warn('[community] index bootstrap failed (will retry next call)', err)
    indexesOnce = null
  })
  return indexesOnce
}

async function mcp(): Promise<string> {
  // Fire-and-forget: don't block reads on index creation, but make sure it
  // happens once per process.
  void ensureCommunityIndexes()
  // Reuse the cached, connected session — no per-call initialize + connect.
  return mcpConnected()
}

function nowIso(): string {
  return new Date().toISOString()
}

// ── Profiles ─────────────────────────────────────────────────────────────────

const AVATAR_EMOJI = [
  '⚽', '🏟️', '🧭', '🌍', '🌎', '🌏',
  '🦁', '🐘', '🦒', '🦅', '🐬', '🦊',
  '🏆', '🎯', '🚲', '🌮', '🍜', '☕',
  '🏔️', '🏖️', '🌆', '🗺️', '🎨', '📷',
]

/** Deterministic default avatar: stable hash of the user id into the emoji set. */
export function defaultAvatarEmoji(userId: string): string {
  let h = 0
  for (let i = 0; i < userId.length; i++) h = (h * 31 + userId.charCodeAt(i)) >>> 0
  return AVATAR_EMOJI[h % AVATAR_EMOJI.length]
}

/** Default handle = the user_id slug, coerced into the handle alphabet/length. */
export function defaultHandle(userId: string): string {
  let h = userId.toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 24)
  while (h.length < 3) h += '_'
  return h
}

function toGeoPoint(value: unknown): GeoPoint | null {
  const v = value as { type?: unknown; coordinates?: unknown } | null
  if (!v || v.type !== 'Point' || !Array.isArray(v.coordinates) || v.coordinates.length !== 2) return null
  const [lng, lat] = v.coordinates
  if (typeof lng !== 'number' || typeof lat !== 'number') return null
  return { type: 'Point', coordinates: [lng, lat] }
}

function toProfile(doc: Record<string, unknown>): CommunityProfile {
  const userId = String(doc.user_id)
  return {
    user_id: userId,
    handle: typeof doc.handle === 'string' && doc.handle ? doc.handle : defaultHandle(userId),
    name: (doc.name as string) ?? null,
    bio: typeof doc.bio === 'string' ? doc.bio : '',
    avatar_emoji: typeof doc.avatar_emoji === 'string' && doc.avatar_emoji ? doc.avatar_emoji : defaultAvatarEmoji(userId),
    discoverable: doc.discoverable !== false, // default true
    share_location: doc.share_location === true, // default false
    location: doc.share_location === true ? toGeoPoint(doc.location) : null,
    last_seen_at: typeof doc.last_seen_at === 'string' ? doc.last_seen_at : null,
    pubkey: doc.pubkey && typeof doc.pubkey === 'object' && !Array.isArray(doc.pubkey)
      ? (doc.pubkey as Record<string, unknown>)
      : null,
  }
}

function toAttribution(doc: Record<string, unknown>): UserAttribution {
  const p = toProfile(doc)
  return { user_id: p.user_id, handle: p.handle, name: p.name, avatar_emoji: p.avatar_emoji }
}

/** Whether `last_seen_at` counts as online right now. */
export function isOnline(lastSeenAt: string | null | undefined): boolean {
  if (!lastSeenAt) return false
  const t = Date.parse(lastSeenAt)
  return Number.isFinite(t) && Date.now() - t < ONLINE_WINDOW_MS
}

async function findUserDoc(sid: string, userId: string): Promise<Record<string, unknown> | null> {
  const docs = extractDocs(
    await mcpCall(sid, 'find', { database: DB, collection: 'users', filter: { user_id: userId }, limit: 1 }),
  )
  return docs[0] ?? null
}

export async function getCommunityProfile(userId: string): Promise<CommunityProfile | null> {
  const sid = await mcp()
  const doc = await findUserDoc(sid, userId)
  return doc ? toProfile(doc) : null
}

export async function getProfileByHandle(handle: string): Promise<CommunityProfile | null> {
  const sid = await mcp()
  // Users who never customized their handle match on their user_id slug.
  const docs = extractDocs(
    await mcpCall(sid, 'find', {
      database: DB,
      collection: 'users',
      filter: { $or: [{ handle }, { handle: { $exists: false }, user_id: handle }] },
      limit: 1,
    }),
  )
  return docs[0] ? toProfile(docs[0]) : null
}

export interface ProfilePatch {
  handle?: string
  bio?: string
  avatar_emoji?: string
  discoverable?: boolean
  share_location?: boolean
  /** Client coordinates; persisted only while share_location is true. */
  location?: { lat: number; lng: number } | null
  /** Public JWK published by lib/e2ee.ts. */
  pubkey?: Record<string, unknown> | null
}

export type UpdateProfileResult =
  | { ok: true; profile: CommunityProfile }
  | { ok: false; reason: 'not_found' | 'handle_taken' }

/**
 * Update the caller's community fields on their existing `users` doc. Never
 * touches auth/billing fields. Handle uniqueness is checked against both stored
 * handles and raw user_ids (which act as implicit default handles).
 */
export async function updateCommunityProfile(userId: string, patch: ProfilePatch): Promise<UpdateProfileResult> {
  const sid = await mcp()
  const doc = await findUserDoc(sid, userId)
  if (!doc) return { ok: false, reason: 'not_found' }

  const set: Record<string, unknown> = {}

  if (patch.handle !== undefined && patch.handle !== toProfile(doc).handle) {
    const clash = extractDocs(
      await mcpCall(sid, 'find', {
        database: DB,
        collection: 'users',
        filter: { $or: [{ handle: patch.handle }, { user_id: patch.handle }], user_id: { $ne: userId } },
        limit: 1,
      }),
    )
    if (clash.length > 0) return { ok: false, reason: 'handle_taken' }
    set.handle = patch.handle
  }

  if (patch.bio !== undefined) set.bio = patch.bio.slice(0, MAX_BIO)
  if (patch.avatar_emoji !== undefined) set.avatar_emoji = patch.avatar_emoji
  if (patch.discoverable !== undefined) set.discoverable = patch.discoverable
  if (patch.share_location !== undefined) set.share_location = patch.share_location
  if (patch.pubkey !== undefined) set.pubkey = patch.pubkey

  // Location is only stored while sharing is (or becomes) enabled.
  const effectiveShare = patch.share_location ?? (doc.share_location === true)
  if (!effectiveShare || patch.location === null) {
    set.location = null
  } else if (patch.location) {
    set.location = { type: 'Point', coordinates: [patch.location.lng, patch.location.lat] } satisfies GeoPoint
  }

  if (Object.keys(set).length > 0) {
    await mcpCall(sid, 'update-many', {
      database: DB, collection: 'users', filter: { user_id: userId }, update: { $set: set },
    })
  }
  return { ok: true, profile: toProfile({ ...doc, ...set }) }
}

/** Batch-load public attributions for a set of user ids. */
export async function getAttributions(userIds: string[]): Promise<Record<string, UserAttribution>> {
  const ids = [...new Set(userIds)].filter(Boolean)
  if (ids.length === 0) return {}
  const sid = await mcp()
  const docs = extractDocs(
    await mcpCall(sid, 'find', {
      database: DB,
      collection: 'users',
      filter: { user_id: { $in: ids } },
      projection: { user_id: 1, handle: 1, name: 1, avatar_emoji: 1 },
      limit: ids.length,
    }),
  )
  const out: Record<string, UserAttribution> = {}
  for (const d of docs) out[String(d.user_id)] = toAttribution(d)
  return out
}

// ── Connections ──────────────────────────────────────────────────────────────

/** One logical edge per pair, whichever direction it was created in. */
function pairFilter(a: string, b: string): Record<string, unknown> {
  return { $or: [{ requester_id: a, recipient_id: b }, { requester_id: b, recipient_id: a }] }
}

function toConnection(doc: Record<string, unknown>): Connection {
  return {
    requester_id: String(doc.requester_id),
    recipient_id: String(doc.recipient_id),
    status: (doc.status as ConnectionStatus) ?? 'pending',
    created_at: typeof doc.created_at === 'string' ? doc.created_at : '',
    responded_at: typeof doc.responded_at === 'string' ? doc.responded_at : null,
  }
}

export async function getConnection(a: string, b: string): Promise<Connection | null> {
  const sid = await mcp()
  const docs = extractDocs(
    await mcpCall(sid, 'find', { database: DB, collection: 'connections', filter: pairFilter(a, b), limit: 1 }),
  )
  return docs[0] ? toConnection(docs[0]) : null
}

/** Every edge involving the user (accepted + pending in/out + blocks they made). */
export async function listConnections(userId: string): Promise<Connection[]> {
  const sid = await mcp()
  const docs = extractDocs(
    await mcpCall(sid, 'find', {
      database: DB,
      collection: 'connections',
      filter: { $or: [{ requester_id: userId }, { recipient_id: userId }] },
      sort: { created_at: -1 },
      limit: 500,
    }),
  )
  return docs.map(toConnection)
}

/** User ids the caller has an accepted connection with. */
export async function acceptedPeerIds(userId: string): Promise<string[]> {
  const edges = await listConnections(userId)
  return edges
    .filter((e) => e.status === 'accepted')
    .map((e) => (e.requester_id === userId ? e.recipient_id : e.requester_id))
}

export async function areConnected(a: string, b: string): Promise<boolean> {
  if (a === b) return true
  const edge = await getConnection(a, b)
  return edge?.status === 'accepted'
}

/** Where `otherId` stands relative to `callerId`, given the caller's edge list. */
export function relationTo(callerId: string, edges: Connection[], otherId: string): RelationStatus {
  for (const e of edges) {
    const involves =
      (e.requester_id === callerId && e.recipient_id === otherId) ||
      (e.requester_id === otherId && e.recipient_id === callerId)
    if (!involves) continue
    if (e.status === 'accepted') return 'accepted'
    if (e.status === 'blocked') return 'blocked'
    return e.requester_id === callerId ? 'pending_out' : 'pending_in'
  }
  return 'none'
}

export type ConnectionActionResult =
  | { ok: true; connection: Connection }
  | {
      ok: false
      reason:
        | 'not_found'
        | 'self'
        | 'already_connected'
        | 'already_pending'
        | 'blocked'
        | 'no_pending'
        | 'no_connection'
        | 'no_block'
    }

/** Actions the recipient/owner takes on an existing edge (everything but invite). */
export type RespondAction = 'accept' | 'decline' | 'block' | 'cancel' | 'remove' | 'unblock'

export async function inviteConnection(requesterId: string, recipientId: string): Promise<ConnectionActionResult> {
  if (requesterId === recipientId) return { ok: false, reason: 'self' }
  const sid = await mcp()
  const recipient = await findUserDoc(sid, recipientId)
  if (!recipient) return { ok: false, reason: 'not_found' }

  const existing = await getConnection(requesterId, recipientId)
  if (existing) {
    if (existing.status === 'accepted') return { ok: false, reason: 'already_connected' }
    if (existing.status === 'blocked') return { ok: false, reason: 'blocked' }
    // A pending invite from the other side counts as mutual interest — accept it.
    if (existing.recipient_id === requesterId) return respondConnection(requesterId, recipientId, 'accept')
    return { ok: false, reason: 'already_pending' }
  }

  const edge: Connection = {
    requester_id: requesterId,
    recipient_id: recipientId,
    status: 'pending',
    created_at: nowIso(),
    responded_at: null,
  }
  await mcpCall(sid, 'insert-many', { database: DB, collection: 'connections', documents: [{ ...edge }] })
  return { ok: true, connection: edge }
}

export async function respondConnection(
  userId: string,
  otherId: string,
  action: RespondAction,
): Promise<ConnectionActionResult> {
  if (userId === otherId) return { ok: false, reason: 'self' }
  const sid = await mcp()
  const edge = await getConnection(userId, otherId)

  const deletePair = () =>
    mcpCall(sid, 'delete-many', { database: DB, collection: 'connections', filter: pairFilter(userId, otherId) })

  if (action === 'block') {
    // Replace any existing edge with a block owned by the blocker. Only the
    // blocker's edge direction records who did the blocking.
    if (edge) await deletePair()
    const blocked: Connection = {
      requester_id: userId, recipient_id: otherId, status: 'blocked', created_at: nowIso(), responded_at: nowIso(),
    }
    await mcpCall(sid, 'insert-many', { database: DB, collection: 'connections', documents: [{ ...blocked }] })
    return { ok: true, connection: blocked }
  }

  if (action === 'unblock') {
    // Only the blocker (who owns the edge direction) can lift their block.
    if (!edge || edge.status !== 'blocked' || edge.requester_id !== userId) {
      return { ok: false, reason: 'no_block' }
    }
    await deletePair()
    return { ok: true, connection: { ...edge, status: 'pending', responded_at: nowIso() } }
  }

  if (action === 'cancel') {
    // Withdraw the caller's own outgoing pending invite.
    if (!edge || edge.status !== 'pending' || edge.requester_id !== userId) {
      return { ok: false, reason: 'no_pending' }
    }
    await deletePair()
    return { ok: true, connection: { ...edge, status: 'pending', responded_at: nowIso() } }
  }

  if (action === 'remove') {
    // Unfriend: drop an accepted edge without blocking. Either party may remove.
    if (!edge || edge.status !== 'accepted') {
      return { ok: false, reason: 'no_connection' }
    }
    await deletePair()
    return { ok: true, connection: { ...edge, status: 'pending', responded_at: nowIso() } }
  }

  // accept / decline require a pending invite addressed to the caller.
  if (!edge || edge.status !== 'pending' || edge.recipient_id !== userId) {
    return { ok: false, reason: 'no_pending' }
  }

  if (action === 'decline') {
    await deletePair()
    return { ok: true, connection: { ...edge, status: 'pending', responded_at: nowIso() } }
  }

  const respondedAt = nowIso()
  await mcpCall(sid, 'update-many', {
    database: DB,
    collection: 'connections',
    filter: pairFilter(userId, otherId),
    update: { $set: { status: 'accepted', responded_at: respondedAt } },
  })
  return { ok: true, connection: { ...edge, status: 'accepted', responded_at: respondedAt } }
}

// ── User search ──────────────────────────────────────────────────────────────

export interface UserSummary extends UserAttribution {
  bio: string
  online: boolean
  last_seen_at: string | null
  connection: RelationStatus
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function toSummary(doc: Record<string, unknown>, callerId: string, edges: Connection[]): UserSummary {
  const p = toProfile(doc)
  return {
    user_id: p.user_id,
    handle: p.handle,
    name: p.name,
    avatar_emoji: p.avatar_emoji,
    bio: p.bio,
    online: isOnline(p.last_seen_at),
    last_seen_at: p.last_seen_at,
    connection: relationTo(callerId, edges, p.user_id),
  }
}

/** Prefix search over handle/name/user_id among discoverable users. */
export async function searchUsers(callerId: string, query: string): Promise<UserSummary[]> {
  const q = query.trim().toLowerCase()
  if (!q) return []
  const sid = await mcp()
  const prefix = `^${escapeRegex(q)}`
  // The user search and the caller's connection edges are independent — run them
  // concurrently instead of one after the other.
  const [docs, edges] = await Promise.all([
    mcpCall(sid, 'find', {
      database: DB,
      collection: 'users',
      filter: {
        user_id: { $ne: callerId },
        discoverable: { $ne: false },
        $or: [
          { handle: { $regex: prefix } },
          { user_id: { $regex: prefix } },
          { name: { $regex: prefix, $options: 'i' } },
        ],
      },
      projection: { user_id: 1, handle: 1, name: 1, avatar_emoji: 1, bio: 1, last_seen_at: 1 },
      limit: 20,
    }).then(extractDocs),
    listConnections(callerId),
  ])
  return docs.map((d) => toSummary(d, callerId, edges)).filter((u) => u.connection !== 'blocked')
}

/**
 * Discoverable users sharing their location within NEARBY_RADIUS_M of the
 * caller. Requires the caller to be sharing a location themselves. Falls back
 * to [] if the 2dsphere index is missing ($near needs it).
 */
export async function usersNear(callerId: string): Promise<UserSummary[]> {
  const sid = await mcp()
  // The caller's own doc is needed first (its location anchors the $near query),
  // so this read can't be parallelized with the search itself.
  const me = await findUserDoc(sid, callerId)
  const myLoc = me && me.share_location === true ? toGeoPoint(me.location) : null
  if (!myLoc) return []
  try {
    // The $near search and the caller's connection edges are independent — run
    // them concurrently.
    const [docs, edges] = await Promise.all([
      mcpCall(sid, 'find', {
        database: DB,
        collection: 'users',
        filter: {
          user_id: { $ne: callerId },
          discoverable: { $ne: false },
          share_location: true,
          location: { $near: { $geometry: myLoc, $maxDistance: NEARBY_RADIUS_M } },
        },
        projection: { user_id: 1, handle: 1, name: 1, avatar_emoji: 1, bio: 1, last_seen_at: 1 },
        limit: 20,
      }).then(extractDocs),
      listConnections(callerId),
    ])
    return docs.map((d) => toSummary(d, callerId, edges)).filter((u) => u.connection !== 'blocked')
  } catch (err) {
    console.warn('[community] $near query failed (2dsphere index missing?)', err)
    return []
  }
}

// ── Shared pins ──────────────────────────────────────────────────────────────

function toPin(doc: Record<string, unknown>): SharedPin {
  const place = (doc.place ?? {}) as Record<string, unknown>
  return {
    pin_id: String(doc.pin_id),
    owner_id: String(doc.owner_id),
    place: {
      place_id: String(place.place_id ?? ''),
      name: String(place.name ?? ''),
      lat: typeof place.lat === 'number' ? place.lat : 0,
      lng: typeof place.lng === 'number' ? place.lng : 0,
      address: typeof place.address === 'string' ? place.address : null,
      photo_url: typeof place.photo_url === 'string' ? place.photo_url : null,
      rating: typeof place.rating === 'number' ? place.rating : null,
    },
    note: typeof doc.note === 'string' ? doc.note : '',
    shared_with: Array.isArray(doc.shared_with) ? doc.shared_with.map(String) : [],
    conversation_id: typeof doc.conversation_id === 'string' ? doc.conversation_id : null,
    created_at: typeof doc.created_at === 'string' ? doc.created_at : '',
  }
}

export interface SharePinInput {
  place: { place_id: string; name: string; lat: number; lng: number; address?: string; photo_url?: string; rating?: number }
  note?: string
  /** Recipients — silently filtered to the owner's accepted connections. */
  sharedWith?: string[]
  /** Alternative audience: every member of this conversation can see the pin. */
  conversationId?: string
}

export type SharePinResult =
  | { ok: true; pin: SharedPin }
  | { ok: false; reason: 'invalid_place' | 'not_conversation_member' | 'no_audience' }

export async function sharePin(ownerId: string, input: SharePinInput): Promise<SharePinResult> {
  const p = input.place
  if (!p || typeof p.place_id !== 'string' || !p.place_id || typeof p.name !== 'string' || !p.name ||
      !Number.isFinite(p.lat) || !Number.isFinite(p.lng)) {
    return { ok: false, reason: 'invalid_place' }
  }

  let sharedWith: string[] = []
  let conversationId: string | null = null

  if (input.conversationId) {
    const conv = await getConversation(input.conversationId)
    if (!conv || !conv.member_ids.includes(ownerId)) return { ok: false, reason: 'not_conversation_member' }
    conversationId = conv.conversation_id
  } else {
    const peers = new Set(await acceptedPeerIds(ownerId))
    sharedWith = [...new Set((input.sharedWith ?? []).map(String))].filter((id) => peers.has(id))
    if (sharedWith.length === 0) return { ok: false, reason: 'no_audience' }
  }

  const pin: SharedPin = {
    pin_id: crypto.randomUUID(),
    owner_id: ownerId,
    place: {
      place_id: p.place_id,
      name: p.name.slice(0, 200),
      lat: p.lat,
      lng: p.lng,
      address: typeof p.address === 'string' ? p.address.slice(0, 300) : null,
      photo_url: typeof p.photo_url === 'string' ? p.photo_url.slice(0, 2000) : null,
      rating: typeof p.rating === 'number' ? p.rating : null,
    },
    note: (input.note ?? '').slice(0, MAX_PIN_NOTE),
    shared_with: sharedWith,
    conversation_id: conversationId,
    created_at: nowIso(),
  }
  const sid = await mcp()
  await mcpCall(sid, 'insert-many', { database: DB, collection: 'shared_pins', documents: [{ ...pin, place: { ...pin.place } }] })
  return { ok: true, pin }
}

/** All pins the viewer can see: own + shared with them + in their conversations. */
export async function listVisiblePins(viewerId: string): Promise<Array<SharedPin & { owner: UserAttribution | null }>> {
  const sid = await mcp()
  const convDocs = extractDocs(
    await mcpCall(sid, 'find', {
      database: DB,
      collection: 'conversations',
      filter: { member_ids: viewerId },
      projection: { conversation_id: 1 },
      limit: 200,
    }),
  )
  const convIds = convDocs.map((d) => String(d.conversation_id)).filter(Boolean)

  const or: Array<Record<string, unknown>> = [{ owner_id: viewerId }, { shared_with: viewerId }]
  if (convIds.length > 0) or.push({ conversation_id: { $in: convIds } })

  const docs = extractDocs(
    await mcpCall(sid, 'find', {
      database: DB, collection: 'shared_pins', filter: { $or: or }, sort: { created_at: -1 }, limit: 200,
    }),
  )
  const pins = docs.map(toPin)
  const owners = await getAttributions(pins.map((p) => p.owner_id))
  return pins.map((p) => ({ ...p, owner: owners[p.owner_id] ?? null }))
}

export async function getPinIfVisible(viewerId: string, pinId: string): Promise<SharedPin | null> {
  const sid = await mcp()
  const docs = extractDocs(
    await mcpCall(sid, 'find', { database: DB, collection: 'shared_pins', filter: { pin_id: pinId }, limit: 1 }),
  )
  if (!docs[0]) return null
  const pin = toPin(docs[0])
  if (pin.owner_id === viewerId || pin.shared_with.includes(viewerId)) return pin
  if (pin.conversation_id) {
    const conv = await getConversation(pin.conversation_id)
    if (conv?.member_ids.includes(viewerId)) return pin
  }
  return null
}

/** Delete a pin the caller owns. Returns false when it doesn't exist / isn't theirs. */
export async function deletePin(ownerId: string, pinId: string): Promise<boolean> {
  const sid = await mcp()
  const docs = extractDocs(
    await mcpCall(sid, 'find', { database: DB, collection: 'shared_pins', filter: { pin_id: pinId, owner_id: ownerId }, limit: 1 }),
  )
  if (!docs[0]) return false
  await mcpCall(sid, 'delete-many', { database: DB, collection: 'shared_pins', filter: { pin_id: pinId, owner_id: ownerId } })
  return true
}

// ── Reviews (closed network) ─────────────────────────────────────────────────

function toReview(doc: Record<string, unknown>): PinReview {
  return {
    review_id: String(doc.review_id ?? ''),
    pin_id: typeof doc.pin_id === 'string' ? doc.pin_id : null,
    place_id: String(doc.place_id ?? ''),
    author_id: String(doc.author_id ?? ''),
    rating: typeof doc.rating === 'number' ? doc.rating : 0,
    text: typeof doc.text === 'string' ? doc.text : '',
    created_at: typeof doc.created_at === 'string' ? doc.created_at : '',
  }
}

export interface CreateReviewInput {
  pinId?: string
  placeId: string
  rating: number
  text: string
}

export type CreateReviewResult =
  | { ok: true; review: PinReview }
  | { ok: false; reason: 'invalid' | 'pin_not_visible' }

/**
 * Create a review. Pin reviews require the pin to be visible to the author;
 * standalone place reviews (place_id only) also feed future AI recommendations.
 */
export async function createReview(authorId: string, input: CreateReviewInput): Promise<CreateReviewResult> {
  const rating = Math.round(input.rating)
  if (!input.placeId || rating < 1 || rating > 5 || typeof input.text !== 'string') {
    return { ok: false, reason: 'invalid' }
  }
  if (input.pinId) {
    const pin = await getPinIfVisible(authorId, input.pinId)
    if (!pin) return { ok: false, reason: 'pin_not_visible' }
  }
  const review: PinReview = {
    review_id: crypto.randomUUID(),
    pin_id: input.pinId ?? null,
    place_id: input.placeId,
    author_id: authorId,
    rating,
    text: input.text.slice(0, MAX_REVIEW_TEXT),
    created_at: nowIso(),
  }
  const sid = await mcp()
  await mcpCall(sid, 'insert-many', { database: DB, collection: 'pin_reviews', documents: [{ ...review }] })
  return { ok: true, review }
}

export interface ReviewQuery {
  placeId?: string
  pinId?: string
  authorId?: string
}

/**
 * Reviews visible to the viewer: closed network — only reviews whose author is
 * the viewer or an accepted connection of the viewer.
 */
export async function listReviewsForViewer(
  viewerId: string,
  q: ReviewQuery,
): Promise<Array<PinReview & { author: UserAttribution | null }>> {
  const allowedAuthors = [viewerId, ...(await acceptedPeerIds(viewerId))]
  const filter: Record<string, unknown> = { author_id: { $in: allowedAuthors } }
  if (q.placeId) filter.place_id = q.placeId
  if (q.pinId) filter.pin_id = q.pinId
  if (q.authorId) {
    if (!allowedAuthors.includes(q.authorId)) return []
    filter.author_id = q.authorId
  }

  const sid = await mcp()
  const docs = extractDocs(
    await mcpCall(sid, 'find', {
      database: DB, collection: 'pin_reviews', filter, sort: { created_at: -1 }, limit: 100,
    }),
  )
  const reviews = docs.map(toReview)
  const authors = await getAttributions(reviews.map((r) => r.author_id))
  return reviews.map((r) => ({ ...r, author: authors[r.author_id] ?? null }))
}

// ── Conversations ────────────────────────────────────────────────────────────

function toConversation(doc: Record<string, unknown>): Conversation {
  return {
    conversation_id: String(doc.conversation_id),
    type: (doc.type as ConversationType) ?? 'dm',
    member_ids: Array.isArray(doc.member_ids) ? doc.member_ids.map(String) : [],
    title: typeof doc.title === 'string' ? doc.title : null,
    pin_id: typeof doc.pin_id === 'string' ? doc.pin_id : null,
    wrapped_keys: (doc.wrapped_keys as Record<string, string>) ?? {},
    created_by: String(doc.created_by ?? ''),
    created_at: typeof doc.created_at === 'string' ? doc.created_at : '',
    last_seq: typeof doc.last_seq === 'number' ? doc.last_seq : 0,
    last_message_at: typeof doc.last_message_at === 'string' ? doc.last_message_at : null,
    read_cursors: (doc.read_cursors as Record<string, number>) ?? {},
  }
}

export async function getConversation(conversationId: string): Promise<Conversation | null> {
  const sid = await mcp()
  const docs = extractDocs(
    await mcpCall(sid, 'find', { database: DB, collection: 'conversations', filter: { conversation_id: conversationId }, limit: 1 }),
  )
  return docs[0] ? toConversation(docs[0]) : null
}

export interface CreateConversationInput {
  type: ConversationType
  memberIds: string[]
  title?: string
  pinId?: string
  /** Per-member wrapped conversation keys from lib/e2ee.ts (opaque base64). */
  wrappedKeys?: Record<string, string>
}

export type CreateConversationResult =
  | { ok: true; conversation: Conversation; existing: boolean }
  | { ok: false; reason: 'invalid' | 'not_connected' | 'pin_not_visible' }

/**
 * Create a conversation. Every member (other than the creator) must be an
 * accepted connection of the creator. DMs deduplicate to one per pair.
 */
export async function createConversation(
  creatorId: string,
  input: CreateConversationInput,
): Promise<CreateConversationResult> {
  const memberIds = [...new Set([creatorId, ...input.memberIds.map(String)])]
  if (memberIds.length < 2 || memberIds.length > 20) return { ok: false, reason: 'invalid' }
  if (input.type === 'dm' && memberIds.length !== 2) return { ok: false, reason: 'invalid' }

  const peers = new Set(await acceptedPeerIds(creatorId))
  for (const id of memberIds) {
    if (id !== creatorId && !peers.has(id)) return { ok: false, reason: 'not_connected' }
  }

  let pinId: string | null = null
  if (input.type === 'pin') {
    if (!input.pinId) return { ok: false, reason: 'invalid' }
    const pin = await getPinIfVisible(creatorId, input.pinId)
    if (!pin) return { ok: false, reason: 'pin_not_visible' }
    pinId = pin.pin_id
  }

  const sid = await mcp()

  if (input.type === 'dm') {
    const existing = extractDocs(
      await mcpCall(sid, 'find', {
        database: DB,
        collection: 'conversations',
        filter: { type: 'dm', member_ids: { $all: memberIds, $size: 2 } },
        limit: 1,
      }),
    )
    if (existing[0]) return { ok: true, conversation: toConversation(existing[0]), existing: true }
  }

  // Wrapped keys are opaque to the server — just constrain them to members and
  // sane sizes so the collection can't be used as arbitrary storage.
  const wrappedKeys: Record<string, string> = {}
  for (const [uid, key] of Object.entries(input.wrappedKeys ?? {})) {
    if (memberIds.includes(uid) && typeof key === 'string' && key.length <= 4096 && BASE64_RE.test(key)) {
      wrappedKeys[uid] = key
    }
  }

  const conv: Conversation = {
    conversation_id: crypto.randomUUID(),
    type: input.type,
    member_ids: memberIds,
    title: input.type === 'group' ? (input.title ?? '').slice(0, 120) || null : null,
    pin_id: pinId,
    wrapped_keys: wrappedKeys,
    created_by: creatorId,
    created_at: nowIso(),
    last_seq: 0,
    last_message_at: null,
    read_cursors: {},
  }
  await mcpCall(sid, 'insert-many', {
    database: DB,
    collection: 'conversations',
    documents: [{ ...conv, wrapped_keys: { ...conv.wrapped_keys }, read_cursors: {} }],
  })
  return { ok: true, conversation: conv, existing: false }
}

export interface ConversationSummary extends Conversation {
  members: UserAttribution[]
  /** True when there are messages newer than the viewer's read cursor. */
  unread: boolean
}

export async function listConversations(userId: string): Promise<ConversationSummary[]> {
  const sid = await mcp()
  const docs = extractDocs(
    await mcpCall(sid, 'find', {
      database: DB,
      collection: 'conversations',
      filter: { member_ids: userId },
      sort: { last_message_at: -1, created_at: -1 },
      limit: 100,
    }),
  )
  const convs = docs.map(toConversation)
  const attributions = await getAttributions(convs.flatMap((c) => c.member_ids))
  return convs.map((c) => ({
    ...c,
    members: c.member_ids.map((id) => attributions[id]).filter((m): m is UserAttribution => Boolean(m)),
    unread: c.last_seq > (c.read_cursors[userId] ?? 0),
  }))
}

// ── Messages (ciphertext only) ───────────────────────────────────────────────

// Monotonic per-process seq: wall clock, bumped past both the process's last
// issued seq and the conversation's persisted last_seq (counter fallback for
// same-millisecond sends and clock skew across instances).
let lastIssuedSeq = 0
function nextSeq(convLastSeq: number): number {
  const seq = Math.max(Date.now(), lastIssuedSeq + 1, convLastSeq + 1)
  lastIssuedSeq = seq
  return seq
}

export type AppendMessageResult =
  | { ok: true; message: EncryptedMessage }
  | { ok: false; reason: 'invalid_payload' | 'too_large' }

/**
 * Append an encrypted message. The caller (route) must have already verified
 * that `senderId` is a member of `conv`. Only ciphertext is ever stored.
 */
export async function appendMessage(
  conv: Conversation,
  senderId: string,
  ciphertext: string,
  iv: string,
  msgType: 'text' | 'image',
): Promise<AppendMessageResult> {
  if (typeof ciphertext !== 'string' || !ciphertext || !BASE64_RE.test(ciphertext)) return { ok: false, reason: 'invalid_payload' }
  if (typeof iv !== 'string' || !iv || iv.length > 64 || !BASE64_RE.test(iv)) return { ok: false, reason: 'invalid_payload' }
  if (msgType !== 'text' && msgType !== 'image') return { ok: false, reason: 'invalid_payload' }
  if (ciphertext.length > MAX_CIPHERTEXT_B64) return { ok: false, reason: 'too_large' }

  const message: EncryptedMessage = {
    conversation_id: conv.conversation_id,
    sender_id: senderId,
    ciphertext,
    iv,
    msg_type: msgType,
    created_at: nowIso(),
    seq: nextSeq(conv.last_seq),
  }
  const sid = await mcp()
  await mcpCall(sid, 'insert-many', { database: DB, collection: 'messages', documents: [{ ...message }] })
  await mcpCall(sid, 'update-many', {
    database: DB,
    collection: 'conversations',
    filter: { conversation_id: conv.conversation_id },
    update: {
      $max: { last_seq: message.seq, [`read_cursors.${senderId}`]: message.seq },
      $set: { last_message_at: message.created_at },
    },
  })
  return { ok: true, message }
}

function toMessage(doc: Record<string, unknown>): EncryptedMessage {
  return {
    conversation_id: String(doc.conversation_id),
    sender_id: String(doc.sender_id),
    ciphertext: String(doc.ciphertext ?? ''),
    iv: String(doc.iv ?? ''),
    msg_type: doc.msg_type === 'image' ? 'image' : 'text',
    created_at: typeof doc.created_at === 'string' ? doc.created_at : '',
    seq: typeof doc.seq === 'number' ? doc.seq : 0,
  }
}

/** Poll messages after a seq. Membership must be checked by the caller. */
export async function listMessages(conversationId: string, afterSeq: number, limit = 100): Promise<EncryptedMessage[]> {
  const sid = await mcp()
  const docs = extractDocs(
    await mcpCall(sid, 'find', {
      database: DB,
      collection: 'messages',
      filter: { conversation_id: conversationId, seq: { $gt: afterSeq } },
      sort: { seq: 1 },
      limit: Math.min(Math.max(limit, 1), 100),
    }),
  )
  return docs.map(toMessage)
}

/** Advance the member's read cursor (best-effort; powers the unread hint). */
export async function markRead(conversationId: string, userId: string, seq: number): Promise<void> {
  try {
    const sid = await mcp()
    await mcpCall(sid, 'update-many', {
      database: DB,
      collection: 'conversations',
      filter: { conversation_id: conversationId },
      update: { $max: { [`read_cursors.${userId}`]: seq } },
    })
  } catch (err) {
    console.warn('[community] markRead failed (non-fatal)', err)
  }
}

// ── Presence ─────────────────────────────────────────────────────────────────

/**
 * Heartbeat: bump last_seen_at; update location only when the user has
 * share_location enabled AND sent fresh coordinates.
 */
export async function heartbeat(userId: string, loc?: { lat: number; lng: number }): Promise<void> {
  const sid = await mcp()
  const doc = await findUserDoc(sid, userId)
  if (!doc) return
  const set: Record<string, unknown> = { last_seen_at: nowIso() }
  if (doc.share_location === true && loc && Number.isFinite(loc.lat) && Number.isFinite(loc.lng)) {
    set.location = { type: 'Point', coordinates: [loc.lng, loc.lat] } satisfies GeoPoint
  }
  await mcpCall(sid, 'update-many', {
    database: DB, collection: 'users', filter: { user_id: userId }, update: { $set: set },
  })
}

export interface PresenceInfo {
  online: boolean
  last_seen_at: string | null
}

/** Presence for the requested ids — restricted to accepted connections (+ self). */
export async function getPresenceFor(callerId: string, ids: string[]): Promise<Record<string, PresenceInfo>> {
  const peers = new Set([callerId, ...(await acceptedPeerIds(callerId))])
  const allowed = [...new Set(ids)].filter((id) => peers.has(id))
  if (allowed.length === 0) return {}
  const sid = await mcp()
  const docs = extractDocs(
    await mcpCall(sid, 'find', {
      database: DB,
      collection: 'users',
      filter: { user_id: { $in: allowed } },
      projection: { user_id: 1, last_seen_at: 1 },
      limit: allowed.length,
    }),
  )
  const out: Record<string, PresenceInfo> = {}
  for (const d of docs) {
    const last = typeof d.last_seen_at === 'string' ? d.last_seen_at : null
    out[String(d.user_id)] = { online: isOnline(last), last_seen_at: last }
  }
  return out
}

// ── Public keys ──────────────────────────────────────────────────────────────

/**
 * Published E2EE public keys (JWKs). Any authenticated user may fetch pubkeys —
 * they are public by design and required to start an encrypted conversation.
 */
export async function getPubkeys(ids: string[]): Promise<Record<string, Record<string, unknown> | null>> {
  const clean = [...new Set(ids)].filter(Boolean).slice(0, 50)
  if (clean.length === 0) return {}
  const sid = await mcp()
  const docs = extractDocs(
    await mcpCall(sid, 'find', {
      database: DB,
      collection: 'users',
      filter: { user_id: { $in: clean } },
      projection: { user_id: 1, pubkey: 1 },
      limit: clean.length,
    }),
  )
  const out: Record<string, Record<string, unknown> | null> = {}
  for (const d of docs) {
    out[String(d.user_id)] = d.pubkey && typeof d.pubkey === 'object' && !Array.isArray(d.pubkey)
      ? (d.pubkey as Record<string, unknown>)
      : null
  }
  return out
}
