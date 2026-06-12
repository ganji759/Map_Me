'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowLeft, ArrowRight, Mail, User } from 'lucide-react'
import {
  EASE,
  HodariLogo,
  LiveClock,
  RollText,
  ThemeToggle,
  useLandingTheme,
} from '@/components/landing/bits'
import SpinningGlobe from '@/components/landing/SpinningGlobe'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

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
    <div className="relative flex h-screen flex-col overflow-hidden bg-[#EFEFEF] dark:bg-[#0a0a0d]">
      {/* Same hero treatment as the landing page */}
      <SpinningGlobe className="absolute right-[-30%] top-[-12%] w-[min(85vw,460px)] sm:right-[-8%] sm:top-[-14%] sm:w-[min(52vh,500px)] lg:right-[2%] lg:top-auto lg:bottom-[-18%]" />
      <div className="absolute inset-x-0 bottom-0 h-[40%] bg-gradient-to-b from-transparent to-[#EFEFEF]/70 dark:to-[#0a0a0d]/80" />

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

      {/* Sign-in card */}
      <div className="relative z-20 flex flex-1 items-center justify-center px-5 pb-10">
        <div className="w-full max-w-[440px] rounded-3xl bg-white p-7 shadow-[0_24px_80px_rgba(0,0,0,0.16)] dark:bg-[#131318] dark:shadow-[0_24px_80px_rgba(0,0,0,0.65)] sm:p-10">
          <h1 className="font-display font-semibold leading-[1.12] tracking-[-0.01em] text-gray-900 dark:text-gray-50 text-[clamp(1.6rem,5vw,2.3rem)]">
            Sign in to Hodari.
          </h1>

          <form onSubmit={submit} className="mt-8 space-y-5">
            <div>
              <label htmlFor="login-name" className="mb-2 block text-[12px] font-medium uppercase tracking-wide text-gray-500 dark:text-gray-500">
                Name or username
              </label>
              <div className="flex items-center gap-2.5 rounded-full border border-gray-200 bg-white px-5 py-3 transition-colors duration-300 focus-within:border-[#F56A00] dark:border-white/15 dark:bg-white/5 dark:focus-within:border-[#F56A00]">
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
              <div className="flex items-center gap-2.5 rounded-full border border-gray-200 bg-white px-5 py-3 transition-colors duration-300 focus-within:border-[#F56A00] dark:border-white/15 dark:bg-white/5 dark:focus-within:border-[#F56A00]">
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
                <ArrowRight size={14} />
              </span>
            </button>
          </form>

        </div>
      </div>
    </div>
  )
}
