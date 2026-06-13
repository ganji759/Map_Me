import { findPlaceIndexInText } from './mapIntents'
import type { Itinerary, Place } from './types'
import { isValidCoord, type LatLng } from './geo'

export type { TravelMode } from './routing'
import type { TravelMode } from './routing'

export type MapAction =
  | { op: 'hide_user_location' }
  | { op: 'show_user_location' }
  | { op: 'open_map' }
  | { op: 'close_map' }
  | { op: 'expand_map' }
  | { op: 'compact_map' }
  | { op: 'chat_only' }
  | { op: 'clear_route' }
  | { op: 'focus_place'; place_index?: number; place_name?: string }
  | { op: 'keep_only'; place_index?: number; place_name?: string }
  | { op: 'route'; from: 'user' | 'landmark'; landmark?: string; to_place_index?: number; to_place_name?: string; mode?: TravelMode }
  | { op: 'suppress_gps_context' }
  | { op: 'highlight_place'; place_index?: number; place_name?: string; color?: string }
  | { op: 'circle_place'; place_index?: number; place_name?: string; color?: string; radius_m?: number }
  | { op: 'clear_annotations' }

// ── Map annotations (AI-drawn colors / circles / extra markers) ──────────────

const ANNOTATION_COLORS: Record<string, string> = {
  green: '#1FA463',
  red: '#E5484D',
  blue: '#2E7DF6',
  purple: '#8B5CF6',
  black: '#1F2430',
  yellow: '#F5B800',
  pink: '#E64980',
  orange: '#F56A00',
}

/** Map a color name (or #hex) to a hex string; defaults to a clear green. */
export function normalizeAnnotationColor(name?: string): string {
  if (!name) return ANNOTATION_COLORS.green
  const k = name.trim().toLowerCase()
  if (ANNOTATION_COLORS[k]) return ANNOTATION_COLORS[k]
  return /^#[0-9a-f]{6}$/i.test(name.trim()) ? name.trim() : ANNOTATION_COLORS.green
}

export interface AnnotationMarker { id: string; name: string; coordinates: LatLng; color: string }
export interface AnnotationCircle { id: string; center: LatLng; radiusM: number; color: string }

export interface MapAnnotations {
  /** place_id -> color, recolors a pin already on the map. */
  colors: Record<string, string>
  /** Extra markers overlaid for places not in the current list. */
  markers: AnnotationMarker[]
  /** Highlight circles to draw. */
  circles: AnnotationCircle[]
}

export const EMPTY_ANNOTATIONS: MapAnnotations = { colors: {}, markers: [], circles: [] }

export interface CustomRouteConfig {
  from: 'user' | 'landmark'
  landmark?: string
  destinationIndex: number
  mode: TravelMode
}

export interface MapActionContext {
  places: Place[]
  itinerary: Itinerary | null
  activeStop: number | null
  /** Raw session payloads — used when React state is not hydrated yet */
  sessionCandidates?: unknown
  sessionItinerary?: unknown
  intentType?: string
}

function unwrapPlaceList(parsed: unknown): unknown[] {
  if (Array.isArray(parsed)) return parsed
  if (parsed && typeof parsed === 'object') {
    const o = parsed as Record<string, unknown>
    for (const key of ['places', 'candidates', 'results', 'items']) {
      if (Array.isArray(o[key])) return o[key] as unknown[]
    }
  }
  return []
}

