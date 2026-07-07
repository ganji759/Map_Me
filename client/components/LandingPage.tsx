'use client'

import { useState, useCallback, useRef, useEffect } from 'react'
import dynamic from 'next/dynamic'
import { MessageSquare, Mic } from 'lucide-react'
import { ChatPanel } from '@/components/ChatPanel'
import { MapView, type RouteInfo } from '@/components/MapView'
import { PlaceCardStrip } from '@/components/PlaceCardStrip'
import { CollapsedReply } from '@/components/CollapsedReply'
import { PlaceDetailsPanel } from '@/components/PlaceDetailsPanel'
import { streamChat, fetchSessionState, ChatGateError } from '@/lib/stream'
import Paywall, { type GateState } from '@/components/Paywall'
import { VoiceOrb } from '@/components/VoiceOrb'
import { MobileChatSheet, SHEET_PEEK_PX, type SheetSnap } from '@/components/MobileChatSheet'
import { useIsMobile } from '@/hooks/useIsMobile'
import {
  isValidCoord,
  pinsFarFromUser,
  queryGeoPermission,
  requestUserLocationDetailed,
} from '@/lib/geo'
import {
  applyMapActions,
  applyAnnotationActions,
  parseMapActions,
  shouldAttachGps,
  EMPTY_ANNOTATIONS,
  type CustomRouteConfig,
  type MapActionEffects,
  type MapAnnotations,
  type TravelMode,
} from '@/lib/mapActions'
import {
  findPlaceIndexInText,
  isKeepOnlyRequest,
  isNamedKeepOnlyRequest,
  isListPickRequest,
  isNewSearchRequest,
  isZoomFocusRequest,
  resolvePlaceIndex,
} from '@/lib/mapIntents'
import { stripEmDashes } from '@/lib/text'
import { speak, cancelSpeech, isSpeechOutputSupported } from '@/lib/voice'
import { useVoice } from '@/hooks/useVoice'
import { type ModelId } from '@/components/ModelSwitcher'
import { useCommunityMapLayer } from '@/components/community/useCommunityMapLayer'
import type { ChatMessage, Place, Itinerary, ItineraryStop, Theme } from '@/lib/types'

// Community UI is lazy-loaded: the chunks (panel, profile sheet, share picker,
// E2EE machinery) only download the first time a community surface opens, so
// the core map/chat path pays ~zero cost when unused.
const CommunityPanel = dynamic(
  () => import('@/components/community/CommunityPanel').then((m) => m.CommunityPanel),
  { ssr: false },
)
const ProfileSheet = dynamic(
  () => import('@/components/community/profile/ProfileSheet').then((m) => m.ProfileSheet),
  { ssr: false },
)
const SharePinDialog = dynamic(
  () => import('@/components/community/SharePinDialog').then((m) => m.SharePinDialog),
  { ssr: false },
)

function uid() { return Math.random().toString(36).slice(2) }

