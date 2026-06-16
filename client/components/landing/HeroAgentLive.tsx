'use client'

import { useEffect, useRef, useState } from 'react'
import { MapPin, Star, ArrowUpRight } from 'lucide-react'
import {
  APIProvider,
  Map3D,
  Marker3D,
  MapMode,
  AltitudeMode,
  useMap3D,
  useMapsLibrary,
} from '@vis.gl/react-google-maps'
import HeroMap from '@/components/landing/HeroMap'

const API_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? ''

/**
 * Cinematic, self-playing hero: the Hodari agent "using" the live Realistic-3D
 * Google map. The cursor types a query, CLICKS send, the camera flies to the
 * result area, glowing pins + a walk-radius circle drop, and a place card slides
 * up. Recorded once (app/rec-hero + scripts/capture-hero.mjs) into the landing
 * page's looping MP4; the public site never loads a live map.
 *
 * RENDER-WAIT is the hard part with photoreal 3D tiles. We solve it in two ways:
 *  1. A WARMUP dry-run flies the full camera path first (no overlays) so every
 *     tile along it is cached before the captured run replays the same path.
 *  2. A handshake: the Director sets `data-hero-phase` and waits on
 *     `window.__heroGo` before the captured sequence, so the recorder can hold
 *     until tiles are network-idle, then release + start capturing in sync.
 *     (Standalone, a timeout releases it so the page still plays.)
 */

const SCENE = { lat: 40.7411, lng: -73.9897, altitude: 0 } // Flatiron, NYC
const PINS = [
  { lat: 40.7414, lng: -73.9894, name: 'Rooftop · La Marea', meta: '4.8 ★ · $$ · 9 min walk' },
  { lat: 40.7397, lng: -73.9869, name: 'Halal grill · Anatolia', meta: '4.7 ★ · $ · 12 min walk' },
  { lat: 40.7385, lng: -73.9921, name: 'Trattoria · Verona', meta: '4.6 ★ · $$ · 6 min walk' },
]
const QUERY = 'Find a halal spot near the stadium and plan my matchday'
const AI_REPLY = 'La Marea — top halal rooftop, 4.8★, 9 min walk. Mapped it for you 🍽️'

// Two framings: a wide establishing shot, then a close push onto the result.
// Both framings sit in the "sharp" zoom range so the OPENING is crisp, not just
// the end. START is only modestly wider than DEST — enough for a visible zoom.
const CAM_START = { center: { lat: 40.73987, lng: -73.98947, altitude: 0 }, range: 1100, tilt: 60, heading: 8 }
const CAM_DEST = { center: { lat: 40.73987, lng: -73.98947, altitude: 0 }, range: 680, tilt: 64, heading: 8 }

type Phase = 'warmup' | 'establishing' | 'typing' | 'send' | 'flying' | 'dropping' | 'card' | 'handoff'

/** Cancellable sleep — resolves early if the run is torn down. */
function makeClock() {
  let cancelled = false
  const timers: ReturnType<typeof setTimeout>[] = []
  return {
    sleep: (ms: number) =>
      new Promise<void>((res) => {
        if (cancelled) return res()
        timers.push(setTimeout(res, ms))
      }),
    get cancelled() { return cancelled },
    cancel() { cancelled = true; timers.forEach(clearTimeout) },
  }
}

/** Resolve when the recorder sets window.__heroGo, or after a standalone timeout. */
function waitForGo(clock: ReturnType<typeof makeClock>, timeoutMs = 600000) {
  return new Promise<void>((res) => {
    let waited = 0
    const tick = () => {
      if (clock.cancelled) return res()
      if ((window as unknown as { __heroGo?: boolean }).__heroGo) return res()
      if (waited >= timeoutMs) return res()
      waited += 100
      setTimeout(tick, 100)
    }
    tick()
  })
}

