'use client'

import { useEffect, useState } from 'react'
import SpinningGlobe from '@/components/landing/SpinningGlobe'

const PHOTOS = [
  '/landing/worldcup-fans.png',
  '/landing/fans-bar.png',
  '/landing/friends-toast.jpg',
]

/**
 * Cinematic sequence: the globe holds the stage, crossfades into the fan
 * photos, returns to the globe, then the last photo, then loops. The globe
 * dwells longer than the photos, and the lead fan shot gets extra time.
 */
const SEQUENCE: Array<{ photo: number | null; dur: number }> = [
  { photo: null, dur: 6500 },
  { photo: 0, dur: 4800 },
  { photo: 1, dur: 4200 },
  { photo: null, dur: 6500 },
  { photo: 2, dur: 4200 },
]

/**
 * Hero rotator: the mouse-steered globe and lifestyle photos share one
 * circular frame (same glow + rim light), crossfading on a timer with a slow
 * Ken Burns drift on the photos so every frame feels alive. With reduced
 * motion the sequence never advances — the globe simply stays.
 */
export default function HeroShowcase({ className = '' }: { className?: string }) {
  const [step, setStep] = useState(0)

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const t = setTimeout(() => setStep((s) => (s + 1) % SEQUENCE.length), SEQUENCE[step].dur)
    return () => clearTimeout(t)
  }, [step])

  const activePhoto = SEQUENCE[step].photo

  return (
    <div className={`pointer-events-none aspect-square select-none ${className}`} aria-hidden>
      {/* Globe stays mounted so its rotation and mouse-steering never reset */}
      <div className={`absolute inset-0 transition-opacity duration-[1400ms] ease-in-out ${activePhoto === null ? 'opacity-100' : 'opacity-0'}`}>
        <SpinningGlobe className="absolute inset-0" />
      </div>

      {PHOTOS.map((src, i) => (
        <div
          key={src}
          className={`absolute inset-0 transition-opacity duration-[1400ms] ease-in-out ${activePhoto === i ? 'opacity-100' : 'opacity-0'}`}
        >
          {/* Same atmosphere glow as the globe so slides feel continuous */}
          <div className="absolute -inset-[8%] rounded-full bg-[radial-gradient(circle,rgba(245,106,0,0.16)_50%,rgba(245,106,0,0.06)_64%,transparent_74%)] blur-2xl" />
          <div className="absolute inset-0 overflow-hidden rounded-full bg-[#0a0a0d]">
            <img src={src} alt="" draggable={false} className="hero-kenburns h-full w-full object-cover" />
            {/* Vignette matching the globe's limb darkening */}
            <div
              className="absolute inset-0"
              style={{
                background:
                  'radial-gradient(circle at 50% 50%, transparent 55%, rgba(0,0,0,0.35) 85%, rgba(0,0,0,0.6) 100%)',
              }}
            />
          </div>
          <div className="absolute inset-0 rounded-full shadow-[inset_2px_3px_22px_rgba(255,255,255,0.18),inset_-28px_-18px_70px_rgba(0,0,0,0.45)]" />
        </div>
      ))}
    </div>
  )
}
