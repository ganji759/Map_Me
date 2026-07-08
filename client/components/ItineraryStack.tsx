'use client'

import { useState } from 'react'
import type { ItineraryStop } from '@/lib/types'

interface Props {
  stops: ItineraryStop[]
  activeIndex: number | null
  onSelect: (index: number) => void
  voiceSummary?: string
  onFeedback?: (stopIndex: number, action: 'liked' | 'disliked') => void
  onSwap?: (stopIndex: number) => void
  onAsk?: (stopIndex: number, prompt: string) => void
  onShowDetails?: (stop: ItineraryStop) => void
  leftOffset?: number
}

function ThumbUpIcon() {
  return (
    <svg viewBox="0 0 24 24" className="w-3.5 h-3.5 fill-current">
      <path d="M1 21h4V9H1v12zm22-11c0-1.1-.9-2-2-2h-6.31l.95-4.57.03-.32c0-.41-.17-.79-.44-1.06L14.17 1 7.59 7.59C7.22 7.95 7 8.45 7 9v10c0 1.1.9 2 2 2h9c.83 0 1.54-.5 1.84-1.22l3.02-7.05c.09-.23.14-.47.14-.73v-2z"/>
    </svg>
  )
}

function ThumbDownIcon() {
  return (
    <svg viewBox="0 0 24 24" className="w-3.5 h-3.5 fill-current">
      <path d="M15 3H6c-.83 0-1.54.5-1.84 1.22l-3.02 7.05c-.09.23-.14.47-.14.73v2c0 1.1.9 2 2 2h6.31l-.95 4.57-.03.32c0 .41.17.79.44 1.06L10.83 23l6.59-6.59c.36-.36.58-.86.58-1.41V5c0-1.1-.9-2-2-2zm4 0v12h4V3h-4z"/>
    </svg>
  )
}

function SwapIcon() {
  return (
    <svg viewBox="0 0 24 24" className="w-3.5 h-3.5 fill-current">
      <path d="M12 6v3l4-4-4-4v3c-4.42 0-8 3.58-8 8 0 1.57.46 3.03 1.24 4.26L6.7 14.8c-.45-.83-.7-1.79-.7-2.8 0-3.31 2.69-6 6-6zm6.76 1.74L17.3 9.2c.44.84.7 1.79.7 2.8 0 3.31-2.69 6-6 6v-3l-4 4 4 4v-3c4.42 0 8-3.58 8-8 0-1.57-.46-3.03-1.24-4.26z"/>
    </svg>
  )
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={`w-4 h-4 fill-current transition-transform duration-300 ${open ? 'rotate-180' : ''}`}
    >
      <path d="M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6z"/>
    </svg>
  )
}

function PinIcon() {
  return (
    <svg viewBox="0 0 24 24" className="w-3 h-3 fill-current shrink-0">
      <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5a2.5 2.5 0 110-5 2.5 2.5 0 010 5z"/>
    </svg>
  )
}

function SparkIcon() {
  return (
    <svg viewBox="0 0 24 24" className="w-3 h-3 fill-current shrink-0">
      <path d="M12 2l1.6 5.4L19 9l-5.4 1.6L12 16l-1.6-5.4L5 9l5.4-1.6L12 2z"/>
    </svg>
  )
}

function ExternalIcon() {
  return (
    <svg viewBox="0 0 24 24" className="w-3 h-3 fill-current shrink-0">
      <path d="M14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7zM5 5h5V3H3v18h18v-7h-2v5H5V5z"/>
    </svg>
  )
}

function mapsUrl(stop: ItineraryStop): string {
  const base = `https://www.google.com/maps/search/?api=1&query=${stop.coordinates.lat},${stop.coordinates.lng}`
  return stop.place_id ? `${base}&query_place_id=${encodeURIComponent(stop.place_id)}` : base
}

// Unique per-card key. place_id alone collides when the itinerary repeats a
// place (e.g. the "min 2 stops" fallback duplicates the only candidate), so we
// always fold in the index.
function cardKey(stop: ItineraryStop, i: number): string {
  return `${stop.place_id || 'stop'}-${i}`
}

