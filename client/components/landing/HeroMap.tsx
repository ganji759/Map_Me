'use client'

import { MapPin, Star } from 'lucide-react'

/**
 * Cinematic hero visual: the host-continent night map as a feathered,
 * slowly drifting panorama with a periodic light sweep and floating
 * "agent at work" chips. Pure CSS animation — with reduced motion
 * everything holds still. Size comes from the caller; the root keeps a
 * portrait aspect so the continent reads tall like the source image.
 */
export default function HeroMap({ className = '' }: { className?: string }) {
  return (
    <div className={`pointer-events-none aspect-[3/4] select-none ${className}`} aria-hidden>
      {/* Atmosphere glow behind the panel */}
      <div className="hero-glow-pulse absolute -inset-[12%] rounded-full bg-[radial-gradient(circle_at_50%_38%,rgba(245,106,0,0.18)_0%,rgba(245,106,0,0.07)_48%,transparent_72%)] blur-3xl" />

      {/* Feathered map panel */}
      <div className="hero-map-mask absolute inset-0 overflow-hidden">
        <img
          src="/landing/globe.png"
          alt=""
          draggable={false}
          className="hero-map-drift h-full w-full object-cover object-[center_42%] dark:brightness-[0.68] dark:contrast-[1.15] dark:saturate-[1.25]"
        />
        {/* Periodic cinematic light sweep */}
        <div className="hero-sheen absolute inset-y-0 left-0 w-[38%] bg-gradient-to-r from-transparent via-white/15 to-transparent" />
        {/* Dark-mode vignette so the white atmosphere edge sinks into the bg.
            Stops sit inside the feather mask's fade (52%→76%) so white edge
            pixels are fully darkened before the mask reveals them. */}
        <div className="absolute inset-0 hidden bg-[radial-gradient(115%_115%_at_50%_44%,transparent_38%,rgba(10,10,13,0.65)_56%,rgba(10,10,13,0.97)_70%)] dark:block" />
      </div>

      {/* Floating guidance chips — what the agent does, shown not told */}
      <div className="hero-chip-float absolute left-[2%] top-[22%] hidden items-center gap-2.5 rounded-2xl bg-white/90 px-4 py-3 shadow-[0_8px_32px_rgba(0,0,0,0.14)] backdrop-blur-md dark:bg-[#15151a]/90 dark:shadow-[0_8px_32px_rgba(0,0,0,0.6)] sm:flex">
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#F56A00]/10 text-[#F56A00]">
          <MapPin size={15} />
        </span>
        <span className="flex flex-col">
          <span className="text-[12px] font-semibold text-gray-900 dark:text-gray-100">MetLife Stadium</span>
          <span className="text-[11px] text-gray-500 dark:text-gray-400">Gate C · 12 min walk</span>
        </span>
      </div>

      <div className="hero-chip-float-late absolute bottom-[24%] right-[4%] hidden items-center gap-2.5 rounded-2xl bg-white/90 px-4 py-3 shadow-[0_8px_32px_rgba(0,0,0,0.14)] backdrop-blur-md dark:bg-[#15151a]/90 dark:shadow-[0_8px_32px_rgba(0,0,0,0.6)] sm:flex">
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#F56A00]/10 text-[#F56A00]">
          <Star size={15} />
        </span>
        <span className="flex flex-col">
          <span className="text-[12px] font-semibold text-gray-900 dark:text-gray-100">La Marea · 4.8 ★</span>
          <span className="text-[11px] text-gray-500 dark:text-gray-400">Table for 6 after the match</span>
        </span>
      </div>
    </div>
  )
}
