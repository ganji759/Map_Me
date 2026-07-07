export type LatLng = { lat: number; lng: number }

/** Fallback map center when the user has not granted location (SF Bay Area). */
export const SF_BAY_CENTER: LatLng = { lat: 37.6819, lng: -122.3453 }

/** Rough distance in km between two WGS84 points. */
export function distanceKm(a: LatLng, b: LatLng): number {
  const R = 6371
  const dLat = ((b.lat - a.lat) * Math.PI) / 180
  const dLng = ((b.lng - a.lng) / 180) * Math.PI
  const lat1 = (a.lat * Math.PI) / 180
  const lat2 = (b.lat * Math.PI) / 180
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

export function isValidCoord(c: LatLng): boolean {
  return (
    Number.isFinite(c.lat) &&
    Number.isFinite(c.lng) &&
    Math.abs(c.lat) <= 90 &&
    Math.abs(c.lng) <= 180 &&
    !(c.lat === 0 && c.lng === 0)
  )
}

/** True when pins are implausibly far from the user's GPS (wrong city search). */
export function pinsFarFromUser(user: LatLng, places: LatLng[], thresholdKm = 80): boolean {
  if (!isValidCoord(user) || places.length === 0) return false
  const nearest = Math.min(...places.map((p) => distanceKm(user, p)))
  return nearest > thresholdKm
}

/** Why a geolocation request failed — mapped from GeolocationPositionError. */
export type GeoFailure = 'denied' | 'unavailable' | 'timeout' | 'insecure' | 'unsupported'

export type GeoResult =
  | { ok: true; location: LatLng }
  | { ok: false; reason: GeoFailure; message: string }

/**
 * Human-readable, actionable copy for each failure mode. Mobile browsers fail
 * geolocation for very different reasons (permission vs. GPS vs. http), so the
 * UI should never show a generic "location unavailable".
 */
export function describeGeoFailure(reason: GeoFailure): string {
  switch (reason) {
    case 'denied':
      return 'Location is blocked for this site. Tap the lock (or AA) icon in your browser’s address bar, allow Location, then try again — or set your city below.'
    case 'unavailable':
      return 'Your device couldn’t get a position (GPS may be off or there’s no signal). Turn on device location services, or set your city below.'
    case 'timeout':
      return 'Getting a GPS fix took too long. Try again — it’s faster outdoors — or set your city below.'
    case 'insecure':
      return 'Location only works over a secure (https) connection. Open the https version of this site, or set your city below.'
    case 'unsupported':
      return 'This browser doesn’t support location. Set your city below instead.'
  }
}

/**
 * Pre-detect the geolocation permission state without prompting. Returns
 * 'unknown' where the Permissions API is missing (older iOS Safari).
 */
export async function queryGeoPermission(): Promise<'granted' | 'prompt' | 'denied' | 'unknown'> {
  if (typeof navigator === 'undefined' || !navigator.geolocation) return 'unknown'
  try {
    const status = await navigator.permissions?.query?.({ name: 'geolocation' })
    if (status?.state === 'granted' || status?.state === 'prompt' || status?.state === 'denied') {
      return status.state
    }
  } catch {
    /* Permissions API unsupported — fall through */
  }
  return 'unknown'
}

/**
 * One-shot position request with a typed failure reason. Must be called from
 * an explicit user gesture on mobile — browsers ignore or auto-deny prompts
 * fired on page load.
 */
export function requestUserLocationDetailed(): Promise<GeoResult> {
  if (typeof navigator === 'undefined' || !navigator.geolocation) {
    return Promise.resolve({ ok: false, reason: 'unsupported', message: describeGeoFailure('unsupported') })
  }
  if (typeof window !== 'undefined' && window.isSecureContext === false) {
    return Promise.resolve({ ok: false, reason: 'insecure', message: describeGeoFailure('insecure') })
  }
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (pos) =>
        resolve({ ok: true, location: { lat: pos.coords.latitude, lng: pos.coords.longitude } }),
      (err) => {
        const reason: GeoFailure =
          err.code === err.PERMISSION_DENIED
            ? 'denied'
            : err.code === err.TIMEOUT
              ? 'timeout'
              : 'unavailable'
        resolve({ ok: false, reason, message: describeGeoFailure(reason) })
      },
      { enableHighAccuracy: true, timeout: 20_000, maximumAge: 120_000 },
    )
  })
}

export async function requestUserLocation(): Promise<LatLng | null> {
  const res = await requestUserLocationDetailed()
  return res.ok ? res.location : null
}

/**
 * Initial map center: user's GPS when available, otherwise SF Bay Area.
 * When places load, MapBounds fitBounds overrides this to show pins + user.
 */
export function defaultMapCenter(
  markers: LatLng[],
  userLocation: LatLng | null,
): LatLng {
  if (userLocation && isValidCoord(userLocation)) return userLocation
  const first = markers.find(isValidCoord)
  if (first) return first
  return SF_BAY_CENTER
}

/** Skip fitting user + pins when GPS is far from results (avoids country-level zoom). */
export function shouldIncludeUserInBounds(
  user: LatLng | null,
  markers: LatLng[],
  maxKm = 25,
): boolean {
  if (!user || !isValidCoord(user) || markers.length === 0) return false
  const valid = markers.filter(isValidCoord)
  if (valid.length === 0) return false
  const nearest = Math.min(...valid.map((m) => distanceKm(user, m)))
  return nearest <= maxKm
}
