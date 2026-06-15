'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { APIProvider, Map, Map3D, Marker3D, MapMode, AltitudeMode, AdvancedMarker, InfoWindow, Pin, useMap, useMap3D, useMapsLibrary } from '@vis.gl/react-google-maps'
import { AlertCircle, ChevronLeft, Compass, ExternalLink, Globe, Image as ImageIcon, Loader2, MapPin, Maximize2, Minimize2, Navigation, RotateCcw, RotateCw, Star } from 'lucide-react'
import type { ItineraryStop, Place, Theme } from '@/lib/types'
import type { CustomRouteConfig, MapAnnotations, TravelMode } from '@/lib/mapActions'
import {
  distanceKm,
  isValidCoord,
  shouldIncludeUserInBounds,
  type LatLng,
} from '@/lib/geo'
import { PlaceImage } from './PlaceImage'
import { cinematicMapKeys } from '@/lib/animationMemory'

const API_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? ''
const ROUTE_ORANGE = '#F56A00'
const KIGALI_DEFAULT: LatLng = { lat: -1.9441, lng: 30.0619 }
const DEFAULT_ZOOM = 13

/** 3D camera defaults — vector maps get true perspective, raster falls back to 45° imagery. */
const VECTOR_3D_TILT = 55
const RASTER_3D_TILT = 45
const DEFAULT_3D_HEADING = 20

type FitPadding = number | { top: number; right: number; bottom: number; left: number }

/**
 * Per-map cancel hooks so programmatic fits (PreciseMapFit / MapZoomFocus /
 * route fitBounds) never fight the cinematic camera animations.
 */
const cameraInterrupts = new WeakMap<google.maps.Map, () => void>()

function cancelCameraMotion(map: google.maps.Map | null | undefined) {
  if (!map) return
  cameraInterrupts.get(map)?.()
}

/** Once the user gestures on the map, never auto-orbit again this session. */
let orbitStoppedForSession = false

function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  )
}

/** Standard light roadmap — no orange tint on land/water (orange only on route + pins). */
const MAP_STYLES: google.maps.MapTypeStyle[] = [
  { featureType: 'transit', stylers: [{ visibility: 'off' }] },
]

function boundsSpanKm(bounds: google.maps.LatLngBounds): number {
  const ne = bounds.getNorthEast()
  const sw = bounds.getSouthWest()
  return distanceKm({ lat: sw.lat(), lng: sw.lng() }, { lat: ne.lat(), lng: ne.lng() })
}

function clampZoomAfterFit(map: google.maps.Map, minZoom: number, maxZoom: number) {
  const listener = google.maps.event.addListenerOnce(map, 'idle', () => {
    const z = map.getZoom()
    if (z == null) return
    if (z < minZoom) map.setZoom(minZoom)
    else if (z > maxZoom) map.setZoom(maxZoom)
  })
  return () => google.maps.event.removeListener(listener)
}

function fitMapPrecisely(
  map: google.maps.Map,
  markers: LatLng[],
  opts: {
    padding?: FitPadding
    minZoom?: number
    maxZoom?: number
    maxSpanKm?: number
    focus?: LatLng | null
    userLocation?: LatLng | null
    includeUser?: boolean
  } = {},
) {
  const valid = markers.filter(isValidCoord)
  if (valid.length === 0) return

  const minZoom = opts.minZoom ?? 15
  const maxZoom = opts.maxZoom ?? 17
  const maxSpanKm = opts.maxSpanKm ?? 32
  const padding = opts.padding ?? 48

  const fitUser =
    opts.includeUser &&
    opts.userLocation &&
    isValidCoord(opts.userLocation) &&
    shouldIncludeUserInBounds(opts.userLocation, valid)

  if (valid.length === 1 && !fitUser) {
    map.setCenter(valid[0])
    map.setZoom(maxZoom)
    return
  }

  const bounds = new google.maps.LatLngBounds()
  for (const m of valid) bounds.extend(m)
  if (fitUser && opts.userLocation) bounds.extend(opts.userLocation)

  const span = boundsSpanKm(bounds)
  if (span > maxSpanKm) {
    const focus =
      opts.focus && isValidCoord(opts.focus)
        ? opts.focus
        : fitUser && opts.userLocation
          ? opts.userLocation
          : valid[0]
    map.setCenter(focus)
    map.setZoom(minZoom)
    return
  }

  const pad =
    typeof padding === 'number'
      ? { top: padding, right: padding, bottom: padding, left: padding }
      : padding
  map.fitBounds(bounds, pad)
  clampZoomAfterFit(map, minZoom, maxZoom)
}

export type MapViewSize = 'compact' | 'full'

export interface RouteInfo {
  distance: string
  duration: string
  destinationName: string
  originLabel?: string
}

interface Props {
  places: Place[]
  itinerary: ItineraryStop[] | null
  /** AI-drawn map annotations (colored pins, circles, extra markers). */
  annotations?: MapAnnotations
  activeStopIndex: number | null
  onMarkerClick: (index: number) => void
  userLocation: { lat: number; lng: number } | null
  theme: Theme
  showUserLocation?: boolean
  routeFromUser?: boolean
  customRoute?: CustomRouteConfig | null
  routeMode?: TravelMode
  onRouteInfo?: (info: RouteInfo | null) => void
  onRouteError?: (message: string | null) => void
  zoomFocusOnActive?: boolean
  size?: MapViewSize
  onExpand?: () => void
  onCollapse?: () => void
  selectedPlace?: Place | null
  loading?: boolean
  error?: string | null
  onRetry?: () => void
  bottomSlot?: React.ReactNode
  hideInlinePlaceCard?: boolean
  onDirections?: () => void
  routeInfo?: RouteInfo | null
  /** Optional bar rendered above the map canvas (voice mode). */
  header?: ReactNode
  /** Full-map marker action bubble (opens the full details panel / saves / routes). */
  onPlaceFullDetails?: (place: Place) => void
  onPlaceSave?: (place: Place) => void
  onPlaceRoute?: (index: number) => void
  savedPlaceIds?: Set<string>
}

function RoutePolyline({ stops }: { stops: ItineraryStop[] }) {
  const map = useMap()
  const polylinesRef = useRef<google.maps.Polyline[]>([])
  const directionsRenderersRef = useRef<google.maps.DirectionsRenderer[]>([])

  useEffect(() => {
    if (!map || stops.length < 2) return

    polylinesRef.current.forEach((p) => p.setMap(null))
    polylinesRef.current = []
    directionsRenderersRef.current.forEach((r) => r.setMap(null))
    directionsRenderersRef.current = []

    const style = {
      geodesic: true,
      strokeColor: ROUTE_ORANGE,
      strokeOpacity: 0.9,
      strokeWeight: 4,
      map,
    }

    const directionsService = new google.maps.DirectionsService()

    for (let i = 1; i < stops.length; i++) {
      const enc = stops[i].travel_from_prev?.encoded_polyline
      if (enc && google.maps.geometry?.encoding) {
        const path = google.maps.geometry.encoding.decodePath(enc)
        polylinesRef.current.push(new google.maps.Polyline({ ...style, path }))
      } else {
        const origin = { lat: stops[i - 1].coordinates.lat, lng: stops[i - 1].coordinates.lng }
        const destination = { lat: stops[i].coordinates.lat, lng: stops[i].coordinates.lng }
        const renderer = new google.maps.DirectionsRenderer({
          map,
          suppressMarkers: true,
          polylineOptions: { strokeColor: ROUTE_ORANGE, strokeOpacity: 0.9, strokeWeight: 4 },
        })
        directionsRenderersRef.current.push(renderer)
        directionsService.route(
          { origin, destination, travelMode: google.maps.TravelMode.WALKING },
          (result, status) => {
            if (status === 'OK' && result) renderer.setDirections(result)
          },
        )
      }
    }

    return () => {
      polylinesRef.current.forEach((p) => p.setMap(null))
      directionsRenderersRef.current.forEach((r) => r.setMap(null))
    }
  }, [map, stops])

  return null
}

