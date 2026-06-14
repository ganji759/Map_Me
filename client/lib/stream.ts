import type { StreamChunk } from './types'

/** Thrown when /api/chat refuses a run because the caller hit a quota gate. */
export class ChatGateError extends Error {
  gate: 'login' | 'paywall'
  entitlement?: unknown
  constructor(gate: 'login' | 'paywall', message: string, entitlement?: unknown) {
    super(message)
    this.name = 'ChatGateError'
    this.gate = gate
    this.entitlement = entitlement
  }
}

const TOOL_LABELS: Record<string, string> = {
  load_user_profile: 'Loading your profile',
  map_control: 'Updating the map',
  hodari_pipeline: 'Running place search (list or plan)',
}

const AGENT_LABELS: Record<string, string> = {
  planner_agent: 'Planning your trip',
  explorer_agent: 'Searching nearby places',
  itinerary_agent: 'Building your itinerary',
}

// Coarse milestones while hodari_pipeline runs inside AgentTool (inner events
// are not streamed). Delays are from pipeline tool-call time, not wall-clock exact.
const PIPELINE_MILESTONES: Array<{ atMs: number; agent: string; label: string }> = [
  { atMs: 0, agent: 'pipeline_intent', label: 'Searching Google Maps (live)' },
  { atMs: 3_000, agent: 'pipeline_search', label: 'Ranking best matches' },
  { atMs: 8_000, agent: 'pipeline_rank', label: 'Calculating walking routes' },
  { atMs: 15_000, agent: 'pipeline_itinerary', label: 'Building your plan' },
  { atMs: 25_000, agent: 'pipeline_present', label: 'Preparing your answer' },
]

function milestoneKey(m: { agent: string; label: string }) {
  return `${m.agent}:${m.label}`
}

async function* streamTextChunks(text: string): AsyncGenerator<StreamChunk> {
  const chunks = text.match(/\S+\s*/g) ?? [text]
  for (const chunk of chunks) {
    yield { type: 'text', text: chunk }
    await new Promise((resolve) => setTimeout(resolve, 18))
  }
}

