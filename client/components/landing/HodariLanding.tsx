'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { ArrowRight, MapPin, Menu, X } from 'lucide-react'
import {
  EASE,
  HodariLogo,
  LiveClock,
  Reveal,
  RollText,
  ThemeToggle,
  useLandingTheme,
} from '@/components/landing/bits'

import HeroMap from '@/components/landing/HeroMap'
import HeroAgentDemo from '@/components/landing/HeroAgentDemo'
import ShowcaseMarquee from '@/components/landing/ShowcaseMarquee'

const NAV_LINKS = [
  { label: 'How it works', href: '#about' },
  { label: 'What fans do', href: '#work' },
  { label: 'Connect', href: '/login' },
]

/** Smooth-scroll same-page anchors within the page's scroll container. */
function scrollToHash(href: string) {
  if (!href.startsWith('#')) return false
  const el = document.getElementById(href.slice(1))
  if (!el) return false
  el.scrollIntoView({ behavior: 'smooth', block: 'start' })
  return true
}

/** Orange CTA with text-roll label and a white arrow circle that tilts on hover. */
function OrangeCta({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="group flex w-fit items-center gap-3 rounded-full bg-[#F56A00] py-2 pl-5 pr-2 text-[13px] font-medium text-white transition-colors duration-300 hover:bg-[#e05a1a] sm:pl-6 sm:text-[14px]"
    >
      <RollText>{label}</RollText>
      <span className={`flex h-7 w-7 items-center justify-center rounded-full bg-white text-[#F56A00] transition-transform duration-500 ${EASE} group-hover:-rotate-45 sm:h-8 sm:w-8`}>
        <ArrowRight size={14} />
      </span>
    </Link>
  )
}

function SectionBadge({ number, label, borderClass = 'border-gray-200 dark:border-white/15' }: { number: string; label: string; borderClass?: string }) {
  return (
    <div className="mb-6 flex items-center gap-3 px-5 sm:mb-8 sm:px-8 lg:px-12">
      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-gray-900 text-[11px] font-semibold text-white dark:bg-white dark:text-gray-900 sm:h-7 sm:w-7 sm:text-[12px]">
        {number}
      </span>
      <span className={`rounded-full border px-3 py-1 text-[12px] font-medium text-gray-900 dark:text-gray-100 sm:px-4 sm:py-1.5 sm:text-[13px] ${borderClass}`}>
        {label}
      </span>
    </div>
  )
}

