// Voice I/O for Hodari — speech-to-speech via the Gemini SDK (server-side).
//
// Input:  the mic is recorded in the browser, converted to WAV, and POSTed to
//         /api/voice/transcribe, which runs Gemini speech-to-text.
// Output: reply text is POSTed to /api/voice/speak, which runs Gemini TTS and
//         returns WAV audio that we play here.
//
// The Gemini API key lives only in the server routes, never in the browser.

// ── Capability detection ─────────────────────────────────────────────────────

export function isSpeechInputSupported(): boolean {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return false
  const hasMic = !!navigator.mediaDevices?.getUserMedia
  const hasRecorder = typeof window.MediaRecorder !== 'undefined'
  const hasBrowserStt = createBrowserRecognizer() !== null
  return hasMic && (hasRecorder || hasBrowserStt)
}

export function isSpeechOutputSupported(): boolean {
  return typeof window !== 'undefined' && typeof window.Audio !== 'undefined'
}

// ── Voice activity broadcast (drives the reactive UI bubble) ─────────────────

export type VoiceState = 'listening' | 'thinking' | 'speaking' | 'paused'
export type VoiceActivity = 'idle' | VoiceState
type ActivityListener = (state: VoiceActivity, level: number) => void
type CaptionListener = (caption: string) => void
type LiveTranscriptListener = (text: string) => void

const activityListeners = new Set<ActivityListener>()
const captionListeners = new Set<CaptionListener>()
const liveTranscriptListeners = new Set<LiveTranscriptListener>()
let activityState: VoiceActivity = 'idle'
let activityLevel = 0
let currentCaption = ''
let outputMeterStop: (() => void) | null = null

/** Subscribe to voice activity (state + 0..1 audio level). Returns unsubscribe. */
export function subscribeVoiceActivity(cb: ActivityListener): () => void {
  activityListeners.add(cb)
  cb(activityState, activityLevel) // emit current immediately
  return () => { activityListeners.delete(cb) }
}

export function subscribeVoiceCaptions(cb: CaptionListener): () => void {
  captionListeners.add(cb)
  cb(currentCaption)
  return () => { captionListeners.delete(cb) }
}

export function subscribeLiveTranscript(cb: LiveTranscriptListener): () => void {
  liveTranscriptListeners.add(cb)
  return () => { liveTranscriptListeners.delete(cb) }
}

function emitLiveTranscript(text: string): void {
  liveTranscriptListeners.forEach((l) => l(text))
}

function emitCaption(caption: string): void {
  currentCaption = caption
  captionListeners.forEach((l) => l(caption))
}

export function emitActivity(state: VoiceActivity, level: number): void {
  activityState = state
  activityLevel = level
  activityListeners.forEach((l) => l(state, level))
}

function makeAudioContext(): AudioContext {
  const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
  return new AC()
}

// Real-time RMS level from a source node -> emits 'listening' + level each frame.
let micMeterStop: (() => void) | null = null
function startMicMeter(stream: MediaStream): void {
  try {
    const ctx = makeAudioContext()
    const src = ctx.createMediaStreamSource(stream)
    const analyser = ctx.createAnalyser()
    analyser.fftSize = 256
    src.connect(analyser)
    const data = new Uint8Array(analyser.frequencyBinCount)
    let raf = 0
    const tick = () => {
      analyser.getByteTimeDomainData(data)
      let sum = 0
      for (let i = 0; i < data.length; i++) { const v = (data[i] - 128) / 128; sum += v * v }
      emitActivity('listening', Math.min(1, Math.sqrt(sum / data.length) * 3.2))
      raf = requestAnimationFrame(tick)
    }
    tick()
    micMeterStop = () => {
      cancelAnimationFrame(raf)
      try { analyser.disconnect(); src.disconnect(); ctx.close() } catch { /* noop */ }
    }
  } catch {
    emitActivity('listening', 0)
  }
}
function stopMicMeter(): void {
  if (micMeterStop) { micMeterStop(); micMeterStop = null }
}