function markerSetKey(markers: LatLng[], userLocation: LatLng | null, includeUser: boolean): string {
  const pts = markers.filter(isValidCoord).map((m) => `${m.lat.toFixed(5)},${m.lng.toFixed(5)}`).sort()
  const user =
    includeUser && userLocation && isValidCoord(userLocation)
      ? `${userLocation.lat.toFixed(5)},${userLocation.lng.toFixed(5)}`
      : ''
  return `${pts.join('|')}|u:${user}`
}

/** Center on place pins — not the user's GPS when results are in a different city. */
function PlacesMapCenter({ places }: { places: LatLng[] }) {
  const map = useMap()
  const placesKey = places.map((p) => `${p.lat.toFixed(5)},${p.lng.toFixed(5)}`).join('|')
  const lastCenterKey = useRef('')

  useEffect(() => {
    if (!map || places.length === 0) return

    const valid = places.filter(isValidCoord)
    if (valid.length === 0) return

    // Only re-center when the place set actually changes — not on unrelated
    // re-renders (e.g. map-mode switches), which would stomp the camera.
    if (lastCenterKey.current === placesKey) return
    lastCenterKey.current = placesKey

    cancelCameraMotion(map)
    const first = valid[0]
    map.setCenter(first)
    map.setZoom(15)

    if (valid.length > 1) {
      const bounds = new google.maps.LatLngBounds()
      valid.forEach((c) => bounds.extend(c))
      map.fitBounds(bounds, { top: 60, right: 40, bottom: 40, left: 40 })
    }
  }, [map, placesKey, places])

  return null
}

function PreciseMapFit({
  markers,
  userLocation,
  includeUser,
  focus,
  size,
}: {
  markers: LatLng[]
  userLocation: LatLng | null
  includeUser: boolean
  focus?: LatLng | null
  size: MapViewSize
}) {
  const map = useMap()
  const lastFitKey = useRef('')

  useEffect(() => {
    if (!map || markers.length === 0) return
    const valid = markers.filter(isValidCoord)
    if (valid.length === 0) return

    const fitKey = `${markerSetKey(valid, userLocation, includeUser)}|${size}`
    if (lastFitKey.current === fitKey) return
    lastFitKey.current = fitKey

    cancelCameraMotion(map)
    const isFull = size === 'full'
    fitMapPrecisely(map, valid, {
      padding: isFull
        ? { top: 96, right: 44, bottom: 220, left: 44 }
        : 36,
      minZoom: 15,
      maxZoom: isFull ? 17 : 18,
      maxSpanKm: isFull ? 28 : 32,
      focus,
      userLocation,
      includeUser,
    })
  }, [map, markers, userLocation, includeUser, focus?.lat, focus?.lng, size])

  return null
}

function MapZoomFocus({
  position,
  enabled,
  targetZoom = 16,
}: {
  position: LatLng | null
  enabled: boolean
  targetZoom?: number
}) {
  const map = useMap()
  const lastFocusKey = useRef('')

  useEffect(() => {
    if (!map || !enabled || !position || !isValidCoord(position)) {
      if (!enabled) lastFocusKey.current = ''
      return
    }
    const focusKey = `${position.lat.toFixed(5)},${position.lng.toFixed(5)}@${targetZoom}`
    if (lastFocusKey.current === focusKey) return
    lastFocusKey.current = focusKey
    cancelCameraMotion(map)
    map.setCenter(position)
    map.setZoom(targetZoom)
  }, [map, position?.lat, position?.lng, enabled, targetZoom])

  return null
}

type MapDisplayMode = '3d' | 'map' | 'satellite' | 'realistic'

const MAP_MODE_OPTIONS: { id: MapDisplayMode; label: string }[] = [
  { id: '3d', label: '3D' },
  { id: 'map', label: 'Map' },
  { id: 'satellite', label: 'Satellite' },
  // Photorealistic Google 3D (Map3DElement). Coverage is US-centric today —
  // which fits the 11 US World Cup host cities; elsewhere it shows a plain globe.
  { id: 'realistic', label: 'Realistic' },
]

function MapUiOptions({ fullControls }: { fullControls: boolean }) {
  const map = useMap()

  useEffect(() => {
    if (!map || typeof google === 'undefined') return
    if (fullControls) {
      map.setOptions({
        zoomControl: true,
        streetViewControl: true,
        fullscreenControl: true,
        mapTypeControl: false,
        // Custom rotate cluster replaces the native compass widget; vector
        // maps then rotate/tilt freely via Ctrl+drag (two fingers on touch).
        rotateControl: false,
        headingInteractionEnabled: true,
        tiltInteractionEnabled: true,
      })
    } else {
      map.setOptions({
        zoomControl: false,
        streetViewControl: false,
        fullscreenControl: false,
        mapTypeControl: false,
        rotateControl: false,
        headingInteractionEnabled: false,
        tiltInteractionEnabled: false,
      })
    }
  }, [map, fullControls])

  return null
}

