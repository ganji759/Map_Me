// Diagnostic: is the :3100 Mongo MCP sidecar connected to Atlas?
const URL = 'http://localhost:3100/mcp'
const H = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' }

function parse(body) {
  const lines = body.includes('data:')
    ? body.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim())
    : [body]
  for (const l of lines) { try { return JSON.parse(l) } catch {} }
  return null
}

const init = await fetch(URL, { method: 'POST', headers: H, body: JSON.stringify({ jsonrpc: '2.0', id: 0, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'probe', version: '1' } } }) })
const sid = init.headers.get('mcp-session-id')
console.log('session id:', sid)

async function call(name, args) {
  const res = await fetch(URL, { method: 'POST', headers: { ...H, 'mcp-session-id': sid }, body: JSON.stringify({ jsonrpc: '2.0', id: '1', method: 'tools/call', params: { name, arguments: args } }) })
  return parse(await res.text())
}

const dbs = await call('list-databases', {})
console.log('list-databases:', JSON.stringify(dbs?.result ?? dbs)?.slice(0, 400))