function startOutputMeter(audio: HTMLAudioElement): void {
  try {
    const ctx = makeAudioContext()
    const src = ctx.createMediaElementSource(audio)
    const analyser = ctx.createAnalyser()
    analyser.fftSize = 256
    src.connect(analyser)
    analyser.connect(ctx.destination)
    const data = new Uint8Array(analyser.frequencyBinCount)
    let raf = 0
    const tick = () => {
      analyser.getByteFrequencyData(data)
      let sum = 0
      for (let i = 0; i < data.length; i++) sum += data[i]
      emitActivity('speaking', Math.min(1, (sum / data.length) / 120))
      raf = requestAnimationFrame(tick)
    }
    tick()
    outputMeterStop = () => {
      cancelAnimationFrame(raf)
      try { analyser.disconnect(); src.disconnect(); ctx.close() } catch { /* noop */ }
    }
  } catch {
    emitActivity('speaking', 0.45)
  }
}

function stopOutputMeter(): void {
  if (outputMeterStop) { outputMeterStop(); outputMeterStop = null }
}

// ── Browser speech APIs (fallback when Gemini is unavailable) ────────────────

type BrowserSpeechRecognition = {
  continuous: boolean
  interimResults: boolean
  lang: string
  onresult: ((event: { results: { length: number; [i: number]: { 0: { transcript: string } } } }) => void) | null
  onerror: (() => void) | null
  onend: (() => void) | null
  onstart: (() => void) | null
  start: () => void
  stop: () => void
}

function createBrowserRecognizer(): BrowserSpeechRecognition | null {
  if (typeof window === 'undefined') return null
  const w = window as unknown as {
    SpeechRecognition?: new () => BrowserSpeechRecognition
    webkitSpeechRecognition?: new () => BrowserSpeechRecognition
  }
  const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition
  return Ctor ? new Ctor() : null
}

/** Cached after the first status check or Gemini failure — avoids repeated 502s. */
let geminiSttAvailable: boolean | null = null

async function shouldUseGeminiStt(): Promise<boolean> {
  if (geminiSttAvailable === false) return false
  if (geminiSttAvailable === true) return true
  try {
    const res = await fetch('/api/voice/status', { cache: 'no-store' })
    if (!res.ok) {
      geminiSttAvailable = false
      return false
    }
    const body = (await res.json()) as { stt?: string }
    geminiSttAvailable = body.stt === 'gemini'
  } catch {
    geminiSttAvailable = false
  }
  return geminiSttAvailable
}

function markGeminiSttUnavailable(): void {
  geminiSttAvailable = false
}

/** Browser-native STT — no MediaRecorder, avoids mic conflicts with SpeechRecognition. */
async function startBrowserSpeechRecording(): Promise<Recorder> {
  const recognition = createBrowserRecognizer()
  if (!recognition) {
    throw new Error('Browser speech recognition is not supported in this browser.')
  }

  let transcript = ''
  let done = false

  const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
  startMicMeter(stream)

  recognition.continuous = true
  recognition.interimResults = true
  recognition.lang = navigator.language || 'en-US'
  recognition.onresult = (event) => {
    const parts: string[] = []
    for (let i = 0; i < event.results.length; i++) {
      parts.push(event.results[i][0].transcript)
    }
    transcript = parts.join(' ').trim()
    emitLiveTranscript(transcript)
  }

  await new Promise<void>((resolve, reject) => {
    recognition.onstart = () => resolve()
    recognition.onerror = () => reject(new Error('Speech recognition failed to start'))
    try {
      recognition.start()
    } catch (error) {
      reject(error)
    }
  })

  const teardown = () => {
    stream.getTracks().forEach((t) => t.stop())
    stopMicMeter()
    emitActivity('idle', 0)
  }

  return {
    async stop(): Promise<string> {
      if (done) return transcript
      done = true
      return new Promise((resolve) => {
        recognition.onend = () => {
          teardown()
          resolve(transcript)
        }
        recognition.onerror = () => {
          teardown()
          resolve(transcript)
        }
        try {
          recognition.stop()
        } catch {
          teardown()
          resolve(transcript)
        }
      })
    },
    cancel(): void {
      if (done) return
      done = true
      try {
        recognition.stop()
      } catch {
        /* noop */
      }
      teardown()
    },
  }
}

