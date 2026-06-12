'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowLeft, ArrowRight, Loader2, Mail, MapPin, Star, User, Utensils } from 'lucide-react'
import {
  EASE,
  HodariLogo,
  LiveClock,
  RollText,
  ThemeToggle,
  useLandingTheme,
} from '@/components/landing/bits'
import HeroMap from '@/components/landing/HeroMap'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const VALUE_POINTS = [
  { Icon: MapPin, text: 'Grounded by Google Maps — real places, never invented' },
  { Icon: Utensils, text: 'Restaurant-first plans built around your match days' },
  { Icon: Star, text: 'Learns your taste with every trip' },
]

export default function LoginView() {
  const router = useRouter()
  const { dark, toggle } = useLandingTheme()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Prefill from a previous session so returning fans sign in with one tap.
  useEffect(() => {
    const savedEmail = localStorage.getItem('hodari_email')
    const savedName = localStorage.getItem('hodari_name')
    if (savedEmail) setEmail(savedEmail)
    if (savedName) setName(savedName)
  }, [])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    const cleanName = name.trim()
    const cleanEmail = email.trim().toLowerCase()
    if (cleanName.length < 2) {
      setError('Enter your name or a username.')
      return
    }
    if (!EMAIL_RE.test(cleanEmail)) {
      setError('Enter a valid email address.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: cleanName, email: cleanEmail }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Sign-in failed. Please try again.')
      localStorage.setItem('hodari_uid', data.user.user_id)
      localStorage.setItem('hodari_email', data.user.email)
      if (data.user.name) localStorage.setItem('hodari_name', data.user.name)
      router.push('/chat')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-in failed. Please try again.')
      setBusy(false)
    }
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
            profile, so every meal plan fits you — on match days and every day
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
            No password needed — your fan profile follows your email.
          </p>

          <form onSubmit={submit} className="mt-7 space-y-5">
            <div>
              <label htmlFor="login-name" className="mb-2 block text-[12px] font-medium uppercase tracking-wide text-gray-500 dark:text-gray-500">
                Name or username
              </label>
              <div className="flex items-center gap-2.5 rounded-full border border-gray-200 bg-white px-5 py-3 transition-colors duration-300 focus-within:border-[#F56A00] focus-within:ring-1 focus-within:ring-[#F56A00] dark:border-white/15 dark:bg-white/5 dark:focus-within:border-[#F56A00]">
                <User size={15} className="shrink-0 text-gray-400" />
                <input
                  id="login-name"
                  type="text"
                  required
                  autoFocus
                  autoComplete="name"
                  value={name}
                  onChange={(e) => { setName(e.target.value); setError(null) }}
                  placeholder="Pacifique, or your handle"
                  className="w-full bg-transparent text-[14px] text-gray-900 outline-none placeholder:text-gray-400 dark:text-gray-100 dark:placeholder:text-gray-600"
                />
              </div>
            </div>

            <div>
              <label htmlFor="login-email" className="mb-2 block text-[12px] font-medium uppercase tracking-wide text-gray-500 dark:text-gray-500">
                Email address
              </label>
              <div className="flex items-center gap-2.5 rounded-full border border-gray-200 bg-white px-5 py-3 transition-colors duration-300 focus-within:border-[#F56A00] focus-within:ring-1 focus-within:ring-[#F56A00] dark:border-white/15 dark:bg-white/5 dark:focus-within:border-[#F56A00]">
                <Mail size={15} className="shrink-0 text-gray-400" />
                <input
                  id="login-email"
                  type="email"
                  required
                  autoComplete="email"
                  value={email}
                  onChange={(e) => { setEmail(e.target.value); setError(null) }}
                  placeholder="you@example.com"
                  className="w-full bg-transparent text-[14px] text-gray-900 outline-none placeholder:text-gray-400 dark:text-gray-100 dark:placeholder:text-gray-600"
                />
              </div>
            </div>

            {error && (
              <p className="text-[13px] text-[#e05a1a]" role="alert">{error}</p>
            )}

            <button
              type="submit"
              disabled={busy}
              className="group flex w-full items-center justify-between rounded-full bg-[#F56A00] py-2 pl-6 pr-2 text-[14px] font-medium text-white transition-colors duration-300 hover:bg-[#e05a1a] disabled:cursor-wait disabled:opacity-70"
            >
              <RollText>{busy ? 'Checking your profile…' : 'Continue'}</RollText>
              <span className={`flex h-8 w-8 items-center justify-center rounded-full bg-white text-[#F56A00] transition-transform duration-500 ${EASE} group-hover:-rotate-45`}>
                {busy
                  ? <Loader2 size={14} className="animate-spin motion-reduce:animate-none" />
                  : <ArrowRight size={14} />}
              </span>
            </button>
          </form>
        </div>
      </main>
    </div>
  )
}
