/**
 * In-memory cache of unwrapped per-conversation AES-GCM keys.
 *
 * Keys are unwrapped once per session (module-level Map, survives panel
 * remounts) and never persisted — a page reload re-unwraps from the
 * conversation's `wrapped_keys` using the device keypair in lib/e2ee.ts.
 */
import { unwrapConversationKey, E2EEUnavailableError } from '@/lib/e2ee'
import { getPubkeys } from '@/lib/communityClient'

/** Raised when a conversation key cannot be recovered on this device. */
export class ConversationKeyError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ConversationKeyError'
  }
}

const cache = new Map<string, CryptoKey>()

/** Remember a freshly generated key (call right after createConversationKey). */
export function registerConversationKey(conversationId: string, key: CryptoKey): void {
  cache.set(conversationId, key)
}

/** Synchronous cache lookup (no unwrap attempt). */
export function getCachedConversationKey(conversationId: string): CryptoKey | undefined {
  return cache.get(conversationId)
}

export interface KeySource {
  conversation_id: string
  created_by: string
  wrapped_keys: Record<string, string>
}

/**
 * Get the conversation key for this device: cache hit, or unwrap our entry in
 * `wrapped_keys` against the creator's published pubkey. Throws
 * ConversationKeyError when this device cannot recover the key (no wrapped
 * entry, creator key unpublished, or the wrap targets another device's key) —
 * callers render the "key unavailable" placeholder instead of crashing.
 */
export async function resolveConversationKey(conv: KeySource, currentUserId: string): Promise<CryptoKey> {
  const hit = cache.get(conv.conversation_id)
  if (hit) return hit

  const wrapped = conv.wrapped_keys?.[currentUserId]
  if (!wrapped) {
    throw new ConversationKeyError('No encryption key was shared with you for this conversation.')
  }

  let creatorPub: JsonWebKey | null = null
  try {
    const keys = await getPubkeys([conv.created_by])
    creatorPub = keys[conv.created_by] ?? null
  } catch {
    throw new ConversationKeyError('Could not fetch the conversation owner’s public key.')
  }
  if (!creatorPub) {
    throw new ConversationKeyError('The conversation owner has not published an encryption key.')
  }

  try {
    const key = await unwrapConversationKey(wrapped, creatorPub)
    cache.set(conv.conversation_id, key)
    return key
  } catch (err) {
    if (err instanceof E2EEUnavailableError) throw new ConversationKeyError(err.message)
    // AES-GCM unwrap failure — usually a key created for a previous device.
    throw new ConversationKeyError('This conversation was encrypted for a different device.')
  }
}
