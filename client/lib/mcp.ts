/**
 * Minimal client for the MongoDB MCP HTTP server (localhost:3100 sidecar).
 * Shared by the auth routes. Mirrors the parsing the agent side does: results
 * come back either as `structuredContent` or as text wrapped in
 * <untrusted-user-data-…> security tags, and tool failures surface via
 * `result.isError` rather than a JSON-RPC error.
 */
const MCP_URL = process.env.MONGODB_MCP_URL ?? 'http://localhost:3100/mcp'

// ── Cached, connected session ────────────────────────────────────────────────
// Opening a session is expensive: `initialize` + `connect` are two round trips
// that (re)authenticate to Atlas. Doing that on every read made community
// search / profile loads take seconds. We open ONE session per server process
// and reuse it. The sidecar keeps session state in memory for its lifetime, and
// it lives/dies with this process (co-located Cloud Run sidecar / local dev), so
// the id stays valid until a restart — at which point the cache clears anyway.
let connectedSession: Promise<string> | null = null

/** A cached, connected MCP session id, reused across calls. Opens once. */
export function mcpConnected(): Promise<string> {
  if (!connectedSession) {
    connectedSession = (async () => {
      const sid = await mcpSession()
      await ensureConnected(sid)
      return sid
    })().catch((err) => {
      connectedSession = null // let the next call retry a fresh handshake
      throw err
    })
  }
  return connectedSession
}

/** Drop the cached session so the next `mcpConnected()` re-handshakes. */
export function resetMcpSession(): void {
  connectedSession = null
}

/** Whether an MCP failure looks like a stale/unknown session (needs re-open). */
function isSessionError(status: number, text: string): boolean {
  if (status === 404 || status === 400) return true
  return /session/i.test(text) && /(not found|unknown|invalid|expired|no valid)/i.test(text)
}

export async function mcpSession(): Promise<string> {
  const res = await fetch(MCP_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 0,
      method: 'initialize',
      params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'hodari-client', version: '1.0' } },
    }),
  })
  const sid = res.headers.get('mcp-session-id')
  if (!sid) throw new Error('MCP did not return a session ID')
  return sid
}

export async function mcpCall(sid: string, name: string, args: Record<string, unknown>): Promise<string[]> {
  const res = await fetch(MCP_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', 'mcp-session-id': sid },
    body: JSON.stringify({ jsonrpc: '2.0', id: '1', method: 'tools/call', params: { name, arguments: args } }),
  })
  const body = await res.text()
  // A stale/unknown session (e.g. sidecar restarted under a cached id) fails
  // here. Clear the cache so the next call re-handshakes, and surface it instead
  // of falling through to a misleading empty result.
  if (!res.ok && isSessionError(res.status, body)) {
    resetMcpSession()
    throw new Error(`MCP session invalid (${res.status}); retry`)
  }
  const payloads = body.includes('data:')
    ? body.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim())
    : [body]
  for (const payload of payloads) {
    let msg: { result?: { content?: Array<{ type: string; text?: string }>; isError?: boolean }; error?: { message?: string } }
    try {
      msg = JSON.parse(payload)
    } catch {
      continue
    }
    if (msg.error) {
      if (isSessionError(res.status, msg.error.message ?? '')) resetMcpSession()
      throw new Error(msg.error.message ?? 'MCP tool error')
    }
    if (msg.result?.content) {
      const texts = msg.result.content.filter((c) => c.type === 'text' && c.text).map((c) => c.text as string)
      if (msg.result.isError) throw new Error(texts.join(' ') || 'MongoDB MCP returned an error')
      return texts
    }
  }
  return []
}

export async function ensureConnected(sid: string): Promise<void> {
  const uri = process.env.MONGODB_URI
  if (!uri) return
  try {
    await mcpCall(sid, 'connect', { connectionString: uri })
  } catch {
    /* already connected — ignore */
  }
}

/** Extract a document array from MCP text items (raw JSON or untrusted-data wrapped). */
export function extractDocs(texts: string[]): Array<Record<string, unknown>> {
  for (const t of texts) {
    try {
      const parsed = JSON.parse(t)
      if (Array.isArray(parsed)) return parsed
    } catch { /* not raw JSON */ }
    const blocks = t.match(/<untrusted-user-data-[^>]+>([\s\S]*?)<\/untrusted-user-data-[^>]+>/g) ?? []
    for (const block of blocks) {
      const inner = block.replace(/<untrusted-user-data-[^>]+>/, '').replace(/<\/untrusted-user-data-[^>]+>/, '').trim()
      try {
        const parsed = JSON.parse(inner)
        if (Array.isArray(parsed)) return parsed
      } catch { /* skip */ }
    }
  }
  return []
}
