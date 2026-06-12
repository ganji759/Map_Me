'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, Loader2, MapPin, Star, Utensils } from 'lucide-react'
import {
  EASE,
  HodariLogo,
  LiveClock,
  RollText,
  ThemeToggle,
  useLandingTheme,
} from '@/components/landing/bits'
import HeroMap from '@/components/landing/HeroMap'

const VALUE_POINTS = [
  { Icon: MapPin, text: 'Grounded by Google Maps, real places, never invented' },
  { Icon: Utensils, text: 'Restaurant-first plans built around your match days' },
  { Icon: Star, text: 'Learns your taste with every trip' },
]

const ERROR_MESSAGES: Record<string, string> = {
  oauth_unconfigured: 'Google sign-in is not set up yet. Please try again soon.',
  oauth_state: 'Your sign-in session expired. Please try again.',
  oauth_denied: 'Sign-in was cancelled.',
  oauth_email: 'Could not get a verified email from Google.',
  oauth_token: 'Sign-in failed. Please try again.',
  oauth_failed: 'Sign-in failed. Please try again.',
  rate: 'Too many attempts. Please wait a moment and try again.',
}

/** Google "G" mark. */
function GoogleMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62Z" />
      <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.34A9 9 0 0 0 9 18Z" />
      <path fill="#FBBC05" d="M3.97 10.72A5.4 5.4 0 0 1 3.68 9c0-.6.1-1.18.29-1.72V4.94H.96A9 9 0 0 0 0 9c0 1.45.35 2.82.96 4.06l3.01-2.34Z" />
      <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.59C13.46.89 11.43 0 9 0A9 9 0 0 0 .96 4.94l3.01 2.34C4.68 5.16 6.66 3.58 9 3.58Z" />
    </svg>
  )
}