async function startGeminiRecording(): Promise<Recorder> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
  const mimeType = pickMimeType()
  const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
  const chunks: Blob[] = []
  recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data) }
  recorder.start()
  startMicMeter(stream)

  let done = false
  const teardown = () => {
    stream.getTracks().forEach((t) => t.stop())
    stopMicMeter()
    emitActivity('idle', 0)
  }

  return {
    async stop(): Promise<string> {
      if (done) return ''
      done = true
      const blob: Blob | null = await new Promise((resolve) => {
        recorder.onstop = () => resolve(chunks.length ? new Blob(chunks, { type: recorder.mimeType }) : null)
        try { recorder.stop() } catch { resolve(null) }
      })
      teardown()
      if (!blob) return ''
      const wavBase64 = await blobToWavBase64(blob)
      return transcribeWithGemini(wavBase64)
    },
    cancel(): void {
      if (done) return
      done = true
      try { recorder.stop() } catch { /* already stopped */ }
      teardown()
    },
  }
}

async function speakWithBrowser(text: string): Promise<void> {
  if (!('speechSynthesis' in window)) return
  await new Promise<void>((resolve) => {
    const utterance = new SpeechSynthesisUtterance(text)
    utterance.lang = navigator.language || 'en-US'
    utterance.rate = 1
    utterance.onend = () => {
      emitCaption('')
      emitActivity('idle', 0)
      resolve()
    }
    utterance.onerror = () => {
      emitCaption('')
      emitActivity('idle', 0)
      resolve()
    }
    animateCaptions(text, Math.max(2000, text.length * 48))
    emitActivity('speaking', 0.35)
    window.speechSynthesis.cancel()
    window.speechSynthesis.speak(utterance)
  })
}

// ── Speech input (record -> Gemini STT or browser STT) ───────────────────────

export interface Recorder {
  /** Stop recording, transcribe, and resolve the transcript. */
  stop(): Promise<string>
  /** Abort recording and discard audio (no transcription). */
  cancel(): void
}

function pickMimeType(): string | undefined {
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4']
  for (const c of candidates) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(c)) return c
  }
  return undefined
}

/**
 * Begin recording from the mic. Uses Gemini when configured, otherwise browser STT.
 *
 * `preferBrowser` forces the browser SpeechRecognition path (voice mode): it
 * streams interim results so the user sees their words live, and `stop()`
 * resolves instantly instead of round-tripping audio to Gemini — so the spoken
 * message echoes into the chat with no delay. Falls back to the default path if
 * the browser recognizer isn't available.
 */
export async function startRecording(opts?: { preferBrowser?: boolean }): Promise<Recorder> {
  if (opts?.preferBrowser && createBrowserRecognizer()) {
    try {
      return await startBrowserSpeechRecording()
    } catch {
      /* fall back to the default path below */
    }
  }
  if (await shouldUseGeminiStt()) {
    return startGeminiRecording()
  }
  return startBrowserSpeechRecording()
}

async function transcribeWithGemini(wavBase64: string): Promise<string> {
  try {
    const res = await fetch('/api/voice/transcribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ audioBase64: wavBase64, mimeType: 'audio/wav' }),
    })
    if (!res.ok) {
      markGeminiSttUnavailable()
      return ''
    }
    const { text } = await res.json()
    const transcript = (text ?? '').trim()
    if (transcript) return transcript
  } catch {
    markGeminiSttUnavailable()
  }
  return ''
}

