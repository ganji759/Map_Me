'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Clock } from 'lucide-react'

export const EASE = 'ease-[cubic-bezier(0.25,0.1,0.25,1)]'

/**
 * Scroll-triggered reveal: fades + lifts children the first time they enter
 * the viewport. With reduced motion the content is simply visible.
 */
export function Reveal({
  children,
  className = '',
  delay = 0,
}: {
  children: ReactNode
  className?: string
  delay?: number
}) {
  const ref = useRef<HTMLDivElement | null>(null)
  const [shown, setShown] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setShown(true)
      return
    }
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setShown(true)
          io.disconnect()
        }
      },
      { threshold: 0.12, rootMargin: '0px 0px -8% 0px' },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [])

  return (
    <div
      ref={ref}
      style={{ transitionDelay: `${delay}ms` }}
      className={`transition-all duration-700 motion-reduce:transition-none ${EASE} ${shown ? 'translate-y-0 opacity-100' : 'translate-y-7 opacity-0'} ${className}`}
    >
      {children}
    </div>
  )
}

/** Theme state shared with the chat app — same `hodari_theme` key + `.dark` class. */
export function useLandingTheme() {
  const [dark, setDark] = useState(false)
  useEffect(() => {
    setDark(document.documentElement.classList.contains('dark'))
  }, [])
  const toggle = () =>
    setDark((d) => {
      const next = !d
      document.documentElement.classList.toggle('dark', next)
      localStorage.setItem('hodari_theme', next ? 'dark' : 'light')
      return next
    })
  return { dark, toggle }
}

/**
 * Hover text-roll: the label is duplicated in a flex-col container clipped to
 * one line; on parent `group` hover the column slides up by 50%.
 */
export function RollText({ children, lineHeight = 20 }: { children: ReactNode; lineHeight?: number }) {
  return (
    <span className="block overflow-hidden" style={{ height: lineHeight }}>
      <span className={`flex flex-col transition-transform duration-500 ${EASE} group-hover:-translate-y-1/2`}>
        <span className="flex items-center" style={{ height: lineHeight }}>{children}</span>
        <span className="flex items-center" style={{ height: lineHeight }}>{children}</span>
      </span>
    </span>
  )
}

/** Live clock for a host-city timezone, HH:MM, ticking every second. */
export function LiveClock({ city = 'New York', timeZone = 'America/New_York' }: { city?: string; timeZone?: string }) {
  const [time, setTime] = useState('--:--')
  useEffect(() => {
    const fmt = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone })
    const tick = () => setTime(fmt.format(new Date()))
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [timeZone])
  return (
    <span className="flex items-center gap-1.5 text-[13px] text-gray-600 dark:text-gray-400">
      <Clock size={14} />
      {time} in {city}
    </span>
  )
}

export function HodariLogo({ className = 'w-9 h-9 sm:w-10 sm:h-10' }: { className?: string }) {
  return (
    <span className={`flex items-center justify-center rounded-full bg-gray-900 dark:bg-[#F56A00] ${className}`}>
      <span className="text-[10px] sm:text-[11px] font-bold tracking-tight text-white">HD</span>
    </span>
  )
}

/** Starburst/compass mark used in the grounded-by-Maps badge. */
export function StarburstMark({ className = 'w-5 h-5 sm:w-6 sm:h-6' }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" className={`fill-current text-[#E8704E] ${className}`}>
      <path d="m19.6 66.5 19.7-11 .3-1-.3-.5h-1l-3.3-.2-11.2-.3L14 53l-9.5-.5-2.4-.5L0 49l.2-1.5 2-1.3 2.9.2 6.3.5 9.5.6 6.9.4L38 49.1h1.6l.2-.7-.5-.4-.4-.4L29 41l-10.6-7-5.6-4.1-3-2-1.5-2-.6-4.2 2.7-3 3.7.3.9.2 3.7 2.9 8 6.1L37 36l1.5 1.2.6-.4.1-.3-.7-1.1L33 25l-6-10.4-2.7-4.3-.7-2.6c-.3-1-.4-2-.4-3l3-4.2L28 0l4.2.6L33.8 2l2.6 6 4.1 9.3L47 29.9l2 3.8 1 3.4.3 1h.7v-.5l.5-7.2 1-8.7 1-11.2.3-3.2 1.6-3.8 3-2L61 2.6l2 2.9-.3 1.8-1.1 7.7L59 27.1l-1.5 8.2h.9l1-1.1 4.1-5.4 6.9-8.6 3-3.5L77 13l2.3-1.8h4.3l3.1 4.7-1.4 4.9-4.4 5.6-3.7 4.7-5.3 7.1-3.2 5.7.3.4h.7l12-2.6 6.4-1.1 7.6-1.3 3.5 1.6.4 1.6-1.4 3.4-8.2 2-9.6 2-14.3 3.3-.2.1.2.3 6.4.6 2.8.2h6.8l12.6 1 3.3 2 1.9 2.7-.3 2-5.1 2.6-6.8-1.6-16-3.8-5.4-1.3h-.8v.4l4.6 4.5 8.3 7.5L89 80.1l.5 2.4-1.3 2-1.4-.2-9.2-7-3.6-3-8-6.8h-.5v.7l1.8 2.7 9.8 14.7.5 4.5-.7 1.4-2.6 1-2.7-.6-5.8-8-6-9-4.7-8.2-.5.4-2.9 30.2-1.3 1.5-3 1.2-2.5-2-1.4-3 1.4-6.2 1.6-8 1.3-6.4 1.2-7.9.7-2.6v-.2H49L43 72l-9 12.3-7.2 7.6-1.7.7-3-1.5.3-2.8L24 86l10-12.8 6-7.9 4-4.6-.1-.5h-.3L17.2 77.4l-4.7.6-2-2 .2-3 1-1 8-5.5Z" />
    </svg>
  )
}

/** Sun/moon theme toggle pill. */
export function ThemeToggle({ dark, onToggle }: { dark: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'}
      className="flex h-9 w-9 items-center justify-center rounded-full bg-gray-100 text-gray-900 transition-colors duration-300 hover:bg-gray-200 dark:bg-white/10 dark:text-gray-100 dark:hover:bg-white/20"
    >
      {dark ? (
        <svg viewBox="0 0 24 24" className="h-4 w-4 fill-none stroke-current" strokeWidth="2" strokeLinecap="round">
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2m0 16v2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
        </svg>
      ) : (
        <svg viewBox="0 0 24 24" className="h-4 w-4 fill-none stroke-current" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" />
        </svg>
      )}
    </button>
  )
}
