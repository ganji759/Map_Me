import { NextRequest, NextResponse } from 'next/server'
import { Modality } from '@google/genai'
import { genai, genaiConfigured, genaiMissingHint } from '@/lib/genaiServer'

// Text-to-speech via the Gemini SDK (Vertex AI or Developer API — see
// lib/genaiServer.ts). Gemini returns raw 16-bit PCM; we wrap it in a WAV header
// so the browser can play it directly. Credentials stay server-side.
export const runtime = 'nodejs'

const TTS_MODEL = process.env.GEMINI_TTS_MODEL ?? 'gemini-3.1-flash-tts-preview'
const TTS_VOICE = process.env.GEMINI_TTS_VOICE ?? 'Kore'

function rateFromMime(mime?: string): number {
  const m = mime?.match(/rate=(\d+)/)
  return m ? parseInt(m[1], 10) : 24000
}

// Minimal 16-bit mono PCM -> WAV container.
function pcmToWav(pcm: Buffer, sampleRate: number, channels = 1, bits = 16): Buffer {
  const blockAlign = (channels * bits) / 8
  const header = Buffer.alloc(44)
  header.write('RIFF', 0)
  header.writeUInt32LE(36 + pcm.length, 4)
  header.write('WAVE', 8)
  header.write('fmt ', 12)
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20) // audio format = PCM
  header.writeUInt16LE(channels, 22)
  header.writeUInt32LE(sampleRate, 24)
  header.writeUInt32LE(sampleRate * blockAlign, 28)
  header.writeUInt16LE(blockAlign, 32)
  header.writeUInt16LE(bits, 34)
  header.write('data', 36)
  header.writeUInt32LE(pcm.length, 40)
  return Buffer.concat([header, pcm])
}

export async function POST(req: NextRequest) {
  const audioHeaders = {
    'Accept-Ranges': 'none',
    'Cache-Control': 'no-store',
  }

  if (!genaiConfigured()) {
    console.warn('speak: Gemini not configured —', genaiMissingHint())
    return NextResponse.json({ error: 'TTS not configured', fallback: 'browser' }, { status: 503 })
  }
  let body: { text?: string; voice?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  const text = (body.text ?? '').slice(0, 2000) // cap to keep latency/cost sane
  if (!text.trim()) {
    return NextResponse.json({ error: 'Missing text' }, { status: 400 })
  }

  try {
    const res = await genai().models.generateContent({
      model: TTS_MODEL,
      contents: [{ role: 'user', parts: [{ text }] }],
      config: {
        responseModalities: [Modality.AUDIO],
        speechConfig: {
          voiceConfig: { prebuiltVoiceConfig: { voiceName: body.voice ?? TTS_VOICE } },
        },
      },
    })

    const audio = res.candidates?.[0]?.content?.parts?.find((p) => p.inlineData)?.inlineData
    if (!audio?.data) {
      return NextResponse.json({ error: 'No audio returned' }, { status: 502 })
    }
    const pcm = Buffer.from(audio.data, 'base64')
    const wav = pcmToWav(pcm, rateFromMime(audio.mimeType ?? undefined))
    return new Response(new Uint8Array(wav), {
      headers: {
        'Content-Type': 'audio/wav',
        'Content-Length': String(wav.length),
        ...audioHeaders,
      },
    })
  } catch (e) {
    console.error('speak failed:', e)
    return NextResponse.json({ error: 'Speech synthesis failed' }, { status: 502 })
  }
}