/** Draws a soft walk-radius ring on the 3D map (maps3d has no Circle). */
function WalkCircle({ center, radiusM, show }: { center: { lat: number; lng: number }; radiusM: number; show: boolean }) {
  const maps3d = useMapsLibrary('maps3d')
  const map3d = useMap3D()
  const polyRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (!maps3d || !map3d) return
    const lib = maps3d as unknown as {
      Polygon3DElement: new (o: google.maps.maps3d.Polygon3DElementOptions) => HTMLElement
      AltitudeMode: typeof google.maps.maps3d.AltitudeMode
    }
    const remove = () => { try { polyRef.current?.remove() } catch { /* gone */ } polyRef.current = null }
    remove()
    if (!show) return

    const n = 72
    const lat0 = (center.lat * Math.PI) / 180
    const ring: google.maps.LatLngLiteral[] = []
    for (let i = 0; i <= n; i++) {
      const ang = (i / n) * 2 * Math.PI
      ring.push({
        lat: center.lat + (radiusM * Math.cos(ang)) / 111320,
        lng: center.lng + (radiusM * Math.sin(ang)) / (111320 * Math.cos(lat0)),
      })
    }
    try {
      const poly = new lib.Polygon3DElement({
        outerCoordinates: ring,
        fillColor: '#F56A0040',
        strokeColor: '#FF8A2A',
        strokeWidth: 11,
        altitudeMode: lib.AltitudeMode.CLAMP_TO_GROUND,
        drawsOccludedSegments: true,
      })
      map3d.append(poly)
      polyRef.current = poly
    } catch { /* older API — skip the ring */ }
    return remove
  }, [maps3d, map3d, show, center.lat, center.lng, radiusM])

  return null
}

/** Runs the warmup dry-run + the scripted, captured choreography.
 *
 * flyCameraTo proved unreliable in this context (silently no-ops), so we drive
 * the camera two ways that DO work: controlled props (onCam → instant, reliable
 * positioning) for the warmup + static establishing shot, and flyCameraAround
 * (smooth, proven) for the cinematic zoom-to-area + orbit. */
function Director({
  onPhase, onVisiblePins, onCardIndex, onCam,
}: {
  onPhase: (p: Phase) => void
  onVisiblePins: (n: number) => void
  onCardIndex: (i: number | null) => void
  onCam: (c: typeof CAM_START | null) => void
}) {
  const map3d = useMap3D()

  useEffect(() => {
    if (!map3d) return // readiness gate; camera is driven via controlled props
    const clock = makeClock()

    // Smooth camera moves via controlled props (reliable; flyCameraTo/Around are
    // flaky here — they silently no-op or lag several seconds).
    const lerp = (a: number, b: number, t: number) => a + (b - a) * t
    const easeInOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2)
    const animateCam = (from: typeof CAM_START, to: typeof CAM_START, duration: number) =>
      new Promise<void>((resolve) => {
        const start = performance.now()
        const step = () => {
          if (clock.cancelled) return resolve()
          const e = easeInOut(Math.min(1, (performance.now() - start) / duration))
          onCam({
            center: { lat: lerp(from.center.lat, to.center.lat, e), lng: lerp(from.center.lng, to.center.lng, e), altitude: 0 },
            range: lerp(from.range, to.range, e),
            tilt: lerp(from.tilt, to.tilt, e),
            heading: lerp(from.heading, to.heading, e),
          })
          if (e < 1) requestAnimationFrame(step); else resolve()
        }
        requestAnimationFrame(step)
      })
    // Gentle continuous orbit (heading drift) at a framing, until cancelled.
    const startOrbit = (base: typeof CAM_START, degPerSec: number) => {
      const start = performance.now()
      const step = () => {
        if (clock.cancelled) return
        const dt = (performance.now() - start) / 1000
        onCam({ ...base, heading: base.heading + degPerSec * dt })
        requestAnimationFrame(step)
      }
      requestAnimationFrame(step)
    }

    const run = async () => {
      // ── WARMUP (not captured): visit DEST then START so both cache. ──
      onPhase('warmup')
      onCam(CAM_DEST)               // snap to the close shot; load its tiles
      await clock.sleep(9000); if (clock.cancelled) return
      onCam(CAM_START)             // establishing shot; dwell long so it fully sharpens
      await clock.sleep(6500); if (clock.cancelled) return

      // Tiles are warm; hold the static establishing shot for the recorder.
      onPhase('establishing')
      await waitForGo(clock); if (clock.cancelled) return

      // ── CAPTURED SEQUENCE (tiles already cached → sharp throughout) ──
      await clock.sleep(1100); if (clock.cancelled) return

      onPhase('typing')             // cursor types the query
      await clock.sleep(2500); if (clock.cancelled) return

      onPhase('send')               // cursor clicks the send button
      await clock.sleep(1100); if (clock.cancelled) return

      // Smooth, immediate zoom to the result area, then a gentle orbit.
      onPhase('flying')
      await animateCam(CAM_START, CAM_DEST, 3200); if (clock.cancelled) return
      startOrbit(CAM_DEST, 3)

      onPhase('dropping')           // marker + walk circle land
      onVisiblePins(1)
      await clock.sleep(900); if (clock.cancelled) return

      onPhase('card')               // result card slides up
      onCardIndex(0)
      await clock.sleep(5200); if (clock.cancelled) return

      onPhase('handoff')            // "drag to explore" hint
    }

    run()
    return () => clock.cancel()
  }, [map3d, onPhase, onVisiblePins, onCardIndex, onCam])

  return null
}

