/**
 * Typed browser-side fetch wrapper over the community API
 * (/api/community/**). Safe to import from 'use client' components — it only
 * uses fetch and type-only imports from lib/community (erased at compile time,
 * so no server code leaks into the client bundle).
 *
 * Every helper throws CommunityApiError on a non-2xx response, carrying the
 * HTTP status and the server's human-readable `error` message.
 */
import type {
  Connection,
  Conversation,
  ConversationSummary,
  ConversationType,
  EncryptedMessage,
  GeoPoint,
  PresenceInfo,
  UserAttribution,
  UserSummary,
} from '@/lib/community'

/** Mirrors lib/community MAX_CIPHERTEXT_B64 (value import would pull in server code). */
export const MAX_CIPHERTEXT_B64 = 400 * 1024
/** Mirrors lib/community ONLINE_WINDOW_MS. */
export const ONLINE_WINDOW_MS = 90_000

/** Non-2xx response from a community endpoint. */
export class CommunityApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.name = 'CommunityApiError'
    this.status = status
  }
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  })
  let body: Record<string, unknown> = {}
  try {
    body = (await res.json()) as Record<string, unknown>
  } catch {
    /* non-JSON error body — fall through to the status check */
  }
  if (!res.ok) {
    const message = typeof body.error === 'string' ? body.error : `Request failed (${res.status}).`
    throw new CommunityApiError(res.status, message)
  }
  return body as T
}

// ── Profile ──────────────────────────────────────────────────────────────────

/** Server projection of a profile (GET/PUT /api/community/profile). */
export interface ProfileView {
  user_id: string
  handle: string
  name: string | null
  bio: string
  avatar_emoji: string
  discoverable: boolean
  share_location: boolean
  location: GeoPoint | null
  online: boolean
  last_seen_at: string | null
  pubkey: Record<string, unknown> | null
}

export interface ProfileUpdate {
  handle?: string
  bio?: string
  avatar_emoji?: string
  discoverable?: boolean
  share_location?: boolean
  location?: { lat: number; lng: number } | null
  pubkey?: Record<string, unknown> | null
}

export async function getMyProfile(): Promise<ProfileView> {
  const { profile } = await request<{ profile: ProfileView }>('/api/community/profile')
  return profile
}

export async function getProfileByHandle(handle: string): Promise<ProfileView> {
  const { profile } = await request<{ profile: ProfileView }>(
    `/api/community/profile?handle=${encodeURIComponent(handle)}`,
  )
  return profile
}

export async function updateMyProfile(patch: ProfileUpdate): Promise<ProfileView> {
  const { profile } = await request<{ profile: ProfileView }>('/api/community/profile', {
    method: 'PUT',
    body: JSON.stringify(patch),
  })
  return profile
}

// ── People: search + connections ─────────────────────────────────────────────

export async function searchUsers(q: string): Promise<UserSummary[]> {
  const { users } = await request<{ users: UserSummary[] }>(
    `/api/community/users/search?q=${encodeURIComponent(q)}`,
  )
  return users
}

/** Discoverable travellers within ~25km of the caller's shared location. */
export async function searchNearby(): Promise<UserSummary[]> {
  const { users } = await request<{ users: UserSummary[] }>('/api/community/users/search?near=1')
  return users
}

/** A connection edge decorated with the other party's public attribution. */
export type ConnectionEdge = Connection & { user: UserAttribution | null }

export interface ConnectionsView {
  accepted: ConnectionEdge[]
  pending_in: ConnectionEdge[]
  pending_out: ConnectionEdge[]
  blocked: ConnectionEdge[]
}

export async function getConnections(): Promise<ConnectionsView> {
  return request<ConnectionsView>('/api/community/connections')
}

export type ConnectionAction =
  | 'invite'
  | 'accept'
  | 'decline'
  | 'block'
  | 'cancel'
  | 'remove'
  | 'unblock'

/** Invite / accept / decline / block / cancel / remove / unblock. Throws 409 on conflicts. */
export async function connectionAction(action: ConnectionAction, userId: string): Promise<Connection> {
  const { connection } = await request<{ ok: true; connection: Connection }>('/api/community/connections', {
    method: 'POST',
    body: JSON.stringify({ action, user_id: userId }),
  })
  return connection
}

// ── Conversations + messages ─────────────────────────────────────────────────

export async function listConversations(): Promise<ConversationSummary[]> {
  const { conversations } = await request<{ conversations: ConversationSummary[] }>(
    '/api/community/conversations',
  )
  return conversations
}

