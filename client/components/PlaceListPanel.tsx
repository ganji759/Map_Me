'use client'

import { motion } from 'framer-motion'
import { Bookmark, ExternalLink, Star } from 'lucide-react'
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
  if (places.length === 0) return null

  return (
    <div className="flex min-h-0 flex-1 flex-col border-t border-border bg-surface/80 backdrop-blur-sm">
      <div className="shrink-0 px-3 py-2">
        <p className="font-mono text-[10px] font-medium uppercase tracking-widest text-text3">
          Places · {places.length}
        </p>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3 scrollbar-hide">
        <ol className="space-y-3">
          {places.map((place, i) => {
            const isActive = activeIndex === i
            const href = mapsLink(place)
            return (
              <motion.li
                key={`${place.place_id || place.name}-${i}`}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.04, duration: 0.22 }}
              >
                <div
                  className={`w-full overflow-hidden rounded-xl border text-left transition-all ${
                    isActive
                      ? 'border-amber-400/60 bg-amber-50/80 shadow-md ring-1 ring-amber-400/30 dark:bg-amber-950/20'
                      : 'border-border bg-surface hover:border-amber-300/50'
                  }`}
                >
                  <button type="button" onClick={() => onSelect(i)} className="block w-full text-left">
                    <PlaceImage
                      place={place}
                      width={480}
                      height={280}
                      className="h-36 w-full object-cover sm:h-40"
                    />
                    <div className="px-3 py-2.5">
                      <span className="font-mono text-[9px] uppercase tracking-wider text-amber-600">
                        {i + 1}
                      </span>
                      <p className="mt-0.5 text-[14px] font-medium leading-snug text-text">{place.name}</p>
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
                      className="rounded-full px-3 py-1 text-[10px] font-medium uppercase tracking-wide text-amber-700 transition-colors hover:bg-amber-100 dark:text-amber-400 dark:hover:bg-amber-900/30"
                    >
                      Details
                    </button>
                    {onSave && (
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); onSave(place) }}
                        title={savedIds?.has(place.place_id) ? 'Remove from saved' : 'Save place'}
                        className={`rounded-full p-1.5 transition-colors ${savedIds?.has(place.place_id) ? 'text-amber-600 hover:text-amber-700' : 'text-text3 hover:text-amber-500'}`}
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
                        className="ml-auto inline-flex items-center gap-1 rounded-full px-3 py-1 text-[10px] font-medium uppercase tracking-wide text-text2 transition-colors hover:text-amber-600"
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
    </div>
  )
}
