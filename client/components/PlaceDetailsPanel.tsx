'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Clock, ExternalLink, MapPin, Star } from 'lucide-react'
import type { Place } from '@/lib/types'

const PLACES_NEW_ENABLED = process.env.NEXT_PUBLIC_PLACES_API_NEW === '1'

interface PlaceData {
  name: string
  rating?: number
  ratingCount?: number
  priceSymbol?: string
  photoUrls: string[]
  address?: string
  todayHours?: string
  summary?: string
  website?: string
  phone?: string
  mapsUri?: string
  isOpen?: boolean | null
}

interface Props {
  placeId: string
  fallbackName: string
  fallbackMapsUrl: string
  fallbackPlace?: Place | null
  onClose: () => void
}

const PRICE_SYMBOL: Record<string, string> = {
  FREE: 'Free',
  INEXPENSIVE: '$',
  MODERATE: '$$',
  EXPENSIVE: '$$$',
  VERY_EXPENSIVE: '$$$$',
  PRICE_LEVEL_FREE: 'Free',
  PRICE_LEVEL_INEXPENSIVE: '$',
  PRICE_LEVEL_MODERATE: '$$',
  PRICE_LEVEL_EXPENSIVE: '$$$',
  PRICE_LEVEL_VERY_EXPENSIVE: '$$$$',
  '0': 'Free',
  '1': '$',
  '2': '$$',
  '3': '$$$',
  '4': '$$$$',
}

function priceLabel(level?: string | number): string | undefined {
  if (level == null) return undefined
  return PRICE_SYMBOL[String(level)] ?? undefined
}

function summaryText(value: unknown): string | undefined {
  if (!value) return undefined
  if (typeof value === 'string') return value
  if (typeof value === 'object' && value !== null && 'text' in value) {
    const t = (value as { text?: string }).text
    return typeof t === 'string' ? t : undefined
  }
  return undefined
}

function buildFromFallback(place: Place, mapsUrl: string): PlaceData {
  const photoUrls: string[] = []
  if (place.place_id && !place.place_id.startsWith('__')) {
    // Proxied URLs loaded async; keep refs as fallback paths
    for (const p of place.photos ?? []) {
      if (p.startsWith('/api/')) photoUrls.push(p)
    }
  }
  return {
    name: place.name,
    rating: place.rating,
    priceSymbol: priceLabel(place.price_level),
    photoUrls,
    address: place.address || undefined,
    summary: place.summary || undefined,
    website: place.website || undefined,
    mapsUri: place.maps_url || mapsUrl,
    isOpen: null,
  }
}

async function fetchPlaceDetailsApi(placeId: string): Promise<Partial<PlaceData> | null> {
  try {
    const res = await fetch(`/api/place-photos?placeId=${encodeURIComponent(placeId)}`)
    if (!res.ok) return null
    const data = await res.json()
    const hours = data.opening_hours?.weekday_text as string[] | undefined
    const todayIdx = (new Date().getDay() + 6) % 7
    return {
      name: data.name,
      rating: data.rating,
      priceSymbol: priceLabel(data.priceLevel ?? data.price_level),
      photoUrls: Array.isArray(data.photoUrls) ? data.photoUrls : [],
      address: data.address ?? data.formatted_address,
      todayHours: hours?.[todayIdx],
      mapsUri: data.maps_url,
      website: typeof data.website === 'string' ? data.website : undefined,
      isOpen: data.isOpen ?? data.opening_hours?.open_now ?? null,
    }
  } catch {
    return null
  }
}

