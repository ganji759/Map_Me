'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { ArrowRight, Menu, X } from 'lucide-react'
import {
  EASE,
  HodariLogo,
  LiveClock,
  RollText,
  StarburstMark,
  ThemeToggle,
  useLandingTheme,
} from '@/components/landing/bits'

import HeroShowcase from '@/components/landing/HeroShowcase'

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

/** Card 1 hover affordance: white circle expanding into a "Learn more" pill. */
function ExpandingLightButton() {
  return (
    <span className="absolute bottom-4 left-4 flex h-9 w-9 items-center gap-2 overflow-hidden rounded-full bg-white pl-[11px] transition-all duration-300 ease-in-out group-hover:w-[148px]">
      <svg viewBox="0 0 24 24" className={`h-[14px] w-[14px] shrink-0 fill-none stroke-gray-900 transition-transform duration-300 ease-in-out -rotate-45 group-hover:rotate-0`} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
        <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
      </svg>
      <span className="whitespace-nowrap text-[13px] font-medium text-gray-900 opacity-0 transition-opacity duration-300 delay-100 group-hover:opacity-100">
        Learn more
      </span>
    </span>
  )
}

/** Card 2 hover affordance: dark circle expanding into "Plan with Hodari". */
function ExpandingDarkButton() {
  return (
    <span className="absolute bottom-4 left-4 flex h-9 w-9 items-center gap-2 overflow-hidden rounded-full bg-gray-900 pl-[11px] transition-all duration-300 ease-in-out group-hover:w-[172px]">
      <ArrowRight size={14} className="shrink-0 text-white transition-transform duration-300 ease-in-out -rotate-45 group-hover:rotate-0" />
      <span className="whitespace-nowrap text-[13px] font-medium text-white opacity-0 transition-opacity duration-300 delay-100 group-hover:opacity-100">
        Plan with Hodari
      </span>
    </span>
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
        {/* Cinematic rotator on the right — globe ↔ fan photos — text owns the left */}
        <HeroShowcase className="absolute right-[-35%] top-[10%] w-[min(88vw,440px)] sm:right-[-12%] sm:top-1/2 sm:-translate-y-[58%] sm:w-[min(70vh,620px)] lg:right-[1%] lg:w-[min(78vh,700px)] xl:right-[4%]" />
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
          <p className="mb-5 text-[13px] tracking-wide text-gray-900 dark:text-gray-200 sm:mb-8 sm:text-[14px]">
            Hodari, your AI companion for World Cup days
          </p>
          <h1 className="max-w-[15ch] font-display font-semibold leading-[1.08] tracking-[-0.02em] text-gray-900 dark:text-gray-50 text-[clamp(1.75rem,7vw,4.2rem)] sm:text-[clamp(2.5rem,5vw,4.2rem)]">
            Find a great place to eat fast, in a city you&apos;ve never set&nbsp;foot&nbsp;in.
          </h1>

          <div className="mt-8 flex flex-col gap-4 sm:mt-12 sm:flex-row sm:items-center sm:gap-5">
            <OrangeCta href={ctaHref} label="Start exploring" />

            <span className="flex w-fit items-center gap-2.5 rounded-[4px] bg-white px-3 py-2 shadow-[0_2px_8px_rgba(0,0,0,0.08)] transition-shadow duration-300 hover:shadow-[0_4px_16px_rgba(0,0,0,0.12)] dark:bg-[#15151a] dark:shadow-[0_2px_8px_rgba(0,0,0,0.45)]">
              <StarburstMark />
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

          <h2 className="mb-12 px-5 font-display font-semibold leading-[1.12] tracking-[-0.01em] text-gray-900 dark:text-gray-50 text-[clamp(1.5rem,4vw,3.2rem)] sm:mb-16 sm:px-8 lg:mb-28 lg:px-12">
            “Four hours, $60, vegetarian near<br className="hidden sm:block" />
            <span className="sm:hidden"> </span>
            the stadium.” That&apos;s all Hodari needs.
          </h2>

          {/* Mobile / tablet */}
          <div className="px-5 sm:px-8 lg:hidden">
            <p className="text-[15px] font-medium leading-[1.6] text-gray-900 dark:text-gray-200 sm:text-[17px]">
              Real restaurants from Google Maps, never invented, ranked to your
              taste and ordered into a route you can actually walk. Where to eat,
              what to see, how to get there.
            </p>
            <div className="mt-6">
              <OrangeCta href={ctaHref} label="Plan my first meal" />
            </div>
            <div className="mt-10 flex flex-col gap-4 sm:flex-row sm:gap-5">
              <img
                src="/landing/globe.png"
                alt="Host-city lights across North America at night"
                className="aspect-[438/346] w-full rounded-xl object-cover object-[center_30%] dark:brightness-[0.5] dark:contrast-[1.15] dark:saturate-[1.3] sm:w-[45%] sm:rounded-2xl"
              />
              <img
                src="/landing/globe.png"
                alt="The 2026 World Cup host continent from orbit"
                className="aspect-[900/600] w-full rounded-xl object-cover object-[center_55%] dark:brightness-[0.5] dark:contrast-[1.15] dark:saturate-[1.3] sm:w-[55%] sm:rounded-2xl"
              />
            </div>
          </div>

          {/* Desktop */}
          <div className="hidden grid-cols-[26%_1fr_48%] items-end gap-6 px-12 lg:grid xl:gap-8">
            <img
              src="/landing/globe.png"
              alt="Host-city lights across North America at night"
              className="aspect-[438/346] w-full self-end rounded-2xl object-cover object-[center_30%] dark:brightness-[0.5] dark:contrast-[1.15] dark:saturate-[1.3]"
            />
            <div className="flex flex-col items-start gap-8 self-start lg:items-end">
              <p className="whitespace-nowrap text-[16px] font-medium leading-[1.65] text-gray-900 dark:text-gray-200 xl:text-[18px]">
                Real restaurants from Google Maps,<br />
                ranked to your taste and ordered into<br />
                a route you can actually walk.
              </p>
              <OrangeCta href={ctaHref} label="Plan my first meal" />
            </div>
            <img
              src="/landing/globe.png"
              alt="The 2026 World Cup host continent from orbit"
              className="aspect-[3/2] w-full self-end rounded-2xl object-cover object-[center_55%] dark:brightness-[0.5] dark:contrast-[1.15] dark:saturate-[1.3]"
            />
          </div>
        </div>
      </section>

      {/* ── SECTION 3 · FEATURED ─────────────────────────────────────────── */}
      <section id="work" className="bg-[#F5F5F5] pb-16 pt-16 dark:bg-[#0b0b0f] sm:pb-20 sm:pt-20 lg:pb-28 lg:pt-28">
        <div className="mx-auto max-w-[1440px]">
          <SectionBadge number="2" label="What fans do with Hodari" borderClass="border-gray-300 dark:border-white/15" />

          <h2 className="mb-10 px-5 font-display font-semibold leading-[1.08] tracking-[-0.01em] text-gray-900 dark:text-gray-50 text-[clamp(1.75rem,7vw,4.2rem)] sm:mb-14 sm:px-8 sm:text-[clamp(2.5rem,5vw,4.2rem)] lg:mb-16 lg:px-12">
            From match to meal
          </h2>

          <div className="grid grid-cols-1 gap-5 px-5 sm:gap-6 sm:px-8 md:grid-cols-2 lg:gap-7 lg:px-12">
            <Link href={ctaHref} className="block">
              <div className="group relative aspect-[329/246] cursor-pointer overflow-hidden rounded-2xl bg-[#1a1d2e]">
                <img
                  src="/landing/worldcup-fans.png"
                  alt="Fans in national team jerseys hanging out together before a match"
                  className="h-full w-full object-cover object-[center_30%] transition-transform duration-700 ease-out group-hover:scale-105"
                />
                <ExpandingLightButton />
              </div>
              <p className="mt-4 text-[13px] leading-relaxed text-gray-600 dark:text-gray-400 sm:text-[14px]">
                Meet your crew in their colours, then walk to a table that fits
                everyone&apos;s budget and diet.
              </p>
              <p className="mt-1 text-[14px] font-semibold text-gray-900 dark:text-gray-100 sm:text-[15px]">
                Match day in New York
              </p>
            </Link>

            <Link href={ctaHref} className="block">
              <div className="group relative aspect-square cursor-pointer overflow-hidden rounded-2xl bg-[#1a1610]">
                <img
                  src="/landing/restaurant.jpg"
                  alt="Warm gold-and-black restaurant interior set for dinner"
                  className="h-full w-full object-cover transition-transform duration-700 ease-out group-hover:scale-105"
                />
                <ExpandingDarkButton />
              </div>
              <p className="mt-4 text-[13px] leading-relaxed text-gray-600 dark:text-gray-400 sm:text-[14px]">
                After the final whistle, Hodari routes you and your friends to the
                city&apos;s best tables and gets you back safe.
              </p>
              <p className="mt-1 text-[14px] font-semibold text-gray-900 dark:text-gray-100 sm:text-[15px]">
                Dinner after dark in Mexico City
              </p>
            </Link>
          </div>
        </div>
      </section>

      {/* ── FOOTER ───────────────────────────────────────────────────────── */}
      <footer className="border-t border-gray-200 bg-[#F5F5F5] dark:border-white/10 dark:bg-[#0b0b0f]">
        <div className="mx-auto flex max-w-[1440px] flex-col items-start justify-between gap-3 px-5 py-8 text-[13px] text-gray-600 dark:text-gray-400 sm:flex-row sm:items-center sm:px-8 lg:px-12">
          <span className="flex items-center gap-2.5">
            <HodariLogo className="h-7 w-7" />
            © 2026 Hodari. Built for the FIFA World Cup.
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