export interface CreateConversationBody {
  type: ConversationType
  member_ids: string[]
  title?: string
  pin_id?: string
  wrapped_keys?: Record<string, string>
}

export async function createConversation(
  body: CreateConversationBody,
): Promise<{ conversation: Conversation; existing: boolean }> {
  const { conversation, existing } = await request<{
    ok: true
    conversation: Conversation
    existing: boolean
  }>('/api/community/conversations', { method: 'POST', body: JSON.stringify(body) })
  return { conversation, existing }
}

export async function fetchMessages(
  conversationId: string,
  afterSeq: number,
): Promise<{ messages: EncryptedMessage[]; last_seq: number }> {
  return request<{ messages: EncryptedMessage[]; last_seq: number }>(
    `/api/community/messages?conversation_id=${encodeURIComponent(conversationId)}&after_seq=${afterSeq}`,
  )
}

export async function sendMessage(
  conversationId: string,
  ciphertext: string,
  iv: string,
  msgType: 'text' | 'image',
): Promise<EncryptedMessage> {
  const { message } = await request<{ ok: true; message: EncryptedMessage }>('/api/community/messages', {
    method: 'POST',
    body: JSON.stringify({ conversation_id: conversationId, ciphertext, iv, msg_type: msgType }),
  })
  return message
}

// ── Presence + keys ──────────────────────────────────────────────────────────

/** Heartbeat: bumps last_seen_at (location only persists if sharing is on). */
export async function sendHeartbeat(loc?: { lat: number; lng: number }): Promise<void> {
  await request<{ ok: true }>('/api/community/presence', {
    method: 'POST',
    body: JSON.stringify(loc ?? {}),
  })
}

export async function getPresence(ids: string[]): Promise<Record<string, PresenceInfo>> {
  if (ids.length === 0) return {}
  const { presence } = await request<{ presence: Record<string, PresenceInfo> }>(
    `/api/community/presence?ids=${encodeURIComponent(ids.join(','))}`,
  )
  return presence
}

export async function getPubkeys(ids: string[]): Promise<Record<string, JsonWebKey | null>> {
  if (ids.length === 0) return {}
  const { keys } = await request<{ keys: Record<string, JsonWebKey | null> }>(
    `/api/community/keys?ids=${encodeURIComponent(ids.join(','))}`,
  )
  return keys
}

// ── Small display helpers ────────────────────────────────────────────────────

/** "Online now" / "Last seen 5m ago" — for presence dot tooltips. */
export function formatLastSeen(iso: string | null | undefined): string {
  if (!iso) return 'Last seen: unknown'
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return 'Last seen: unknown'
  const diff = Date.now() - t
  if (diff < ONLINE_WINDOW_MS) return 'Online now'
  const mins = Math.floor(diff / 60_000)
  if (mins < 60) return `Last seen ${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `Last seen ${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `Last seen ${days}d ago`
  return `Last seen ${new Date(t).toLocaleDateString()}`
}

/** Compact conversation-list timestamp: time today, weekday this week, else date. */
export function formatWhen(iso: string | null | undefined): string {
  if (!iso) return ''
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return ''
  const d = new Date(t)
  const now = new Date()
  if (d.toDateString() === now.toDateString()) {
    return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
  }
  if (now.getTime() - t < 6 * 24 * 3600_000) {
    return d.toLocaleDateString(undefined, { weekday: 'short' })
  }
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

/** Day-divider label for message threads: Today / Yesterday / "Mon, 6 Jul". */
export function dayLabel(iso: string): string {
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return ''
  const d = new Date(t)
  const today = new Date()
  const yesterday = new Date(today)
  yesterday.setDate(today.getDate() - 1)
  if (d.toDateString() === today.toDateString()) return 'Today'
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday'
  return d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })
}

/** hh:mm timestamp under a message bubble. */
export function timeLabel(iso: string): string {
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return ''
  return new Date(t).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
}

/** Display title of a conversation from the viewer's side (group title or peers). */
export function conversationTitle(
  conv: Pick<ConversationSummary, 'title' | 'members'>,
  currentUserId: string,
): string {
  if (conv.title) return conv.title
  const others = conv.members.filter((m) => m.user_id !== currentUserId)
  if (others.length === 0) return 'Just you'
  return others.map((m) => m.name || `@${m.handle}`).join(', ')
}