export default function LoginView() {
  const { dark, toggle } = useLandingTheme()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Surface OAuth errors passed back as ?error=… on the redirect.
  useEffect(() => {
    const code = new URLSearchParams(window.location.search).get('error')
    if (code) setError(ERROR_MESSAGES[code] ?? 'Sign-in failed. Please try again.')
  }, [])

  const signInWithGoogle = () => {
    setBusy(true)
    window.location.href = '/api/auth/google'
  }

  return (
    <div className="relative flex h-screen flex-col overflow-y-auto overflow-x-hidden bg-[#EFEFEF] dark:bg-[#0a0a0d]">
      {/* Same cinematic night-map treatment as the landing hero — the sign-in
          card floats over its right edge on large screens. */}
      <HeroMap className="absolute right-[-35%] top-[-2%] w-[min(85vw,420px)] sm:right-[-8%] sm:top-1/2 sm:-translate-y-1/2 sm:w-[min(56vh,540px)] lg:right-[2%] lg:w-[min(62vh,600px)] xl:right-[4%]" />
      {/* Readability veil under the content */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-[36%] bg-gradient-to-b from-transparent to-[#EFEFEF]/95 dark:to-[#0a0a0d]/95" />

      {/* Minimal nav */}
      <header className="relative z-20 mx-auto w-full max-w-[1440px] p-2 sm:p-3">
        <nav className="flex items-center justify-between rounded-full bg-white p-[5px] shadow-[0_2px_12px_rgba(0,0,0,0.06)] dark:bg-[#15151a] dark:shadow-[0_2px_12px_rgba(0,0,0,0.5)]">
          <Link href="/" className="flex items-center gap-2.5 pl-1">
            <HodariLogo />
            <span className="text-[14px] font-semibold tracking-tight text-gray-900 dark:text-gray-100">Hodari</span>
          </Link>
          <div className="flex items-center gap-3 sm:gap-4">
            <span className="hidden md:block">
              <LiveClock />
            </span>
            <ThemeToggle dark={dark} onToggle={toggle} />
            <Link
              href="/"
              className="group flex items-center gap-2 rounded-full bg-gray-900 py-2 pl-3 pr-4 text-[13px] font-medium text-white dark:bg-white dark:text-gray-900"
            >
              <ArrowLeft size={13} className={`transition-transform duration-500 ${EASE} group-hover:-translate-x-0.5`} />
              <RollText>Back home</RollText>
            </Link>
          </div>
        </nav>
      </header>

      {/* Two-column composition: welcome copy left, sign-in card right.
          On mobile the card stacks first so signing in stays one thumb away. */}
      <main className="relative z-20 mx-auto grid w-full max-w-[1440px] flex-1 content-center items-center gap-x-10 gap-y-12 px-5 pb-14 pt-6 sm:px-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,460px)] lg:gap-x-20 lg:px-12 lg:pb-16">

        {/* Welcome copy */}
        <div className="order-2 max-w-[560px] lg:order-1">
          <p className="animate-[fadeUp_0.7s_0.05s_both] motion-reduce:animate-none text-[13px] tracking-wide text-gray-900 dark:text-gray-200 sm:text-[14px]">
            Hodari · 2026 FIFA World Cup
          </p>
          <h1 className="mt-4 max-w-[16ch] animate-[fadeUp_0.8s_0.18s_both] motion-reduce:animate-none font-display font-semibold leading-[1.08] tracking-[-0.02em] text-gray-900 dark:text-gray-50 text-[clamp(1.8rem,5.6vw,3.4rem)] sm:text-[clamp(2.1rem,4vw,3.4rem)]">
            Your next great meal is already on the map.
          </h1>
          <p className="mt-5 max-w-[48ch] animate-[fadeUp_0.8s_0.32s_both] motion-reduce:animate-none text-[14px] leading-relaxed text-gray-600 dark:text-gray-300 sm:text-[15px]">
            Your taste, dietary needs and saved places live in your fan
            profile, so every meal plan fits you, on match days and every day
            after.
          </p>

          <ul className="mt-8 animate-[fadeUp_0.8s_0.46s_both] motion-reduce:animate-none space-y-3.5">
            {VALUE_POINTS.map(({ Icon, text }) => (
              <li key={text} className="flex items-center gap-3">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#F56A00]/10 text-[#F56A00]">
                  <Icon size={15} />
                </span>
                <span className="text-[13px] text-gray-700 dark:text-gray-300 sm:text-[14px]">{text}</span>
              </li>
            ))}
          </ul>
        </div>

        {/* Sign-in card */}
        <div className="order-1 w-full max-w-[460px] animate-[fadeUp_0.8s_0.12s_both] motion-reduce:animate-none justify-self-center rounded-3xl bg-white p-7 shadow-[0_24px_80px_rgba(0,0,0,0.16),0_2px_12px_rgba(0,0,0,0.06)] ring-1 ring-black/5 dark:bg-[#131318] dark:shadow-[0_24px_80px_rgba(0,0,0,0.65),0_2px_12px_rgba(0,0,0,0.5)] dark:ring-white/10 sm:p-9 lg:order-2 lg:justify-self-end">
          <h2 className="font-display text-[24px] font-semibold leading-[1.12] tracking-[-0.01em] text-gray-900 dark:text-gray-50 sm:text-[26px]">
            Sign in to Hodari.
          </h2>
          <p className="mt-2 text-[13px] leading-relaxed text-gray-500 dark:text-gray-400">
            Continue with Google. Your fan profile and saved places follow your account.
          </p>

          <div className="mt-7 space-y-4">
            {error && (
              <p className="text-[13px] text-[#e05a1a]" role="alert">{error}</p>
            )}

            <button
              type="button"
              onClick={signInWithGoogle}
              disabled={busy}
              className="flex w-full items-center justify-center gap-3 rounded-full border border-gray-300 bg-white py-3.5 text-[14px] font-medium text-gray-700 shadow-sm transition-colors duration-200 hover:bg-gray-50 disabled:cursor-wait disabled:opacity-70 dark:border-white/15 dark:bg-white/5 dark:text-gray-100 dark:hover:bg-white/10"
            >
              {busy ? (
                <Loader2 size={16} className="animate-spin motion-reduce:animate-none" />
              ) : (
                <GoogleMark />
              )}
              {busy ? 'Redirecting to Google…' : 'Continue with Google'}
            </button>

            <p className="text-center text-[11px] leading-relaxed text-gray-400 dark:text-gray-500">
              We only use your name and email to build your profile.
            </p>
          </div>
        </div>
      </main>
    </div>
  )
}