function askChips(stop: ItineraryStop, i: number): { label: string; prompt: string }[] {
  return [
    { label: 'Tell me more', prompt: `Tell me more about ${stop.name}, what makes it worth the stop and anything I should know before going?` },
    { label: 'Why this stop?', prompt: `Why did you pick ${stop.name} as stop ${i + 1} in my plan?` },
    { label: 'Hours & price', prompt: `What are ${stop.name}'s typical opening hours and roughly how expensive is it?` },
    { label: 'Nearby', prompt: `What else is worth seeing or eating near ${stop.name}?` },
  ]
}

export function ItineraryStack({ stops, activeIndex, onSelect, voiceSummary, onFeedback, onSwap, onAsk, onShowDetails, leftOffset = 0 }: Props) {
  const [ratings, setRatings] = useState<Record<string, 'liked' | 'disliked'>>({})
  const [expanded, setExpanded] = useState(false)
  const [collapsed, setCollapsed] = useState(false)

  function handleFeedback(e: React.MouseEvent, i: number, action: 'liked' | 'disliked') {
    e.stopPropagation()
    const key = cardKey(stops[i], i)
    setRatings((prev) => ({ ...prev, [key]: action }))
    onFeedback?.(i, action)
  }

  function handleSwap(e: React.MouseEvent, i: number) {
    e.stopPropagation()
    onSwap?.(i)
  }

  function handleCardClick(i: number) {
    if (activeIndex === i) {
      setExpanded((v) => !v)
    } else {
      onSelect(i)
      setExpanded(true)
    }
  }

  const active = activeIndex != null ? stops[activeIndex] : null
  const isOpen = expanded && active != null
  const activeRating = active && activeIndex != null ? ratings[cardKey(active, activeIndex)] : undefined

  return (
    <div className="absolute bottom-0 right-0 p-4" style={{ left: leftOffset }}>
      {collapsed ? (
        /* ── Collapsed: a single pill to bring the itinerary back ── */
        <button
          onClick={() => setCollapsed(false)}
          title="Show itinerary"
          className="glass rounded-xl px-4 py-3 flex items-center gap-2 text-text2 hover:text-gold transition-colors animate-fade-up"
        >
          <span className="font-mono text-xs tracking-wider uppercase">
            Itinerary · {stops.length} {stops.length === 1 ? 'stop' : 'stops'}
          </span>
          <svg viewBox="0 0 24 24" className="w-4 h-4 fill-current"><path d="M7.41 15.41L12 10.83l4.59 4.58L18 14l-6-6-6 6z" /></svg>
        </button>
      ) : (
      <>
      {/* ── Header: title + collapse toggle ── */}
      <div className="flex items-center justify-between mb-2.5 max-w-lg">
        <span className="font-mono text-[11px] tracking-widest uppercase text-text3">
          Your plan · {stops.length} {stops.length === 1 ? 'stop' : 'stops'}
        </span>
        <button
          onClick={() => setCollapsed(true)}
          title="Hide itinerary"
          className="glass p-1.5 rounded-lg text-text3 hover:text-gold transition-all"
        >
          <svg viewBox="0 0 24 24" className="w-4 h-4 fill-current"><path d="M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6z" /></svg>
        </button>
      </div>

      {/* Voice summary — its own glassy pill */}
      {voiceSummary && (
        <div className="glass rounded-xl px-4 py-3 mb-3 max-w-2xl animate-fade-up">
          <p className="font-mono text-[12.5px] text-text2 italic tracking-wide line-clamp-2">
            <span className="text-gold not-italic mr-2">›</span>
            {voiceSummary}
          </p>
        </div>
      )}

      {/* ── Expandable detail sheet (full text for the active stop) ───────── */}
      {isOpen && active && (
            <div className="glass rounded-2xl max-h-[42vh] overflow-y-auto px-5 pt-4 pb-4 mb-3 max-w-md scrollbar-hide animate-fade-up">
              {/* Header: stop label + name + collapse */}
              <div className="flex items-start justify-between gap-3 mb-2">
                <div className="min-w-0">
                  <span className="font-mono text-[10px] tracking-widest uppercase text-gold">
                    Stop {(activeIndex ?? 0) + 1}
                    {active.arrival_time && <span className="text-text3 ml-2">{active.arrival_time}</span>}
                  </span>
                  <p className="font-display text-lg font-semibold leading-snug text-text mt-0.5">
                    {active.name}
                  </p>
                </div>
                <button
                  onClick={() => setExpanded(false)}
                  title="Collapse"
                  className="shrink-0 p-1 rounded-lg text-text3 hover:text-gold hover:bg-gold/5 transition-all"
                >
                  <ChevronIcon open={true} />
                </button>
              </div>

              {/* Meta chips: duration + travel */}
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mb-2">
                {active.duration_at_stop && (
                  <span className="font-mono text-[11px] text-text2">⏱ {active.duration_at_stop}</span>
                )}
                {active.travel_from_prev && (
                  <span className="font-mono text-[11px] text-text3">
                    {active.travel_from_prev.distance} · {active.travel_from_prev.duration} from previous
                  </span>
                )}
              </div>

              {/* Address */}
              {active.address && (
                <div className="flex items-start gap-1.5 text-text2 mb-3">
                  <span className="text-gold/70 mt-0.5"><PinIcon /></span>
                  <span className="text-[12.5px] leading-relaxed font-sans">{active.address}</span>
                </div>
              )}

              {/* Full rationale — no clamp */}
              {active.rationale && (
                <p className="text-sm text-text leading-relaxed font-sans mb-3">
                  {active.rationale}
                </p>
              )}

              {/* Ask chips — continue the conversation about THIS place */}
              {onAsk && (
                <div className="mb-3">
                  <p className="font-mono text-[9px] tracking-widest uppercase text-text3 mb-1.5">Ask Hodari</p>
                  <div className="flex gap-2 overflow-x-auto scrollbar-hide pb-0.5">
                    {askChips(active, activeIndex ?? 0).map((chip) => (
                      <button
                        key={chip.label}
                        onClick={() => onAsk(activeIndex ?? 0, chip.prompt)}
                        className="shrink-0 flex items-center gap-1.5 font-sans text-[11px] text-text2 px-3 py-1.5 rounded-full border border-border hover:border-gold/40 hover:text-text hover:bg-gold/5 transition-all"
                      >
                        <span className="text-gold/60"><SparkIcon /></span>
                        {chip.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Footer: in-app details + feedback */}
              <div className="flex items-center justify-between border-t border-border/40 pt-2.5">
                {onShowDetails ? (
                  <button
                    onClick={() => onShowDetails(active)}
                    className="flex items-center gap-1.5 font-mono text-[11px] tracking-wider uppercase text-gold hover:text-gold-light transition-colors"
                  >
                    <ExternalIcon />
                    View details
                  </button>
                ) : (
                  <a
                    href={mapsUrl(active)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1.5 font-mono text-[10px] tracking-wider uppercase text-text3 hover:text-gold transition-colors"
                  >
                    <ExternalIcon />
                    Open in Maps
                  </a>
                )}

                {onFeedback && (
                  <div className="flex items-center gap-1">
                    <button
                      onClick={(e) => handleFeedback(e, activeIndex ?? 0, 'liked')}
                      title="I liked this"
                      className={`flex items-center gap-1 px-2 py-1 rounded-lg transition-all ${
                        activeRating === 'liked' ? 'text-green bg-green/10' : 'text-text3 hover:text-green hover:bg-green/5'
                      }`}
                    >
                      <ThumbUpIcon />
                    </button>
                    <button
                      onClick={(e) => handleFeedback(e, activeIndex ?? 0, 'disliked')}
                      title="Not for me"
                      className={`flex items-center gap-1 px-2 py-1 rounded-lg transition-all ${
                        activeRating === 'disliked' ? 'text-red-400 bg-red-400/10' : 'text-text3 hover:text-red-400 hover:bg-red-400/5'
                      }`}
                    >
                      <ThumbDownIcon />
                    </button>
                  </div>
                )}
              </div>
            </div>
      )}

      {/* ── Itinerary cards — separate glassy boxes ──────────────────────── */}
      <div className="overflow-x-auto flex gap-3 pb-1 scrollbar-hide">
        {stops.map((stop, i) => {
          const isActive = activeIndex === i
          const key = cardKey(stop, i)
          const rating = ratings[key]

          return (
            <div
              key={key}
              role="button"
              tabIndex={0}
              onClick={() => handleCardClick(i)}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleCardClick(i) } }}
              style={{ animationDelay: `${i * 70}ms` }}
              className={`glass ${isActive ? 'glass-active' : ''} flex-shrink-0 w-64 rounded-2xl overflow-hidden text-left cursor-pointer transition-transform duration-300 [@media(hover:hover)]:hover:-translate-y-0.5 relative group animate-fade-up`}
            >
              {/* Background stop number watermark */}
              <span
                className={`absolute right-2 bottom-1 font-display font-bold text-[72px] leading-none pointer-events-none select-none ${isActive ? 'text-gold/[0.10]' : 'text-text/[0.06]'}`}
              >
                {i + 1}
              </span>

              <div className="h-full p-3.5">
                {/* Stop index + time row */}
                <div className="flex items-center justify-between mb-2">
                  <span className={`font-mono text-[11px] tracking-widest uppercase ${isActive ? 'text-gold' : 'text-text3'}`}>
                    Stop {i + 1}
                  </span>
                  <div className="flex items-center gap-1.5">
                    {stop.arrival_time && (
                      <span className="font-mono text-[11px] text-text2">{stop.arrival_time}</span>
                    )}
                    {/* Expand affordance on the active card */}
                    {isActive && (
                      <span className="text-gold/70"><ChevronIcon open={isOpen} /></span>
                    )}
                  </div>
                </div>

                {/* Perforation line */}
                <div className="border-t border-dashed border-border mb-2" />

                {/* Place name */}
                <p className={`font-display text-[15px] font-semibold leading-snug mb-1.5 ${isActive ? 'text-text' : 'text-text/80'}`}>
                  {stop.name}
                </p>

                {/* Duration + travel */}
                <div className="flex flex-wrap gap-x-3 gap-y-0.5 mb-2">
                  {stop.duration_at_stop && (
                    <span className="font-mono text-[11px] text-text2">{stop.duration_at_stop}</span>
                  )}
                  {stop.travel_from_prev && (
                    <span className="font-mono text-[11px] text-text3">
                      {stop.travel_from_prev.distance} · {stop.travel_from_prev.duration}
                    </span>
                  )}
                </div>

                {/* Rationale (preview — full text lives in the expanded sheet) */}
                <p className="text-[13px] text-text2 leading-relaxed line-clamp-3 font-sans mb-3">
                  {stop.rationale}
                </p>

                {/* Action row */}
                <div className="flex items-center justify-between border-t border-border/40 pt-2">
                  {/* Swap button */}
                  {onSwap && (
                    <button
                      onClick={(e) => handleSwap(e, i)}
                      title="Swap this stop"
                      className="flex items-center gap-1 font-mono text-[9px] tracking-wider uppercase text-text3 hover:text-gold transition-colors px-1.5 py-1 rounded-lg hover:bg-gold/5"
                    >
                      <SwapIcon />
                      <span>Swap</span>
                    </button>
                  )}

                  {/* Thumbs up / down */}
                  {onFeedback && (
                    <div className="flex items-center gap-1 ml-auto">
                      <button
                        onClick={(e) => handleFeedback(e, i, 'liked')}
                        title="I liked this"
                        className={`p-1.5 rounded-lg transition-all ${
                          rating === 'liked'
                            ? 'text-green bg-green/10'
                            : 'text-text3 hover:text-green hover:bg-green/5'
                        }`}
                      >
                        <ThumbUpIcon />
                      </button>
                      <button
                        onClick={(e) => handleFeedback(e, i, 'disliked')}
                        title="Not for me"
                        className={`p-1.5 rounded-lg transition-all ${
                          rating === 'disliked'
                            ? 'text-red-400 bg-red-400/10'
                            : 'text-text3 hover:text-red-400 hover:bg-red-400/5'
                        }`}
                      >
                        <ThumbDownIcon />
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )
        })}
      </div>
      </>
      )}
    </div>
  )
}