/** Segmented pill control — brand-styled replacement for the old map-type <select>. */
function MapModeControl({
  mode,
  onChange,
}: {
  mode: MapDisplayMode
  onChange: (mode: MapDisplayMode) => void
}) {
  return (
    <div className="pointer-events-none absolute left-1/2 top-4 z-[58] -translate-x-1/2">
      <div
        role="group"
        aria-label="Map mode"
        className="pointer-events-auto flex items-center gap-0.5 rounded-full border border-gray-200 bg-white/95 p-1 shadow-[0_2px_12px_rgba(0,0,0,0.06)] backdrop-blur dark:border-white/10 dark:bg-[#15151a]/95 dark:shadow-[0_2px_12px_rgba(0,0,0,0.5)]"
      >
        {MAP_MODE_OPTIONS.map((opt) => {
          const active = mode === opt.id
          return (
            <button
              key={opt.id}
              type="button"
              aria-pressed={active}
              onClick={() => onChange(opt.id)}
              className={`rounded-full px-3.5 py-1.5 text-[13px] font-medium tracking-tight transition-colors motion-reduce:transition-none ${
                active
                  ? 'bg-[#F56A00] text-white'
                  : 'text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-white/10'
              }`}
            >
              {opt.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}

/**
 * Right-edge rotate cluster for the 3D vector map: 45° steps left/right
 * (smoothly tweened) and a compass reset back to north. Manual rotation is a
 * camera takeover, so it permanently stops the ambient orbit like any other
 * user gesture. Hidden in satellite mode — raster imagery snaps heading to
 * 90° steps and free rotation reads as broken there.
 */
function MapRotateControls() {
  const map = useMap()
  const rafRef = useRef<number | null>(null)

  useEffect(() => {
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current)
    }
  }, [])

  const rotateTo = (target: number, from: number) => {
    if (!map) return
    if (prefersReducedMotion()) {
      map.setHeading(((target % 360) + 360) % 360)
      return
    }
    const duration = 350
    const start = performance.now()
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / duration)
      const e = 1 - Math.pow(1 - t, 3) // cubic ease-out
      map.setHeading(from + (target - from) * e)
      rafRef.current = t < 1 ? requestAnimationFrame(step) : null
    }
    rafRef.current = requestAnimationFrame(step)
  }

  const handleRotate = (delta: number | 'north') => {
    if (!map) return
    orbitStoppedForSession = true
    cancelCameraMotion(map)
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current)
    const from = map.getHeading() ?? 0
    // Reset spins through the shorter arc back to north.
    const target = delta === 'north' ? (((from % 360) + 360) % 360 > 180 ? Math.ceil(from / 360) * 360 : Math.floor(from / 360) * 360) : from + delta
    rotateTo(target, from)
  }

  const buttonClass =
    'flex h-9 w-9 items-center justify-center rounded-full text-gray-700 transition-colors hover:bg-gray-100 motion-reduce:transition-none dark:text-gray-200 dark:hover:bg-white/10'

  return (
    <div className="pointer-events-none absolute right-4 top-1/2 z-[58] -translate-y-1/2">
      <div
        role="group"
        aria-label="Rotate map"
        className="pointer-events-auto flex flex-col items-center gap-0.5 rounded-full border border-gray-200 bg-white/95 p-1 shadow-[0_2px_12px_rgba(0,0,0,0.06)] backdrop-blur dark:border-white/10 dark:bg-[#15151a]/95 dark:shadow-[0_2px_12px_rgba(0,0,0,0.5)]"
      >
        <button type="button" aria-label="Rotate left" title="Rotate left 45°" onClick={() => handleRotate(-45)} className={buttonClass}>
          <RotateCcw className="h-4 w-4" />
        </button>
        <button type="button" aria-label="Face north" title="Reset to north" onClick={() => handleRotate('north')} className={buttonClass}>
          <Compass className="h-4 w-4" />
        </button>
        <button type="button" aria-label="Rotate right" title="Rotate right 45°" onClick={() => handleRotate(45)} className={buttonClass}>
          <RotateCw className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}

function applyDisplayMode(
  map: google.maps.Map,
  mode: MapDisplayMode,
  size: MapViewSize,
  isVector: boolean | null,
) {
  if (size !== 'full') {
    map.setMapTypeId('roadmap')
    map.setTilt(0)
    map.setHeading(0)
    return
  }
  if (mode === '3d') {
    if (isVector === false) {
      map.setMapTypeId('hybrid')
      map.setTilt(RASTER_3D_TILT)
      map.setHeading(0)
    } else {
      map.setMapTypeId('roadmap')
      map.setTilt(VECTOR_3D_TILT)
      map.setHeading(DEFAULT_3D_HEADING)
    }
  } else if (mode === 'map') {
    map.setMapTypeId('roadmap')
    map.setTilt(0)
    map.setHeading(0)
  } else {
    map.setMapTypeId('hybrid')
    map.setTilt(0)
    map.setHeading(0)
  }
}

/**
 * Applies the selected display mode to the map. 3D prefers vector rendering
 * (roadmap, tilt 55); if the map falls back to raster it uses hybrid + tilt 45
 * so 45° aerial imagery still gives a 3D feel. Compact maps stay flat.
 *
 * Re-applies tilt after programmatic fitBounds (which resets tilt to 0) via an
 * idle listener — without this the map looks flat even in 3D mode.
 */
function MapModeController({ mode, size }: { mode: MapDisplayMode; size: MapViewSize }) {
  const map = useMap()
  const [isVector, setIsVector] = useState<boolean | null>(null)

  useEffect(() => {
    if (!map || typeof google === 'undefined') return
    const update = () => {
      const rt = map.getRenderingType?.()
      if (rt === 'VECTOR') setIsVector(true)
      else if (rt === 'RASTER') setIsVector(false)
    }
    update()
    const listener = map.addListener('renderingtype_changed', update)
    return () => listener.remove()
  }, [map])

  useEffect(() => {
    if (!map || typeof google === 'undefined') return
    cancelCameraMotion(map)
    applyDisplayMode(map, mode, size, isVector)
  }, [map, mode, isVector, size])

  // fitBounds / setZoom reset tilt to 0 — restore 3D perspective once the fit settles.
  useEffect(() => {
    if (!map || typeof google === 'undefined' || mode !== '3d' || size !== 'full') return
    const listener = map.addListener('idle', () => {
      const tilt = map.getTilt() ?? 0
      if (tilt < 10) applyDisplayMode(map, mode, size, isVector)
    })
    return () => listener.remove()
  }, [map, mode, size, isVector])

  return null
}

/**
 * Cinematic camera for 3D mode: glides to the active place (~1s cubic
 * ease-out via rAF + moveCamera) and slowly orbits (~1°/100ms) once the map
 * is idle. Orbit stops permanently for the session on any user gesture and
 * never runs when prefers-reduced-motion is set. Registered in
 * `cameraInterrupts` so programmatic fits always cancel it first.
 */
function CinematicCamera({
  focus,
  enabled,
  glideCenter,
  resetKey,
}: {
  focus: LatLng | null
  enabled: boolean
  /** False when MapZoomFocus owns centering — avoids fighting it. */
  glideCenter: boolean
  /** Changes when the marker set changes, so the orbit re-arms after refits. */
  resetKey: string
}) {
  const map = useMap()
  const rafRef = useRef<number | null>(null)
  const idleRef = useRef<google.maps.MapsEventListener | null>(null)

  // Register the cancel hook for this map so fits can interrupt us.
  useEffect(() => {
    if (!map) return
    const cancel = () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current)
      rafRef.current = null
      idleRef.current?.remove()
      idleRef.current = null
    }
    cameraInterrupts.set(map, cancel)
    return () => {
      cancel()
      cameraInterrupts.delete(map)
    }
  }, [map])

  // Any user gesture on the map permanently disables auto-orbit this session.
  useEffect(() => {
    if (!map || !enabled || typeof google === 'undefined') return
    const stop = () => {
      orbitStoppedForSession = true
      cancelCameraMotion(map)
    }
    const div = map.getDiv()
    const drag = map.addListener('dragstart', stop)
    div.addEventListener('wheel', stop, { passive: true })
    div.addEventListener('pointerdown', stop, { passive: true })
    return () => {
      drag.remove()
      div.removeEventListener('wheel', stop)
      div.removeEventListener('pointerdown', stop)
    }
  }, [map, enabled])

  const focusKey =
    focus && isValidCoord(focus) ? `${focus.lat.toFixed(5)},${focus.lng.toFixed(5)}` : ''

  useEffect(() => {
    if (!map || !enabled || typeof google === 'undefined') return
    const reduceMotion = prefersReducedMotion()

    cancelCameraMotion(map)

    const moveCamera = (cam: google.maps.CameraOptions) => {
      if (typeof map.moveCamera === 'function') {
        map.moveCamera(cam)
      } else {
        if (cam.center) map.setCenter(cam.center)
        if (cam.tilt != null) map.setTilt(cam.tilt)
        if (cam.heading != null) map.setHeading(cam.heading)
      }
    }

    const startOrbit = () => {
      if (orbitStoppedForSession || reduceMotion) return
      // Raster maps snap heading to 90° steps — orbit only on vector.
      if (map.getRenderingType?.() !== 'VECTOR') return
      // Wait for PreciseMapFit / MapZoomFocus / route fits to settle first.
      idleRef.current?.remove()
      idleRef.current = google.maps.event.addListenerOnce(map, 'idle', () => {
        let last = performance.now()
        const step = (now: number) => {
          if (orbitStoppedForSession) {
            rafRef.current = null
            return
          }
          const dt = now - last
          last = now
          // ~1° per 100ms
          moveCamera({ heading: ((map.getHeading() ?? 0) + dt * 0.01) % 360 })
          rafRef.current = requestAnimationFrame(step)
        }
        rafRef.current = requestAnimationFrame(step)
      })
    }

    const target = focus && isValidCoord(focus) ? focus : null

    // Don't replay the cinematic glide/orbit when the map merely remounts
    // (switching chat <-> full map, or page <-> page) for a marker set + focus
    // we've already animated this session — snap into place instead. A new
    // search or a different focused pin produces a new key and animates.
    const cinematicKey = `${resetKey}|${focusKey}`
    if (cinematicKey.trim() !== '|' && cinematicMapKeys.has(cinematicKey)) {
      if (target && glideCenter) {
        const settledTilt = map.getRenderingType?.() === 'RASTER' ? RASTER_3D_TILT : VECTOR_3D_TILT
        moveCamera({ center: target, tilt: settledTilt })
      }
      return
    }
    cinematicMapKeys.add(cinematicKey)

    if (!target || !glideCenter) {
      startOrbit()
      return
    }

    if (reduceMotion) {
      // No animation — but the focused place should still be centered.
      moveCamera({ center: target })
      return
    }

    const center = map.getCenter()
    const from = {
      lat: center?.lat() ?? target.lat,
      lng: center?.lng() ?? target.lng,
      tilt: map.getTilt() ?? 0,
    }
    const toTilt = map.getRenderingType?.() === 'RASTER' ? RASTER_3D_TILT : VECTOR_3D_TILT
    const duration = 1000
    const start = performance.now()
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / duration)
      const e = 1 - Math.pow(1 - t, 3) // cubic ease-out
      moveCamera({
        center: {
          lat: from.lat + (target.lat - from.lat) * e,
          lng: from.lng + (target.lng - from.lng) * e,
        },
        tilt: from.tilt + (toTilt - from.tilt) * e,
      })
      if (t < 1) {
        rafRef.current = requestAnimationFrame(step)
      } else {
        rafRef.current = null
        startOrbit()
      }
    }
    rafRef.current = requestAnimationFrame(step)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, enabled, glideCenter, focusKey, resetKey])

  return null
}