function normalizePlace(raw: unknown): Place | null {
  if (!raw || typeof raw !== 'object') return null
  const p = raw as Record<string, unknown>
  let coordinates = p.coordinates as Place['coordinates'] | undefined
  if (!coordinates && typeof p.lat === 'number' && typeof p.lng === 'number') {
    coordinates = { lat: p.lat, lng: p.lng }
  }
  if (!coordinates || typeof coordinates.lat !== 'number' || typeof coordinates.lng !== 'number') {
    return null
  }
  const placeId = p.place_id ?? p.id ?? p.name
  const name = p.name
  if (!placeId || !name) return null
  return {
    place_id: String(placeId),
    name: String(name),
    address: String(p.address ?? ''),
    coordinates,
    categories: Array.isArray(p.categories) ? (p.categories as string[]) : [],
    rating: typeof p.rating === 'number' ? p.rating : undefined,
    price_level: typeof p.price_level === 'string' ? p.price_level : undefined,
    open_now: typeof p.open_now === 'boolean' ? p.open_now : undefined,
    summary: typeof p.summary === 'string' ? p.summary : undefined,
    maps_url: typeof p.maps_url === 'string' ? p.maps_url : undefined,
    photo_url: typeof p.photo_url === 'string' ? p.photo_url : undefined,
    photo_reference: typeof p.photo_reference === 'string' ? p.photo_reference : undefined,
    photos: Array.isArray(p.photos)
      ? (p.photos as unknown[]).filter((x): x is string => typeof x === 'string')
      : undefined,
    personalization_score: 0,
  } as Place & { personalization_score?: number }
}

/** Parse candidates/places from agent session state (string, array, or wrapped object). */
export function parseSessionPlaces(raw: unknown): Place[] {
  if (!raw) return []
  try {
    let parsed: unknown = raw
    if (typeof raw === 'string') {
      const clean = raw
        .replace(/^```json\s*/i, '')
        .replace(/^```\s*/i, '')
        .replace(/\s*```$/i, '')
        .trim()
      if (!clean || clean === '[]' || clean === '""') return []
      parsed = JSON.parse(clean)
      if (typeof parsed === 'string') {
        const inner = parsed.trim()
        if (inner && inner !== '[]') parsed = JSON.parse(inner)
      }
    }
    const list = unwrapPlaceList(parsed)
    return list.map(normalizePlace).filter((p): p is Place => p !== null)
  } catch {
    return []
  }
}

export function parseSessionItinerary(raw: unknown): Itinerary | null {
  if (!raw) return null
  try {
    let parsed: unknown = raw
    if (typeof raw === 'string') {
      const clean = raw
        .replace(/^```json\s*/i, '')
        .replace(/^```\s*/i, '')
        .replace(/\s*```$/i, '')
        .trim()
      if (!clean || clean === '""' || clean === '{}') return null
      parsed = JSON.parse(clean)
    }
    const it = parsed as Itinerary
    if (!Array.isArray(it?.stops) || it.stops.length === 0) return null
    return it
  } catch {
    return null
  }
}

export interface MapActionEffects {
  showUserOnMap?: boolean
  suppressGpsContext?: boolean
  mapOpen?: boolean
  mapExpanded?: boolean
  mapZoomFocus?: boolean
  activeStop?: number | null
  places?: Place[]
  clearItinerary?: boolean
  soloPlaceMode?: boolean
  routeFromUser?: boolean
  customRoute?: CustomRouteConfig | null
  routeMode?: TravelMode
}

const VALID_OPS = new Set([
  'hide_user_location',
  'show_user_location',
  'open_map',
  'close_map',
  'expand_map',
  'compact_map',
  'chat_only',
  'clear_route',
  'focus_place',
  'keep_only',
  'route',
  'suppress_gps_context',
  'highlight_place',
  'circle_place',
  'clear_annotations',
])

export function parseMapActions(raw: unknown): MapAction[] {
  if (!raw) return []
  try {
    const str = typeof raw === 'string' ? raw : JSON.stringify(raw)
    const clean = str.trim()
    if (!clean || clean === '""' || clean === '[]') return []
    const parsed = JSON.parse(clean) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (a): a is MapAction =>
        typeof a === 'object' &&
        a !== null &&
        'op' in a &&
        typeof (a as { op: string }).op === 'string' &&
        VALID_OPS.has((a as { op: string }).op),
    )
  } catch {
    return []
  }
}

function visiblePlaces(ctx: MapActionContext): Place[] {
  if (ctx.itinerary?.stops?.length) {
    return ctx.itinerary.stops.map((s) => ({
      ...s,
      personalization_score: 0,
      categories: [] as string[],
    }))
  }
  if (ctx.places.length > 0) return ctx.places

  const sessionPlaces = parseSessionPlaces(ctx.sessionCandidates)
  if (sessionPlaces.length > 0) {
    console.log('[hodari:mapActions] resolved places from sessionCandidates:', sessionPlaces.length)
    return sessionPlaces
  }

  const sessionItin = parseSessionItinerary(ctx.sessionItinerary)
  if (sessionItin?.stops?.length && ctx.intentType !== 'LIST_DISCOVERY') {
    console.log('[hodari:mapActions] resolved places from sessionItinerary:', sessionItin.stops.length)
    return sessionItin.stops.map((s) => ({
      ...s,
      personalization_score: 0,
      categories: [] as string[],
    }))
  }

  return []
}

