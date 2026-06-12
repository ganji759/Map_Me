'use client'

import { useState, useCallback, useRef, useEffect } from 'react'
import { MessageSquare, Mic } from 'lucide-react'
import { ChatPanel } from '@/components/ChatPanel'
import { MapView, type RouteInfo } from '@/components/MapView'
import { PlaceListPanel } from '@/components/PlaceListPanel'
import { PlaceCardStrip } from '@/components/PlaceCardStrip'
import { CollapsedReply } from '@/components/CollapsedReply'
import { PlaceDetailsPanel } from '@/components/PlaceDetailsPanel'
import { streamChat, fetchSessionState } from '@/lib/stream'
import { pinsFarFromUser, requestUserLocation } from '@/lib/geo'
import {
  applyMapActions,
  parseMapActions,
  shouldAttachGps,
  type CustomRouteConfig,
  type MapActionEffects,
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
import type { ChatMessage, Place, Itinerary, ItineraryStop, Theme } from '@/lib/types'

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
  const [selectedModel, setSelectedModel] = useState<ModelId>('gemini-3.5')
  const [theme, setTheme] = useState<Theme>(() => {
    if (typeof window === 'undefined') return 'light'
    const saved = localStorage.getItem('hodari_theme')
    return saved === 'dark' ? 'dark' : 'light'
  })
  const [userLocation, setUserLocation] = useState<{ lat: number; lng: number } | null>(null)
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
  const [savedPlaceIds, setSavedPlaceIds] = useState<Set<string>>(() => {
    if (typeof window === 'undefined') return new Set()
    try { return new Set(JSON.parse(localStorage.getItem('hodari_saved') ?? '[]')) } catch { return new Set() }
  })

  useEffect(() => { placesRef.current = places }, [places])
  useEffect(() => { itineraryRef.current = itinerary }, [itinerary])
  useEffect(() => { activeStopRef.current = activeStop }, [activeStop])
  useEffect(() => { speakRepliesRef.current = speakReplies }, [speakReplies])

  // Auto-fetch photos for places that came back without one
  const placeIdsKey = places.map((p) => p.place_id).join(',')
  useEffect(() => {
    const toFetch = places.filter(
      (p) => p.place_id && !p.place_id.startsWith('__') && !p.photo_url && !p.photos?.length && !fetchedPhotoIdsRef.current.has(p.place_id),
    )
    if (!toFetch.length) return
    toFetch.forEach((place) => {
      fetchedPhotoIdsRef.current.add(place.place_id)
      fetch(`/api/place-photos?placeId=${encodeURIComponent(place.place_id)}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => {
          if (!data?.photoUrls?.length) return
          setPlaces((prev) =>
            prev.map((p) =>
              p.place_id === place.place_id ? { ...p, photo_url: data.photoUrls[0], photos: data.photoUrls } : p,
            ),
          )
        })
        .catch(() => {})
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [placeIdsKey])

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
    const enriched = attachGps && userLocation
      ? `${text}\n[User location: ${userLocation.lat.toFixed(5)}, ${userLocation.lng.toFixed(5)}]`
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
      if (err instanceof Error && err.name === 'AbortError') {
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
  }, [userLocation, places, itinerary, activeStop, suppressGpsContext]) // eslint-disable-line react-hooks/exhaustive-deps

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

  const ensureUserLocation = useCallback(async (): Promise<boolean> => {
    if (userLocation) return true
    setLocationPending(true)
    const loc = await requestUserLocation()
    setLocationPending(false)
    if (loc) { setUserLocation(loc); return true }
    setRouteError('Allow location access in your browser (lock icon in the address bar), then tap Route from me again.')
    return false
  }, [userLocation])

  const handleMarkerClick = useCallback((index: number) => {
    setActiveStop(index)
    setMapZoomFocus(true)
    setMapVisible(true)
    const list = itinerary?.stops ?? places
    const item = list[index]
    if (item) setDetailsPlace(item as Place)
    setCustomRoute(null)
    setRouteFromUser(true)
    setRouteInfo(null)
    setRouteError(null)
    void ensureUserLocation()
  }, [places, itinerary, ensureUserLocation])

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
    handleSend(prompt)
  }, [handleSend])

  const handleNewChat = useCallback(() => {
    cancelSpeech()
    sessionId.current = uid()
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
  }, [])

  const handleSelectHistory = useCallback((id: string) => {
    const item = historyItems.find((entry) => entry.id === id)
    if (!item) return
    cancelSpeech()
    sessionId.current = item.id
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
  }, [historyItems])

  const handleDeleteHistory = useCallback((id: string) => {
    setHistoryItems((prev) => prev.filter((item) => item.id !== id))
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
    try {
      const savedHistory = localStorage.getItem('hodari_history')
      const parsed = savedHistory ? JSON.parse(savedHistory) as HistoryItem[] : []
      if (Array.isArray(parsed)) setHistoryItems(parsed.slice(0, 20))
    } catch {
      setHistoryItems([])
    } finally {
      setHistoryLoaded(true)
    }
  }, [])

  useEffect(() => {
    if (!historyLoaded) return
    localStorage.setItem('hodari_history', JSON.stringify(historyItems.slice(0, 20)))
  }, [historyItems, historyLoaded])

  useEffect(() => {
    if (!messages.length) return
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

  useEffect(() => {
    if (!navigator.geolocation) return
    const apply = (pos: GeolocationPosition) =>
      setUserLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude })
    navigator.geolocation.getCurrentPosition(apply, () => {}, { enableHighAccuracy: true, timeout: 20_000, maximumAge: 120_000 })
    const watchId = navigator.geolocation.watchPosition(apply, () => {}, { enableHighAccuracy: true, maximumAge: 60_000 })
    return () => navigator.geolocation.clearWatch(watchId)
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
  const hasMapData = mapPlaces.length > 0

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
      speakReplies={speakReplies}
      speechOutSupported={speechOutSupported}
      onToggleSpeakReplies={() => setSpeakReplies((v) => { const nv = !v; if (!nv) cancelSpeech(); return nv })}
      onCollapse={mapExpanded ? () => setChatCollapsed(true) : undefined}
      onStop={handleStop}
      uiMode={uiMode}
      onEnterChatMode={enterChatMode}
      onEnterVoiceMode={enterVoiceMode}
    />
  )

  const selectedPlace = activeStop != null && mapPlaces[activeStop]
    ? (mapPlaces[activeStop] as Place)
    : null

  return (
    <div className="relative h-screen w-screen overflow-hidden">

      {/* Mode toggle when chat panel is collapsed on full-screen map */}
      {mapExpanded && chatCollapsed && (
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
      {!mapExpanded && (
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
              <div className="relative h-[min(34vh,260px)] min-h-[180px] shrink-0 p-2">
                <MapView
                  places={mapPlaces as Place[]}
                  itinerary={itineraryStops}
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
                  size="compact"
                  hideInlinePlaceCard
                  onExpand={() => { setMapExpanded(true); setMapVisible(true); setChatCollapsed(false) }}
                  selectedPlace={selectedPlace}
                  routeInfo={routeInfo}
                  onDirections={activeStop != null ? () => handleRouteFromMe(activeStop) : undefined}
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
              {!itineraryStops && places.length > 0 && (
                <PlaceListPanel
                  places={places}
                  activeIndex={activeStop}
                  onSelect={handleMarkerClick}
                  onShowDetails={setDetailsPlace}
                  onSave={handleSavePlace}
                  savedIds={savedPlaceIds}
                />
              )}
              {itineraryStops && itineraryStops.length > 0 && (
                <PlaceListPanel
                  places={itineraryStops.map((s) => ({ ...s, personalization_score: 0, categories: [] })) as Place[]}
                  activeIndex={activeStop}
                  onSelect={handleMarkerClick}
                  onShowDetails={(stop) => setDetailsPlace(stop)}
                  onSave={handleSavePlace}
                  savedIds={savedPlaceIds}
                />
              )}
            </aside>
          )}
        </div>
      )}

      {/* Expanded full-screen map — `isolate` creates a stacking context so Google
          Maps' internal z-indices (up to ~1000002) don't escape and cover the chat */}
      {mapExpanded && (
        <div className="absolute inset-0 isolate">
          <MapView
            places={mapPlaces as Place[]}
            itinerary={itineraryStops}
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
              leftOffset={chatCollapsed ? 0 : chatWidth}
            />
          )}
          {itineraryStops && itineraryStops.length > 0 && (
            <PlaceCardStrip
              places={itineraryStops.map((s) => ({ ...s, personalization_score: 0, categories: [] })) as Place[]}
              activeIndex={activeStop}
              onSelect={handleMarkerClick}
              onShowDetails={(stop) => setDetailsPlace(stop)}
              leftOffset={chatCollapsed ? 0 : chatWidth}
            />
          )}
        </div>
      )}

      {/* Chat overlay on the expanded map — conversation stays reachable */}
      {mapExpanded && !chatCollapsed && (
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
      {mapExpanded && chatCollapsed && (
        <CollapsedReply
          content={lastAssistant?.content ?? null}
          loading={loading}
          streaming={loading && streamingStarted}
          onOpen={() => setChatCollapsed(false)}
        />
      )}

      {/* Exit full map — back to the side-panel layout */}
      {mapExpanded && (
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

      {/* In-app place details */}
      {detailsPlace?.place_id && (
        <PlaceDetailsPanel
          placeId={detailsPlace.place_id}
          fallbackName={detailsPlace.name}
          fallbackMapsUrl={`https://www.google.com/maps/search/?api=1&query=${detailsPlace.coordinates.lat},${detailsPlace.coordinates.lng}&query_place_id=${encodeURIComponent(detailsPlace.place_id)}`}
          onClose={() => setDetailsPlace(null)}
        />
      )}
    </div>
  )
}