function OriginToPlaceRoute({
  origin,
  destination,
  destinationName,
  originLabel,
  mode,
  onRouteInfo,
  onRouteError,
}: {
  origin: LatLng | string
  destination: LatLng
  destinationName: string
  originLabel?: string
  mode: TravelMode
  onRouteInfo?: (info: RouteInfo | null) => void
  onRouteError?: (message: string | null) => void
}) {
  const map = useMap()
  const rendererRef = useRef<google.maps.DirectionsRenderer | null>(null)
  const [resolvedOrigin, setResolvedOrigin] = useState<LatLng | null>(
    typeof origin === 'string' ? null : origin,
  )

  useEffect(() => {
    if (typeof origin !== 'string') {
      setResolvedOrigin(origin)
      return
    }
    setResolvedOrigin(null)
    const geocoder = new google.maps.Geocoder()
    geocoder.geocode({ address: origin }, (results, status) => {
      if (status === 'OK' && results?.[0]?.geometry?.location) {
        const loc = results[0].geometry.location
        setResolvedOrigin({ lat: loc.lat(), lng: loc.lng() })
      } else {
        onRouteError?.(`Could not find "${origin}" on the map.`)
      }
    })
  }, [origin, onRouteError])

  useEffect(() => {
    if (!map || !resolvedOrigin) return

    rendererRef.current?.setMap(null)
    rendererRef.current = null
    onRouteInfo?.(null)
    onRouteError?.(null)

    if (!isValidCoord(resolvedOrigin) || !isValidCoord(destination)) {
      onRouteError?.('Invalid map coordinates for this route.')
      return
    }

    const renderer = new google.maps.DirectionsRenderer({
      map,
      suppressMarkers: true,
      polylineOptions: { strokeColor: ROUTE_ORANGE, strokeOpacity: 0.9, strokeWeight: 4 },
    })
    rendererRef.current = renderer

    const directionsService = new google.maps.DirectionsService()
    const TM = google.maps.TravelMode
    const modeMap: Record<TravelMode, google.maps.TravelMode> = {
      DRIVE: TM.DRIVING,
      WALK: TM.WALKING,
      BICYCLE: TM.BICYCLING,
      TRANSIT: TM.TRANSIT,
    }
    const travelMode = modeMap[mode] ?? TM.WALKING
    // If the primary mode finds no route (e.g. no transit data for the area),
    // fall back to driving (or walking when driving was primary).
    const altMode = travelMode === TM.DRIVING ? TM.WALKING : TM.DRIVING

    function finishError(primary: string, fallback?: string) {
      onRouteError?.(
        `Could not draw route (${primary}${fallback ? ` / ${fallback}` : ''}). ` +
          'Check that Directions API is enabled for your Maps key.',
      )
    }

    function applyResult(result: google.maps.DirectionsResult) {
      renderer.setDirections(result)
      const leg = result.routes[0]?.legs[0]
      if (leg) {
        onRouteInfo?.({
          distance: leg.distance?.text ?? '',
          duration: leg.duration?.text ?? '',
          destinationName,
          originLabel,
        })
        const bounds = result.routes[0]?.bounds
        if (map && bounds) {
          cancelCameraMotion(map)
          map.fitBounds(bounds, { top: 96, right: 48, bottom: 240, left: 48 })
        }
      }
    }

    directionsService.route(
      { origin: resolvedOrigin, destination, travelMode },
      (result, status) => {
        if (status === 'OK' && result) {
          applyResult(result)
          return
        }
        directionsService.route(
          { origin: resolvedOrigin, destination, travelMode: altMode },
          (altResult, altStatus) => {
            if (altStatus === 'OK' && altResult) {
              applyResult(altResult)
            } else {
              finishError(status, altStatus)
            }
          },
        )
      },
    )

    return () => {
      rendererRef.current?.setMap(null)
      onRouteInfo?.(null)
      onRouteError?.(null)
    }
  }, [
    map,
    resolvedOrigin?.lat,
    resolvedOrigin?.lng,
    destination.lat,
    destination.lng,
    destinationName,
    originLabel,
    mode,
    onRouteInfo,
    onRouteError,
  ])

  return null
}

type PlaceDetail = Place & { photos?: string[]; open?: boolean; price?: string }

function formatDistanceKm(km: number): string {
  if (km < 1) return `${Math.round(km * 1000)} m`
  return `${km.toFixed(1)} km`
}

function estimateWalkMin(km: number): number {
  return Math.max(1, Math.round((km / 5) * 60))
}