function resolveIndex(
  action: { place_index?: number; place_name?: string },
  list: Place[],
  fallback: number | null,
): number | null {
  if (
    typeof action.place_index === 'number' &&
    action.place_index >= 0 &&
    action.place_index < list.length
  ) {
    return action.place_index
  }
  if (action.place_name) {
    const idx = findPlaceIndexInText(action.place_name, list)
    if (idx !== null) return idx
  }
  if (fallback !== null && fallback < list.length) return fallback
  return null
}

/** Apply agent map_control actions to client UI state. */
export function applyMapActions(
  actions: MapAction[],
  ctx: MapActionContext,
): MapActionEffects {
  const resolvedList = visiblePlaces(ctx)

  // Session places may arrive before React state hydrates — write into ctx now.
  if (!ctx.itinerary?.stops?.length && resolvedList.length > 0) {
    ctx.places = resolvedList
  }
  console.log('[map] places saved to ctx:', ctx.places?.length ?? 0)

  if (actions.length > 0) {
    console.log(
      '[hodari:mapActions] dispatch',
      actions.map((a) => a.op),
      '| places in ctx:',
      ctx.places.length,
      '| itinerary stops:',
      ctx.itinerary?.stops?.length ?? 0,
    )
  }

  const effects: MapActionEffects = {}
  const list = ctx.places.length > 0 ? ctx.places : resolvedList
  let active = ctx.activeStop

  for (const action of actions) {
    switch (action.op) {
      case 'hide_user_location':
        effects.showUserOnMap = false
        effects.routeFromUser = false
        effects.customRoute = null
        break
      case 'show_user_location':
        console.log('[map] show_user_location triggered')
        effects.showUserOnMap = true
        effects.suppressGpsContext = false
        effects.mapOpen = true
        effects.mapZoomFocus = true
        break
      case 'open_map':
      case 'compact_map':
        effects.mapOpen = true
        effects.mapExpanded = false
        break
      case 'expand_map':
        effects.mapOpen = true
        effects.mapExpanded = true
        break
      case 'chat_only':
      case 'close_map':
        effects.mapOpen = false
        effects.mapExpanded = false
        break
      case 'clear_route':
        effects.routeFromUser = false
        effects.customRoute = null
        break
      case 'suppress_gps_context':
        effects.suppressGpsContext = true
        effects.showUserOnMap = false
        break
      case 'focus_place': {
        const idx = resolveIndex(action, list, active)
        if (idx !== null) {
          active = idx
          effects.activeStop = idx
          effects.mapZoomFocus = true
          effects.mapOpen = true
        }
        break
      }
      case 'keep_only': {
        const idx = resolveIndex(action, list, active)
        if (idx !== null) {
          effects.places = [list[idx]]
          effects.clearItinerary = true
          effects.activeStop = 0
          effects.soloPlaceMode = true
          effects.mapZoomFocus = true
          effects.mapOpen = true
          active = 0
        }
        break
      }
      case 'route': {
        const destIdx = resolveIndex(
          {
            place_index: action.to_place_index,
            place_name: action.to_place_name,
          },
          list,
          active,
        )
        if (destIdx === null) break
        const mode: TravelMode =
          action.mode === 'DRIVE' || action.mode === 'TRANSIT' || action.mode === 'BICYCLE'
            ? action.mode
            : 'WALK'
        effects.activeStop = destIdx
        effects.mapOpen = true
        effects.routeMode = mode
        active = destIdx
        if (action.from === 'user') {
          effects.routeFromUser = true
          effects.customRoute = null
        } else if (action.landmark) {
          effects.routeFromUser = false
          effects.customRoute = {
            from: 'landmark',
            landmark: action.landmark,
            destinationIndex: destIdx,
            mode,
          }
          effects.showUserOnMap = false
        }
        break
      }
      default:
        break
    }
  }

  const opensMap = actions.some(
    (a) =>
      a.op === 'open_map' ||
      a.op === 'compact_map' ||
      a.op === 'expand_map' ||
      a.op === 'focus_place' ||
      a.op === 'route' ||
      a.op === 'keep_only' ||
      a.op === 'show_user_location',
  )
  if (opensMap && effects.places === undefined && list.length > 0 && !ctx.itinerary?.stops?.length) {
    effects.places = list
    ctx.places = list
    console.log('[map] places saved to ctx:', ctx.places.length)
  }

  if (actions.length > 0) {
    console.log('[hodari:mapActions] effects →', effects)
  }

  return effects
}

