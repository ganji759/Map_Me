/**
 * Server-side metering & credits (see BILLING.md).
 *
 * The chat pipeline (Planner → Explorer → Itinerary) spends real Gemini + Maps
 * tokens on every run, so usage MUST be metered server-side — never trust the
 * client. The entitlement ladder:
 *
 *   guest  (no login)      → GUEST_FREE generations, metered by IP, then a login wall
 *   member (Google login)  → FREE_DAILY free generations/day, then a paywall
 *   paid   (bought credits)→ one-time credit packs, consumed after the daily free
 *
 * State lives in Mongo (via the MCP sidecar): the daily-free counter and the
 * purchased `credits` balance hang off the user's `users` doc; guest counters
 * live in a small `usage` collection keyed by IP. All reads/writes go through
 * the same MCP helpers the auth routes use.
 *
 * Note on atomicity: consume() is read-modify-write, not a single atomic CAS, so
 * under heavy concurrency a user could occasionally slip one extra free run.
 * That's an acceptable few-cents leak for this app; the per-IP rate limiter caps
 * the blast radius. If it ever matters, swap the find+update for a conditional
 * `update-many` (filter encodes the cap) and read the matched count.
 */
import { mcpSession, mcpCall, ensureConnected, extractDocs } from '@/lib/mcp'

const DB = process.env.MONGODB_DATABASE ?? 'hodari'

/** Free generations a not-logged-in visitor gets before the login wall. */
export const GUEST_FREE = Number(process.env.HODARI_GUEST_FREE ?? 3)
/** Free generations a signed-in member gets each day before the paywall. */
export const FREE_DAILY = Number(process.env.HODARI_FREE_DAILY ?? 5)

export type Gate = 'login' | 'paywall'

/** Who is making the request, resolved server-side (cookie or IP). */
export type Identity =
  | { kind: 'user'; userId: string }
  | { kind: 'guest'; key: string }

export interface Entitlement {
  kind: 'user' | 'guest'
  /** Free generations still available now (daily for members, total for guests). */
  freeRemaining: number
  /** Size of the free allotment (FREE_DAILY for members, GUEST_FREE for guests). */
  freeLimit: number
  /** Purchased credit balance (members only; always 0 for guests). */
  credits: number
  /** Set when the user has nothing left: 'login' for guests, 'paywall' for members. */
  gate: Gate | null
}

export interface ConsumeResult {
  ok: boolean
  /** Present when ok === false. */
  gate?: Gate
  /** True when this run was paid for out of the purchased credit balance. */
  usedCredit: boolean
  entitlement: Entitlement
  /** True when Mongo was unreachable and we failed OPEN (allowed without metering). */
  degraded?: boolean
}

/** One-time credit packs. `credits` is authoritative HERE (never trust the client). */
export interface CreditPack {
  id: string
  credits: number
  label: string
  /** Human price string for the UI, e.g. "$3". Real charge comes from the Stripe price. */
  priceDisplay: string
}

export const PACKS: CreditPack[] = [
  { id: 'starter', credits: 25, label: 'Starter', priceDisplay: process.env.STRIPE_PRICE_DISPLAY_STARTER ?? '$3' },
  { id: 'explorer', credits: 75, label: 'Explorer', priceDisplay: process.env.STRIPE_PRICE_DISPLAY_EXPLORER ?? '$7' },
  { id: 'tournament', credits: 200, label: 'Tournament', priceDisplay: process.env.STRIPE_PRICE_DISPLAY_TOURNAMENT ?? '$15' },
]

export function packById(id: string): CreditPack | undefined {
  return PACKS.find((p) => p.id === id)
}

function today(): string {
  return new Date().toISOString().slice(0, 10) // YYYY-MM-DD (UTC)
}

async function mcp() {
  const sid = await mcpSession()
  await ensureConnected(sid)
  return sid
}

// ── Reads ──────────────────────────────────────────────────────────────────

async function readUser(sid: string, userId: string): Promise<Record<string, unknown> | null> {
  const docs = extractDocs(
    await mcpCall(sid, 'find', { database: DB, collection: 'users', filter: { user_id: userId }, limit: 1 }),
  )
  return docs[0] ?? null
}

async function readGuestCount(sid: string, key: string): Promise<number> {
  const docs = extractDocs(
    await mcpCall(sid, 'find', { database: DB, collection: 'usage', filter: { key }, limit: 1 }),
  )
  const n = docs[0]?.count
  return typeof n === 'number' ? n : 0
}

function userEntitlement(doc: Record<string, unknown> | null): Entitlement {
  const credits = typeof doc?.credits === 'number' ? (doc!.credits as number) : 0
  const usedToday = doc?.free_day === today() && typeof doc?.free_used === 'number' ? (doc!.free_used as number) : 0
  const freeRemaining = Math.max(0, FREE_DAILY - usedToday)
  const gate: Gate | null = freeRemaining <= 0 && credits <= 0 ? 'paywall' : null
  return { kind: 'user', freeRemaining, freeLimit: FREE_DAILY, credits, gate }
}

