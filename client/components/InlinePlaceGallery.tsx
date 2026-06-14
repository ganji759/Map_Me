'use client'

import { useState } from 'react'
import { ExternalLink, Globe, MapPin, Star } from 'lucide-react'
import type { Place } from '@/lib/types'
import { PlaceImage } from './PlaceImage'

interface Props {
  places: Place[]
  /** Opens the in-app details panel (photos lightbox, hours, website, phone). */
  onDetails?: (place: Place) => void
}

function mapsLink(place: Place): string | null {
  if (place.maps_url) return place.maps_url
  if (place.place_id && !place.place_id.startsWith('__')) {
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(place.name)}&query_place_id=${encodeURIComponent(place.place_id)}`
  }
  if (place.coordinates) {
    return `https://www.google.com/maps/search/?api=1&query=${place.coordinates.lat},${place.coordinates.lng}`
  }
  return null
}

/**
 * Persistent place cards rendered INSIDE the chat, directly under the AI reply.
 * Unlike the map's bottom strip these don't slide in or live on the right — they
 * stay attached to the message so the images are always there on scroll-back.
 */
export function InlinePlaceGallery({ places, onDetails }: Props) {
  if (!places?.length) return null

  // Past ~4 cards (2 rows on desktop) cap the height and let it scroll
  // vertically (up/down) so the gallery doesn't push the chat down endlessly.
  const scrolls = places.length > 4

  return (
    <div
      className={`mt-3 grid grid-cols-1 gap-2.5 sm:grid-cols-2 ${
        scrolls ? 'chat-scroll max-h-[58vh] overflow-y-auto pr-1' : ''
      }`}
    >
      {places.map((place, i) => {
        const href = mapsLink(place)
        return (
          <div
            key={`${place.place_id || place.name}-${i}`}
            className="group overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--bg-header)] shadow-[0_1px_8px_rgba(0,0,0,0.05)] transition-colors hover:border-[#F56A00]/40 dark:shadow-[0_1px_8px_rgba(0,0,0,0.4)]"
          >
            <button
              type="button"
              onClick={() => onDetails?.(place)}
              className="block w-full text-left"
              title="See photos & details"
            >
              <GalleryPhoto place={place} />
              <div className="px-3 pb-1.5 pt-2">
                <p className="line-clamp-1 text-[13px] font-medium leading-snug text-[var(--text-primary)]">
                  {place.name}
                </p>
                <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5">
                  {place.rating != null && (
                    <span className="flex items-center gap-1 text-[11px] text-[var(--text-secondary)]">
                      <Star className="h-3 w-3 fill-amber-500 text-amber-500" />
                      {place.rating.toFixed(1)}
                    </span>
                  )}
                  {place.open_now != null && (
                    <span className={`text-[10px] font-semibold ${place.open_now ? 'text-[#1FA463]' : 'text-[#E5484D]'}`}>
                      {place.open_now ? 'Open now' : 'Closed'}
                    </span>
                  )}
                </div>
              </div>
            </button>
            <div className="flex items-center gap-1.5 px-2.5 pb-2 pt-0.5">
              <button
                type="button"
                onClick={() => onDetails?.(place)}
                className="rounded-full bg-[#F56A00]/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-[#F56A00] transition-colors hover:bg-[#F56A00]/20 dark:bg-[#F56A00]/15 dark:text-[#FF8C2F]"
              >
                Details
              </button>
              {place.website && (
                <a
                  href={place.website}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  className="inline-flex items-center gap-1 rounded-full border border-[var(--border)] px-2.5 py-1 text-[10px] font-medium uppercase tracking-wide text-[var(--text-secondary)] transition-colors hover:border-[#F56A00]/40 hover:text-[#F56A00]"
                >
                  <Globe className="h-3 w-3" />
                  Site
                </a>
              )}
              {href && (
                <a
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  className="ml-auto inline-flex items-center gap-1 rounded-full border border-[var(--border)] px-2.5 py-1 text-[10px] font-medium uppercase tracking-wide text-[var(--text-secondary)] transition-colors hover:border-[#F56A00]/40 hover:text-[#F56A00]"
                >
                  <ExternalLink className="h-3 w-3" />
                  Maps
                </a>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function GalleryPhoto({ place }: { place: Place }) {
  const [loaded, setLoaded] = useState(false)
  return (
    <div className="relative h-28 w-full overflow-hidden bg-black/5 dark:bg-white/5">
      {!loaded && <div className="place-shimmer absolute inset-0" aria-hidden />}
      <PlaceImage
        place={place}
        width={440}
        height={240}
        className="relative h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
        onLoad={() => setLoaded(true)}
      />
      <span className="pointer-events-none absolute left-2 top-2 flex items-center gap-1 rounded-full bg-black/55 px-2 py-0.5 text-[9px] font-medium uppercase tracking-wide text-white backdrop-blur-sm">
        <MapPin className="h-2.5 w-2.5" />
        {place.city || 'Place'}
      </span>
    </div>
  )
}