function MapPlaceholder({
  place,
  userLocation,
  empty = false,
  routeInfo,
  onDirections,
  className,
}: {
  place?: Place | null
  userLocation?: LatLng | null
  empty?: boolean
  routeInfo?: RouteInfo | null
  onDirections?: () => void
  className?: string
}) {
  const km =
    place?.coordinates && userLocation && isValidCoord(userLocation) && isValidCoord(place.coordinates)
      ? distanceKm(userLocation, place.coordinates)
      : null
  const distanceLabel = routeInfo?.distance ?? (km != null ? formatDistanceKm(km) : null)
  const durationLabel = routeInfo?.duration ?? (km != null ? `${estimateWalkMin(km)} min` : null)

  if (empty || !place) {
    return (
      <div
        className={`flex min-h-[200px] w-full flex-col items-center justify-center gap-2 rounded-2xl border border-gray-200 bg-white p-6 text-center shadow-[0_2px_12px_rgba(0,0,0,0.06)] dark:border-white/10 dark:bg-[#15151a] dark:shadow-[0_2px_12px_rgba(0,0,0,0.5)] ${className ?? ''}`}
        style={{ minHeight: 200, width: '100%', position: 'relative' }}
      >
        <MapPin className="h-12 w-12 text-[#F56A00]" strokeWidth={1.5} />
        <p className="text-[14px] font-medium tracking-tight text-gray-900 dark:text-gray-100">Ask me where to go</p>
        <p className="text-[13px] text-gray-500 dark:text-gray-400">I&apos;ll show places on the map</p>
      </div>
    )
  }

  return (
    <div
      className={`flex min-h-[200px] w-full flex-col items-center justify-center gap-2 rounded-2xl border border-gray-200 bg-white p-4 text-center shadow-[0_2px_12px_rgba(0,0,0,0.06)] dark:border-white/10 dark:bg-[#15151a] dark:shadow-[0_2px_12px_rgba(0,0,0,0.5)] ${className ?? ''}`}
      style={{ minHeight: 200, width: '100%', position: 'relative' }}
    >
      <MapPin className="h-10 w-10 text-[#F56A00]" strokeWidth={1.5} />
      <p className="text-[13px] font-semibold tracking-tight text-gray-900 dark:text-gray-100">{place.name}</p>
      <div className="flex flex-wrap items-center justify-center gap-3 text-[13px] text-gray-500 dark:text-gray-400">
        {distanceLabel && <span>{distanceLabel}</span>}
        {durationLabel && <span>{durationLabel}</span>}
      </div>
      {onDirections && (
        <button
          type="button"
          onClick={onDirections}
          className="mt-2 rounded-full bg-[#F56A00] px-4 py-2 text-[13px] font-medium text-white transition-colors hover:bg-[#e05a1a] motion-reduce:transition-none"
        >
          Directions
        </button>
      )}
    </div>
  )
}

function PlaceDetailBox({ place }: { place: PlaceDetail }) {
  return (
    <div className="mt-2 rounded-xl border border-amber-100 bg-white p-3 dark:border-gray-700 dark:bg-gray-800">
      {place.photos && place.photos.length > 0 && (
        <div className="mb-2 flex gap-2 overflow-x-auto">
          {place.photos.map((photo, i) => (
            <PlaceImage
              key={`${photo}-${i}`}
              place={{ ...place, photos: [photo] }}
              className="h-16 w-24 shrink-0 rounded-lg object-cover"
              width={192}
              height={128}
            />
          ))}
        </div>
      )}
      <p className="text-[13px] font-medium text-gray-900 dark:text-white">{place.name}</p>
      <p className="text-[11px] text-gray-500 dark:text-gray-400">{place.address}</p>
      <div className="mt-1 flex items-center gap-2">
        {place.rating != null && (
          <span className="flex items-center gap-0.5 text-[11px] text-amber-600">
            <Star className="h-3 w-3 fill-amber-500 text-amber-500" />
            {place.rating}
          </span>
        )}
        {(place.price ?? place.price_level) && (
          <span className="text-[11px] text-gray-400">{place.price ?? place.price_level}</span>
        )}
        {place.open != null && (
          <span className={`text-[11px] ${place.open ? 'text-green-600' : 'text-red-500'}`}>
            {place.open ? 'Open now' : 'Closed'}
          </span>
        )}
      </div>
    </div>
  )
}

function MapMarkers({
  markers,
  activeStopIndex,
  onMarkerClick,
  showUserLocation,
  userLocation,
  colors = {},
}: {
  markers: (Place | ItineraryStop)[]
  activeStopIndex: number | null
  onMarkerClick: (index: number) => void
  showUserLocation: boolean
  userLocation: LatLng | null
  numberedStops?: boolean
  /** place_id -> color, recolors the AI-highlighted pins. */
  colors?: Record<string, string>
}) {
  return (
    <>
      {showUserLocation && userLocation && isValidCoord(userLocation) && (
        <AdvancedMarker position={userLocation} title="Your location" zIndex={10}>
          <div className="user-location-dot" />
        </AdvancedMarker>
      )}

      {markers.map((item, i) => {
        const coords = 'coordinates' in item ? item.coordinates : (item as Place).coordinates
        const name = 'name' in item ? item.name : (item as Place).name
        const isActive = activeStopIndex === i
        const pid = 'place_id' in item ? item.place_id : ''
        const hl = pid ? colors[pid] : undefined

        return (
          <AdvancedMarker
            key={`${pid ? pid : 'm'}-${i}`}
            position={coords}
            title={name}
            zIndex={hl ? 6 : isActive ? 5 : 1}
            onClick={() => onMarkerClick(i)}
          >
            {hl ? (
              <GlowMarkerContent color={hl} glyph={String(i + 1)} />
            ) : isActive ? (
              <GlowMarkerContent color={ROUTE_ORANGE} glyph={String(i + 1)} />
            ) : (
              <Pin background="#ffffff" borderColor={ROUTE_ORANGE} glyphColor={ROUTE_ORANGE} glyph={String(i + 1)} scale={1} />
            )}
          </AdvancedMarker>
        )
      })}
    </>
  )
}

/**
 * Glowing, gently bouncing marker for AI-highlighted places — visually distinct
 * from the plain numbered pins and Google's POI icons, so a marked place pops.
 */
function GlowMarkerContent({ color, glyph }: { color: string; glyph: string }) {
  return (
    <div className="hodari-glow-marker" style={{ '--mk': color } as React.CSSProperties}>
      <span className="hodari-glow-marker__ring" aria-hidden />
      <span className="hodari-glow-marker__dot">{glyph}</span>
      <span className="hodari-glow-marker__tip" aria-hidden />
    </div>
  )
}

/** Extra AI-placed markers (places not in the current list, e.g. an anchor). */
function AnnotationMarkers({ markers, placeCoords = [] }: { markers: MapAnnotations['markers']; placeCoords?: LatLng[] }) {
  // A highlighted place already renders its own (recolored) numbered marker, so
  // skip any annotation marker that sits on top of one — otherwise you see TWO
  // markers stacked at the same spot.
  const onAPlace = (c: LatLng) =>
    placeCoords.some((p) => Math.abs(p.lat - c.lat) < 2e-4 && Math.abs(p.lng - c.lng) < 2e-4)
  return (
    <>
      {markers
        .filter((m) => isValidCoord(m.coordinates) && !onAPlace(m.coordinates))
        .map((m) => (
          <AdvancedMarker key={`anno-${m.id}`} position={m.coordinates} title={m.name} zIndex={7}>
            <GlowMarkerContent color={m.color} glyph="★" />
          </AdvancedMarker>
        ))}
    </>
  )
}