export default function HodariLanding() {
  const { dark, toggle } = useLandingTheme()
  const [menuOpen, setMenuOpen] = useState(false)
  const [menuVisible, setMenuVisible] = useState(false)
  const [signedIn, setSignedIn] = useState(false)

  useEffect(() => {
    setSignedIn(!!localStorage.getItem('hodari_email'))
  }, [])

  // Two-step mount so the bottom sheet animates from translate-y-full.
  useEffect(() => {
    if (menuOpen) {
      const id = requestAnimationFrame(() => setMenuVisible(true))
      return () => cancelAnimationFrame(id)
    }
    setMenuVisible(false)
  }, [menuOpen])

  const ctaHref = signedIn ? '/chat' : '/login'
  const ctaLabel = signedIn ? 'Open Hodari' : 'Sign in'

  return (
    <div className="h-screen overflow-y-auto overflow-x-hidden scroll-smooth bg-[#EFEFEF] dark:bg-[#0a0a0d]">

      {/* ── SECTION 1 · HERO ─────────────────────────────────────────────── */}
      <section id="top" className="relative flex min-h-screen flex-col overflow-hidden bg-[#EFEFEF] dark:bg-[#0a0a0d]">
        {/* Cinematic night-map panorama on the right — text owns the left */}
        <HeroMap className="absolute right-[-32%] top-[4%] w-[min(92vw,440px)] sm:right-[-6%] sm:top-1/2 sm:-translate-y-[54%] sm:w-[min(58vh,560px)] lg:right-[2%] lg:w-[min(64vh,620px)] xl:right-[5%]" />
        {/* Readability veil under the headline */}
        <div className="absolute inset-x-0 bottom-0 h-[36%] bg-gradient-to-b from-transparent to-[#EFEFEF]/95 dark:to-[#0a0a0d]/95" />

        {/* Navigation */}
        <header className="relative z-20 mx-auto w-full max-w-[1440px] p-2 sm:p-3">
          <nav className="flex items-center justify-between rounded-full bg-white p-[5px] shadow-[0_2px_12px_rgba(0,0,0,0.06)] dark:bg-[#15151a] dark:shadow-[0_2px_12px_rgba(0,0,0,0.5)]">
            <div className="flex items-center gap-6 pl-1">
              <Link href="/" className="flex items-center gap-2.5">
                <HodariLogo />
                <span className="text-[14px] font-semibold tracking-tight text-gray-900 dark:text-gray-100">Hodari</span>
              </Link>
              <div className="hidden items-center gap-6 md:flex">
                {NAV_LINKS.map((l) => (
                  <Link
                    key={l.label}
                    href={l.href}
                    onClick={(e) => { if (scrollToHash(l.href)) e.preventDefault() }}
                    className="text-[14px] text-gray-900 transition-colors duration-300 hover:text-gray-500 dark:text-gray-100 dark:hover:text-gray-400"
                  >
                    {l.label}
                  </Link>
                ))}
              </div>
            </div>

            <div className="hidden items-center gap-4 md:flex">
              <span className="hidden text-[13px] text-gray-600 dark:text-gray-400 lg:block">
                Live for the 2026 World Cup
              </span>
              <LiveClock />
              <ThemeToggle dark={dark} onToggle={toggle} />
              <Link
                href={ctaHref}
                className="group flex items-center gap-3 rounded-full bg-gray-900 py-2 pl-5 pr-2 text-[13px] font-medium text-white dark:bg-white dark:text-gray-900"
              >
                <RollText>{ctaLabel}</RollText>
                <span className={`flex h-6 w-6 items-center justify-center rounded-full bg-white text-gray-900 transition-transform duration-500 ${EASE} group-hover:-rotate-45 dark:bg-gray-900 dark:text-white`}>
                  <ArrowRight size={12} />
                </span>
              </Link>
            </div>

            <div className="flex items-center gap-2 md:hidden">
              <ThemeToggle dark={dark} onToggle={toggle} />
              <button
                type="button"
                onClick={() => setMenuOpen(true)}
                className="flex items-center gap-2 rounded-full bg-gray-900 px-4 py-2.5 text-[13px] font-medium text-white dark:bg-white dark:text-gray-900"
              >
                <Menu size={15} />
                Menu
              </button>
            </div>
          </nav>
        </header>

        <div className="flex-1" />

        {/* Hero content — pinned to the bottom of the viewport */}
        <div className="relative z-20 mx-auto w-full max-w-[1440px] px-5 pb-14 sm:px-8 sm:pb-16 lg:px-12 lg:pb-20">
          <p className="mb-5 animate-[fadeUp_0.7s_0.05s_both] motion-reduce:animate-none text-[13px] tracking-wide text-gray-900 dark:text-gray-200 sm:mb-7 sm:text-[14px]">
            Hodari, your AI companion for the 2026 FIFA World Cup
          </p>
          <h1 className="max-w-[20ch] animate-[fadeUp_0.8s_0.18s_both] motion-reduce:animate-none font-display font-semibold leading-[1.08] tracking-[-0.02em] text-gray-900 dark:text-gray-50 text-[clamp(1.7rem,6.4vw,3.9rem)] sm:text-[clamp(2.3rem,4.6vw,3.9rem)]">
            Find the best restaurants and hotels for your World Cup journey, and&nbsp;beyond.
          </h1>
          <p className="mt-5 max-w-[52ch] animate-[fadeUp_0.8s_0.32s_both] motion-reduce:animate-none text-[14px] leading-relaxed text-gray-600 dark:text-gray-300 sm:mt-6 sm:text-[16px]">
            Never feel lost in a new city. Hodari understands exactly where you
            are, guides you with confidence, and helps you make the most of
            every day, during the tournament and long after.
          </p>

          <div className="mt-8 flex animate-[fadeUp_0.8s_0.46s_both] motion-reduce:animate-none flex-col gap-4 sm:mt-10 sm:flex-row sm:items-center sm:gap-5">
            <OrangeCta href={ctaHref} label="Start exploring" />

            <span className="flex w-fit items-center gap-2.5 rounded-[4px] bg-white px-3 py-2 shadow-[0_2px_8px_rgba(0,0,0,0.08)] transition-shadow duration-300 hover:shadow-[0_4px_16px_rgba(0,0,0,0.12)] dark:bg-[#15151a] dark:shadow-[0_2px_8px_rgba(0,0,0,0.45)]">
              <MapPin size={15} strokeWidth={2.5} className="text-[#F56A00]" />
              <span className="text-[13px] font-medium text-gray-900 dark:text-gray-100 sm:text-[14px]">
                Grounded by Google Maps
              </span>
              <span className="rounded bg-gray-900 px-1.5 py-0.5 text-[10px] text-white dark:bg-[#F56A00] sm:px-2 sm:text-[11px]">
                Live
              </span>
            </span>
          </div>
        </div>
      </section>

      {/* Mobile menu overlay */}
      {menuOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div
            className={`absolute inset-0 bg-black/60 transition-opacity duration-500 ${menuVisible ? 'opacity-100' : 'opacity-0'}`}
            onClick={() => setMenuOpen(false)}
          />
          <div
            className={`absolute inset-x-0 bottom-0 mx-3 mb-3 rounded-2xl bg-white p-6 transition-transform duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] dark:bg-[#15151a] ${menuVisible ? 'translate-y-0' : 'translate-y-full'}`}
          >
            <div className="mb-6 flex items-center justify-between">
              <LiveClock />
              <button
                type="button"
                onClick={() => setMenuOpen(false)}
                className="flex items-center gap-2 rounded-full bg-gray-900 px-4 py-2.5 text-[13px] font-medium text-white dark:bg-white dark:text-gray-900"
              >
                <X size={15} />
                Close
              </button>
            </div>
            <div className="mb-8 flex flex-col gap-4">
              {NAV_LINKS.map((l) => (
                <Link
                  key={l.label}
                  href={l.href}
                  onClick={(e) => { if (scrollToHash(l.href)) e.preventDefault(); setMenuOpen(false) }}
                  className="text-[28px] font-medium leading-[32px] text-gray-900 dark:text-gray-100"
                >
                  {l.label}
                </Link>
              ))}
            </div>
            <OrangeCta href={ctaHref} label="Start exploring" />
          </div>
        </div>
      )}

      {/* ── SECTION 2 · ABOUT ────────────────────────────────────────────── */}
      <section id="about" className="overflow-hidden bg-white pb-12 pt-16 dark:bg-[#0e0e12] sm:pb-16 sm:pt-20 lg:pb-24 lg:pt-32">
        <div className="mx-auto max-w-[1440px]">
          <SectionBadge number="1" label="Introducing Hodari" />

          <Reveal>
            <h2 className="mb-12 px-5 font-display font-semibold leading-[1.12] tracking-[-0.01em] text-gray-900 dark:text-gray-50 text-[clamp(1.5rem,4vw,3.2rem)] sm:mb-16 sm:px-8 lg:mb-28 lg:px-12">
              “Four hours, $60, vegetarian near<br className="hidden sm:block" />
              <span className="sm:hidden"> </span>
              the stadium.” That&apos;s all Hodari needs.
            </h2>
          </Reveal>

          {/* Mobile / tablet */}
          <div className="px-5 sm:px-8 lg:hidden">
            <p className="text-[15px] font-medium leading-[1.6] text-gray-900 dark:text-gray-200 sm:text-[17px]">
              Real restaurants and hotels from Google Maps, never invented,
              ranked to your taste and ordered into a route you can actually
              walk. Where to eat, where to stay, how to get there.
            </p>
            <div className="mt-6">
              <OrangeCta href={ctaHref} label="Plan my first meal" />
            </div>
            <div className="mt-10 flex flex-col gap-4 sm:flex-row sm:gap-5">
              <Reveal className="sm:w-[45%]">
                <img
                  src="/landing/worldcup-draw.jpg"
                  alt="The FIFA World Cup trophy beneath a canopy of national flags"
                  className="aspect-[438/346] w-full rounded-xl object-cover object-[center_62%] sm:rounded-2xl"
                />
              </Reveal>
              <Reveal delay={120} className="sm:w-[55%]">
                <img
                  src="/landing/metlife-stadium.jpg"
                  alt="MetLife Stadium glowing at night with the New York skyline behind it"
                  className="aspect-[900/600] w-full rounded-xl object-cover object-[center_55%] sm:rounded-2xl"
                />
              </Reveal>
            </div>
          </div>

          {/* Desktop */}
          <div className="hidden grid-cols-[26%_1fr_48%] items-end gap-6 px-12 lg:grid xl:gap-8">
            <Reveal className="self-end">
              <img
                src="/landing/worldcup-draw.jpg"
                alt="The FIFA World Cup trophy beneath a canopy of national flags"
                className="aspect-[438/346] w-full rounded-2xl object-cover object-[center_62%]"
              />
            </Reveal>
            <div className="flex flex-col items-start gap-8 self-start lg:items-end">
              <p className="whitespace-nowrap text-[16px] font-medium leading-[1.65] text-gray-900 dark:text-gray-200 xl:text-[18px]">
                Real restaurants and hotels from<br />
                Google Maps, ranked to your taste and<br />
                ordered into a route you can walk.
              </p>
              <OrangeCta href={ctaHref} label="Plan my first meal" />
            </div>
            <Reveal delay={140} className="self-end">
              <img
                src="/landing/metlife-stadium.jpg"
                alt="MetLife Stadium glowing at night with the New York skyline behind it"
                className="aspect-[3/2] w-full rounded-2xl object-cover object-[center_58%]"
              />
            </Reveal>
          </div>
        </div>
      </section>

      {/* ── SECTION 3 · SHOWCASE ─────────────────────────────────────────── */}
      <section id="work" className="overflow-hidden bg-[#F5F5F5] pb-16 pt-16 dark:bg-[#0b0b0f] sm:pb-20 sm:pt-20 lg:pb-28 lg:pt-28">
        <div className="mx-auto max-w-[1440px]">
          <SectionBadge number="2" label="What fans do with Hodari" borderClass="border-gray-300 dark:border-white/15" />

          <Reveal>
            <h2 className="mb-4 px-5 font-display font-semibold leading-[1.08] tracking-[-0.01em] text-gray-900 dark:text-gray-50 text-[clamp(1.75rem,7vw,4.2rem)] sm:px-8 sm:text-[clamp(2.5rem,5vw,4.2rem)] lg:px-12">
              From the trophy to the table
            </h2>
            <p className="mb-10 max-w-[58ch] px-5 text-[14px] leading-relaxed text-gray-600 dark:text-gray-400 sm:mb-12 sm:px-8 sm:text-[16px] lg:px-12">
              The match is ninety minutes. The rest of the day is yours. Hodari
              fills it with the right stadium route, the right table, and the
              right people.
            </p>
          </Reveal>
        </div>

        {/* Full-bleed sliding showcase — hover to pause */}
        <Reveal delay={100}>
          <ShowcaseMarquee />
        </Reveal>

        <div className="mx-auto mt-10 max-w-[1440px] px-5 sm:mt-12 sm:px-8 lg:px-12">
          <OrangeCta href={ctaHref} label="Plan my World Cup days" />
        </div>
      </section>

      {/* ── SECTION 4 · SEE IT IN ACTION ─────────────────────────────────── */}
      <section id="demo" className="overflow-hidden bg-white pb-16 pt-16 dark:bg-[#0e0e12] sm:pb-20 sm:pt-20 lg:pb-28 lg:pt-28">
        <div className="mx-auto max-w-[1440px]">
          <SectionBadge number="3" label="See it in action" />

          <div className="grid items-center gap-10 px-5 sm:px-8 lg:grid-cols-2 lg:gap-16 lg:px-12">
            <Reveal>
              <div className="flex flex-col items-start">
                <h2 className="mb-5 font-display font-semibold leading-[1.1] tracking-[-0.01em] text-gray-900 dark:text-gray-50 text-[clamp(1.6rem,4.5vw,3.2rem)]">
                  Watch Hodari work the&nbsp;map
                </h2>
                <p className="mb-8 max-w-[46ch] text-[15px] leading-relaxed text-gray-600 dark:text-gray-300 sm:text-[17px]">
                  Ask in plain words. Hodari reads where you are, searches real
                  places on Google&apos;s photorealistic 3D map, drops the best
                  picks with walk-times and a route you can actually follow.
                  Live, grounded, never invented.
                </p>
                <OrangeCta href={ctaHref} label="Try it yourself" />
              </div>
            </Reveal>

            <Reveal delay={120}>
              <HeroAgentDemo className="mx-auto w-full max-w-[340px]" />
            </Reveal>
          </div>
        </div>
      </section>

      {/* ── FOOTER ───────────────────────────────────────────────────────── */}
      <footer className="border-t border-gray-200 bg-[#F5F5F5] dark:border-white/10 dark:bg-[#0b0b0f]">
        <div className="mx-auto flex max-w-[1440px] flex-col items-start justify-between gap-3 px-5 py-8 text-[13px] text-gray-600 dark:text-gray-400 sm:flex-row sm:items-center sm:px-8 lg:px-12">
          <span className="flex items-center gap-2.5">
            <HodariLogo className="h-7 w-7" />
            © 2026 Hodari. Built for a live travel experience.
          </span>
          <span className="flex items-center gap-5">
            <Link href="/login" className="transition-colors duration-300 hover:text-gray-900 dark:hover:text-gray-100">
              Sign in
            </Link>
            <a
              href="#top"
              onClick={(e) => { if (scrollToHash('#top')) e.preventDefault() }}
              className="transition-colors duration-300 hover:text-gray-900 dark:hover:text-gray-100"
            >
              Back to top
            </a>
          </span>
        </div>
      </footer>
    </div>
  )
}
