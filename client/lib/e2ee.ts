/**
 * Client-side end-to-end encryption for community messaging (WebCrypto only —
 * safe to import from 'use client' components; never import on the server).
 *
 * Scheme (v1, device-bound):
 * - Each device holds one ECDH P-256 keypair. The public JWK is published via
 *   PUT /api/community/profile { pubkey }; the private key never leaves the
 *   device (stored non-extractable in IndexedDB where possible, falling back
 *   to an extractable JWK in localStorage).
 * - Each conversation has a random AES-GCM-256 key. The creator wraps it once
 *   per member with an AES-GCM key derived from ECDH(creator_private,
 *   member_public); members unwrap with ECDH(member_private, creator_public).
 *   Wrapped keys live on the conversation doc — the server only ever sees
 *   opaque base64.
 * - Every message is AES-GCM encrypted with a fresh 12-byte IV. The server
 *   stores ciphertext + IV only.
 *
 * Known v1 limitations (accepted, stated honestly):
 * - Keys are DEVICE-BOUND: signing in on a new device generates a new keypair,
 *   so the new device cannot decrypt existing history, and conversations
 *   started against the old pubkey can't be unwrapped there.
 * - No forward secrecy ratchet: one conversation key encrypts the whole
 *   thread; compromising it exposes the full thread.
 * - No key verification (safety numbers): the server is trusted to serve the
 *   right pubkeys (a malicious server could MITM new conversations).
 *
 * When WebCrypto or a secure context is missing, helpers throw
 * E2EEUnavailableError so the UI can explain instead of silently failing.
 */

/** Thrown when the environment can't do E2EE (no WebCrypto / insecure context / no key storage). */
export class E2EEUnavailableError extends Error {
  constructor(message = 'End-to-end encryption is unavailable in this browser (WebCrypto requires a secure context).') {
    super(message)
    this.name = 'E2EEUnavailableError'
  }
}

const ECDH_PARAMS: EcKeyGenParams = { name: 'ECDH', namedCurve: 'P-256' }
const IDB_NAME = 'hodari-e2ee'
const IDB_STORE = 'keys'
const IDB_KEY = 'device-keypair-v1'
const LS_KEY = 'hodari_e2ee_keypair_v1'
const IV_BYTES = 12

interface StoredKeypair {
  privateKey: CryptoKey
  publicJwk: JsonWebKey
}

let cachedKeypair: StoredKeypair | null = null

// ── Environment guards ───────────────────────────────────────────────────────

function subtle(): SubtleCrypto {
  if (typeof globalThis === 'undefined' || !globalThis.crypto?.subtle) throw new E2EEUnavailableError()
  if (typeof window !== 'undefined' && window.isSecureContext === false) {
    throw new E2EEUnavailableError('Encryption needs HTTPS or localhost. This page is not secure.')
  }
  return globalThis.crypto.subtle
}

// ── Base64 helpers (chunked — image payloads can be hundreds of KB) ──────────

function toB64(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf)
  let bin = ''
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return btoa(bin)
}

function fromB64(b64: string): Uint8Array<ArrayBuffer> {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

function randomIv(): Uint8Array<ArrayBuffer> {
  return globalThis.crypto.getRandomValues(new Uint8Array(IV_BYTES))
}

// ── IndexedDB persistence (preferred: stores a non-extractable CryptoKey) ────

function idbOpen(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new E2EEUnavailableError('IndexedDB is unavailable.'))
      return
    }
    const req = indexedDB.open(IDB_NAME, 1)
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(IDB_STORE)) req.result.createObjectStore(IDB_STORE)
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'))
  })
}

async function idbGet<T>(key: string): Promise<T | undefined> {
  const db = await idbOpen()
  try {
    return await new Promise<T | undefined>((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readonly')
      const req = tx.objectStore(IDB_STORE).get(key)
      req.onsuccess = () => resolve(req.result as T | undefined)
      req.onerror = () => reject(req.error ?? new Error('IndexedDB read failed'))
    })
  } finally {
    db.close()
  }
}

