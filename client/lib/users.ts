/**
 * Create-or-load a Hodari user by email, via the MongoDB MCP. Shared by the
 * OAuth callback. Matches the existing `users` collection schema.
 */
import { mcpSession, mcpCall, ensureConnected, extractDocs } from '@/lib/mcp'
import { encryptSecret, decryptSecret } from '@/lib/crypto'
import { hashPassword, verifyPassword } from '@/lib/password'

const DB = process.env.MONGODB_DATABASE ?? 'hodari'

export interface HodariUser {
  user_id: string
  name: string | null
  email: string
  home_country: string | null
  languages: string[]
  budget_tier: string
}

function publicUser(doc: Record<string, unknown>): HodariUser {
  return {
    user_id: String(doc.user_id),
    name: (doc.name as string) ?? null,
    email: String(doc.email),
    home_country: (doc.home_country as string) ?? null,
    languages: (doc.languages as string[]) ?? ['en'],
    budget_tier: (doc.budget_tier as string) ?? 'moderate',
  }
}

function slugifyId(name: string, email: string): string {
  const base = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
  return base || email.split('@')[0].replace(/[^a-z0-9_]/g, '') || 'fan'
}

/** Look up the user by email; create the profile on first sign-in. */
export async function findOrCreateUser(email: string, name: string): Promise<HodariUser> {
  const cleanEmail = email.trim().toLowerCase()
  const cleanName = name.trim() || cleanEmail.split('@')[0]

  const sid = await mcpSession()
  await ensureConnected(sid)

  const existing = extractDocs(
    await mcpCall(sid, 'find', { database: DB, collection: 'users', filter: { email: cleanEmail }, limit: 1 }),
  )
  if (existing.length > 0) {
    const doc = existing[0]
    if (doc.name !== cleanName) {
      await mcpCall(sid, 'update-many', {
        database: DB, collection: 'users', filter: { email: cleanEmail }, update: { $set: { name: cleanName } },
      })
      doc.name = cleanName
    }
    return publicUser(doc)
  }

  let userId = slugifyId(cleanName, cleanEmail)
  const clash = extractDocs(
    await mcpCall(sid, 'find', { database: DB, collection: 'users', filter: { user_id: userId }, limit: 1 }),
  )
  if (clash.length > 0) userId = `${userId}_${Math.random().toString(36).slice(2, 6)}`

  const doc = {
    user_id: userId, name: cleanName, email: cleanEmail,
    home_country: null, languages: ['en'], dietary: [], budget_tier: 'moderate', accessibility: [],
    created_at: new Date().toISOString(),
  }
  await mcpCall(sid, 'insert-many', { database: DB, collection: 'users', documents: [doc] })
  return publicUser(doc)
}

/** Distinguishes the outcome of a password sign-up attempt for the API layer. */
export type SignupResult =
  | { ok: true; user: HodariUser }
  | { ok: false; reason: 'email_taken' }

/**
 * Register a new email/password user. Fails if the email is already registered
 * (whether via Google or a prior password sign-up) so we never silently attach a
 * password to someone else's account. Stores only a scrypt hash — never the
 * plaintext. Mirrors the `findOrCreateUser` doc shape + `created_at` marker so a
 * "new user" query works the same regardless of sign-in method.
 */
export async function createUserWithPassword(
  email: string,
  name: string,
  plainPassword: string,
): Promise<SignupResult> {
  const cleanEmail = email.trim().toLowerCase()
  const cleanName = name.trim() || cleanEmail.split('@')[0]

  const sid = await mcpSession()
  await ensureConnected(sid)

  const existing = extractDocs(
    await mcpCall(sid, 'find', { database: DB, collection: 'users', filter: { email: cleanEmail }, limit: 1 }),
  )
  if (existing.length > 0) return { ok: false, reason: 'email_taken' }

  let userId = slugifyId(cleanName, cleanEmail)
  const clash = extractDocs(
    await mcpCall(sid, 'find', { database: DB, collection: 'users', filter: { user_id: userId }, limit: 1 }),
  )
  if (clash.length > 0) userId = `${userId}_${Math.random().toString(36).slice(2, 6)}`

  const doc = {
    user_id: userId, name: cleanName, email: cleanEmail,
    password_hash: hashPassword(plainPassword),
    home_country: null, languages: ['en'], dietary: [], budget_tier: 'moderate', accessibility: [],
    created_at: new Date().toISOString(),
  }
  await mcpCall(sid, 'insert-many', { database: DB, collection: 'users', documents: [doc] })
  return { ok: true, user: publicUser(doc) }
}

/**
 * Verify an email/password login. Returns the user on success, or null on a bad
 * email/password OR an account with no password set (e.g. a Google-only user) —
 * the caller shows one generic "wrong email or password" either way so we never
 * reveal which emails exist or how they signed up.
 */
export async function verifyUserPassword(email: string, plainPassword: string): Promise<HodariUser | null> {
  const cleanEmail = email.trim().toLowerCase()
  const sid = await mcpSession()
  await ensureConnected(sid)

  const docs = extractDocs(
    await mcpCall(sid, 'find', { database: DB, collection: 'users', filter: { email: cleanEmail }, limit: 1 }),
  )
  const doc = docs[0]
  if (!doc) return null
  if (!verifyPassword(plainPassword, doc.password_hash as string | undefined)) return null
  return publicUser(doc)
}

/** Store the user's Google refresh token (encrypted) + mark calendar connected. */
export async function setGoogleRefreshToken(userId: string, refreshToken: string): Promise<void> {
  const sid = await mcpSession()
  await ensureConnected(sid)
  await mcpCall(sid, 'update-many', {
    database: DB,
    collection: 'users',
    filter: { user_id: userId },
    update: { $set: { google_refresh_token: encryptSecret(refreshToken), google_calendar_connected: true } },
  })
}

/** The decrypted Google refresh token for a user, or null if not connected. */
export async function getGoogleRefreshToken(userId: string): Promise<string | null> {
  const sid = await mcpSession()
  await ensureConnected(sid)
  const docs = extractDocs(
    await mcpCall(sid, 'find', { database: DB, collection: 'users', filter: { user_id: userId }, limit: 1 }),
  )
  return decryptSecret(docs[0]?.google_refresh_token as string | undefined)
}

/** Whether the user has connected Google Calendar. */
export async function isCalendarConnected(userId: string): Promise<boolean> {
  const sid = await mcpSession()
  await ensureConnected(sid)
  const docs = extractDocs(
    await mcpCall(sid, 'find', { database: DB, collection: 'users', filter: { user_id: userId }, limit: 1 }),
  )
  return Boolean(docs[0]?.google_calendar_connected)
}
