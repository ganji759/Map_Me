/**
 * Google-signed ID token for service-to-service auth (see BILLING.md / P0.3).
 *
 * Lets the frontend call the agent Cloud Run service as its own service account
 * so the agent can be locked down (invoker = frontend SA, drop `allUsers`) and
 * can't be hit directly to bypass the paywall.
 *
 * On Cloud Run the token comes from the instance metadata server. Off-GCP
 * (local dev), the metadata host doesn't resolve, so this returns null and the
 * caller sends no Authorization header — exactly what we want against a local,
 * unauthenticated ADK server.
 */
const METADATA_URL =
  'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/identity'

const cache = new Map<string, { token: string; exp: number }>()

/** Audience for the agent service: its own base URL. */
export function agentAudience(): string {
  return process.env.AGENT_AUDIENCE || process.env.ADK_BASE_URL || ''
}

/** Returns a Google ID token for `audience`, or null when unavailable (dev). */
export async function idTokenFor(audience: string): Promise<string | null> {
  if (!audience || audience.startsWith('http://localhost') || audience.startsWith('http://127.')) return null

  const now = Date.now()
  const hit = cache.get(audience)
  if (hit && hit.exp > now + 60_000) return hit.token

  try {
    const res = await fetch(`${METADATA_URL}?audience=${encodeURIComponent(audience)}`, {
      headers: { 'Metadata-Flavor': 'Google' },
      // Don't hang a request if we're not actually on GCP.
      signal: AbortSignal.timeout(2000),
    })
    if (!res.ok) return null
    const token = (await res.text()).trim()
    if (!token) return null
    // Cloud Run identity tokens last 1h; refresh comfortably before that.
    cache.set(audience, { token, exp: now + 50 * 60_000 })
    return token
  } catch {
    return null
  }
}

/** Build headers for an ADK fetch, attaching the bearer token when available. */
export async function adkAuthHeaders(base: HeadersInit = {}): Promise<HeadersInit> {
  const token = await idTokenFor(agentAudience())
  return token ? { ...base, Authorization: `Bearer ${token}` } : base
}