export function mergeMapActionEffects(
  current: MapActionEffects,
  next: MapActionEffects,
): MapActionEffects {
  return { ...current, ...next }
}

function upsertById<T extends { id: string }>(arr: T[], item: T): T[] {
  const i = arr.findIndex((x) => x.id === item.id)
  if (i === -1) return [...arr, item]
  const copy = arr.slice()
  copy[i] = item
  return copy
}

/**
 * Apply highlight_place / circle_place / clear_annotations actions to the map
 * annotation state. A place is resolved against the current visible list first,
 * then against `memory` (every place seen this session) — so the AI can color
 * or circle a place from an earlier search (e.g. mark the restaurant green while
 * the hotels stay orange). Places not in the current list become extra markers.
 */
export function applyAnnotationActions(
  actions: MapAction[],
  list: Place[],
  memory: Place[],
  current: MapAnnotations,
): MapAnnotations {
  let next = current

  const resolve = (a: { place_index?: number; place_name?: string }): Place | null => {
    if (typeof a.place_index === 'number' && a.place_index >= 0 && a.place_index < list.length) {
      return list[a.place_index]
    }
    if (a.place_name) {
      const li = findPlaceIndexInText(a.place_name, list)
      if (li !== null) return list[li]
      const mi = findPlaceIndexInText(a.place_name, memory)
      if (mi !== null) return memory[mi]
    }
    return null
  }

  for (const action of actions) {
    if (action.op === 'clear_annotations') {
      next = { colors: {}, markers: [], circles: [] }
      continue
    }
    if (action.op !== 'highlight_place' && action.op !== 'circle_place') continue

    const place = resolve(action)
    if (!place || !isValidCoord(place.coordinates)) continue
    const color = normalizeAnnotationColor(action.color)
    const inList = list.some((x) => x.place_id === place.place_id)

    next = {
      ...next,
      colors: { ...next.colors, [place.place_id]: color },
      markers: inList
        ? next.markers
        : upsertById(next.markers, { id: place.place_id, name: place.name, coordinates: place.coordinates, color }),
    }

    if (action.op === 'circle_place') {
      const radiusM =
        typeof action.radius_m === 'number' && action.radius_m > 0
          ? Math.min(action.radius_m, 5000)
          : 350
      next = {
        ...next,
        circles: upsertById(next.circles, { id: place.place_id, center: place.coordinates, radiusM, color }),
      }
    }
  }

  return next
}

/** Whether to attach GPS coordinates to the agent message. */
export function shouldAttachGps(
  text: string,
  userLocation: LatLng | null,
  suppressGpsContext: boolean,
): boolean {
  if (!userLocation) return false
  if (suppressGpsContext) return false
  const t = text.toLowerCase()
  if (/\b(hide|don't show|do not show|remove)\b.{0,30}\b(my )?(location|gps|position)\b/.test(t)) {
    return false
  }
  if (/\b(not from me|don't route from me|do not route from me|ignore my (gps|location))\b/.test(t)) {
    return false
  }
  if (
    /\b(without my location|ignore my gps|not my location)\b/.test(t)
  ) {
    return false
  }
  // Browsing a named place/city — don't bias search with distant GPS.
  if (
    /\b(near|around|by|from)\b.{0,40}\b(louvre|paris|eiffel|musee|musée|museum)\b/.test(t) &&
    !/\bnear me\b/.test(t)
  ) {
    return false
  }
  return true
}
