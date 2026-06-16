// Recording surface — drives the LIVE Realistic-3D agent demo full-bleed so
// Playwright (scripts/capture-hero.mjs) can screencast the cinematic loop into
// public/landing/hero-demo.mp4. The production landing page plays that baked
// video (no live Maps cost); this route exists only to re-record it.
//
// Dev-only: in any non-development build it 404s, so it can never load the live
// Map3D (and bill Google Maps) on the public site.
import { notFound } from 'next/navigation'
import HeroAgentLive from '@/components/landing/HeroAgentLive'

export default function RecHero() {
  if (process.env.NODE_ENV !== 'development') notFound()
  return (
    <div className="fixed inset-0 bg-[#0a0a0d]">
      <HeroAgentLive sizeClass="h-full w-full" className="!rounded-none !shadow-none" />
    </div>
  )
}