export function PlaceDetailsPanel({
  placeId,
  fallbackName,
  fallbackMapsUrl,
  fallbackPlace,
  onClose,
}: Props) {
  const [lbOpen, setLbOpen] = useState(false)
  const [lbIndex, setLbIndex] = useState(0)

  const openLightbox = useCallback((index: number) => {
    setLbIndex(index)
    setLbOpen(true)
  }, [])

  const closeLightbox = useCallback(() => setLbOpen(false), [])

  const initial = useMemo(
    () => (fallbackPlace ? buildFromFallback(fallbackPlace, fallbackMapsUrl) : null),
    [fallbackPlace, fallbackMapsUrl],
  )
  const [data, setData] = useState<PlaceData | null>(initial)
  const [status, setStatus] = useState<'loading' | 'ok' | 'error'>('loading')

  const lbPrev = useCallback(() => {
    setLbIndex((i) => (i === 0 ? (data?.photoUrls.length ?? 1) - 1 : i - 1))
  }, [data?.photoUrls.length])

  const lbNext = useCallback(() => {
    setLbIndex((i) => ((i + 1) % (data?.photoUrls.length ?? 1)))
  }, [data?.photoUrls.length])

  useEffect(() => {
    if (!lbOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeLightbox()
      else if (e.key === 'ArrowLeft') lbPrev()
      else if (e.key === 'ArrowRight') lbNext()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [lbOpen, closeLightbox, lbPrev, lbNext])

  useEffect(() => {
    let cancelled = false

    async function load() {
      setStatus('loading')
      const base = fallbackPlace
        ? buildFromFallback(fallbackPlace, fallbackMapsUrl)
        : { name: fallbackName, photoUrls: [], mapsUri: fallbackMapsUrl }

      const api = await fetchPlaceDetailsApi(placeId)
      if (cancelled) return

      const merged: PlaceData = {
        name: api?.name ?? base.name ?? fallbackName,
        rating: api?.rating ?? base.rating,
        ratingCount: undefined,
        priceSymbol: api?.priceSymbol ?? base.priceSymbol,
        photoUrls: api?.photoUrls?.length ? api.photoUrls : base.photoUrls,
        address: api?.address ?? base.address,
        todayHours: api?.todayHours ?? base.todayHours,
        summary: base.summary ?? api?.summary,
        website: api?.website ?? base.website,
        phone: base.phone,
        mapsUri: api?.mapsUri ?? base.mapsUri ?? fallbackMapsUrl,
        isOpen: api?.isOpen ?? base.isOpen ?? null,
      }

      if (PLACES_NEW_ENABLED && typeof google !== 'undefined' && google.maps?.importLibrary) {
        try {
          await google.maps.importLibrary('places')
          const place = new google.maps.places.Place({ id: placeId })
          await place.fetchFields({
            fields: [
              'displayName', 'rating', 'userRatingCount', 'priceLevel', 'photos',
              'formattedAddress', 'regularOpeningHours', 'websiteURI',
              'googleMapsURI', 'nationalPhoneNumber', 'editorialSummary',
            ],
          })
          if (!cancelled) {
            const hours = place.regularOpeningHours
            const todayIdx = (new Date().getDay() + 6) % 7
            merged.name = place.displayName ?? merged.name
            merged.rating = place.rating ?? merged.rating
            merged.ratingCount = place.userRatingCount ?? undefined
            merged.priceSymbol = place.priceLevel ? priceLabel(place.priceLevel) : merged.priceSymbol
            if (merged.photoUrls.length === 0 && place.photos?.length) {
              merged.photoUrls = place.photos
                .map((p) => {
                  try {
                    const uri = p.getURI({ maxWidth: 720, maxHeight: 420 })
                    return `/api/place-photo?url=${encodeURIComponent(uri)}`
                  } catch {
                    return null
                  }
                })
                .filter((u): u is string => !!u)
            }
            merged.address = place.formattedAddress ?? merged.address
            merged.todayHours = hours?.weekdayDescriptions?.[todayIdx] ?? merged.todayHours
            merged.summary = summaryText(place.editorialSummary) ?? merged.summary
            merged.website = place.websiteURI ?? merged.website
            merged.phone = place.nationalPhoneNumber ?? merged.phone
            merged.mapsUri = place.googleMapsURI ?? merged.mapsUri
          }
        } catch {
          /* keep merged API + fallback data */
        }
      }

      if (!cancelled) {
        setData(merged)
        setStatus('ok')
      }
    }

    void load()
    return () => { cancelled = true }
  }, [placeId, fallbackName, fallbackMapsUrl, fallbackPlace])

  const displayName = data?.name ?? fallbackName
  const mapsLink =
    data?.mapsUri ??
    fallbackMapsUrl ??
    (placeId && !placeId.startsWith('__')
      ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(fallbackName)}&query_place_id=${encodeURIComponent(placeId)}`
      : null)

  return (
    <div className="fixed inset-0 z-[250] flex items-center justify-center p-4 animate-fade-up" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      <div className="relative flex max-h-[88vh] w-full max-w-md flex-col overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--bg-header)] shadow-2xl">
        <div className="relative h-44 shrink-0 overflow-hidden bg-gradient-to-br from-amber-50 to-[#ffffff] dark:from-amber-950/40 dark:to-slate-900">
          {data?.photoUrls?.length ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={data.photoUrls[0]}
              alt={displayName}
              className="h-full w-full cursor-zoom-in object-cover"
              loading="lazy"
              onClick={() => openLightbox(0)}
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center">
              <span className="font-display text-4xl font-semibold text-amber-600/60">
                {displayName.split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase()}
              </span>
            </div>
          )}
          <button
            type="button"
            onClick={onClose}
            title="Close"
            className="absolute right-3 top-3 flex h-8 w-8 items-center justify-center rounded-full bg-black/50 text-white backdrop-blur-sm transition-colors hover:bg-black/70"
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4 fill-current"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" /></svg>
          </button>
        </div>

        {data && data.photoUrls.length > 1 && (
          <div className="flex gap-2 overflow-x-auto border-b border-[var(--border)] px-3 py-2 scrollbar-hide">
            {data.photoUrls.map((url, i) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={`${url}-${i}`}
                src={url}
                alt={`${displayName} photo ${i + 1}`}
                className="h-14 w-20 shrink-0 cursor-zoom-in rounded-lg object-cover transition-opacity hover:opacity-80"
                loading="lazy"
                onClick={() => openLightbox(i)}
              />
            ))}
          </div>
        )}

        <div className="scrollbar-hide overflow-y-auto p-5">
          <h2 className="font-display text-xl font-semibold leading-tight text-[var(--text-primary)]">
            {displayName}
          </h2>

          {status === 'loading' && (
            <div className="mt-4 flex items-center gap-2.5">
              <div className="thinking-ring" />
              <span className="text-[11px] tracking-wide text-[var(--text-secondary)]">Loading details…</span>
            </div>
          )}

          {status === 'ok' && data && (
            <>
              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
                {data.rating != null && (
                  <span className="inline-flex items-center gap-1 text-[13px] text-[var(--text-primary)]">
                    <Star className="h-3.5 w-3.5 fill-amber-500 text-amber-500" />
                    {data.rating.toFixed(1)}
                    {data.ratingCount != null && (
                      <span className="text-[var(--text-secondary)]">({data.ratingCount.toLocaleString()})</span>
                    )}
                  </span>
                )}
                {data.priceSymbol && (
                  <span className="text-[13px] font-medium text-green-600">{data.priceSymbol}</span>
                )}
                {data.isOpen != null && (
                  <span
                    className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                      data.isOpen
                        ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300'
                        : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300'
                    }`}
                  >
                    {data.isOpen ? 'Open' : 'Closed'}
                  </span>
                )}
              </div>

              {data.summary && (
                <p className="mt-3 text-[13.5px] leading-relaxed text-[var(--text-secondary)]">{data.summary}</p>
              )}

              {data.todayHours && (
                <p className="mt-3 flex items-start gap-1.5 text-[12.5px] text-[var(--text-secondary)]">
                  <Clock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" />
                  {data.todayHours}
                </p>
              )}

              {data.address && (
                <div className="mt-3 flex items-start gap-2 text-[var(--text-secondary)]">
                  <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" />
                  <span className="text-[13px] leading-relaxed">{data.address}</span>
                </div>
              )}

              {!data.summary && !data.address && !data.rating && (
                <p className="mt-3 text-[13px] text-[var(--text-secondary)]">
                  No extra details from Google yet — try asking Hodari about this place.
                </p>
              )}

              <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-[var(--border)] pt-4">
                {mapsLink && (
                  <a
                    href={mapsLink}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 rounded-full bg-[#F56A00] px-4 py-2 text-[12px] font-medium text-white transition-colors hover:bg-[#e05a1a]"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                    Open in Google Maps
                  </a>
                )}
                {data.website && (
                  <a
                    href={data.website}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="rounded-full border border-[var(--border)] px-3 py-1.5 text-[12px] text-[var(--text-secondary)] transition-colors hover:border-amber-400 hover:text-amber-600"
                  >
                    Website
                  </a>
                )}
                {data.phone && (
                  <a
                    href={`tel:${data.phone}`}
                    className="rounded-full border border-[var(--border)] px-3 py-1.5 text-[12px] text-[var(--text-secondary)] transition-colors hover:border-amber-400 hover:text-amber-600"
                  >
                    {data.phone}
                  </a>
                )}
              </div>
            </>
          )}
        </div>
      </div>
      {lbOpen && data?.photoUrls?.length ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Photo lightbox"
          className="fixed inset-0 z-[60] flex flex-col items-center justify-center bg-black/90"
          onClick={closeLightbox}
        >
          {/* Main image — stop propagation so clicking image doesn't close */}
          <div
            className="relative flex w-full flex-1 items-center justify-center overflow-hidden px-14"
            onClick={(e) => e.stopPropagation()}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={data.photoUrls[lbIndex]}
              alt={`${displayName} photo ${lbIndex + 1} of ${data.photoUrls.length}`}
              className="max-h-[70vh] max-w-full object-contain motion-reduce:transition-none"
              draggable={false}
            />
          </div>

          {/* Counter */}
          <div
            className="absolute top-4 left-1/2 -translate-x-1/2 rounded-full bg-black/60 px-3 py-1 text-[13px] font-medium text-white"
            onClick={(e) => e.stopPropagation()}
          >
            {lbIndex + 1} / {data.photoUrls.length}
          </div>

          {/* Close button */}
          <button
            type="button"
            aria-label="Close lightbox"
            onClick={(e) => { e.stopPropagation(); closeLightbox() }}
            className="absolute right-4 top-4 flex h-9 w-9 items-center justify-center rounded-full bg-black/60 text-white backdrop-blur-sm transition-colors hover:bg-black/80"
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5 fill-current">
              <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
            </svg>
          </button>

          {/* Prev arrow */}
          {data.photoUrls.length > 1 && (
            <button
              type="button"
              aria-label="Previous photo"
              onClick={(e) => { e.stopPropagation(); lbPrev() }}
              className="absolute left-2 top-1/2 -translate-y-1/2 flex h-10 w-10 items-center justify-center rounded-full bg-black/60 text-white backdrop-blur-sm transition-colors hover:bg-[#F56A00] disabled:opacity-30"
            >
              <svg viewBox="0 0 24 24" className="h-6 w-6 fill-current">
                <path d="M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12z" />
              </svg>
            </button>
          )}

          {/* Next arrow */}
          {data.photoUrls.length > 1 && (
            <button
              type="button"
              aria-label="Next photo"
              onClick={(e) => { e.stopPropagation(); lbNext() }}
              className="absolute right-2 top-1/2 -translate-y-1/2 flex h-10 w-10 items-center justify-center rounded-full bg-black/60 text-white backdrop-blur-sm transition-colors hover:bg-[#F56A00] disabled:opacity-30"
            >
              <svg viewBox="0 0 24 24" className="h-6 w-6 fill-current">
                <path d="M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z" />
              </svg>
            </button>
          )}

          {/* Thumbnail strip */}
          {data.photoUrls.length > 1 && (
            <div
              className="flex w-full gap-2 overflow-x-auto px-4 pb-4 pt-3 scrollbar-hide"
              onClick={(e) => e.stopPropagation()}
            >
              {data.photoUrls.map((url, i) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  key={`lb-thumb-${i}`}
                  src={url}
                  alt={`${displayName} photo ${i + 1}`}
                  onClick={(e) => { e.stopPropagation(); setLbIndex(i) }}
                  className={`h-14 w-20 shrink-0 cursor-pointer rounded-lg object-cover transition-opacity motion-reduce:transition-none ${
                    i === lbIndex
                      ? 'ring-2 ring-[#F56A00] opacity-100'
                      : 'opacity-50 hover:opacity-80'
                  }`}
                  loading="lazy"
                />
              ))}
            </div>
          )}
        </div>
      ) : null}
    </div>
  )
}