/** Compact action bubble shown on the selected marker (full map). */
function PlaceBubble({
  place,
  index,
  saved,
  onFullDetails,
  onSave,
  onRoute,
}: {
  place: Place
  index: number
  saved: boolean
  onFullDetails?: (place: Place) => void
  onSave?: (place: Place) => void
  onRoute?: (index: number) => void
}) {
  const btn =
    'flex h-8 w-8 items-center justify-center rounded-full border border-gray-200 text-gray-600 transition-colors hover:border-[#F56A00]/50 hover:text-[#F56A00]'
  return (
    <div className="min-w-[170px] max-w-[240px] px-1 pb-1 pt-0.5">
      <p className="mb-2 pr-5 text-[13px] font-semibold leading-snug text-gray-900">{place.name}</p>
      <div className="flex items-center gap-1.5">
        {onFullDetails && (
          <button type="button" title="Full details & photos" className={btn} onClick={() => onFullDetails(place)}>
            <ImageIcon className="h-4 w-4" />
          </button>
        )}
        {onSave && (
          <button
            type="button"
            title={saved ? 'Saved' : 'Save'}
            className={`${btn} ${saved ? 'border-[#F56A00]/60 text-[#F56A00]' : ''}`}
            onClick={() => onSave(place)}
          >
            <Star className={`h-4 w-4 ${saved ? 'fill-[#F56A00]' : ''}`} />
          </button>
        )}
        {onRoute && (
          <button type="button" title="Route from my location" className={btn} onClick={() => onRoute(index)}>
            <Navigation className="h-4 w-4" />
          </button>
        )}
        {place.website && (
          <a href={place.website} target="_blank" rel="noopener noreferrer" title="Website" className={btn}>
            <Globe className="h-4 w-4" />
          </a>
        )}
        {place.maps_url && (
          <a href={place.maps_url} target="_blank" rel="noopener noreferrer" title="Open in Google Maps" className={btn}>
            <ExternalLink className="h-4 w-4" />
          </a>
        )}
      </div>
    </div>
  )
}

/**
 * Draws AI highlight circles with native google.maps.Circle overlays. Each
 * highlight gets a soft outer "glow" ring plus a crisp inner ring, and the pair
 * gently pulses (unless reduced motion) so the highlighted area reads clearly.
 */
function MapCircles({ circles }: { circles: MapAnnotations['circles'] }) {
  const map = useMap()
  const ref = useRef<google.maps.Circle[]>([])
  const rafRef = useRef<number | null>(null)

  useEffect(() => {
    if (!map || typeof google === 'undefined') return
    ref.current.forEach((c) => c.setMap(null))
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current)

    const valid = circles.filter((c) => isValidCoord(c.center) && c.radiusM > 0)
    const created: google.maps.Circle[] = []
    for (const c of valid) {
      // Soft outer glow.
      created.push(
        new google.maps.Circle({
          map,
          center: c.center,
          radius: c.radiusM,
          strokeColor: c.color,
          strokeOpacity: 0.35,
          strokeWeight: 9,
          fillColor: c.color,
          fillOpacity: 0.08,
          clickable: false,
          zIndex: 1,
        }),
      )
      // Crisp inner ring.
      created.push(
        new google.maps.Circle({
          map,
          center: c.center,
          radius: c.radiusM,
          strokeColor: c.color,
          strokeOpacity: 0.95,
          strokeWeight: 2.5,
          fillColor: c.color,
          fillOpacity: 0.06,
          clickable: false,
          zIndex: 2,
        }),
      )
    }
    ref.current = created

    if (!prefersReducedMotion() && created.length > 0) {
      const start = performance.now()
      const tick = (now: number) => {
        const t = (now - start) / 1000
        const wave = (Math.sin(t * 1.6) + 1) / 2 // 0..1
        for (let i = 0; i < created.length; i += 2) {
          created[i]?.setOptions({ strokeOpacity: 0.2 + wave * 0.3, strokeWeight: 7 + wave * 6 })
        }
        rafRef.current = requestAnimationFrame(tick)
      }
      rafRef.current = requestAnimationFrame(tick)
    }

    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current)
      ref.current.forEach((c) => c.setMap(null))
      ref.current = []
    }
  }, [map, circles])

  return null
}

/**
 * Photorealistic "Realistic" 3D view via Google Map3DElement (full map only).
 * Renders the same place markers and flies the camera to the selected one.
 * Coverage is strongest in US cities (11 of the 16 World Cup hosts); elsewhere
 * it falls back to a plain 3D globe.
 */
const NAMED_COLORS: Record<string, string> = {
  red: '#E5484D', green: '#1FA463', blue: '#3B82F6', yellow: '#F5C518',
  orange: '#F56A00', purple: '#8B5CF6', pink: '#EC4899', white: '#FFFFFF',
}
function toHexColor(c?: string): string {
  if (!c) return ROUTE_ORANGE
  if (c.startsWith('#')) return c
  return NAMED_COLORS[c.toLowerCase()] ?? ROUTE_ORANGE
}
/** Translucent fill (hex8) for a circle on the 3D map. */
function fillColorFor(c?: string): string {
  const h = toHexColor(c)
  return h.length >= 7 ? `${h.slice(0, 7)}33` : h // ~20% alpha
}
/** A ring of ~72 lat/lng points approximating a circle (maps3d has no Circle). */
function circleRing(center: LatLng, radiusM: number, n = 72): google.maps.LatLngLiteral[] {
  const pts: google.maps.LatLngLiteral[] = []
  const lat0 = (center.lat * Math.PI) / 180
  for (let i = 0; i <= n; i++) {
    const ang = (i / n) * 2 * Math.PI
    const dLat = (radiusM * Math.cos(ang)) / 111320
    const dLng = (radiusM * Math.sin(ang)) / (111320 * Math.cos(lat0))
    pts.push({ lat: center.lat + dLat, lng: center.lng + dLng })
  }
  return pts
}

function Map3DView({
  markers,
  activeStopIndex,
  onMarkerClick,
  annotations,
}: {
  markers: (Place | ItineraryStop)[]
  activeStopIndex: number | null
  onMarkerClick: (index: number) => void
  annotations?: MapAnnotations
}) {
  const first = markers.find((m) => isValidCoord(m.coordinates))?.coordinates
  const center: google.maps.LatLngAltitudeLiteral = first
    ? { lat: first.lat, lng: first.lng, altitude: 0 }
    : { lat: 40.8135, lng: -74.0745, altitude: 0 } // MetLife Stadium — US default

  return (
    <Map3D
      className="h-full w-full"
      defaultCenter={center}
      defaultRange={2200}
      defaultTilt={62}
      mode={MapMode.HYBRID}
    >
      {markers.map((p, i) =>
        isValidCoord(p.coordinates) ? (
          <Marker3D
            key={`m3d-${p.place_id || p.name}-${i}`}
            position={{ lat: p.coordinates.lat, lng: p.coordinates.lng, altitude: 45 }}
            altitudeMode={AltitudeMode.RELATIVE_TO_GROUND}
            extruded
            label={String(i + 1)}
            onClick={() => onMarkerClick(i)}
          />
        ) : null,
      )}
      {/* AI-placed highlight markers (★) that aren't in the result list. */}
      {(annotations?.markers ?? []).filter((m) => isValidCoord(m.coordinates)).map((m) => (
        <Marker3D
          key={`anno3d-${m.id}`}
          position={{ lat: m.coordinates.lat, lng: m.coordinates.lng, altitude: 50 }}
          altitudeMode={AltitudeMode.RELATIVE_TO_GROUND}
          extruded
          label="★"
        />
      ))}
      {/* AI-drawn circles — rendered as ground polygons so they show in 3D too. */}
      <Circles3D circles={annotations?.circles ?? []} />
      <Fly3DToActive markers={markers} activeStopIndex={activeStopIndex} />
    </Map3D>
  )
}