async function idbPut(key: string, value: unknown): Promise<void> {
  const db = await idbOpen()
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readwrite')
      tx.objectStore(IDB_STORE).put(value, key)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error ?? new Error('IndexedDB write failed'))
    })
  } finally {
    db.close()
  }
}

// ── Device keypair ───────────────────────────────────────────────────────────

async function loadKeypair(): Promise<StoredKeypair | null> {
  if (cachedKeypair) return cachedKeypair
  const s = subtle()

  // Preferred store: IndexedDB with a structured-cloned (often non-extractable) key.
  try {
    const stored = await idbGet<StoredKeypair>(IDB_KEY)
    if (stored?.privateKey && stored.publicJwk) {
      cachedKeypair = stored
      return stored
    }
  } catch { /* IndexedDB unavailable — try localStorage */ }

  // Fallback store: extractable JWK pair in localStorage.
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(LS_KEY) : null
    if (raw) {
      const parsed = JSON.parse(raw) as { publicJwk: JsonWebKey; privateJwk: JsonWebKey }
      const privateKey = await s.importKey('jwk', parsed.privateJwk, ECDH_PARAMS, false, ['deriveKey', 'deriveBits'])
      cachedKeypair = { privateKey, publicJwk: parsed.publicJwk }
      return cachedKeypair
    }
  } catch { /* corrupt / unavailable — treat as absent */ }

  return null
}

/**
 * Get-or-create this device's ECDH P-256 keypair and return the PUBLIC JWK,
 * ready to publish via PUT /api/community/profile { pubkey }. The private key
 * stays on-device (non-extractable in IndexedDB when possible).
 */
export async function ensureKeypair(): Promise<JsonWebKey> {
  const existing = await loadKeypair()
  if (existing) return existing.publicJwk
  const s = subtle()

  // Preferred: non-extractable private key persisted via IndexedDB structured clone.
  try {
    const pair = await s.generateKey(ECDH_PARAMS, false, ['deriveKey', 'deriveBits'])
    const publicJwk = await s.exportKey('jwk', pair.publicKey)
    const stored: StoredKeypair = { privateKey: pair.privateKey, publicJwk }
    await idbPut(IDB_KEY, stored)
    cachedKeypair = stored
    return publicJwk
  } catch { /* IndexedDB unavailable — fall through */ }

  // Fallback: extractable keypair, private JWK in localStorage. Weaker (any JS
  // on the origin can read it) but keeps E2EE working where IDB is blocked.
  const pair = await s.generateKey(ECDH_PARAMS, true, ['deriveKey', 'deriveBits'])
  const publicJwk = await s.exportKey('jwk', pair.publicKey)
  const privateJwk = await s.exportKey('jwk', pair.privateKey)
  try {
    localStorage.setItem(LS_KEY, JSON.stringify({ publicJwk, privateJwk }))
  } catch {
    throw new E2EEUnavailableError('No persistent key storage available (IndexedDB and localStorage both failed).')
  }
  cachedKeypair = { privateKey: pair.privateKey, publicJwk }
  return publicJwk
}

/** AES-GCM key derived from ECDH(our private, their public) — used only to wrap/unwrap. */
async function deriveWrappingKey(privateKey: CryptoKey, peerPubJwk: JsonWebKey): Promise<CryptoKey> {
  const s = subtle()
  const peerPub = await s.importKey('jwk', peerPubJwk, ECDH_PARAMS, false, [])
  return s.deriveKey({ name: 'ECDH', public: peerPub }, privateKey, { name: 'AES-GCM', length: 256 }, false, [
    'encrypt',
    'decrypt',
  ])
}

/**
 * Generate a fresh AES-GCM-256 conversation key and wrap it for every member.
 * `memberPubkeys` maps user_id → published public JWK and MUST include the
 * caller's own uid + pubkey (so the creator can decrypt their own thread).
 * Returns the live key (use it to encrypt immediately) plus the base64 wrapped
 * map to store as the conversation's `wrapped_keys`.
 */
