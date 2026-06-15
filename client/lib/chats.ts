/**
 * Per-user chat transcript storage in MongoDB (collection `chats`), so a
 * signed-in member's history follows their account across devices instead of
 * living only in one browser's localStorage.
 *
 * Transcripts are ENCRYPTED at rest (lib/crypto, AES-256-GCM) — a DB read alone
 * never exposes conversation content. Guests (no session) keep using
 * localStorage; only authenticated users get server-side history.
 */
import { mcpSession, mcpCall, ensureConnected, extractDocs } from '@/lib/mcp'
import { encryptSecret, decryptSecret } from '@/lib/crypto'

const DB = process.env.MONGODB_DATABASE ?? 'hodari'
const COLLECTION = 'chats'
const MAX_CHATS = 50 // retention: keep the newest N conversations per user

export interface StoredChat {
  id: string
  title: string
  updatedAt: number
  messages: unknown[]
}

export async function listChats(userId: string): Promise<StoredChat[]> {
  const sid = await mcpSession()
  await ensureConnected(sid)
  const docs = extractDocs(
    await mcpCall(sid, 'find', { database: DB, collection: COLLECTION, filter: { user_id: userId }, limit: MAX_CHATS }),
  )
  const chats = docs.map((d) => {
    let messages: unknown[] = []
    try {
      const json = decryptSecret(d.data as string)
      if (json) messages = JSON.parse(json)
    } catch { /* corrupt/secret-rotated — drop content, keep the entry */ }
    return {
      id: String(d.session_id),
      title: String(d.title ?? 'Untitled chat'),
      updatedAt: Number(d.updated_at ?? 0),
      messages,
    }
  })
  return chats.sort((a, b) => b.updatedAt - a.updatedAt)
}

export async function upsertChat(
  userId: string,
  chat: { sessionId: string; title: string; messages: unknown[]; updatedAt: number },
): Promise<void> {
  const sid = await mcpSession()
  await ensureConnected(sid)
  await mcpCall(sid, 'update-many', {
    database: DB,
    collection: COLLECTION,
    filter: { user_id: userId, session_id: chat.sessionId },
    update: {
      $set: {
        user_id: userId,
        session_id: chat.sessionId,
        title: chat.title.slice(0, 80),
        data: encryptSecret(JSON.stringify(chat.messages)),
        updated_at: chat.updatedAt,
      },
    },
    upsert: true,
  })

  // Retention: drop anything beyond the newest MAX_CHATS for this user.
  const ids = extractDocs(
    await mcpCall(sid, 'find', {
      database: DB, collection: COLLECTION, filter: { user_id: userId },
      projection: { session_id: 1, updated_at: 1, _id: 0 }, limit: 500,
    }),
  )
  if (ids.length > MAX_CHATS) {
    const stale = ids
      .sort((a, b) => Number(b.updated_at ?? 0) - Number(a.updated_at ?? 0))
      .slice(MAX_CHATS)
      .map((d) => String(d.session_id))
    if (stale.length) {
      await mcpCall(sid, 'delete-many', {
        database: DB, collection: COLLECTION, filter: { user_id: userId, session_id: { $in: stale } },
      })
    }
  }
}

export async function deleteChat(userId: string, sessionId: string): Promise<void> {
  const sid = await mcpSession()
  await ensureConnected(sid)
  await mcpCall(sid, 'delete-many', {
    database: DB, collection: COLLECTION, filter: { user_id: userId, session_id: sessionId },
  })
}