/**
 * Draws annotation circles on the photorealistic map. maps3d has no Circle
 * primitive and vis.gl ships no Polygon3D component, so we create
 * Polygon3DElement rings imperatively and append them to the Map3DElement.
 */
function Circles3D({ circles }: { circles: MapAnnotations['circles'] }) {
  const maps3d = useMapsLibrary('maps3d')
  const map3d = useMap3D()
  const polysRef = useRef<HTMLElement[]>([])

  useEffect(() => {
    if (!maps3d || !map3d) return
    const lib = maps3d as unknown as {
      Polygon3DElement: new (o: google.maps.maps3d.Polygon3DElementOptions) => HTMLElement
      AltitudeMode: typeof google.maps.maps3d.AltitudeMode
    }
    polysRef.current.forEach((p) => { try { p.remove() } catch { /* gone */ } })
    polysRef.current = []
    for (const c of circles) {
      if (!isValidCoord(c.center) || !(c.radiusM > 0)) continue
      const poly = new lib.Polygon3DElement({
        outerCoordinates: circleRing(c.center, c.radiusM),
        fillColor: fillColorFor(c.color),
        strokeColor: toHexColor(c.color),
        strokeWidth: 6,
        altitudeMode: lib.AltitudeMode.CLAMP_TO_GROUND,
        drawsOccludedSegments: true,
      })
      map3d.append(poly)
      polysRef.current.push(poly)
    }
    return () => {
      polysRef.current.forEach((p) => { try { p.remove() } catch { /* gone */ } })
      polysRef.current = []
    }
  }, [maps3d, map3d, circles])

  return null
}

/** Smooth camera fly to the selected marker on the 3D map. */
function Fly3DToActive({
  markers,
  activeStopIndex,
}: {
  markers: (Place | ItineraryStop)[]
  activeStopIndex: number | null
}) {
  const map3d = useMap3D()
  useEffect(() => {
    if (activeStopIndex == null || !map3d?.flyCameraTo) return
    const p = markers[activeStopIndex]
    if (!p || !isValidCoord(p.coordinates)) return
    map3d.flyCameraTo({
      endCamera: {
        center: { lat: p.coordinates.lat, lng: p.coordinates.lng, altitude: 0 },
        range: 700,
        tilt: 62,
      },
      durationMillis: 2200,
    })
  }, [activeStopIndex, markers, map3d])
  return null
}

function MapCanvas({
  places,
  itinerary,
  annotations,
  activeStopIndex,
  onMarkerClick,
  userLocation,
  showUserLocation = true,
  routeFromUser = false,
  customRoute = null,
  routeMode = 'WALK',
  onRouteInfo,
  onRouteError,
  zoomFocusOnActive = false,
  size = 'full',
  onPlaceFullDetails,
  onPlaceSave,
  onPlaceRoute,
  savedPlaceIds,
}: Omit<Props, 'onExpand' | 'onCollapse' | 'selectedPlace' | 'loading' | 'error' | 'onRetry' | 'bottomSlot'>) {
  const markers = itinerary ?? places
  const markerCoords = markers
    .map((m) => m.coordinates)
    .filter(isValidCoord)
  const firstPlace = markerCoords[0]
  const defaultCenter = firstPlace ?? KIGALI_DEFAULT
  const initialZoom = markerCoords.length > 0 ? 15 : DEFAULT_ZOOM
  const focusIndex = activeStopIndex ?? (markers.length > 0 ? 0 : null)
  const focusPos =
    focusIndex !== null && markers[focusIndex]
      ? markers[focusIndex].coordinates
      : null
  const isCompact = size === 'compact'
  const usePreciseFit = !zoomFocusOnActive && markerCoords.length > 0
  const useFocus =
    !!focusPos &&
    isValidCoord(focusPos) &&
    (zoomFocusOnActive || (isCompact && markerCoords.length === 1))
  const focusZoom = isCompact ? 17 : 16

  const routeDestIndex = customRoute?.destinationIndex ?? activeStopIndex
  const routeDestination =
    routeDestIndex !== null && markers[routeDestIndex]
      ? markers[routeDestIndex]
      : null

  // 3D vector perspective by default in full mode; compact stays flat.
  const [mapMode, setMapMode] = useState<MapDisplayMode>('3d')
  const is3D = !isCompact && mapMode === '3d'
  const realistic = !isCompact && mapMode === 'realistic'

  // Marker action bubble (full map): a small popup on the selected marker with
  // quick actions, instead of slamming the full details panel open every click.
  const [bubbleOpen, setBubbleOpen] = useState(true)
  useEffect(() => { setBubbleOpen(true) }, [activeStopIndex])
  const activePlace = activeStopIndex !== null ? markers[activeStopIndex] : null
  const showBubble =
    !isCompact && bubbleOpen && activeStopIndex !== null && !!activePlace && isValidCoord(activePlace.coordinates)
  // Only an explicit active selection triggers the cinematic glide — never
  // the initial fallback focus, so PreciseMapFit owns the first framing.
  const activePos =
    activeStopIndex !== null &&
    markers[activeStopIndex] &&
    isValidCoord(markers[activeStopIndex].coordinates)
      ? markers[activeStopIndex].coordinates
      : null
  const cameraResetKey = markerCoords
    .map((c) => `${c.lat.toFixed(4)},${c.lng.toFixed(4)}`)
    .join(';')

  return (
    <APIProvider
      apiKey={API_KEY}
      libraries={['geometry', 'places']}
      version="beta"
      onError={(err) => console.error('[map] Google Maps API failed to load', err)}
    >
      {realistic ? (
        <Map3DView markers={markers} activeStopIndex={activeStopIndex} onMarkerClick={onMarkerClick} annotations={annotations} />
      ) : (
      <Map
        defaultCenter={defaultCenter}
        defaultZoom={markerCoords.length > 0 ? (isCompact ? 17 : initialZoom) : DEFAULT_ZOOM}
        defaultTilt={isCompact ? 0 : VECTOR_3D_TILT}
        defaultHeading={isCompact ? 0 : DEFAULT_3D_HEADING}
        renderingType="VECTOR"
        mapId="hodari-map"
        className="h-full w-full"
        style={{ width: '100%', height: '100%', display: 'block' }}
        gestureHandling="greedy"
        disableDefaultUI
        zoomControl={!isCompact}
        mapTypeControl={false}
        streetViewControl={false}
        fullscreenControl={false}
        styles={MAP_STYLES}
      >
        <MapUiOptions fullControls={size === 'full'} />
        <MapModeController mode={mapMode} size={size} />
        {markerCoords.length > 0 && <PlacesMapCenter places={markerCoords} />}
        {usePreciseFit && !useFocus && (
          <PreciseMapFit
            markers={markerCoords}
            userLocation={userLocation}
            includeUser={showUserLocation}
            focus={focusPos ?? null}
            size={size}
          />
        )}
        <MapZoomFocus position={focusPos ?? null} enabled={useFocus} targetZoom={focusZoom} />
        <CinematicCamera
          focus={activePos}
          enabled={is3D && markerCoords.length > 0}
          glideCenter={!useFocus}
          resetKey={cameraResetKey}
        />

        <MapMarkers
          markers={markers}
          activeStopIndex={activeStopIndex}
          onMarkerClick={onMarkerClick}
          showUserLocation={showUserLocation}
          userLocation={userLocation}
          colors={annotations?.colors}
        />

        {annotations && annotations.markers.length > 0 && (
          <AnnotationMarkers markers={annotations.markers} placeCoords={markerCoords} />
        )}
        {annotations && annotations.circles.length > 0 && <MapCircles circles={annotations.circles} />}

        {showBubble && activePlace && (
          <InfoWindow
            position={activePlace.coordinates}
            pixelOffset={[0, -46]}
            headerDisabled
            onCloseClick={() => setBubbleOpen(false)}
          >
            <PlaceBubble
              place={activePlace as Place}
              index={activeStopIndex as number}
              saved={!!savedPlaceIds?.has((activePlace as Place).place_id)}
              onFullDetails={onPlaceFullDetails}
              onSave={onPlaceSave}
              onRoute={onPlaceRoute}
            />
          </InfoWindow>
        )}

        {itinerary && itinerary.length >= 2 && !routeFromUser && !customRoute && (
          <RoutePolyline stops={itinerary} />
        )}

        {routeFromUser &&
          userLocation &&
          isValidCoord(userLocation) &&
          routeDestination &&
          isValidCoord(routeDestination.coordinates) && (
          <OriginToPlaceRoute
            origin={userLocation}
            destination={routeDestination.coordinates}
            destinationName={routeDestination.name}
            originLabel="you"
            mode={routeMode}
            onRouteInfo={onRouteInfo}
            onRouteError={onRouteError}
          />
        )}

        {customRoute?.from === 'landmark' &&
          customRoute.landmark &&
          routeDestination &&
          isValidCoord(routeDestination.coordinates) && (
          <OriginToPlaceRoute
            origin={customRoute.landmark}
            destination={routeDestination.coordinates}
            destinationName={routeDestination.name}
            originLabel={customRoute.landmark.split(',')[0]}
            mode={customRoute.mode}
            onRouteInfo={onRouteInfo}
            onRouteError={onRouteError}
          />
        )}
      </Map>
      )}
      {size === 'full' && <MapModeControl mode={mapMode} onChange={setMapMode} />}
      {size === 'full' && !realistic && mapMode !== 'satellite' && <MapRotateControls />}
    </APIProvider>
  )
}