export async function createConversationKey(
  memberPubkeys: Record<string, JsonWebKey>,
): Promise<{ key: CryptoKey; wrappedKeys: Record<string, string> }> {
  const s = subtle()
  const me = await loadKeypair()
  if (!me) throw new E2EEUnavailableError('No device key yet. Call ensureKeypair() first.')

  const convKey = await s.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt'])
  const raw = await s.exportKey('raw', convKey)

  const wrappedKeys: Record<string, string> = {}
  for (const [uid, pubJwk] of Object.entries(memberPubkeys)) {
    const wrapKey = await deriveWrappingKey(me.privateKey, pubJwk)
    const iv = randomIv()
    const ct = await s.encrypt({ name: 'AES-GCM', iv }, wrapKey, raw)
    // Payload layout: iv (12 bytes) || ciphertext.
    const buf = new Uint8Array(iv.length + ct.byteLength)
    buf.set(iv, 0)
    buf.set(new Uint8Array(ct), iv.length)
    wrappedKeys[uid] = toB64(buf)
  }
  return { key: convKey, wrappedKeys }
}

/**
 * Unwrap this device's copy of a conversation key. `wrapped` is our entry from
 * the conversation's `wrapped_keys`; `creatorPubJwk` is the creator's published
 * pubkey (GET /api/community/keys) — ECDH gives both sides the same secret.
 */
export async function unwrapConversationKey(wrapped: string, creatorPubJwk: JsonWebKey): Promise<CryptoKey> {
  const s = subtle()
  const me = await loadKeypair()
  if (!me) {
    throw new E2EEUnavailableError('No device key here. History encrypted for another device can\'t be read here.')
  }
  const wrapKey = await deriveWrappingKey(me.privateKey, creatorPubJwk)
  const buf = fromB64(wrapped)
  if (buf.length <= IV_BYTES) throw new E2EEUnavailableError('Malformed wrapped key.')
  const iv = buf.subarray(0, IV_BYTES)
  const ct = buf.subarray(IV_BYTES)
  const raw = await s.decrypt({ name: 'AES-GCM', iv }, wrapKey, ct)
  return s.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt'])
}

// ── Message encryption ───────────────────────────────────────────────────────

export interface EncryptedPayload {
  /** Base64 AES-GCM ciphertext — what gets POSTed as the message body. */
  ciphertext: string
  /** Base64 12-byte IV, fresh per message. */
  iv: string
}

/** Encrypt raw bytes (e.g. image data) with a fresh 12-byte IV. */
export async function encryptBytes(key: CryptoKey, bytes: Uint8Array | ArrayBuffer): Promise<EncryptedPayload> {
  const s = subtle()
  const iv = randomIv()
  // Copy into a fresh (ArrayBuffer-backed) view — also satisfies BufferSource
  // typing for callers passing SharedArrayBuffer-typed views.
  const data = bytes instanceof Uint8Array ? new Uint8Array(bytes) : new Uint8Array(bytes)
  const ct = await s.encrypt({ name: 'AES-GCM', iv }, key, data)
  return { ciphertext: toB64(ct), iv: toB64(iv) }
}

/** Decrypt to raw bytes. Throws (DOMException) if the key or payload is wrong. */
export async function decryptBytes(key: CryptoKey, ciphertext: string, iv: string): Promise<Uint8Array> {
  const s = subtle()
  const raw = await s.decrypt({ name: 'AES-GCM', iv: fromB64(iv) }, key, fromB64(ciphertext))
  return new Uint8Array(raw)
}

/** Encrypt a text message with a fresh 12-byte IV. */
export async function encryptText(key: CryptoKey, text: string): Promise<EncryptedPayload> {
  return encryptBytes(key, new TextEncoder().encode(text))
}

/** Decrypt a text message. */
export async function decryptText(key: CryptoKey, ciphertext: string, iv: string): Promise<string> {
  return new TextDecoder().decode(await decryptBytes(key, ciphertext, iv))
}
