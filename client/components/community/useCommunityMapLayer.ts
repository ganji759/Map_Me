'use client'

/**
 * useCommunityMapLayer — data feed for the map's community layer.
 *
 * Two independent switches:
 *  - `pinsEnabled`   → fetch shared pins (GET /api/community/pins) on enable and
 *    every 60s. Pins carry the owner's attribution for the "shared by @handle"
 *    marker card.
 *  - `friendsEnabled` → every 15s: accepted connections → their profiles (the
 *    only endpoint that exposes a connection's location, and only when they
 *    share it) + bulk presence for the online ring. Also heartbeats the
 *    caller's own coordinates every 30s — the server persists them ONLY if the
 *    caller's own share_location toggle is on, so own visibility follows the
 *    profile setting with no client-side logic.
 *
 * Both intervals stop as soon as their switch turns off, and all state is
 * cleared, so the core map/chat path pays nothing while the layer is unused.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  getConnections,
  getPresence,
  getProfileByHandle,
  sendHeartbeat,
} from '@/lib/communityClient'
import type { SharedPin, UserAttribution } from '@/lib/community'

/** A shared pin projected for map rendering (owner attribution inlined). */
export interface CommunityMapPin {
  pin_id: string
  place_id: string
  name: string
  lat: number
  lng: number
  address: string | null
  photo_url: string | null
  rating: number | null
  note: string
  owner: UserAttribution | null
}

/** An accepted connection with share_location on and a fresh position. */
export interface CommunityFriend {
  user_id: string
  handle: string
  name: string | null
  avatar_emoji: string
  lat: number
  lng: number
  online: boolean
  last_seen_at: string | null
}

const PINS_POLL_MS = 60_000
const FRIENDS_POLL_MS = 15_000
const HEARTBEAT_MS = 30_000
/** Hide a connection whose location heartbeat is older than this. */
const LOCATION_FRESH_MS = 30 * 60_000
/** Cap per-tick profile lookups (one GET per connection). */
const MAX_FRIENDS = 20

type PinsResponse = { pins?: Array<SharedPin & { owner?: UserAttribution | null }> }

async function fetchSharedPins(): Promise<CommunityMapPin[]> {
  const res = await fetch('/api/community/pins')
  if (!res.ok) return []
  const data = (await res.json().catch(() => ({}))) as PinsResponse
  const out: CommunityMapPin[] = []
  for (const pin of data.pins ?? []) {
    const p = pin.place
    if (!p || typeof p.lat !== 'number' || typeof p.lng !== 'number') continue
    out.push({
      pin_id: pin.pin_id,
      place_id: p.place_id,
      name: p.name,
      lat: p.lat,
      lng: p.lng,
      address: p.address ?? null,
      photo_url: p.photo_url ?? null,
      rating: p.rating ?? null,
      note: pin.note ?? '',
      owner: pin.owner ?? null,
    })
  }
  return out
}

async function fetchFriendLocations(): Promise<CommunityFriend[]> {
  const conns = await getConnections()
  const edges = conns.accepted.filter((e) => e.user).slice(0, MAX_FRIENDS)
  if (edges.length === 0) return []
  const ids = edges.map((e) => e.user!.user_id)
  const [presence, profiles] = await Promise.all([
    getPresence(ids).catch(() => ({} as Awaited<ReturnType<typeof getPresence>>)),
    Promise.all(edges.map((e) => getProfileByHandle(e.user!.handle).catch(() => null))),
  ])
  const out: CommunityFriend[] = []
  for (const profile of profiles) {
    if (!profile?.share_location || !profile.location) continue
    const [lng, lat] = profile.location.coordinates
    if (typeof lat !== 'number' || typeof lng !== 'number') continue
    const p = presence[profile.user_id]
    const lastSeen = p?.last_seen_at ?? profile.last_seen_at
    if (!lastSeen || Date.now() - Date.parse(lastSeen) > LOCATION_FRESH_MS) continue
    out.push({
      user_id: profile.user_id,
      handle: profile.handle,
      name: profile.name,
      avatar_emoji: profile.avatar_emoji,
      lat,
      lng,
      online: p?.online ?? profile.online,
      last_seen_at: lastSeen,
    })
  }
  return out
}

export interface CommunityMapLayerOptions {
  /** Fetch/refresh shared pins (panel open OR layer toggle on). */
  pinsEnabled: boolean
  /** Poll connection locations + presence (layer toggle on only). */
  friendsEnabled: boolean
  /** Caller's GPS — heartbeated so connections can see them (if sharing). */
  userLocation: { lat: number; lng: number } | null
}

export function useCommunityMapLayer({ pinsEnabled, friendsEnabled, userLocation }: CommunityMapLayerOptions): {
  pins: CommunityMapPin[]
  friends: CommunityFriend[]
  /** Re-fetch pins now (e.g. right after sharing one). */
  refreshPins: () => void
} {
  const [pins, setPins] = useState<CommunityMapPin[]>([])
  const [friends, setFriends] = useState<CommunityFriend[]>([])
  const pinsEnabledRef = useRef(pinsEnabled)
  pinsEnabledRef.current = pinsEnabled
  const locationRef = useRef(userLocation)
  locationRef.current = userLocation

  const refreshPins = useCallback(() => {
    if (!pinsEnabledRef.current) return
    void fetchSharedPins()
      .then((next) => { if (pinsEnabledRef.current) setPins(next) })
      .catch(() => { /* transient — next tick retries */ })
  }, [])

  // ── Shared pins ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!pinsEnabled) {
      setPins([])
      return
    }
    refreshPins()
    const interval = setInterval(refreshPins, PINS_POLL_MS)
    return () => clearInterval(interval)
  }, [pinsEnabled, refreshPins])

  // ── Connection locations + presence ─────────────────────────────────────────
  useEffect(() => {
    if (!friendsEnabled) {
      setFriends([])
      return
    }
    let cancelled = false
    let inFlight = false
    const tick = () => {
      if (inFlight || (typeof document !== 'undefined' && document.visibilityState !== 'visible')) return
      inFlight = true
      void fetchFriendLocations()
        .then((next) => { if (!cancelled) setFriends(next) })
        .catch(() => { /* transient */ })
        .finally(() => { inFlight = false })
    }
    tick()
    const interval = setInterval(tick, FRIENDS_POLL_MS)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [friendsEnabled])

  // ── Own heartbeat with coordinates (server enforces share_location) ─────────
  useEffect(() => {
    if (!friendsEnabled) return
    const beat = () => {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return
      void sendHeartbeat(locationRef.current ?? undefined).catch(() => { /* best-effort */ })
    }
    beat()
    const interval = setInterval(beat, HEARTBEAT_MS)
    return () => clearInterval(interval)
  }, [friendsEnabled])

  return { pins, friends, refreshPins }
}