// Decode the recorded clip and re-encode as mono 16-bit WAV — a format Gemini
// reliably accepts (browsers record webm/opus, which it does not).
async function blobToWavBase64(blob: Blob): Promise<string> {
  const arrayBuf = await blob.arrayBuffer()
  const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
  const ctx = new AC()
  try {
    const audioBuf = await ctx.decodeAudioData(arrayBuf)
    return arrayBufferToBase64(audioBufferToWav(audioBuf))
  } finally {
    ctx.close()
  }
}

function audioBufferToWav(buf: AudioBuffer): ArrayBuffer {
  const length = buf.length
  const sampleRate = buf.sampleRate
  // Downmix every channel to mono.
  const mono = new Float32Array(length)
  for (let ch = 0; ch < buf.numberOfChannels; ch++) {
    const data = buf.getChannelData(ch)
    for (let i = 0; i < length; i++) mono[i] += data[i] / buf.numberOfChannels
  }

  const bytesPerSample = 2
  const out = new ArrayBuffer(44 + length * bytesPerSample)
  const view = new DataView(out)
  const writeStr = (off: number, s: string) => { for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i)) }

  writeStr(0, 'RIFF')
  view.setUint32(4, 36 + length * bytesPerSample, true)
  writeStr(8, 'WAVE')
  writeStr(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)            // PCM
  view.setUint16(22, 1, true)            // mono
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * bytesPerSample, true)
  view.setUint16(32, bytesPerSample, true)
  view.setUint16(34, 16, true)
  writeStr(36, 'data')
  view.setUint32(40, length * bytesPerSample, true)

  let off = 44
  for (let i = 0; i < length; i++) {
    const s = Math.max(-1, Math.min(1, mono[i]))
    view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true)
    off += 2
  }
  return out
}

function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf)
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}

// ── Speech output (Gemini TTS -> play) ───────────────────────────────────────

/** Natural speech intro: repeat the user's words, then Hodari's answer. */
export function formatSpokenReply(userText: string, assistantMarkdown: string): string {
  const question = toSpeakable(userText)
  const answer = toSpeakable(assistantMarkdown)
  if (!question) return answer
  if (!answer) return `You said: ${question}.`
  return `You said: ${question}. ${answer}`
}

// Strip markdown / emoji so the spoken text sounds natural.
function toSpeakable(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[*_#>~]/g, '')
    .replace(/^\s*\d+\.\s*/gm, '')
    .replace(/^\s*[-•›]\s*/gm, '')
    .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}]/gu, '')
    .replace(/\n{2,}/g, '. ')
    .replace(/\s+/g, ' ')
    .trim()
}

let currentAudio: HTMLAudioElement | null = null
let currentCaptionRaf = 0
let speechCancelled = false
let speechPaused = false
let playbackCancelResolve: (() => void) | null = null

/** Speak Hodari's reply aloud, echoing what the user said first. */
export async function speakReply(userText: string, assistantMarkdown: string): Promise<void> {
  return speak(formatSpokenReply(userText, assistantMarkdown))
}

/** Speak text aloud via Gemini TTS (browser SpeechSynthesis as fallback). */
export async function speak(markdown: string): Promise<void> {
  if (!isSpeechOutputSupported()) return
  const text = toSpeakable(markdown)
  if (!text) return
  cancelSpeech()
  speechCancelled = false
  speechPaused = false

  try {
    const chunks = chunkSpeakableText(text)
    let spoken = ''
    let playedAny = false
    for (const chunk of chunks) {
      if (speechCancelled) break
      const res = await fetch('/api/voice/speak', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: chunk }),
      })
      if (!res.ok) continue
      const buf = await res.arrayBuffer()
      if (buf.byteLength < 128) continue
      const blob = new Blob([buf], { type: 'audio/wav' })
      spoken = `${spoken} ${chunk}`.trim()
      playedAny = true
      await playAudioBlob(blob, spoken)
      if (speechCancelled) break
    }
    if (!speechCancelled && !playedAny) {
      console.warn(
        '[voice] Vertex/Gemini TTS unavailable — set GOOGLE_GENAI_USE_VERTEXAI=TRUE, ' +
          'GOOGLE_CLOUD_PROJECT, and run: gcloud auth application-default login',
      )
    }
  } catch (err) {
    console.warn('[voice] TTS request failed:', err)
  } finally {
    if (!speechCancelled && !speechPaused) {
      emitCaption('')
      emitActivity('idle', 0)
    }
  }
}