function guestEntitlement(count: number): Entitlement {
  const freeRemaining = Math.max(0, GUEST_FREE - count)
  return {
    kind: 'guest',
    freeRemaining,
    freeLimit: GUEST_FREE,
    credits: 0,
    gate: freeRemaining <= 0 ? 'login' : null,
  }
}

/** Read-only entitlement snapshot for the UI (the quota pill / paywall state). */
export async function getEntitlement(identity: Identity): Promise<Entitlement> {
  const sid = await mcp()
  if (identity.kind === 'user') return userEntitlement(await readUser(sid, identity.userId))
  return guestEntitlement(await readGuestCount(sid, identity.key))
}

// ── Writes ─────────────────────────────────────────────────────────────────

/**
 * Try to spend one generation. Members burn their daily free allotment first,
 * then purchased credits. Guests burn their IP-keyed free pool. Returns
 * `{ ok: false, gate }` when the caller has hit the login wall / paywall.
 *
 * Fails OPEN on infrastructure errors (Mongo/MCP down): we allow the run rather
 * than block paying users during a blip — the rate limiter still caps abuse.
 */
export async function consume(identity: Identity): Promise<ConsumeResult> {
  try {
    const sid = await mcp()

    if (identity.kind === 'guest') {
      const count = await readGuestCount(sid, identity.key)
      const ent = guestEntitlement(count)
      if (ent.gate) return { ok: false, gate: ent.gate, usedCredit: false, entitlement: ent }
      await mcpCall(sid, 'update-many', {
        database: DB,
        collection: 'usage',
        filter: { key: identity.key },
        update: { $inc: { count: 1 }, $setOnInsert: { key: identity.key, kind: 'guest', created_at: new Date().toISOString() } },
        upsert: true,
      })
      return { ok: true, usedCredit: false, entitlement: guestEntitlement(count + 1) }
    }

    // Member
    const doc = await readUser(sid, identity.userId)
    const ent = userEntitlement(doc)
    const usedToday = doc?.free_day === today() && typeof doc?.free_used === 'number' ? (doc.free_used as number) : 0

    if (ent.freeRemaining > 0) {
      await mcpCall(sid, 'update-many', {
        database: DB,
        collection: 'users',
        filter: { user_id: identity.userId },
        update: { $set: { free_day: today(), free_used: usedToday + 1 } },
      })
      return { ok: true, usedCredit: false, entitlement: userEntitlement({ ...doc, free_day: today(), free_used: usedToday + 1 }) }
    }

    if (ent.credits > 0) {
      await mcpCall(sid, 'update-many', {
        database: DB,
        collection: 'users',
        filter: { user_id: identity.userId },
        update: { $inc: { credits: -1 }, $set: { free_day: today(), free_used: usedToday } },
      })
      return { ok: true, usedCredit: true, entitlement: userEntitlement({ ...doc, credits: ent.credits - 1, free_day: today(), free_used: usedToday }) }
    }

    return { ok: false, gate: 'paywall', usedCredit: false, entitlement: ent }
  } catch (err) {
    console.error('[billing] consume failed — failing open', err)
    const ent: Entitlement =
      identity.kind === 'user'
        ? { kind: 'user', freeRemaining: 0, freeLimit: FREE_DAILY, credits: 0, gate: null }
        : { kind: 'guest', freeRemaining: 0, freeLimit: GUEST_FREE, credits: 0, gate: null }
    return { ok: true, usedCredit: false, entitlement: ent, degraded: true }
  }
}

/**
 * Give back one generation when the run never started (agent unreachable). Skip
 * when the consume was degraded (we never actually decremented anything).
 */
export async function refund(identity: Identity, usedCredit: boolean): Promise<void> {
  try {
    const sid = await mcp()
    if (identity.kind === 'guest') {
      await mcpCall(sid, 'update-many', {
        database: DB, collection: 'usage', filter: { key: identity.key }, update: { $inc: { count: -1 } },
      })
      return
    }
    const update = usedCredit ? { $inc: { credits: 1 } } : { $inc: { free_used: -1 } }
    await mcpCall(sid, 'update-many', {
      database: DB, collection: 'users', filter: { user_id: identity.userId }, update,
    })
  } catch (err) {
    console.error('[billing] refund failed (non-fatal)', err)
  }
}

/**
 * Add purchased credits to a member. Idempotent per Stripe event: records the
 * event id in `billing_events` first and no-ops if it's already been applied,
 * so webhook retries don't double-credit.
 */
export async function addCredits(userId: string, credits: number, eventId: string): Promise<boolean> {
  const sid = await mcp()
  const seen = extractDocs(
    await mcpCall(sid, 'find', { database: DB, collection: 'billing_events', filter: { event_id: eventId }, limit: 1 }),
  )
  if (seen.length > 0) return false // already applied

  await mcpCall(sid, 'insert-many', {
    database: DB,
    collection: 'billing_events',
    documents: [{ event_id: eventId, user_id: userId, credits, applied_at: new Date().toISOString() }],
  })
  await mcpCall(sid, 'update-many', {
    database: DB, collection: 'users', filter: { user_id: userId }, update: { $inc: { credits } },
  })
  return true
}
