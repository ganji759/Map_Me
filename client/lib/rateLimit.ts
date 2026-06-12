/**
 * In-memory token-bucket rate limiter.
 *
 * Scope note: state lives in this module's memory, so limits are enforced
 * PER Cloud Run instance. With a low `--max-instances` (typical for this app)
 * that is effectively global; if you scale out horizontally, swap the `buckets`
 * Map for a shared store (Upstash/Redis) behind the same `rateLimit()` shape.
 *
 * A token bucket allows short bursts (up to `capacity`) while capping the
 * sustained rate at `refillPerSec` tokens/sec. Each request spends one token.
 */

export interface RateLimitRule {
  /** Max burst — how many requests can arrive back-to-back. */
  capacity: number
  /** Sustained refill rate in tokens per second. */
  refillPerSec: number
}

export interface RateLimitResult {
  allowed: boolean
  /** Tokens left in the bucket after this request (floored). */
  remaining: number
  /** Seconds until the next token is available (0 when allowed). */
  retryAfterSec: number
  /** Effective per-minute limit, for the `RateLimit-Limit` header. */
  limitPerMin: number
}

interface Bucket {
  tokens: number
  updatedAt: number
}

const buckets = new Map<string, Bucket>()

// Bound memory: once we cross this many keys, drop buckets that have fully
// refilled (i.e. the client has been idle long enough to be back to full).
const MAX_KEYS = 10_000

function sweep(now: number) {
  for (const [key, bucket] of buckets) {
    // A bucket idle long enough to fully refill carries no state worth keeping.
    if ((now - bucket.updatedAt) / 1000 > 3600) buckets.delete(key)
  }
}

/**
 * Consume one token for `key` under `rule`. Pure-ish: the only side effect is
 * the in-memory bucket update. Safe to call on every request.
 */
export function rateLimit(key: string, rule: RateLimitRule): RateLimitResult {
  const now = Date.now()
  const limitPerMin = Math.round(rule.refillPerSec * 60)

  if (buckets.size > MAX_KEYS) sweep(now)

  let bucket = buckets.get(key)
  if (!bucket) {
    bucket = { tokens: rule.capacity, updatedAt: now }
    buckets.set(key, bucket)
  } else {
    // Refill based on elapsed time, capped at capacity.
    const elapsedSec = (now - bucket.updatedAt) / 1000
    bucket.tokens = Math.min(rule.capacity, bucket.tokens + elapsedSec * rule.refillPerSec)
    bucket.updatedAt = now
  }

  if (bucket.tokens >= 1) {
    bucket.tokens -= 1
    return {
      allowed: true,
      remaining: Math.floor(bucket.tokens),
      retryAfterSec: 0,
      limitPerMin,
    }
  }

  // Not enough tokens — compute how long until one more refills.
  const needed = 1 - bucket.tokens
  const retryAfterSec = Math.ceil(needed / rule.refillPerSec)
  return {
    allowed: false,
    remaining: 0,
    retryAfterSec,
    limitPerMin,
  }
}
