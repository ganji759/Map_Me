'use client'

import { useState } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import { Bookmark, ExternalLink, MapPin, Star } from 'lucide-react'
import type { Place } from '@/lib/types'
import { PlaceImage } from './PlaceImage'

interface Props {
  places: Place[]
  activeIndex: number | null
  onSelect: (index: number) => void
  onShowDetails: (place: Place) => void
  onSave?: (place: Place) => void
  savedIds?: Set<string>
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

export function PlaceListPanel({ places, activeIndex, onSelect, onShowDetails, onSave, savedIds }: Props) {
  const reduced = useReducedMotion()
  if (places.length === 0) return null

  return (
    <div className="flex min-h-0 flex-1 flex-col border-t border-border bg-surface/80 backdrop-blur-sm">
      <div className="shrink-0 px-3 py-2.5">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-[#F56A00]/10 px-3 py-1 text-[11px] font-medium tracking-wide text-[#F56A00] dark:bg-[#F56A00]/15 dark:text-[#FF8C2F]">
          <MapPin className="h-3 w-3" />
          Places · {places.length}
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3 scrollbar-hide">
        <ol className="space-y-3">
          {places.map((place, i) => {
            const isActive = activeIndex === i
            const href = mapsLink(place)
            return (
              <motion.li
                key={`${place.place_id || place.name}-${i}`}
                initial={reduced ? false : { opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: reduced ? 0 : i * 0.04, duration: reduced ? 0 : 0.22 }}
              >
                <div
                  className={`w-full overflow-hidden rounded-2xl border text-left transition-all duration-200 motion-reduce:transition-none motion-reduce:transform-none ${
                    isActive
                      ? 'border-[#F56A00]/60 bg-[#F56A00]/[0.06] shadow-[0_6px_20px_rgba(245,106,0,0.16)] ring-1 ring-[#F56A00]/50 dark:bg-[#F56A00]/10'
                      : 'border-border bg-surface shadow-[0_2px_12px_rgba(0,0,0,0.06)] hover:-translate-y-0.5 hover:border-[#F56A00]/40 hover:shadow-[0_8px_24px_rgba(0,0,0,0.12)] dark:shadow-[0_2px_12px_rgba(0,0,0,0.5)] dark:hover:shadow-[0_8px_24px_rgba(0,0,0,0.6)]'
                  }`}
                >
                  <button type="button" onClick={() => onSelect(i)} className="block w-full text-left">
                    <PlaceCardPhoto place={place} />
                    <div className="px-3 py-2.5">
                      <span className="font-mono text-[9px] uppercase tracking-wider text-[#F56A00] dark:text-[#FF8C2F]">
                        {i + 1}
                      </span>
                      <p className="mt-0.5 text-[14px] font-medium leading-snug tracking-tight text-text">{place.name}</p>
                      {place.rating != null && (
                        <p className="mt-1 flex items-center gap-1 text-[11px] text-text2">
                          <Star className="h-3.5 w-3.5 fill-amber-500 text-amber-500" />
                          {place.rating.toFixed(1)}
                        </p>
                      )}
                      {place.address && (
                        <p className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-text2">{place.address}</p>
                      )}
                    </div>
                  </button>
                  <div className="flex items-center gap-2 border-t border-border/60 px-3 py-2">
                    <button
                      type="button"
                      onClick={() => onShowDetails(place)}
                      className="rounded-full bg-[#F56A00]/10 px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-[#F56A00] transition-colors hover:bg-[#F56A00]/20 dark:bg-[#F56A00]/15 dark:text-[#FF8C2F] dark:hover:bg-[#F56A00]/25"
                    >
                      Details
                    </button>
                    {onSave && (
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); onSave(place) }}
                        title={savedIds?.has(place.place_id) ? 'Remove from saved' : 'Save place'}
                        className={`rounded-full p-1.5 transition-colors ${
                          savedIds?.has(place.place_id)
                            ? 'text-[#F56A00] hover:text-[#D45400] dark:text-[#FF8C2F]'
                            : 'text-text3 hover:text-[#F56A00]'
                        }`}
                      >
                        <Bookmark className={`h-3.5 w-3.5 ${savedIds?.has(place.place_id) ? 'fill-current' : ''}`} />
                      </button>
                    )}
                    {href && (
                      <a
                        href={href}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="ml-auto inline-flex items-center gap-1 rounded-full border border-border px-3 py-1 text-[10px] font-medium uppercase tracking-wide text-text2 transition-colors hover:border-[#F56A00]/40 hover:text-[#F56A00]"
                      >
                        <ExternalLink className="h-3 w-3" />
                        Maps
                      </a>
                    )}
                  </div>
                </div>
              </motion.li>
            )
          })}
        </ol>
      </div>
      <style>{`
        .place-shimmer {
          background-color: rgb(0 0 0 / 0.06);
          background-image: linear-gradient(100deg, transparent 30%, rgb(255 255 255 / 0.55) 50%, transparent 70%);
          background-size: 200% 100%;
          background-repeat: no-repeat;
          animation: place-shimmer-slide 1.8s ease-in-out infinite;
        }
        .dark .place-shimmer {
          background-color: rgb(255 255 255 / 0.06);
          background-image: linear-gradient(100deg, transparent 30%, rgb(255 255 255 / 0.1) 50%, transparent 70%);
        }
        @keyframes place-shimmer-slide {
          from { background-position: 180% 0; }
          to   { background-position: -80% 0; }
        }
        @media (prefers-reduced-motion: reduce) {
          .place-shimmer { animation: none; }
        }
      `}</style>
    </div>
  )
}

function PlaceCardPhoto({ place }: { place: Place }) {
  const [loaded, setLoaded] = useState(false)
  return (
    <div className="relative h-36 w-full overflow-hidden sm:h-40">
      {!loaded && <div className="place-shimmer absolute inset-0" aria-hidden />}
      <PlaceImage
        place={place}
        width={480}
        height={280}
        className="relative h-full w-full object-cover"
        onLoad={() => setLoaded(true)}
      />
    </div>
  )
}
