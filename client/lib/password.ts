/**
 * Password hashing for email/password sign-in, using Node's built-in scrypt —
 * no external dependency (bcrypt/argon2) needed. Hashes are stored as
 * "scrypt.<N>.<salt>.<hash>" (salt + hash base64url) so the cost params travel
 * with the hash and can be upgraded later without breaking existing users.
 *
 * Node runtime only (uses `node:crypto`). All auth API routes run in Node.
 */
import crypto from 'node:crypto'

// scrypt cost. N=16384 (2^14) is a sane interactive-login default; r/p left at
// library defaults. keylen 64 → 512-bit derived key.
const N = 16384
const KEYLEN = 64

/** Hash a plaintext password → a self-describing "scrypt.N.salt.hash" string. */
export function hashPassword(plain: string): string {
  const salt = crypto.randomBytes(16)
  const derived = crypto.scryptSync(plain, salt, KEYLEN, { N })
  return ['scrypt', String(N), salt.toString('base64url'), derived.toString('base64url')].join('.')
}

/**
 * Constant-time verify a plaintext password against a stored hash. Returns false
 * on any malformed/legacy/absent hash rather than throwing.
 */
export function verifyPassword(plain: string, stored: string | undefined | null): boolean {
  if (!stored) return false
  const parts = stored.split('.')
  if (parts.length !== 4 || parts[0] !== 'scrypt') return false
  const n = Number(parts[1])
  if (!Number.isInteger(n) || n < 2) return false
  try {
    const salt = Buffer.from(parts[2], 'base64url')
    const expected = Buffer.from(parts[3], 'base64url')
    const derived = crypto.scryptSync(plain, salt, expected.length, { N: n })
    return derived.length === expected.length && crypto.timingSafeEqual(derived, expected)
  } catch {
    return false
  }
}

/** Basic email shape check (defense-in-depth; not a full RFC validator). */
export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}