/** The live 3D scene + agent reveal. Mounted only when motion is allowed. */
function Scene() {
  const [phase, setPhase] = useState<Phase>('warmup')
  const [visiblePins, setVisiblePins] = useState(0)
  const [cardIndex, setCardIndex] = useState<number | null>(null)
  const [typed, setTyped] = useState('')
  const [aiTyped, setAiTyped] = useState('')
  // Controlled camera for warmup + static shots; null hands control to the orbit.
  const [cam, setCam] = useState<typeof CAM_START | null>(CAM_START)

  // Expose the phase so the recorder can sync capture to the sequence.
  useEffect(() => { document.documentElement.dataset.heroPhase = phase }, [phase])

  // Type the query out during the 'typing' phase; keep it shown afterwards.
  useEffect(() => {
    if (phase === 'warmup' || phase === 'establishing') { setTyped(''); return }
    if (phase !== 'typing') return
    let i = 0
    const id = setInterval(() => {
      i += 1
      setTyped(QUERY.slice(0, i))
      if (i >= QUERY.length) clearInterval(id)
    }, 34)
    return () => clearInterval(id)
  }, [phase])

  // Type the AI's reply once the result card is up.
  useEffect(() => {
    if (phase !== 'card') return
    let i = 0
    const id = setInterval(() => {
      i += 1
      setAiTyped(AI_REPLY.slice(0, i))
      if (i >= AI_REPLY.length) clearInterval(id)
    }, 28)
    return () => clearInterval(id)
  }, [phase])

  const showChat = phase !== 'warmup' && phase !== 'establishing'
  const showAiReply = (phase === 'card' || phase === 'handoff') && aiTyped.length > 0
  const sending = phase === 'send'
  const afterSend = phase === 'flying' || phase === 'dropping' || phase === 'card' || phase === 'handoff'
  const handoff = phase === 'handoff'

  // Cursor: over the input while typing → onto the send button → onto the result.
  const cursorPos =
    phase === 'typing' ? { left: '26%', top: '85%' }
      : sending ? { left: '75%', top: '85%' }
        : afterSend ? { left: '50%', top: '47%' }
          : { left: '50%', top: '70%' }

  return (
    <div className="absolute inset-0 overflow-hidden">
      <Map3D
        className="h-full w-full"
        defaultCenter={CAM_START.center}
        defaultRange={CAM_START.range}
        defaultTilt={CAM_START.tilt}
        defaultHeading={CAM_START.heading}
        center={cam?.center}
        range={cam?.range}
        tilt={cam?.tilt}
        heading={cam?.heading}
        mode={MapMode.HYBRID}
      >
        {/* One prominent result marker, raised so it clears the rooftops. */}
        {visiblePins >= 1 && (
          <Marker3D
            position={{ lat: CAM_DEST.center.lat, lng: CAM_DEST.center.lng, altitude: 130 }}
            altitudeMode={AltitudeMode.RELATIVE_TO_GROUND}
            extruded
          />
        )}
        <WalkCircle center={CAM_DEST.center} radiusM={180} show={visiblePins >= 1} />
        <Director onPhase={setPhase} onVisiblePins={setVisiblePins} onCardIndex={setCardIndex} onCam={setCam} />
      </Map3D>

      {/* Top gradient so the nav/headline stays readable over the map */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-40 bg-gradient-to-b from-[#0a0a0d]/60 to-transparent" />

      {/* AI agent response bubble — appears once the result is found */}
      <div
        className={`pointer-events-none absolute bottom-[21%] left-1/2 z-20 w-[min(86%,460px)] -translate-x-1/2 transition-all duration-500 ${
          showAiReply ? 'translate-y-0 opacity-100' : 'translate-y-3 opacity-0'
        }`}
      >
        <div className="flex w-fit max-w-full items-start gap-2 rounded-2xl rounded-bl-sm border border-[#F56A00]/25 bg-[#1a120a]/90 px-3 py-2 shadow-[0_8px_30px_rgba(0,0,0,0.5)] backdrop-blur-md">
          <span className="mt-px flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#F56A00] text-[10px] font-bold text-white">H</span>
          <p className="text-[12px] leading-snug text-gray-100">{aiTyped}</p>
        </div>
      </div>

      {/* Faux chat bar — the agent's input */}
      <div
        className={`pointer-events-none absolute bottom-[12%] left-1/2 z-20 w-[min(86%,460px)] -translate-x-1/2 transition-all duration-500 ${
          showChat ? 'translate-y-0 opacity-100' : 'translate-y-4 opacity-0'
        }`}
      >
        <div className="flex items-center gap-2.5 rounded-full border border-white/15 bg-[#15151a]/85 px-4 py-3 shadow-[0_8px_32px_rgba(0,0,0,0.5)] backdrop-blur-md">
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[#F56A00]/15 text-[#F56A00]">
            <MapPin size={14} />
          </span>
          <span className="flex-1 truncate text-[13px] text-gray-100">
            {typed}
            {phase === 'typing' && <span className="ml-0.5 inline-block w-[2px] animate-pulse text-[#F56A00]">|</span>}
          </span>
          {/* Send button — pulses when the cursor "clicks" it */}
          <span className="relative flex h-7 w-7 items-center justify-center">
            {sending && <span className="absolute inset-0 animate-ping rounded-full bg-[#F56A00]/50" />}
            <span
              className={`flex h-7 w-7 items-center justify-center rounded-full bg-[#F56A00] text-white transition-transform duration-200 ${
                sending ? 'scale-90' : 'scale-100'
              }`}
            >
              <ArrowUpRight size={14} />
            </span>
          </span>
        </div>
      </div>

      {/* Animated agent cursor */}
      <div
        className="pointer-events-none absolute z-30 transition-all duration-[1100ms] ease-[cubic-bezier(0.22,1,0.36,1)]"
        style={cursorPos}
        aria-hidden
      >
        <div className="relative -translate-x-1/2 -translate-y-1/2">
          <span className={`absolute inset-0 -m-2 rounded-full bg-[#F56A00]/30 ${sending ? 'animate-ping' : ''}`} />
          <svg width="22" height="22" viewBox="0 0 24 24" className="drop-shadow-[0_2px_4px_rgba(0,0,0,0.5)]">
            <path d="M5 3l14 7-6 2-2 6-6-15z" fill="#fff" stroke="#F56A00" strokeWidth="1.5" strokeLinejoin="round" />
          </svg>
        </div>
      </div>

      {/* Place card — slides up once pins land */}
      {cardIndex != null && (
        <div className="pointer-events-none absolute right-[5%] top-[22%] z-20 w-[min(78%,250px)] translate-y-0 opacity-100 transition-all duration-500">
          <div className="rounded-2xl border border-white/12 bg-[#15151a]/90 p-3 shadow-[0_8px_30px_rgba(0,0,0,0.5)] backdrop-blur">
            <div className="flex items-center gap-1 text-[11px] text-amber-400">
              <Star className="h-3 w-3 fill-amber-400 text-amber-400" />
              {PINS[cardIndex].meta}
            </div>
            <p className="mt-1 text-[13px] font-semibold leading-snug text-white">{PINS[cardIndex].name}</p>
            <p className="mt-0.5 text-[11px] text-gray-400">Grounded by Google Maps · open now</p>
          </div>
        </div>
      )}

      {/* Hand-off hint */}
      <div
        className={`pointer-events-none absolute bottom-[3%] left-1/2 z-20 -translate-x-1/2 transition-opacity duration-700 ${
          handoff ? 'opacity-100' : 'opacity-0'
        }`}
      >
        <span className="rounded-full border border-white/15 bg-black/50 px-3 py-1.5 text-[11px] font-medium text-gray-200 backdrop-blur">
          Drag to explore the city in 3D
        </span>
      </div>
    </div>
  )
}

export default function HeroAgentLive({
  className = '',
  sizeClass = 'aspect-[3/4]',
}: {
  className?: string
  /** Override the intrinsic sizing — e.g. `h-full w-full` when recording. */
  sizeClass?: string
}) {
  const [ready, setReady] = useState(false)
  const [allowed, setAllowed] = useState(false)

  useEffect(() => {
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    setAllowed(!reduce && !!API_KEY)
    setReady(true)
  }, [])

  if (!ready || !allowed) return <HeroMap className={className} />

  return (
    <div className={`${sizeClass} overflow-hidden rounded-3xl bg-[#0a0a0d] shadow-[0_24px_80px_rgba(0,0,0,0.45)] ${className}`}>
      <APIProvider apiKey={API_KEY} libraries={['geometry', 'places']} version="beta">
        <div className="relative h-full w-full">
          <Scene />
        </div>
      </APIProvider>
    </div>
  )
}