export function MapView({
  size = 'full',
  onExpand,
  onCollapse,
  selectedPlace,
  loading = false,
  error = null,
  onRetry,
  bottomSlot,
  hideInlinePlaceCard = false,
  onDirections,
  routeInfo = null,
  header,
  ...canvasProps
}: Props) {
  const { places, itinerary } = canvasProps
  const hasData = (itinerary?.length ?? 0) > 0 || places.length > 0
  const fallbackPlace = selectedPlace ?? places[0] ?? itinerary?.[0] ?? null
  const compactPx = 220
  const mapHeight = size === 'compact' ? 'h-full min-h-[220px]' : 'h-full'
  const mapMinHeight = size === 'compact' ? compactPx : 200

  useEffect(() => {
    if (!API_KEY) {
      console.error('[map] NEXT_PUBLIC_GOOGLE_MAPS_API_KEY is missing')
    }
  }, [])

  if (loading) {
    return (
      <div className={`relative ${mapHeight} w-full overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-[0_2px_12px_rgba(0,0,0,0.06)] dark:border-white/10 dark:bg-[#15151a] dark:shadow-[0_2px_12px_rgba(0,0,0,0.5)]`}>
        <div className="absolute inset-0 animate-pulse bg-gray-100 motion-reduce:animate-none dark:bg-white/5" />
        <div className="absolute inset-0 flex items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-[#F56A00] motion-reduce:animate-none" />
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className={`flex ${mapHeight} w-full flex-col items-center justify-center gap-3 rounded-2xl border border-gray-200 bg-white p-6 text-center shadow-[0_2px_12px_rgba(0,0,0,0.06)] dark:border-white/10 dark:bg-[#15151a] dark:shadow-[0_2px_12px_rgba(0,0,0,0.5)]`}>
        <AlertCircle className="h-6 w-6 text-red-500" />
        <p className="text-[13px] font-medium tracking-tight text-gray-900 dark:text-gray-100">Map unavailable</p>
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="rounded-full bg-[#F56A00] px-4 py-1.5 text-[13px] font-medium text-white transition-colors hover:bg-[#e05a1a] motion-reduce:transition-none"
          >
            Retry
          </button>
        )}
      </div>
    )
  }

  if (!hasData) {
    return (
      <MapPlaceholder
        empty
        className={mapHeight}
      />
    )
  }

  if (!API_KEY) {
    console.error('[map] NEXT_PUBLIC_GOOGLE_MAPS_API_KEY is missing')
    return (
      <MapPlaceholder
        place={fallbackPlace as Place | null}
        userLocation={canvasProps.userLocation}
        routeInfo={routeInfo}
        onDirections={onDirections}
        className={mapHeight}
      />
    )
  }

  return (
    <div
      className={size === 'full' ? 'fixed inset-0 z-50 flex flex-col bg-bg' : 'relative h-full w-full'}
      style={size === 'compact' ? { width: '100%', height: '100%', minHeight: compactPx, display: 'block' } : undefined}
    >
      {size === 'full' && header}
      <div
        className={`relative ${size === 'full' ? 'min-h-0 flex-1' : mapHeight} w-full overflow-hidden ${size === 'compact' ? 'rounded-xl' : ''}`}
        style={size === 'compact' ? { width: '100%', height: '100%', minHeight: compactPx, display: 'block' } : { minHeight: size === 'full' ? 0 : mapMinHeight }}
      >
        {size === 'compact' && onExpand && (
          <button
            type="button"
            onClick={onExpand}
            aria-label="Expand map"
            className="absolute right-2 top-2 z-10 rounded-full border border-gray-200 bg-white/95 p-1.5 shadow-md transition-colors hover:bg-amber-50 dark:border-slate-600 dark:bg-slate-900/95"
          >
            <Maximize2 className="h-3.5 w-3.5 text-gray-600 dark:text-gray-300" />
          </button>
        )}
        {size === 'full' && onCollapse && (
          <>
            <button
              type="button"
              onClick={onCollapse}
              aria-label="Open chat"
              className="absolute left-4 top-4 z-[60] flex items-center gap-2 rounded-full border border-gray-200 bg-white px-4 py-2.5 text-sm font-medium text-gray-800 shadow-lg transition-all hover:bg-amber-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-amber-900/20"
            >
              <ChevronLeft size={16} />
              Open chat
            </button>
            <button
              type="button"
              onClick={onCollapse}
              aria-label="Close map"
              className="absolute right-4 top-4 z-[60] flex h-10 w-10 items-center justify-center rounded-full border border-gray-200 bg-white/95 text-gray-700 shadow-lg transition-colors hover:bg-gray-50 dark:border-slate-600 dark:bg-slate-900/95 dark:text-gray-200"
            >
              <Minimize2 className="h-4 w-4" />
            </button>
          </>
        )}
        <div className="absolute inset-0">
          <MapCanvas {...canvasProps} size={size} />
        </div>
      </div>
      {size === 'compact' && selectedPlace && !hideInlinePlaceCard && <PlaceDetailBox place={selectedPlace} />}
      {size === 'full' && bottomSlot && (
        <div className="absolute bottom-0 left-0 right-0 z-[55] overflow-x-auto border-t border-gray-200 bg-white/95 p-3 backdrop-blur dark:border-slate-700 dark:bg-slate-900/95">
          {bottomSlot}
        </div>
      )}
    </div>
  )
}