export async function* streamChat(
  message: string,
  userId: string,
  sessionId: string,
  signal?: AbortSignal,
): AsyncGenerator<StreamChunk> {
  const res = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, userId, sessionId }),
    signal,
  })

  if (res.status === 429) {
    const retryAfter = res.headers.get('Retry-After')
    const wait = retryAfter ? ` Try again in ${retryAfter}s.` : ''
    const msg = await res.json().then((d) => d?.error).catch(() => null)
    throw new Error((msg ?? 'Too many requests. Please slow down.') + wait)
  }
  if (res.status === 401 || res.status === 402) {
    const d = await res.json().catch(() => ({}))
    const gate: 'login' | 'paywall' = d?.gate === 'paywall' ? 'paywall' : res.status === 402 ? 'paywall' : 'login'
    throw new ChatGateError(gate, d?.error ?? 'You’ve reached your limit.', d?.entitlement)
  }
  if (!res.ok || !res.body) {
    throw new Error(`Chat request failed: ${res.status}`)
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  const seenSteps = new Set<string>()
  let streamedText = false
  let pipelineStartedAt: number | null = null
  let nextMilestoneIdx = 0

  function* dueMilestones(): Generator<StreamChunk> {
    if (pipelineStartedAt === null) return
    const elapsed = Date.now() - pipelineStartedAt
    while (
      nextMilestoneIdx < PIPELINE_MILESTONES.length &&
      elapsed >= PIPELINE_MILESTONES[nextMilestoneIdx].atMs
    ) {
      const m = PIPELINE_MILESTONES[nextMilestoneIdx++]
      const key = milestoneKey(m)
      if (!seenSteps.has(key)) {
        seenSteps.add(key)
        yield { type: 'thinking', agent: m.agent, label: m.label }
      }
    }
  }

  function* emitToolStep(name: string): Generator<StreamChunk> {
    const label = TOOL_LABELS[name]
    if (!label || seenSteps.has(name)) return
    seenSteps.add(name)
    yield { type: 'thinking', agent: name, label }
    if (name === 'hodari_pipeline') {
      pipelineStartedAt = Date.now()
      yield* dueMilestones()
    }
  }

  function* emitAgentStep(author: string): Generator<StreamChunk> {
    const label = AGENT_LABELS[author]
    if (!label || seenSteps.has(author)) return
    seenSteps.add(author)
    yield { type: 'thinking', agent: author, label }
  }

  // The read is held across milestone-timeout wake-ups: racing a fresh
  // reader.read() against a timer and discarding the loser DROPS whatever chunk
  // the abandoned read later resolves with — which truncated replies and lost
  // list items. We keep ONE pending read and only clear it once consumed.
  const TIMEOUT = Symbol('timeout')
  let pendingRead: Promise<ReadableStreamReadResult<Uint8Array>> | null = null

  while (true) {
    yield* dueMilestones()

    if (!pendingRead) pendingRead = reader.read()

    let result: ReadableStreamReadResult<Uint8Array> | typeof TIMEOUT
    if (pipelineStartedAt !== null) {
      const wait = PIPELINE_MILESTONES[nextMilestoneIdx]?.atMs ?? Infinity
      const elapsed = Date.now() - pipelineStartedAt
      const delay = Math.max(0, wait - elapsed)
      const timeoutPromise = new Promise<typeof TIMEOUT>((resolve) =>
        setTimeout(() => resolve(TIMEOUT), Number.isFinite(delay) ? delay : 2_147_483_647),
      )
      result = await Promise.race([pendingRead, timeoutPromise])
    } else {
      result = await pendingRead
    }

    // Timeout wake-up — the read is still in flight; loop to emit due
    // milestones and re-await the SAME read (no chunk is dropped).
    if (result === TIMEOUT) continue

    pendingRead = null
    if (result.done) break
    if (!result.value) continue

    buffer += decoder.decode(result.value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue
      const raw = line.slice(6).trim()
      if (!raw || raw === '[DONE]') continue

      try {
        const event = JSON.parse(raw)
        const author = event?.author as string | undefined
        if (!author) continue

        const errMsg: string | undefined = event.errorMessage || event.error
        if (errMsg) {
          if (errMsg.includes('prepayment credits are depleted') || errMsg.includes('prepay')) {
            yield { type: 'text', text: '⚡ Prepay credits depleted. Add credits at aistudio.google.com/projects or switch to a fresh API key.' }
          } else if (errMsg.includes('RESOURCE_EXHAUSTED') || errMsg.includes('quota')) {
            yield { type: 'text', text: '⚡ API quota reached. Switch to a fresh API key or wait for the daily quota to reset at midnight Pacific Time.' }
          } else {
            yield { type: 'text', text: `Something went wrong: ${errMsg.slice(0, 180)}` }
          }
          return
        }

        if (author !== 'hodari') {
          yield* emitAgentStep(author)
          continue
        }

        const parts = event?.content?.parts ?? []
        for (const part of parts) {
          const fnName: string | undefined = part?.functionCall?.name
          if (fnName) {
            yield* emitToolStep(fnName)
            continue
          }
          if (part.text) {
            if (event?.partial === true) {
              streamedText = true
              yield { type: 'text', text: part.text }
            } else if (!streamedText) {
              streamedText = true
              yield* streamTextChunks(part.text)
            }
          }
        }
      } catch {
        // non-JSON SSE line — skip
      }
    }
  }
}

export async function fetchSessionState(
  userId: string,
  sessionId: string,
): Promise<Record<string, unknown>> {
  const res = await fetch(`/api/session?userId=${userId}&sessionId=${sessionId}`)
  if (!res.ok) return {}
  return res.json()
}