/** Pause Hodari's speech without cancelling the session or losing context. */
export function pauseSpeech(): boolean {
  if (!currentAudio || speechCancelled) return false
  speechPaused = true
  try {
    currentAudio.pause()
  } catch {
    return false
  }
  stopOutputMeter()
  emitActivity('paused', 0)
  return true
}

/** Resume speech after pause. */
export function resumeSpeech(): boolean {
  if (!currentAudio || speechCancelled || !speechPaused) return false
  speechPaused = false
  void currentAudio.play().then(() => {
    if (currentAudio && !speechCancelled) {
      emitActivity('speaking', 0.4)
      startOutputMeter(currentAudio)
    }
  }).catch(() => {
    speechPaused = false
  })
  return true
}

/** Stop speech immediately (alias used by voice UI controls). */
export function stopSpeech(): void {
  cancelSpeech()
}

export function isSpeechPaused(): boolean {
  return speechPaused
}

export function cancelSpeech(): void {
  speechCancelled = true
  speechPaused = false
  cancelAnimationFrame(currentCaptionRaf)
  currentCaptionRaf = 0
  stopOutputMeter()
  if (currentAudio) {
    try { currentAudio.pause() } catch { /* noop */ }
    currentAudio = null
  }
  playbackCancelResolve?.()
  playbackCancelResolve = null
  emitCaption('')
  emitActivity('idle', 0)
}

function chunkSpeakableText(text: string): string[] {
  const sentences = text.match(/[^.!?]+[.!?]*/g)?.map((s) => s.trim()).filter(Boolean) ?? [text]
  const chunks: string[] = []
  let current = ''
  for (const sentence of sentences) {
    if ((current + ' ' + sentence).trim().length > 260 && current) {
      chunks.push(current)
      current = sentence
    } else {
      current = `${current} ${sentence}`.trim()
    }
  }
  if (current) chunks.push(current)
  return chunks
}

function animateCaptions(text: string, durationMs: number): void {
  cancelAnimationFrame(currentCaptionRaf)
  const words = text.split(/\s+/).filter(Boolean)
  const startedAt = performance.now()
  const tick = () => {
    const elapsed = performance.now() - startedAt
    const count = Math.max(1, Math.min(words.length, Math.ceil((elapsed / Math.max(durationMs, 1)) * words.length)))
    emitCaption(words.slice(0, count).join(' '))
    if (count < words.length) currentCaptionRaf = requestAnimationFrame(tick)
  }
  tick()
}

function playAudioBlob(blob: Blob, captionText: string): Promise<void> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob)
    const audio = new Audio(url)
    currentAudio = audio
    const cleanup = () => {
      playbackCancelResolve = null
      cancelAnimationFrame(currentCaptionRaf)
      currentCaptionRaf = 0
      stopOutputMeter()
      URL.revokeObjectURL(url)
      if (currentAudio === audio) currentAudio = null
      resolve()
    }
    playbackCancelResolve = cleanup
    audio.onloadedmetadata = () => {
      animateCaptions(captionText, Number.isFinite(audio.duration) ? audio.duration * 1000 : Math.max(1500, captionText.length * 45))
    }
    audio.onended = () => {
      speechPaused = false
      cleanup()
    }
    audio.onerror = cleanup
    audio.onplay = () => {
      if (currentAudio === audio && !speechPaused) {
        emitActivity('speaking', 0.4)
        startOutputMeter(audio)
      }
    }
    audio.play().catch(cleanup)
  })
}