function isMapShowRequest(text: string): boolean {
  const t = text.toLowerCase()
  if (/\b(on (the |this )?map|on your map|in the map)\b/.test(t)) return true
  if (/\b(show|see|view|put|pin|display)\b/.test(t) && /\b(map|pins?|them|these|places)\b/.test(t)) return true
  if (/\bwhere (are|is) (they|them|it)\b/.test(t)) return true
  if (/\b(can't you|can you|could you).*\b(map|pins?)\b/.test(t)) return true
  return false
}

function isHideLocationRequest(text: string): boolean {
  const t = text.toLowerCase()
  return /\b(hide|don't show|do not show|remove)\b.{0,30}\b(my )?(location|gps|position)\b/.test(t)
}

function wantsRouteFromUser(text: string): boolean {
  const t = text.toLowerCase()
  if (/\b(do not|don't|not)\b.{0,25}\b(route|from me|from my)\b/.test(t)) return false
  if (/\b(without|ignore)\b.{0,15}\b(my (location|gps)|routing from me)\b/.test(t)) return false
  return (
    /\b(route|directions|how (do|to) (i )?get|how to go|plan my (route|way)|navigate)\b/.test(t)
    || /\b(from my (location|actual location)|using my location|from where i am)\b/.test(t)
    || /\b(go there|get there|show me how)\b/.test(t)
    || /\bdistance\b/.test(t)
    || /\broute from me\b/.test(t)
  )
}

function parseCandidates(raw: unknown): Place[] | null {
  try {
    const str = typeof raw === 'string' ? raw : JSON.stringify(raw)
    const clean = str.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '').trim()
    if (!clean || clean === '[]' || clean === '""') return null
    const parsed = JSON.parse(clean) as Place[]
    return Array.isArray(parsed) && parsed.length > 0 ? parsed : null
  } catch {
    return null
  }
}

function parseItinerary(raw: unknown): Itinerary | null {
  try {
    const str = typeof raw === 'string' ? raw : JSON.stringify(raw)
    const clean = str.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '').trim()
    if (!clean || clean === '""' || clean === '{}' || clean === '{"stops":[]}') return null
    const it = JSON.parse(clean) as Itinerary
    if (Array.isArray(it?.stops)) {
      const seen = new Set<string>()
      it.stops = it.stops.filter((s) => {
        if (!s.place_id) return true
        if (seen.has(s.place_id)) return false
        seen.add(s.place_id)
        return true
      })
    }
    if (it?.voice_summary) it.voice_summary = stripEmDashes(it.voice_summary)
    it?.stops?.forEach((s) => { if (s.rationale) s.rationale = stripEmDashes(s.rationale) })
    return it
  } catch {
    return null
  }
}

const USER_ID = typeof window !== 'undefined'
  ? (localStorage.getItem('hodari_uid') ?? (() => {
      const id = uid(); localStorage.setItem('hodari_uid', id); return id
    })())
  : 'anon'

interface HistoryItem {
  id: string
  title: string
  updatedAt: number
  messages: ChatMessage[]
}

export default function LandingPage() {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [gate, setGate] = useState<GateState | null>(null)

  // Acknowledge a return from Stripe Checkout and strip the query param so a
  // refresh doesn't re-trigger it. Credits land via the webhook; they apply on
  // the next generation.
  useEffect(() => {
    if (typeof window === 'undefined') return
    const purchase = new URLSearchParams(window.location.search).get('purchase')
    if (!purchase) return
    if (purchase === 'success') {
      setMessages((prev) => [
        ...prev,
        { id: uid(), role: 'assistant', content: '✓ Payment received — your credits are ready. Ask away!' },
      ])
    }
    window.history.replaceState({}, '', window.location.pathname)
  }, [])
  const [userName] = useState(() =>
    typeof window !== 'undefined'
      ? (localStorage.getItem('hodari_name') || localStorage.getItem('hodari_email') || '')
      : '',
  )
  const [historyItems, setHistoryItems] = useState<HistoryItem[]>([])
  const [historyLoaded, setHistoryLoaded] = useState(false)
  const [loading, setLoading] = useState(false)
  const [thinkingSteps, setThinkingSteps] = useState<string[]>([])
  const [streamingStarted, setStreamingStarted] = useState(false)
  const streamingStartedRef = useRef(false)
  const [places, setPlaces] = useState<Place[]>([])
  const [itinerary, setItinerary] = useState<Itinerary | null>(null)
  const [activeStop, setActiveStop] = useState<number | null>(null)
  const [mapVisible, setMapVisible] = useState(false)
  const [mapExpanded, setMapExpanded] = useState(false)
  const [chatCollapsed, setChatCollapsed] = useState(false)
  const [uiMode, setUiMode] = useState<'chat' | 'voice'>('chat')
  const [chatWidth, setChatWidth] = useState(380)
  const resizingRef = useRef(false)
  // ── Mobile (<768px): map is the base layer, chat is a draggable bottom sheet
  const isMobile = useIsMobile()
  const [chatSnap, setChatSnap] = useState<SheetSnap>('half')
  const [selectedModel, setSelectedModel] = useState<ModelId>('gemini-3.5')
  const [theme, setTheme] = useState<Theme>(() => {
    if (typeof window === 'undefined') return 'light'
    const saved = localStorage.getItem('hodari_theme')
    return saved === 'dark' ? 'dark' : 'light'
  })
  const [userLocation, setUserLocation] = useState<{ lat: number; lng: number } | null>(null)
  // Manual "set my city" fallback when GPS is denied/unavailable (mobile).
  // Piped into the chat context the same way coords are (see handleSend).
  const [manualCity, setManualCity] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null
    return localStorage.getItem('hodari_city') || null
  })
  const [geoNotice, setGeoNotice] = useState<string | null>(null)
  const geoWatchIdRef = useRef<number | null>(null)
  const [routeFromUser, setRouteFromUser] = useState(false)
  const [routeInfo, setRouteInfo] = useState<RouteInfo | null>(null)
  const [routeError, setRouteError] = useState<string | null>(null)
  const [locationPending, setLocationPending] = useState(false)
  const [mapZoomFocus, setMapZoomFocus] = useState(false)
  const [showUserOnMap, setShowUserOnMap] = useState(true)
  const [suppressGpsContext, setSuppressGpsContext] = useState(false)
  const [customRoute, setCustomRoute] = useState<CustomRouteConfig | null>(null)
  const [routeMode, setRouteMode] = useState<TravelMode>('WALK')
  const [detailsPlace, setDetailsPlace] = useState<Place | null>(null)
  const [speakReplies, setSpeakReplies] = useState(true)
  const [speechOutSupported, setSpeechOutSupported] = useState(false)
  const speakRepliesRef = useRef(true)
  const sessionId = useRef(uid())
  const abortRef = useRef<AbortController | null>(null)
  const soloPlaceModeRef = useRef(false)
  const appliedMapActionsRef = useRef('')
  const placesRef = useRef(places)
  const itineraryRef = useRef(itinerary)
  const activeStopRef = useRef(activeStop)
  const fetchedPhotoIdsRef = useRef(new Set<string>())
  // Every place seen this session, so the AI can color/circle a place from an
  // earlier search (e.g. mark the restaurant while showing nearby hotels).
  const placeMemoryRef = useRef<Map<string, Place>>(new Map())
  const [annotations, setAnnotations] = useState<MapAnnotations>(EMPTY_ANNOTATIONS)
  const [savedPlaceIds, setSavedPlaceIds] = useState<Set<string>>(() => {
    if (typeof window === 'undefined') return new Set()
    try { return new Set(JSON.parse(localStorage.getItem('hodari_saved') ?? '[]')) } catch { return new Set() }
  })

  // ── Community layer (panel, profile sheet, share picker, map overlays) ──────
  // `communityMounted` keeps the lazy chunk mounted after first open so the
  // sheet's close animation still plays; before that nothing is downloaded.
  const [communityMounted, setCommunityMounted] = useState(false)
  const [communityOpen, setCommunityOpen] = useState(false)
  const [communityLayerOn, setCommunityLayerOn] = useState(
    () => typeof window !== 'undefined' && localStorage.getItem('hodari_community_layer') === '1',
  )
  const [profileTarget, setProfileTarget] = useState<string | null>(null)
  const [shareTarget, setShareTarget] = useState<Place | null>(null)
  const [shareConversationId, setShareConversationId] = useState<string | null>(null)
  const [communityFocus, setCommunityFocus] = useState<{ lat: number; lng: number } | null>(null)

  useEffect(() => {
    try { localStorage.setItem('hodari_community_layer', communityLayerOn ? '1' : '0') } catch { /* ignore */ }
  }, [communityLayerOn])

  // Pins load while the panel OR the map layer is on; connection positions
  // poll (15s) only while the map layer is on. All polling stops otherwise.
  const { pins: communityPins, friends: communityFriends, refreshPins } = useCommunityMapLayer({
    pinsEnabled: communityLayerOn || communityOpen,
    friendsEnabled: communityLayerOn,
    userLocation,
  })

  const openCommunity = useCallback(() => {
    setCommunityMounted(true)
    setCommunityOpen(true)
    // One panel at a time: community replaces the place-details overlay.
    setDetailsPlace(null)
  }, [])
  const handleOpenProfile = useCallback((handle: string) => setProfileTarget(handle), [])
  const handleToggleCommunityLayer = useCallback(() => setCommunityLayerOn((v) => !v), [])
  /** Center the map on a community place (shared-pin tap in panel/profile). */
  const handleCommunityFocusPlace = useCallback((lat: number, lng: number) => {
    if (!isValidCoord({ lat, lng })) return
    setCommunityLayerOn(true)
    setMapVisible(true)
    setCommunityFocus({ lat, lng })
  }, [])
  const handlePlaceShare = useCallback((place: Place) => setShareTarget(place), [])

  useEffect(() => {
    placesRef.current = places
    for (const p of places) {
      if (p.place_id && isValidCoord(p.coordinates)) placeMemoryRef.current.set(p.place_id, p)
    }
  }, [places])
  useEffect(() => { itineraryRef.current = itinerary }, [itinerary])
  useEffect(() => { activeStopRef.current = activeStop }, [activeStop])
  useEffect(() => { speakRepliesRef.current = speakReplies }, [speakReplies])

  // Auto-fetch photos for places that came back without one. The stream
  // handler re-sets `places` with fresh photo-less objects several times per
  // turn (candidates chunk, final state, open-map-from-message), so fetched
  // URLs are kept in a cache keyed by place_id and re-applied after every
  // overwrite — the key below flips whenever a visible place loses its photo.
  const photoCacheRef = useRef(new Map<string, string[]>())
  // Calendar events already surfaced as chips (keyed place_id:date) — avoids
  // re-showing the same scheduled visit on later turns.
  const shownCalendarKeysRef = useRef(new Set<string>())
  // Signed-in members get server-side (encrypted, cross-device) chat history;
  // guests fall back to localStorage. Set during the initial history load.
  const authedRef = useRef(false)
  const placePhotoKey = places
    .map((p) => `${p.place_id}:${p.photo_url || p.photos?.length ? 1 : 0}`)
    .join(',')
  useEffect(() => {
    const applyCached = (list: Place[]) =>
      list.map((p) => {
        if (p.photo_url || p.photos?.length) return p
        const urls = photoCacheRef.current.get(p.place_id)
        return urls?.length ? { ...p, photo_url: urls[0], photos: urls } : p
      })

    if (places.some((p) => !p.photo_url && !p.photos?.length && photoCacheRef.current.has(p.place_id))) {
      setPlaces((prev) => applyCached(prev))
    }

    // Mirror cached photos onto message places too — `msg.places` are set from
    // the raw parse and never get enriched, so the in-chat gallery would show
    // "No photo" without this. Only writes when something actually changed.
    setMessages((prev) => {
      let anyChanged = false
      const next = prev.map((m) => {
        if (!m.places?.length) return m
        let msgChanged = false
        const patched = m.places.map((p) => {
          if (p.photo_url || p.photos?.length) return p
          const urls = photoCacheRef.current.get(p.place_id)
          if (urls?.length) { msgChanged = true; return { ...p, photo_url: urls[0], photos: urls } }
          return p
        })
        if (msgChanged) { anyChanged = true; return { ...m, places: patched } }
        return m
      })
      return anyChanged ? next : prev
    })

    const toFetch = places.filter(
      (p) => p.place_id && !p.place_id.startsWith('__') && !p.photo_url && !p.photos?.length && !fetchedPhotoIdsRef.current.has(p.place_id),
    )
    if (!toFetch.length) return
    toFetch.forEach((place) => {
      fetchedPhotoIdsRef.current.add(place.place_id)
      fetch(`/api/place-photos?placeId=${encodeURIComponent(place.place_id)}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => {
          if (!data) return
          const patch: Partial<Place> = {}
          if (data.photoUrls?.length) {
            photoCacheRef.current.set(place.place_id, data.photoUrls)
            patch.photo_url = data.photoUrls[0]
            patch.photos = data.photoUrls
          }
          if (typeof data.isOpen === 'boolean') patch.open_now = data.isOpen
          if (Object.keys(patch).length === 0) return
          setPlaces((prev) =>
            prev.map((p) => (p.place_id === place.place_id ? { ...p, ...patch } : p)),
          )
        })
        .catch(() => {})
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [placePhotoKey])

  // Warm the browser cache for every place photo as soon as its URL is known,
  // so cards and detail panels render their image instantly instead of
  // downloading on first view.
  const preloadedPhotoSrcsRef = useRef(new Set<string>())
  useEffect(() => {
    for (const p of places) {
      const refSrc = p.photo_reference
        ? `/api/place-photo?ref=${encodeURIComponent(p.photo_reference)}`
        : null
      const srcs = [p.photo_url, ...(p.photos ?? []), refSrc].filter(Boolean).slice(0, 3) as string[]
      for (const src of srcs) {
        if (preloadedPhotoSrcsRef.current.has(src)) continue
        preloadedPhotoSrcsRef.current.add(src)
        const img = new Image()
        img.src = src
      }
    }
  }, [places])

  const handleSavePlace = useCallback(
    (place: Place) => {
      const id = place.place_id
      const isNowSaved = !savedPlaceIds.has(id)
      setSavedPlaceIds((prev) => {
        const next = new Set(prev)
        if (isNowSaved) next.add(id)
        else next.delete(id)
        try { localStorage.setItem('hodari_saved', JSON.stringify([...next])) } catch { /* ok */ }
        return next
      })
      fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: USER_ID, placeId: id, placeName: place.name, city: place.city ?? '', action: isNowSaved ? 'saved' : 'unsaved' }),
      }).catch(() => {})
    },
    [savedPlaceIds],
  )

  const handleSend = useCallback(async (text: string, opts?: { speak?: boolean }) => {
    cancelSpeech()
    const wantSpeak = !!opts?.speak

    if (isNewSearchRequest(text)) soloPlaceModeRef.current = false

    if (isHideLocationRequest(text)) {
      setShowUserOnMap(false)
      setRouteFromUser(false)
      setCustomRoute(null)
      setRouteInfo(null)
    }

    const attachGps = shouldAttachGps(text, userLocation, suppressGpsContext)
    // Manual-city fallback rides the same seam: shouldAttachGps only gates on
    // "a location exists" + text intent, so probe it with a sentinel coord.
    const attachCity =
      !attachGps && !!manualCity && shouldAttachGps(text, { lat: 1, lng: 1 }, suppressGpsContext)
    const enriched = attachGps && userLocation
      ? `${text}\n[User location: ${userLocation.lat.toFixed(5)}, ${userLocation.lng.toFixed(5)}]`
      : attachCity
        ? `${text}\n[User city: ${manualCity}]`
        : text

    const userMsg: ChatMessage = { id: uid(), role: 'user', content: text }
    setMessages((prev) => [...prev, userMsg])

    const visiblePlaces: Place[] = itinerary?.stops?.length
      ? itinerary.stops.map((s) => ({ ...s, personalization_score: 0, categories: [] }))
      : places

    let mapOnlyReply: string | null = null

    if (isZoomFocusRequest(text) || isListPickRequest(text)) {
      const idx = resolvePlaceIndex(text, visiblePlaces, activeStop)
      if (idx !== null) {
        setActiveStop(idx)
        setMapZoomFocus(true)
        setMapVisible(true)
        if (isZoomFocusRequest(text)) {
          mapOnlyReply = `Centered the map on ${visiblePlaces[idx].name}. Tap Route from me for directions.`
        }
      }
    }

    if (isKeepOnlyRequest(text) || isNamedKeepOnlyRequest(text, visiblePlaces)) {
      const idx = resolvePlaceIndex(text, visiblePlaces, activeStop)
      if (idx !== null) {
        const solo = visiblePlaces[idx]
        setPlaces([solo])
        setItinerary(null)
        setActiveStop(0)
        setMapZoomFocus(true)
        setMapVisible(true)
        soloPlaceModeRef.current = true
        mapOnlyReply = `Showing only ${solo.name} on your map. Tap its card and Route from me when you're ready to go.`
      }
    }

    if (isMapShowRequest(text)) setMapVisible(true)

    if (mapOnlyReply && !wantsRouteFromUser(text)) {
      setMessages((prev) => [
        ...prev,
        { id: uid(), role: 'assistant', content: mapOnlyReply },
      ])
      if (wantSpeak && speakRepliesRef.current) speak(mapOnlyReply)
      return
    }
    const routeRequest = wantsRouteFromUser(text)
    if (routeRequest) {
      setRouteFromUser(true)
      setMapVisible(true)
      const idx = findPlaceIndexInText(text, places)
      if (idx !== null) setActiveStop(idx)
    }
    abortRef.current?.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl

    setLoading(true)
    setThinkingSteps([])
    setStreamingStarted(false)
    streamingStartedRef.current = false

    let assistantText = ''
    const assistantId = uid()
    let earlyItinerarySet = false
    let streamDone = false
    let pipelineRan = false

    const processSessionMapActions = (state: Record<string, unknown>) => {
      const raw = state.map_actions
      const payload = typeof raw === 'string' ? raw : JSON.stringify(raw ?? '')
      if (!payload || payload === '[]' || payload === '""' || payload === appliedMapActionsRef.current) return
      const actions = parseMapActions(raw)
      if (!actions.length) return
      appliedMapActionsRef.current = payload
      const effects = applyMapActions(actions, {
        places: placesRef.current,
        itinerary: itineraryRef.current,
        activeStop: activeStopRef.current,
      })
      applyMapEffects(effects)

      // AI-drawn map annotations (colors / circles / extra markers).
      if (actions.some((a) => a.op === 'highlight_place' || a.op === 'circle_place' || a.op === 'clear_annotations')) {
        const stops = itineraryRef.current?.stops ?? []
        const list: Place[] = placesRef.current.length
          ? placesRef.current
          : stops.map((s) => ({ ...s, categories: [] as string[] }))
        const memory = [...placeMemoryRef.current.values()]
        setAnnotations((prev) => applyAnnotationActions(actions, list, memory, prev))
        setMapVisible(true)
      }
    }

    const pollForItinerary = async () => {
      for (let i = 0; i < 120; i++) {
        await new Promise((r) => setTimeout(r, 3000))
        if (streamDone || earlyItinerarySet) break
        try {
          const s = await fetchSessionState(USER_ID, sessionId.current)
          if (s.intent_type === 'LIST_DISCOVERY') setItinerary(null)
          if (s.itinerary && s.intent_type !== 'LIST_DISCOVERY') {
            const parsed = parseItinerary(s.itinerary)
            if (parsed) {
              earlyItinerarySet = true
              setItinerary(parsed)
              setPlaces([])
              setActiveStop(0)
              setMapVisible(true)
              if (!routeRequest) setRouteFromUser(false)
              setMessages((prev) => {
                const ri = [...prev].reverse().findIndex((m) => m.role === 'assistant')
                if (ri === -1) {
                  const text = parsed.voice_summary || `Here's your ${parsed.stops.length}-stop plan!`
                  return [...prev, { id: assistantId, role: 'assistant' as const, content: text, itinerary: parsed }]
                }
                const ai = prev.length - 1 - ri
                return prev.map((m, i) => i === ai ? { ...m, itinerary: parsed, places: undefined } : m)
              })
            }
          }
          if (!earlyItinerarySet && s.candidates && !soloPlaceModeRef.current) {
            const parsed = parseCandidates(s.candidates)
            if (parsed) {
              setPlaces(parsed)
              setItinerary(null)
              setMapZoomFocus(false)
              setMapVisible(true)
              setActiveStop((prev) => prev ?? 0)
              if (!routeRequest) { setRouteFromUser(false); setRouteInfo(null) }
              setMessages((prev) => {
                const ri = [...prev].reverse().findIndex((m) => m.role === 'assistant')
                if (ri === -1) {
                  const text = `Found ${parsed.length} place${parsed.length !== 1 ? 's' : ''} for you!`
                  return [...prev, { id: assistantId, role: 'assistant' as const, content: text, places: parsed }]
                }
                const ai = prev.length - 1 - ri
                return prev.map((m, i) => i === ai ? { ...m, places: parsed, itinerary: undefined } : m)
              })
            }
          }
          processSessionMapActions(s)
          if (s.suppress_gps_context === '1') setSuppressGpsContext(true)
        } catch { /* non-critical */ }
      }
    }

    try {
      for await (const chunk of streamChat(enriched, USER_ID, sessionId.current, ctrl.signal)) {
        if (chunk.type === 'thinking') {
          pipelineRan = true
          setThinkingSteps((prev) => [...prev, chunk.label])
          if (chunk.agent === 'map_control') {
            fetchSessionState(USER_ID, sessionId.current)
              .then((s) => {
                processSessionMapActions(s)
                if (s.suppress_gps_context === '1') setSuppressGpsContext(true)
              })
              .catch(() => {})
          }
          const planningSignal =
            chunk.agent === 'hodari_pipeline' ||
            chunk.agent === 'load_user_profile' ||
            chunk.agent.startsWith('pipeline_') ||
            chunk.agent === 'itinerary_agent'
          if (planningSignal && !earlyItinerarySet) pollForItinerary()
        } else {
          if (!streamingStartedRef.current) {
            streamingStartedRef.current = true
            setStreamingStarted(true)
          }
          assistantText += chunk.text
          const clean = stripEmDashes(assistantText)
          setMessages((prev) => {
            const existing = prev.find((m) => m.id === assistantId)
            if (existing) return prev.map((m) => m.id === assistantId ? { ...m, content: clean } : m)
            return [...prev, { id: assistantId, role: 'assistant', content: clean }]
          })
        }
      }

      streamDone = true

      if (wantSpeak && speakRepliesRef.current && assistantText.trim()) {
        speak(stripEmDashes(assistantText))
      }

      const wantsMap = isMapShowRequest(text)
      try {
        const state = await fetchSessionState(USER_ID, sessionId.current)
        processSessionMapActions(state)
        if (state.suppress_gps_context === '1') setSuppressGpsContext(true)
        else if (state.suppress_gps_context === '') setSuppressGpsContext(false)

        // Scheduled visits (plan_visit) → attach "Add to Google Calendar" chips to
        // the reply. Track shown events by place+date so they don't re-appear.
        const calRaw = Array.isArray(state.calendar_events) ? state.calendar_events as Array<Record<string, unknown>> : []
        const freshCal = calRaw
          .map((e) => ({ title: String(e.title ?? ''), date: String(e.date ?? ''), location: (e.location as string) || undefined, description: (e.note as string) || undefined, placeId: String(e.place_id ?? '') }))
          .filter((e) => e.title && e.date && !shownCalendarKeysRef.current.has(`${e.placeId}:${e.date}`))
        if (freshCal.length) {
          freshCal.forEach((e) => shownCalendarKeysRef.current.add(`${e.placeId}:${e.date}`))
          setMessages((prev) => {
            const ri = [...prev].reverse().findIndex((m) => m.role === 'assistant')
            if (ri === -1) return prev
            const ai = prev.length - 1 - ri
            return prev.map((m, i) => i === ai
              ? { ...m, calendarEvents: freshCal.map(({ title, date, location, description }) => ({ title, date, location, description })) }
              : m)
          })
        }

        if ((pipelineRan && !earlyItinerarySet) || wantsMap) {
          const intent = state.intent_type as string | undefined
          const parsedCandidates = state.candidates ? parseCandidates(state.candidates) : null
          const parsedItinerary =
            state.itinerary && !earlyItinerarySet ? parseItinerary(state.itinerary) : null

          if (parsedCandidates && (intent === 'LIST_DISCOVERY' || !parsedItinerary) && !soloPlaceModeRef.current) {
            setPlaces(parsedCandidates)
            setItinerary(null)
            setMapZoomFocus(false)
            setMapVisible(true)
            setActiveStop((prev) => prev ?? 0)
            setMessages((prev) => {
              const ri = [...prev].reverse().findIndex((m) => m.role === 'assistant')
              if (ri === -1) {
                const text = `Found ${parsedCandidates.length} place${parsedCandidates.length !== 1 ? 's' : ''} for you!`
                return [...prev, { id: assistantId, role: 'assistant' as const, content: text, places: parsedCandidates }]
              }
              const ai = prev.length - 1 - ri
              return prev.map((m, i) => i === ai ? { ...m, places: parsedCandidates, itinerary: undefined } : m)
            })
          } else if (parsedItinerary && intent !== 'LIST_DISCOVERY') {
            setItinerary(parsedItinerary)
            setPlaces([])
            setMapVisible(true)
            setActiveStop(0)
            if (!routeRequest) setRouteFromUser(false)
            setMessages((prev) => {
              const ri = [...prev].reverse().findIndex((m) => m.role === 'assistant')
              if (ri === -1) {
                const text = parsedItinerary.voice_summary || `Here's your ${parsedItinerary.stops.length}-stop plan!`
                return [...prev, { id: assistantId, role: 'assistant' as const, content: text, itinerary: parsedItinerary }]
              }
              const ai = prev.length - 1 - ri
              return prev.map((m, i) => i === ai ? { ...m, itinerary: parsedItinerary, places: undefined } : m)
            })
          }
        }
      } catch { /* non-critical */ }

      if (routeRequest) {
        let list = places
        try {
          const state = await fetchSessionState(USER_ID, sessionId.current)
          const parsed = state.candidates ? parseCandidates(state.candidates) : null
          if (parsed) list = parsed
        } catch { /* use in-memory places */ }
        const idx = findPlaceIndexInText(text, list)
        if (idx !== null) setActiveStop(idx)
      }
    } catch (err) {
      if (err instanceof ChatGateError) {
        // Quota gate (free previews used / out of credits): drop the empty
        // assistant turn and open the login wall or paywall instead of an error.
        setMessages((prev) => prev.filter((m) => m.content !== '' || m.role !== 'assistant'))
        setGate({ type: err.gate, message: err.message })
      } else if (err instanceof Error && err.name === 'AbortError') {
        // User stopped the request — leave whatever partial text is already in messages
      } else {
        console.error(err)
        setMessages((prev) => [
          ...prev,
          { id: uid(), role: 'assistant', content: 'Something went wrong. Please try again.' },
        ])
      }
    } finally {
      streamDone = true
      abortRef.current = null
      setLoading(false)
      setStreamingStarted(false)
      streamingStartedRef.current = false
    }
  }, [userLocation, manualCity, places, itinerary, activeStop, suppressGpsContext]) // eslint-disable-line react-hooks/exhaustive-deps

  const applyMapEffects = useCallback((effects: MapActionEffects) => {
    if (effects.showUserOnMap !== undefined) setShowUserOnMap(effects.showUserOnMap)
    if (effects.suppressGpsContext !== undefined) setSuppressGpsContext(effects.suppressGpsContext)
    if (effects.mapOpen !== undefined) setMapVisible(effects.mapOpen)
    if (effects.mapExpanded !== undefined) setMapExpanded(effects.mapExpanded)
    if (effects.mapOpen === false) setMapExpanded(false)
    if (effects.mapZoomFocus !== undefined) setMapZoomFocus(effects.mapZoomFocus)
    if (effects.activeStop !== undefined) setActiveStop(effects.activeStop)
    if (effects.places !== undefined) setPlaces(effects.places)
    if (effects.clearItinerary) setItinerary(null)
    if (effects.soloPlaceMode) soloPlaceModeRef.current = true
    if (effects.routeFromUser !== undefined) setRouteFromUser(effects.routeFromUser)
    if (effects.customRoute !== undefined) setCustomRoute(effects.customRoute)
    if (effects.routeMode !== undefined) setRouteMode(effects.routeMode)
    if (effects.routeFromUser || effects.customRoute) { setRouteInfo(null); setRouteError(null) }
    if (effects.customRoute === null && effects.routeFromUser === false) { setRouteInfo(null); setRouteError(null) }
  }, [])

  /** Follow the user once permission exists (no-op if a watch is running). */
  const startGeoWatch = useCallback(() => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) return
    if (geoWatchIdRef.current != null) return
    geoWatchIdRef.current = navigator.geolocation.watchPosition(
      (pos) => setUserLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => {},
      { enableHighAccuracy: true, maximumAge: 60_000 },
    )
  }, [])

  const ensureUserLocation = useCallback(async (): Promise<boolean> => {
    if (userLocation) return true
    setLocationPending(true)
    const res = await requestUserLocationDetailed()
    setLocationPending(false)
    if (res.ok) {
      setUserLocation(res.location)
      startGeoWatch()
      return true
    }
    setRouteError(res.message)
    return false
  }, [userLocation, startGeoWatch])

  const handleMarkerClick = useCallback((index: number) => {
    setActiveStop(index)
    setMapZoomFocus(true)
    setMapVisible(true)
    // Selecting a place only focuses it and pops its action bubble on the map
    // (Full details / Save / Route / Website). It does NOT open the full details
    // panel anymore, and does NOT draw a route — keep the map clean.
    setRouteFromUser(false)
    setCustomRoute(null)
    setRouteInfo(null)
    setRouteError(null)
  }, [])

  // Clicking a result card in the in-chat gallery: on the FULL map it just
  // focuses that place's marker (the bubble gives full details); in compact mode
  // it opens the details panel as before.
  const handleGalleryCardClick = useCallback((place: Place) => {
    if (mapExpanded) {
      const list = (itinerary?.stops ?? places) as Place[]
      const idx = list.findIndex((p) => p.place_id === place.place_id)
      if (idx >= 0) { handleMarkerClick(idx); return }
    }
    setDetailsPlace(place)
  }, [mapExpanded, itinerary, places, handleMarkerClick])

  const handleRouteFromMe = useCallback(async (index: number) => {
    setActiveStop(index)
    setCustomRoute(null)
    setRouteFromUser(true)
    setRouteInfo(null)
    setRouteError(null)
    setMapVisible(true)
    await ensureUserLocation()
  }, [ensureUserLocation])

  const handlePlaceAsk = useCallback((index: number, prompt: string) => {
    setActiveStop(index)
    setChatCollapsed(false)
    setChatSnap('half')
    handleSend(prompt)
  }, [handleSend])

  const handleFeedback = useCallback(async (stopIndex: number, action: 'liked' | 'disliked') => {
    if (!itinerary) return
    const stop = itinerary.stops[stopIndex]
    const city = (stop.address ?? '').split(',').slice(-2, -1)[0]?.trim() ?? ''
    fetch('/api/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: USER_ID, placeId: stop.place_id, placeName: stop.name, city, action }),
    }).catch(() => {})
  }, [itinerary])

  const handleSwap = useCallback((index: number) => {
    if (!itinerary) return
    const stop = itinerary.stops[index]
    handleSend(`Replace stop ${index + 1} (${stop.name}) with a different alternative, keeping the same budget and constraints.`)
  }, [itinerary, handleSend])

  const handleAsk = useCallback((_stopIndex: number, prompt: string) => {
    setChatCollapsed(false)
    setChatSnap('half')
    handleSend(prompt)
  }, [handleSend])

  const handleLogout = useCallback(() => {
    cancelSpeech()
    fetch('/api/auth/logout', { method: 'POST' }).catch(() => {})
    try {
      localStorage.removeItem('hodari_uid')
      localStorage.removeItem('hodari_email')
      localStorage.removeItem('hodari_name')
      localStorage.removeItem('hodari_active_session')
      // Clear personal data so a shared/public browser doesn't leak the previous
      // user's chats or saved places to the next person.
      localStorage.removeItem('hodari_history')
      localStorage.removeItem('hodari_saved')
    } catch { /* ignore */ }
    window.location.href = '/login'
  }, [])

  const handleNewChat = useCallback(() => {
    cancelSpeech()
    sessionId.current = uid()
    try { localStorage.setItem('hodari_active_session', sessionId.current) } catch { /* ignore */ }
    placeMemoryRef.current.clear()
    setAnnotations(EMPTY_ANNOTATIONS)
    setMessages([])
    setLoading(false)
    setThinkingSteps([])
    setStreamingStarted(false)
    streamingStartedRef.current = false
    setPlaces([])
    setItinerary(null)
    setActiveStop(null)
    setMapVisible(false)
    setMapExpanded(false)
    setChatCollapsed(false)
    setRouteInfo(null)
    setRouteError(null)
    setRouteFromUser(false)
    setCustomRoute(null)
    setDetailsPlace(null)
    setCommunityFocus(null)
  }, [])

  const handleSelectHistory = useCallback((id: string) => {
    const item = historyItems.find((entry) => entry.id === id)
    if (!item) return
    cancelSpeech()
    sessionId.current = item.id
    try { localStorage.setItem('hodari_active_session', item.id) } catch { /* ignore */ }
    setAnnotations(EMPTY_ANNOTATIONS)
    setMessages(item.messages)
    setLoading(false)
    setThinkingSteps([])
    setStreamingStarted(false)
    streamingStartedRef.current = false
    setPlaces([])
    setItinerary(null)
    setActiveStop(null)
    setMapVisible(false)
    setMapExpanded(false)
    setChatCollapsed(false)
    setRouteInfo(null)
    setRouteError(null)
    setRouteFromUser(false)
    setCustomRoute(null)
    setDetailsPlace(null)
    setCommunityFocus(null)
  }, [historyItems])

  const handleDeleteHistory = useCallback((id: string) => {
    setHistoryItems((prev) => prev.filter((item) => item.id !== id))
    if (authedRef.current) {
      fetch(`/api/chats?sessionId=${encodeURIComponent(id)}`, { method: 'DELETE' }).catch(() => {})
    }
  }, [])

  const handleOpenMapFromMessage = useCallback((message: ChatMessage) => {
    if (message.itinerary?.stops?.length) {
      setItinerary(message.itinerary)
      setPlaces([])
      setActiveStop(0)
    } else if (message.places?.length) {
      setPlaces(message.places)
      setItinerary(null)
      setActiveStop(0)
    }
    setMapVisible(true)
    setChatCollapsed(false)
  }, [])

  useEffect(() => {
    setSpeechOutSupported(isSpeechOutputSupported())
    const savedVoice = localStorage.getItem('hodari_speak')
    if (savedVoice === '0') setSpeakReplies(false)
    const resume = (items: HistoryItem[]) => {
      setHistoryItems(items)
      // Resume the conversation we left (e.g. after visiting Saved places) instead
      // of starting a blank one — unless we were already in a fresh, unsent chat.
      const activeId = localStorage.getItem('hodari_active_session')
      const active = activeId ? items.find((it) => it.id === activeId) : undefined
      if (active) {
        sessionId.current = active.id
        setMessages(active.messages)
      } else {
        localStorage.setItem('hodari_active_session', sessionId.current)
      }
    }

    const loadLocal = () => {
      try {
        const savedHistory = localStorage.getItem('hodari_history')
        const parsed = savedHistory ? JSON.parse(savedHistory) as HistoryItem[] : []
        resume(Array.isArray(parsed) ? parsed.slice(0, 20) : [])
      } catch {
        setHistoryItems([])
      }
    }

    // Members → server history (encrypted, cross-device). Guests → localStorage.
    fetch('/api/chats')
      .then((r) => r.json())
      .then((d) => {
        if (d?.authed) {
          authedRef.current = true
          resume((d.chats ?? []).map((c: HistoryItem) => ({ id: c.id, title: c.title, updatedAt: c.updatedAt, messages: c.messages ?? [] })))
        } else {
          loadLocal()
        }
      })
      .catch(() => loadLocal())
      .finally(() => setHistoryLoaded(true))
  }, [])

  // Persist the history list. Members sync to the server (encrypted, debounced
  // below); guests keep it in localStorage. We never write transcripts to
  // localStorage for members, so logout / a shared browser can't leak them.
  useEffect(() => {
    if (!historyLoaded || authedRef.current) return
    localStorage.setItem('hodari_history', JSON.stringify(historyItems.slice(0, 20)))
  }, [historyItems, historyLoaded])

  // Members: debounced save of the active conversation to the server. Debounced
  // so streaming token updates coalesce into one write per turn.
  useEffect(() => {
    if (!historyLoaded || !authedRef.current || !messages.length) return
    const t = setTimeout(() => {
      const firstUser = messages.find((m) => m.role === 'user') ?? messages[0]
      const title = firstUser.content.replace(/\s+/g, ' ').trim().slice(0, 56) || 'Untitled chat'
      fetch('/api/chats', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: sessionId.current, title, messages }),
      }).catch(() => {})
    }, 1500)
    return () => clearTimeout(t)
  }, [messages, historyLoaded])

  useEffect(() => {
    if (!messages.length) return
    // Remember which conversation is active so a round-trip to /saved resumes it.
    try { localStorage.setItem('hodari_active_session', sessionId.current) } catch { /* ignore */ }
    const firstUserMessage = messages.find((m) => m.role === 'user') ?? messages[0]
    const title = firstUserMessage.content.replace(/\s+/g, ' ').trim().slice(0, 56) || 'Untitled chat'
    const id = sessionId.current
    setHistoryItems((prev) => {
      const nextItem: HistoryItem = { id, title, updatedAt: Date.now(), messages }
      return [nextItem, ...prev.filter((item) => item.id !== id)].slice(0, 20)
    })
  }, [messages])

  useEffect(() => {
    localStorage.setItem('hodari_speak', speakReplies ? '1' : '0')
  }, [speakReplies])

  useEffect(() => {
    const saved = Number(localStorage.getItem('hodari_chatw'))
    if (saved >= 300 && saved <= 760) setChatWidth(saved)
  }, [])

  const startResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    resizingRef.current = true
    let latest = 380
    const onMove = (ev: MouseEvent) => {
      if (!resizingRef.current) return
      const max = Math.min(760, window.innerWidth - 260)
      latest = Math.max(320, Math.min(ev.clientX, max))
      setChatWidth(latest)
    }
    const onUp = () => {
      resizingRef.current = false
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      document.body.style.userSelect = ''
      document.body.style.cursor = ''
      localStorage.setItem('hodari_chatw', String(latest))
    }
    document.body.style.userSelect = 'none'
    document.body.style.cursor = 'col-resize'
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }, [])

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark')
    localStorage.setItem('hodari_theme', theme)
  }, [theme])

  // Geolocation: never prompt on page load — mobile browsers auto-deny or
  // silently swallow un-gestured prompts (the old "AI can't get my location"
  // bug). We only start watching automatically when the browser reports the
  // permission is ALREADY granted; otherwise the user taps "Use my location"
  // in the composer (see handleUseMyLocation), which is a real gesture.
  useEffect(() => {
    let cancelled = false
    queryGeoPermission().then((state) => {
      if (cancelled || state !== 'granted') return
      navigator.geolocation?.getCurrentPosition(
        (pos) => { if (!cancelled) setUserLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude }) },
        () => {},
        { enableHighAccuracy: true, timeout: 20_000, maximumAge: 120_000 },
      )
      startGeoWatch()
    })
    return () => {
      cancelled = true
      if (geoWatchIdRef.current != null) {
        navigator.geolocation?.clearWatch(geoWatchIdRef.current)
        geoWatchIdRef.current = null
      }
    }
  }, [startGeoWatch])

  /** Explicit "Use my location" gesture — the only place that may prompt. */
  const handleUseMyLocation = useCallback(async () => {
    setGeoNotice(null)
    setLocationPending(true)
    const res = await requestUserLocationDetailed()
    setLocationPending(false)
    if (res.ok) {
      setUserLocation(res.location)
      startGeoWatch()
    } else {
      setGeoNotice(res.message)
    }
  }, [startGeoWatch])

  /** Manual fallback: a typed city feeds the same location context seam. */
  const handleSetCity = useCallback((city: string) => {
    const clean = city.trim().slice(0, 80)
    setManualCity(clean || null)
    setGeoNotice(null)
    try {
      if (clean) localStorage.setItem('hodari_city', clean)
      else localStorage.removeItem('hodari_city')
    } catch { /* ignore */ }
  }, [])

  const handleStop = useCallback(() => {
    abortRef.current?.abort()
    cancelSpeech()
  }, [])

  const voiceTranscriptCb = useCallback((t: string) => handleSend(t, { speak: true }), [handleSend])
  // The ONLY useVoice instance in the app. Multiple instances each spin up their
  // own recorder on auto-resume, which double-sends every transcript.
  const voice = useVoice({
    onTranscript: voiceTranscriptCb,
    disabled: loading,
    autoResumeAfterSpeak: uiMode === 'voice',
    // Voice mode: browser STT → live words + instant echo (no ~4s Gemini delay).
    preferBrowserStt: uiMode === 'voice',
  })

  const stopEverything = useCallback(() => {
    voice.stopAll()
    cancelSpeech()
    abortRef.current?.abort()
  }, [voice])

  const enterChatMode = useCallback(() => {
    setUiMode('chat')
    voice.stopAll()
    cancelSpeech()
  }, [voice])

  const enterVoiceMode = useCallback(() => {
    setUiMode('voice')
    if (voice.voiceState === 'idle') voice.startListening()
  }, [voice])

  const lastAssistant = [...messages].reverse().find((m) => m.role === 'assistant') ?? null
  const itineraryStops = itinerary?.stops ?? null
  const mapPlaces = itineraryStops
    ? itineraryStops.map((s) => ({ ...s, personalization_score: 0, categories: [] }))
    : places

  const pinsMismatch =
    showUserOnMap &&
    !suppressGpsContext &&
    !!userLocation &&
    places.length > 0 &&
    !itineraryStops &&
    pinsFarFromUser(userLocation, places.map((p) => p.coordinates))

  const routeActive = routeFromUser || !!customRoute
  const communityLayerHasData =
    communityLayerOn && (communityPins.length > 0 || communityFriends.length > 0)
  const hasMapData = mapPlaces.length > 0 || communityLayerHasData

  // ── Mobile sheet discipline ─────────────────────────────────────────────────
  // When the map (base layer) first appears, drop the chat to its peek so the
  // user actually sees the map they asked for; the reply shows in the peek.
  const showMobileMap = isMobile && mapVisible && hasMapData
  const prevShowMobileMapRef = useRef(false)
  useEffect(() => {
    if (showMobileMap && !prevShowMobileMapRef.current) setChatSnap('collapsed')
    prevShowMobileMapRef.current = showMobileMap
  }, [showMobileMap])

  // One surface at a time on phones: any overlay (details, community, profile,
  // share picker) minimizes the chat sheet underneath it.
  const overlayOpen =
    !!detailsPlace || communityOpen || !!profileTarget || !!shareTarget || !!shareConversationId
  useEffect(() => {
    if (isMobile && overlayOpen && showMobileMap) setChatSnap('collapsed')
  }, [isMobile, overlayOpen, showMobileMap])

  // Edit a sent message + re-send it: drop that turn and everything after, then
  // resend the edited text so the AI answers it fresh.
  const handleEditMessage = useCallback((id: string, newText: string) => {
    if (loading) return
    setMessages((prev) => {
      const idx = prev.findIndex((m) => m.id === id)
      return idx < 0 ? prev : prev.slice(0, idx)
    })
    handleSend(newText)
  }, [loading, handleSend])

  const chatPanel = (
    <ChatPanel
      messages={messages}
      loading={loading}
      thinkingSteps={thinkingSteps}
      streamingStarted={streamingStarted}
      onSend={handleSend}
      voiceState={voice.voiceState}
      voiceSupported={voice.supported}
      voiceWarning={voice.warning}
      voiceLiveText={voice.liveText}
      onVoiceToggle={voice.toggleVoice}
      onVoiceStop={stopEverything}
      historyItems={historyItems}
      onNewChat={handleNewChat}
      onSelectHistory={handleSelectHistory}
      onDeleteHistory={handleDeleteHistory}
      mapVisible={mapVisible && !mapExpanded}
      mapExpanded={mapExpanded}
      hasMapData={hasMapData}
      onOpenMapPanel={() => { setMapVisible(true); setMapExpanded(false); setChatCollapsed(false) }}
      onExpandMap={() => { setMapVisible(true); setMapExpanded(true); setChatCollapsed(false) }}
      onCollapseMap={() => { setMapExpanded(false); setMapVisible(true); setChatCollapsed(false) }}
      onOpenMapFromMessage={handleOpenMapFromMessage}
      onEditMessage={handleEditMessage}
      onPlaceDetails={handleGalleryCardClick}
      onToggleMapPanel={() => {
        setMapVisible((v) => {
          const next = !v
          if (!next) setMapExpanded(false)
          return next
        })
      }}
      selectedModel={selectedModel}
      onModelChange={setSelectedModel}
      theme={theme}
      onToggleTheme={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
      hasLocation={!!userLocation}
      manualCity={manualCity}
      onUseMyLocation={handleUseMyLocation}
      onSetCity={handleSetCity}
      locationNotice={geoNotice}
      onDismissLocationNotice={() => setGeoNotice(null)}
      locationPending={locationPending}
      speakReplies={speakReplies}
      speechOutSupported={speechOutSupported}
      onToggleSpeakReplies={() => setSpeakReplies((v) => { const nv = !v; if (!nv) cancelSpeech(); return nv })}
      onCollapse={mapExpanded ? () => setChatCollapsed(true) : undefined}
      onStop={handleStop}
      uiMode={uiMode}
      onEnterChatMode={enterChatMode}
      onEnterVoiceMode={enterVoiceMode}
      userName={userName}
      onLogout={handleLogout}
      onOpenCommunity={openCommunity}
    />
  )

  const selectedPlace = activeStop != null && mapPlaces[activeStop]
    ? (mapPlaces[activeStop] as Place)
    : null

  return (
    <div className="app-shell relative w-screen overflow-hidden">

      {/* Mode toggle when chat panel is collapsed on full-screen map */}
      {!isMobile && mapExpanded && chatCollapsed && (
        <div className="fixed top-3 left-4 z-[300] flex items-center gap-1 rounded-full border border-border bg-surface/95 p-1 shadow-lg backdrop-blur-md">
          <button
            type="button"
            onClick={enterChatMode}
            aria-pressed={uiMode === 'chat'}
            className={`flex items-center gap-1.5 rounded-full px-4 py-1.5 text-[12px] font-medium transition-colors ${
              uiMode === 'chat' ? 'bg-amber-600 text-white shadow' : 'text-text2 hover:text-text'
            }`}
          >
            <MessageSquare className="h-3.5 w-3.5" />
            Chat
          </button>
          <button
            type="button"
            onClick={enterVoiceMode}
            aria-pressed={uiMode === 'voice'}
            className={`flex items-center gap-1.5 rounded-full px-4 py-1.5 text-[12px] font-medium transition-colors ${
              uiMode === 'voice' ? 'bg-amber-600 text-white shadow' : 'text-text2 hover:text-text'
            }`}
          >
            <Mic className="h-3.5 w-3.5" />
            Voice
          </button>
        </div>
      )}

      {/* Compact layout: chat on the left, map + place list on the right */}
      {!isMobile && !mapExpanded && (
        <div className="absolute inset-0 flex animate-fade-up">
          <div className="relative flex h-full min-w-0 flex-1 flex-col overflow-hidden">
            {!mapVisible && (
              <>
                <div
                  className="pointer-events-none absolute inset-0 opacity-[0.018]"
                  style={{
                    backgroundImage: 'radial-gradient(circle, rgb(var(--color-text)) 1px, transparent 1px)',
                    backgroundSize: '32px 32px',
                  }}
                />
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                  <div className="absolute h-[560px] w-[560px] rounded-full border border-gold/[0.04]" />
                  <div className="absolute h-[380px] w-[380px] rounded-full border border-gold/[0.05]" />
                  <div className="absolute h-[220px] w-[220px] rounded-full border border-gold/[0.07]" />
                </div>
              </>
            )}
            <div className={`relative mx-auto flex h-full w-full flex-col ${mapVisible ? '' : 'max-w-2xl'}`}>
              {chatPanel}
            </div>
          </div>

          {mapVisible && hasMapData && (
            <aside className="flex h-full w-[clamp(300px,32vw,420px)] shrink-0 flex-col border-l border-border bg-surface2/40 animate-slide-right">
              <div className="relative min-h-[200px] flex-1 p-2">
                <MapView
                  places={mapPlaces as Place[]}
                  itinerary={itineraryStops}
                  annotations={annotations}
                  activeStopIndex={activeStop}
                  onMarkerClick={handleMarkerClick}
                  userLocation={userLocation}
                  theme={theme}
                  showUserLocation={showUserOnMap}
                  routeFromUser={routeFromUser}
                  customRoute={customRoute}
                  routeMode={routeMode}
                  onRouteInfo={setRouteInfo}
                  onRouteError={setRouteError}
                  zoomFocusOnActive={mapZoomFocus}
                  aiBusy={loading}
                  size="compact"
                  hideInlinePlaceCard
                  onExpand={() => { setMapExpanded(true); setMapVisible(true); setChatCollapsed(false) }}
                  selectedPlace={selectedPlace}
                  routeInfo={routeInfo}
                  onDirections={activeStop != null ? () => handleRouteFromMe(activeStop) : undefined}
                  communityPins={communityPins}
                  communityFriends={communityFriends}
                  communityLayerOn={communityLayerOn}
                  onToggleCommunityLayer={handleToggleCommunityLayer}
                  onOpenProfile={handleOpenProfile}
                  communityFocus={communityFocus}
                />
              </div>
              {routeActive && routeError && (
                <div className="mx-2 mb-1 shrink-0 rounded-xl border border-red-500/40 bg-surface/95 px-3 py-2 text-[12px] text-text2">
                  {routeError}
                </div>
              )}
              {routeFromUser && locationPending && (
                <div className="mx-2 mb-1 shrink-0 rounded-xl border border-border bg-surface/95 px-3 py-2 text-[12px] text-text2">
                  Getting your location…
                </div>
              )}
              {/* Place results live ONLY in the chat now (InlinePlaceGallery under
                  the AI reply). The right side keeps just the map. */}
            </aside>
          )}
        </div>
      )}

      {/* Expanded full-screen map — `isolate` creates a stacking context so Google
          Maps' internal z-indices (up to ~1000002) don't escape and cover the chat */}
      {!isMobile && mapExpanded && (
        <div className="absolute inset-0 isolate">
          <MapView
            places={mapPlaces as Place[]}
            itinerary={itineraryStops}
            annotations={annotations}
            activeStopIndex={activeStop}
            onMarkerClick={handleMarkerClick}
            userLocation={userLocation}
            theme={theme}
            showUserLocation={showUserOnMap}
            routeFromUser={routeFromUser}
            customRoute={customRoute}
            routeMode={routeMode}
            onRouteInfo={setRouteInfo}
            onRouteError={setRouteError}
            zoomFocusOnActive={mapZoomFocus}
            aiBusy={loading}
            onPlaceFullDetails={setDetailsPlace}
            onPlaceSave={handleSavePlace}
            onPlaceRoute={handleRouteFromMe}
            savedPlaceIds={savedPlaceIds}
            communityPins={communityPins}
            communityFriends={communityFriends}
            communityLayerOn={communityLayerOn}
            onToggleCommunityLayer={handleToggleCommunityLayer}
            onOpenProfile={handleOpenProfile}
            communityFocus={communityFocus}
            onPlaceShare={handlePlaceShare}
          />
          {pinsMismatch && (
            <div className="absolute top-16 left-1/2 -translate-x-1/2 z-20 max-w-md px-4 py-2 rounded-xl bg-surface/95 border border-gold/40 text-sm text-text backdrop-blur-md">
              Pins look far from your GPS. Ask Hodari to search again in your city.
            </div>
          )}
          {routeActive && routeError && (
            <div className="absolute bottom-24 left-1/2 -translate-x-1/2 z-20 max-w-lg px-4 py-2 rounded-xl bg-surface/95 border border-red-500/40 text-sm text-text2 backdrop-blur-md">
              {routeError}
            </div>
          )}
          {routeFromUser && locationPending && (
            <div className="absolute bottom-24 left-1/2 -translate-x-1/2 z-20 px-4 py-2 rounded-full bg-surface/95 border border-border text-sm text-text2 backdrop-blur-md">
              Getting your location…
            </div>
          )}
          {routeActive && routeInfo && (
            <div className="pointer-events-none absolute bottom-[11.5rem] left-1/2 z-20 -translate-x-1/2 px-4 py-2 rounded-full bg-surface/95 border border-border shadow-lg text-sm text-text backdrop-blur-md">
              <span className="text-gold font-medium">{routeInfo.destinationName}</span>
              <span className="text-text2">
                {' · '}{routeInfo.distance}{' · '}{routeInfo.duration} from{' '}
                {routeInfo.originLabel && routeInfo.originLabel !== 'you' ? routeInfo.originLabel : 'you'}
              </span>
            </div>
          )}
          {routeFromUser && !userLocation && !locationPending && (
            <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-20 max-w-md px-4 py-2 rounded-xl bg-surface/95 border border-gold/40 text-sm text-text2 backdrop-blur-md text-center">
              Allow location in your browser, then tap <strong className="text-text">Route from me</strong> again.
            </div>
          )}
          {!itineraryStops && places.length > 0 && (
            <PlaceCardStrip
              places={places}
              activeIndex={activeStop}
              onSelect={handleMarkerClick}
              onShowDetails={setDetailsPlace}
              onRouteFromMe={handleRouteFromMe}
              leftOffset={chatCollapsed ? 0 : chatWidth}
            />
          )}
          {itineraryStops && itineraryStops.length > 0 && (
            <PlaceCardStrip
              places={itineraryStops.map((s) => ({ ...s, personalization_score: 0, categories: [] })) as Place[]}
              activeIndex={activeStop}
              onSelect={handleMarkerClick}
              onShowDetails={(stop) => setDetailsPlace(stop)}
              onRouteFromMe={handleRouteFromMe}
              leftOffset={chatCollapsed ? 0 : chatWidth}
            />
          )}
        </div>
      )}

      {/* Chat overlay on the expanded map — conversation stays reachable */}
      {!isMobile && mapExpanded && !chatCollapsed && (
        <div
          className="absolute top-0 bottom-0 left-0 z-[200] flex flex-col bg-bg/95 backdrop-blur-md border-r border-border animate-slide-left"
          style={{ width: chatWidth }}
        >
          {chatPanel}
          <div
            onMouseDown={startResize}
            title="Drag to resize"
            className="absolute top-0 right-0 h-full w-2 cursor-col-resize group z-20"
          >
            <div className="absolute right-0 top-1/2 -translate-y-1/2 h-16 w-1 rounded-full bg-border group-hover:bg-gold/70 transition-colors" />
          </div>
        </div>
      )}

      {/* Collapsed chat pill on the expanded map */}
      {!isMobile && mapExpanded && chatCollapsed && (
        <CollapsedReply
          content={lastAssistant?.content ?? null}
          loading={loading}
          streaming={loading && streamingStarted}
          onOpen={() => setChatCollapsed(false)}
        />
      )}

      {/* Exit full map — back to the side-panel layout */}
      {!isMobile && mapExpanded && (
        <button
          onClick={() => { setMapExpanded(false); setChatCollapsed(false) }}
          className="absolute top-4 right-4 z-[210] bg-bg/90 backdrop-blur-sm border border-border rounded-xl p-2 text-text2 hover:text-text hover:border-gold/40 transition-all"
          aria-label="Exit full map"
        >
          <svg viewBox="0 0 24 24" className="w-4 h-4 fill-current">
            <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
          </svg>
        </button>
      )}

      {/* ── Mobile layout (<768px) ──────────────────────────────────────────
          Map is the base layer; the chat rides in a draggable bottom sheet
          (collapsed / half / full). Without map data the chat is full-screen. */}
      {isMobile && !showMobileMap && (
        <div className="absolute inset-0 flex animate-fade-up">
          <div className="relative mx-auto flex h-full w-full max-w-2xl flex-col">
            {chatPanel}
          </div>
        </div>
      )}
      {isMobile && showMobileMap && (
        <>
          <div className="absolute inset-0 isolate">
            <MapView
              places={mapPlaces as Place[]}
              itinerary={itineraryStops}
              annotations={annotations}
              activeStopIndex={activeStop}
              onMarkerClick={handleMarkerClick}
              userLocation={userLocation}
              theme={theme}
              showUserLocation={showUserOnMap}
              routeFromUser={routeFromUser}
              customRoute={customRoute}
              routeMode={routeMode}
              onRouteInfo={setRouteInfo}
              onRouteError={setRouteError}
              zoomFocusOnActive={mapZoomFocus}
              aiBusy={loading}
              onPlaceFullDetails={setDetailsPlace}
              onPlaceSave={handleSavePlace}
              onPlaceRoute={handleRouteFromMe}
              savedPlaceIds={savedPlaceIds}
              communityPins={communityPins}
              communityFriends={communityFriends}
              communityLayerOn={communityLayerOn}
              onToggleCommunityLayer={handleToggleCommunityLayer}
              onOpenProfile={handleOpenProfile}
              communityFocus={communityFocus}
              onPlaceShare={handlePlaceShare}
            />
            {/* Status banners pinned near the top — clear of the bottom sheet */}
            <div className="pointer-events-none absolute inset-x-3 top-16 z-[65] flex flex-col items-center gap-2">
              {pinsMismatch && (
                <div className="pointer-events-auto max-w-md rounded-xl border border-gold/40 bg-surface/95 px-4 py-2 text-[13px] text-text backdrop-blur-md">
                  Pins look far from your GPS. Ask Hodari to search again in your city.
                </div>
              )}
              {routeActive && routeError && (
                <div className="pointer-events-auto max-w-md rounded-xl border border-red-500/40 bg-surface/95 px-4 py-2 text-[13px] text-text2 backdrop-blur-md">
                  {routeError}
                </div>
              )}
              {routeFromUser && locationPending && (
                <div className="pointer-events-auto rounded-full border border-border bg-surface/95 px-4 py-2 text-[13px] text-text2 backdrop-blur-md">
                  Getting your location…
                </div>
              )}
              {routeActive && routeInfo && (
                <div className="rounded-full border border-border bg-surface/95 px-4 py-2 text-[13px] text-text shadow-lg backdrop-blur-md">
                  <span className="font-medium text-gold">{routeInfo.destinationName}</span>
                  <span className="text-text2">
                    {' · '}{routeInfo.distance}{' · '}{routeInfo.duration}
                  </span>
                </div>
              )}
            </div>
            {/* Result / itinerary card strip — only while the sheet is a peek */}
            {chatSnap === 'collapsed' && !itineraryStops && places.length > 0 && (
              <div className="absolute inset-x-0 z-[55]" style={{ bottom: SHEET_PEEK_PX }}>
                <PlaceCardStrip
                  places={places}
                  activeIndex={activeStop}
                  onSelect={handleMarkerClick}
                  onShowDetails={setDetailsPlace}
                  onRouteFromMe={handleRouteFromMe}
                  leftOffset={0}
                />
              </div>
            )}
            {chatSnap === 'collapsed' && itineraryStops && itineraryStops.length > 0 && (
              <div className="absolute inset-x-0 z-[55]" style={{ bottom: SHEET_PEEK_PX }}>
                <PlaceCardStrip
                  places={itineraryStops.map((s) => ({ ...s, personalization_score: 0, categories: [] })) as Place[]}
                  activeIndex={activeStop}
                  onSelect={handleMarkerClick}
                  onShowDetails={(stop) => setDetailsPlace(stop)}
                  onRouteFromMe={handleRouteFromMe}
                  leftOffset={0}
                />
              </div>
            )}
          </div>
          <MobileChatSheet
            snap={chatSnap}
            onSnapChange={setChatSnap}
            peek={
              <button
                type="button"
                onClick={() => setChatSnap('half')}
                className="min-h-[44px] w-full px-5 pb-3 text-left"
              >
                <p className="text-[11px] font-medium uppercase tracking-wider text-[#F56A00] dark:text-[#FF8C2F]">
                  Hodari
                </p>
                <p className="mt-0.5 line-clamp-2 text-[13px] leading-snug text-[var(--text-secondary)]">
                  {loading
                    ? 'Working on it…'
                    : lastAssistant?.content || 'Ask me about food, sights, or your matchday plan.'}
                </p>
              </button>
            }
          >
            {chatPanel}
          </MobileChatSheet>
        </>
      )}

      {/* In-app place details */}
      {detailsPlace?.place_id && (
        <PlaceDetailsPanel
          placeId={detailsPlace.place_id}
          fallbackName={detailsPlace.name}
          fallbackMapsUrl={`https://www.google.com/maps/search/?api=1&query=${detailsPlace.coordinates.lat},${detailsPlace.coordinates.lng}&query_place_id=${encodeURIComponent(detailsPlace.place_id)}`}
          onClose={() => setDetailsPlace(null)}
          onShare={() => setShareTarget(detailsPlace)}
        />
      )}

      {/* Community: people, encrypted chats, shared pins */}
      {communityMounted && (
        <CommunityPanel
          open={communityOpen}
          onClose={() => setCommunityOpen(false)}
          currentUserId={USER_ID}
          onFocusPlace={handleCommunityFocusPlace}
          onSharePin={(conversationId) => setShareConversationId(conversationId)}
          onOpenProfile={handleOpenProfile}
        />
      )}
      {profileTarget && (
        <ProfileSheet
          userIdOrHandle={profileTarget}
          onClose={() => setProfileTarget(null)}
          onFocusPlace={(p) => handleCommunityFocusPlace(p.lat, p.lng)}
        />
      )}
      {(shareTarget || shareConversationId) && (
        <SharePinDialog
          place={shareTarget}
          conversationId={shareConversationId}
          candidatePlaces={mapPlaces as Place[]}
          onClose={() => { setShareTarget(null); setShareConversationId(null) }}
          onShared={refreshPins}
        />
      )}

      <Paywall gate={gate} onClose={() => setGate(null)} />

      {/* Dedicated voice UI: a floating orb with the LIVE transcript of what the
          user is saying (browser STT streams interim words) + speak controls. */}
      {uiMode === 'voice' && (
        <div className="fixed right-4 z-[130] bottom-[calc(env(safe-area-inset-bottom,0px)+10rem)] md:bottom-6 md:right-6">
          <VoiceOrb
            compact
            state={voice.voiceState}
            liveText={voice.liveText}
            onToggle={voice.toggleVoice}
            onPause={voice.pauseSpeaking}
            onResume={voice.resumeSpeaking}
            onStopSpeaking={voice.stopSpeakingAndListen}
          />
        </div>
      )}
    </div>
  )
}
