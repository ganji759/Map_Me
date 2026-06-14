'use client'

import { useState } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import { ExternalLink, MapPin, Navigation, Star } from 'lucide-react'
import type { Place } from '@/lib/types'
import { PlaceImage } from './PlaceImage'

interface Props {
  places: Place[]
  activeIndex: number | null
  onSelect: (index: number) => void
  onShowDetails: (place: Place) => void
  /** Explicit route-from-my-location — only runs when the user taps it. */
  onRouteFromMe?: (index: number) => void
  leftOffset?: number
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

/** Horizontal place cards with photos — full-map bottom strip. */
export function PlaceCardStrip({ places, activeIndex, onSelect, onShowDetails, onRouteFromMe, leftOffset = 0 }: Props) {
  const reduced = useReducedMotion()
  if (places.length === 0) return null

  return (
    <div
      className="absolute bottom-0 right-0 z-[25] border-t border-border bg-surface/95 px-4 py-3 backdrop-blur-md"
      style={{ left: leftOffset }}
    >
      <div className="mb-2.5">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-[#F56A00]/10 px-3 py-1 text-[11px] font-medium tracking-wide text-[#F56A00] dark:bg-[#F56A00]/15 dark:text-[#FF8C2F]">
          <MapPin className="h-3 w-3" />
          Places · {places.length}
        </span>
      </div>
      <div className="flex gap-3 overflow-x-auto pb-1 scrollbar-hide">
        {places.map((place, i) => {
          const isActive = activeIndex === i
          const href = mapsLink(place)
          return (
            <motion.div
              key={`${place.place_id || place.name}-${i}`}
              initial={reduced ? false : { opacity: 0, x: 16 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: reduced ? 0 : i * 0.05, duration: reduced ? 0 : 0.22 }}
              className={`w-[min(72vw,220px)] shrink-0 overflow-hidden rounded-2xl border bg-surface transition-all duration-200 motion-reduce:transition-none motion-reduce:transform-none ${
                isActive
                  ? 'border-[#F56A00]/70 shadow-[0_8px_24px_rgba(245,106,0,0.18)] ring-2 ring-[#F56A00]/60'
                  : 'border-border shadow-[0_2px_12px_rgba(0,0,0,0.06)] hover:-translate-y-1 hover:border-[#F56A00]/40 hover:shadow-[0_10px_28px_rgba(0,0,0,0.14)] dark:shadow-[0_2px_12px_rgba(0,0,0,0.5)] dark:hover:shadow-[0_10px_28px_rgba(0,0,0,0.65)]'
              }`}
            >
              <button type="button" onClick={() => onSelect(i)} className="block w-full text-left">
                <PlaceCardPhoto place={place} />
                <div className="px-3 py-2">
                  <span className="font-mono text-[9px] uppercase tracking-wider text-[#F56A00] dark:text-[#FF8C2F]">{i + 1}</span>
                  <p className="line-clamp-2 text-[13px] font-medium leading-snug tracking-tight text-text">{place.name}</p>
                  <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
                    {place.rating != null && (
                      <span className="flex items-center gap-1 text-[11px] text-text2">
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
              <div className="flex items-center gap-2 border-t border-border/60 px-2.5 py-2">
                <button
                  type="button"
                  onClick={() => onShowDetails(place)}
                  className="rounded-full bg-[#F56A00]/10 px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-[#F56A00] transition-colors hover:bg-[#F56A00]/20 dark:bg-[#F56A00]/15 dark:text-[#FF8C2F] dark:hover:bg-[#F56A00]/25"
                >
                  Details
                </button>
                {onRouteFromMe && (
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); onRouteFromMe(i) }}
                    title="Route from my location"
                    className="inline-flex items-center gap-1 rounded-full border border-border px-3 py-1 text-[10px] font-medium uppercase tracking-wide text-text2 transition-colors hover:border-[#F56A00]/40 hover:text-[#F56A00]"
                  >
                    <Navigation className="h-3 w-3" />
                    Route
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
            </motion.div>
          )
        })}
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
    <div className="relative h-28 w-full overflow-hidden sm:h-32">
      {!loaded && <div className="place-shimmer absolute inset-0" aria-hidden />}
      <PlaceImage
        place={place}
        width={440}
        height={260}
        className="relative h-full w-full object-cover"
        onLoad={() => setLoaded(true)}
      />
    </div>
  )
}
