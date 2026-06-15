/**
 * Symmetric encryption for secrets stored at rest (Google Calendar refresh
 * tokens). AES-256-GCM with a key derived from HODARI_SESSION_SECRET, so a DB
 * read alone never exposes a usable token. Node runtime only.
 */
import crypto from 'node:crypto'

const SECRET = process.env.HODARI_SESSION_SECRET ?? ''

function key(): Buffer {
  // Derive a stable 32-byte key from the session secret.
  return crypto.createHash('sha256').update(SECRET).digest()
}

/** Encrypt → "iv.tag.ciphertext" (all base64url). Throws if no secret. */
export function encryptSecret(plain: string): string {
  if (!SECRET) throw new Error('HODARI_SESSION_SECRET is not configured')
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv)
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return [iv.toString('base64url'), tag.toString('base64url'), enc.toString('base64url')].join('.')
}

/** Decrypt a blob from `encryptSecret`. Returns null on any tampering/error. */
export function decryptSecret(blob: string | undefined | null): string | null {
  if (!blob || !SECRET) return null
  try {
    const [ivB, tagB, encB] = blob.split('.')
    if (!ivB || !tagB || !encB) return null
    const decipher = crypto.createDecipheriv('aes-256-gcm', key(), Buffer.from(ivB, 'base64url'))
    decipher.setAuthTag(Buffer.from(tagB, 'base64url'))
    return Buffer.concat([decipher.update(Buffer.from(encB, 'base64url')), decipher.final()]).toString('utf8')
  } catch {
    return null
  }
}
