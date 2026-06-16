// Throwaway stub of the ADK agent server for LOCAL billing tests only.
// Returns an instant SSE reply so /api/chat succeeds (no refund) and the
// metering counter actually increments — without running the real ~230s
// Gemini pipeline. Not for production; safe to delete.
//
//   node client/scripts/mock-adk.mjs    → listens on :8000 (ADK_BASE_URL)
import { createServer } from 'node:http'

const PORT = process.env.MOCK_ADK_PORT ? Number(process.env.MOCK_ADK_PORT) : 8000

const server = createServer((req, res) => {
  // Session bootstrap: POST /apps/:app/users/:u/sessions/:s
  if (req.method === 'POST' && req.url.includes('/sessions/')) {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end('{}')
    return
  }

  // GET session state (the /api/session route) — return empty state.
  if (req.method === 'GET' && req.url.includes('/sessions/')) {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ state: {} }))
    return
  }

  // The run: POST /run_sse → a quick streamed reply.
  if (req.method === 'POST' && req.url.startsWith('/run_sse')) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    })
    const event = (obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`)
    event({ author: 'hodari', partial: true, content: { parts: [{ text: 'Mock agent here — ' }] } })
    setTimeout(() => {
      event({ author: 'hodari', partial: true, content: { parts: [{ text: 'this is a stubbed reply to test billing/metering.' }] } })
      res.end()
    }, 150)
    return
  }

  res.writeHead(404)
  res.end('not found')
})

server.listen(PORT, () => console.log(`[mock-adk] listening on http://localhost:${PORT}`))
