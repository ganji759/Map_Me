'use client'

import { useEffect, useRef, useState } from 'react'

/**
 * Hero visual: a pre-recorded cinematic loop of the Hodari agent using the live
 * Realistic-3D Google map (camera fly-in → typed query → glowing pins + walk
 * circle → orbit → place card). Baked once from the live `HeroAgentLive`
 * component (see app/rec-hero + scripts/capture-hero.mjs) into
 * public/landing/hero-demo.{webm,mp4}, so the public landing page costs **zero**
 * Google Maps usage per visit — only a ~1.2 MB video that browsers cache.
 *
 * Reduced-motion or no-autoplay → the static poster frame holds. The component
 * keeps the same `className` / `sizeClass` contract as the old live version, so
 * HodariLanding's hero slot is unchanged.
 */
const POSTER = '/landing/hero-demo-poster.jpg'

export default function HeroAgentDemo({
  className = '',
  sizeClass = 'aspect-[3/4]',
}: {
  className?: string
  sizeClass?: string
}) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [reduce, setReduce] = useState(false)

  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-reduced-motion: reduce)')
    setReduce(!!mq?.matches)
    const onChange = (e: MediaQueryListEvent) => setReduce(e.matches)
    mq?.addEventListener?.('change', onChange)
    return () => mq?.removeEventListener?.('change', onChange)
  }, [])

  // Pause when scrolled off-screen so it isn't decoding behind the fold.
  useEffect(() => {
    const v = videoRef.current
    if (!v || reduce) return
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) v.play().catch(() => {})
        else v.pause()
      },
      { threshold: 0.15 },
    )
    io.observe(v)
    return () => io.disconnect()
  }, [reduce])

  return (
    <div
      className={`${sizeClass} overflow-hidden rounded-3xl bg-[#0a0a0d] shadow-[0_24px_80px_rgba(0,0,0,0.45)] ${className}`}
      aria-hidden
    >
      {reduce ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={POSTER} alt="" draggable={false} className="h-full w-full select-none object-cover" />
      ) : (
        <video
          ref={videoRef}
          poster={POSTER}
          autoPlay
          muted
          loop
          playsInline
          preload="none"
          className="h-full w-full object-cover"
        >
          {/* H.264 MP4 only — universally supported (Chrome/Safari/Firefox/Edge). */}
          <source src="/landing/hero-demo.mp4" type="video/mp4" />
        </video>
      )}
    </div>
  )
}
