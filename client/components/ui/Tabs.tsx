'use client'

import { createContext, useContext, useId, useRef, useState } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import { cn } from '@/lib/design/cn'
import { focusRing } from '@/lib/design/tokens'
import { DUR, EASE } from './motion'

interface TabsCtx {
  value: string
  setValue: (v: string) => void
  baseId: string
}
const Ctx = createContext<TabsCtx | null>(null)
const useTabs = () => {
  const c = useContext(Ctx)
  if (!c) throw new Error('Tabs.* must be used within <Tabs>')
  return c
}

export interface TabsProps {
  /** Controlled value. Omit and use `defaultValue` for uncontrolled. */
  value?: string
  defaultValue?: string
  onValueChange?: (v: string) => void
  children: React.ReactNode
  className?: string
}

/** Tabs — accessible (roving focus, arrow keys) with an animated gold underline. */
export function Tabs({ value, defaultValue, onValueChange, children, className }: TabsProps) {
  const [internal, setInternal] = useState(defaultValue ?? '')
  const current = value ?? internal
  const baseId = useId()
  const setValue = (v: string) => {
    if (value === undefined) setInternal(v)
    onValueChange?.(v)
  }
  return (
    <Ctx.Provider value={{ value: current, setValue, baseId }}>
      <div className={className}>{children}</div>
    </Ctx.Provider>
  )
}

export function TabsList({ children, className }: { children: React.ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  // Arrow-key navigation across triggers.
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return
    const tabs = Array.from(ref.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]') ?? [])
    const i = tabs.findIndex((t) => t === document.activeElement)
    if (i < 0) return
    e.preventDefault()
    const next = e.key === 'ArrowRight' ? (i + 1) % tabs.length : (i - 1 + tabs.length) % tabs.length
    tabs[next]?.focus()
    tabs[next]?.click()
  }
  return (
    <div ref={ref} role="tablist" onKeyDown={onKeyDown} className={cn('flex items-center gap-1 border-b border-border', className)}>
      {children}
    </div>
  )
}

export function TabsTrigger({ value, children, className }: { value: string; children: React.ReactNode; className?: string }) {
  const { value: active, setValue, baseId } = useTabs()
  const selected = active === value
  const reduced = useReducedMotion()
  return (
    <button
      role="tab"
      type="button"
      id={`${baseId}-tab-${value}`}
      aria-selected={selected}
      aria-controls={`${baseId}-panel-${value}`}
      tabIndex={selected ? 0 : -1}
      onClick={() => setValue(value)}
      className={cn(
        'relative px-3.5 py-2 font-mono text-[11px] tracking-wider uppercase transition-colors rounded-t-md',
        selected ? 'text-gold' : 'text-text3 hover:text-text2',
        focusRing,
        className,
      )}
    >
      {children}
      {selected && (
        <motion.span
          layoutId={`${baseId}-underline`}
          className="absolute left-2 right-2 -bottom-px h-0.5 rounded-full bg-gold"
          // Slides, doesn't jump — same calm glide as every other surface,
          // not framer's default spring (which would read as a bouncy jump).
          transition={reduced ? { duration: 0 } : { duration: DUR.base, ease: EASE }}
        />
      )}
    </button>
  )
}

export function TabsContent({ value, children, className }: { value: string; children: React.ReactNode; className?: string }) {
  const { value: active, baseId } = useTabs()
  if (active !== value) return null
  return (
    <div role="tabpanel" id={`${baseId}-panel-${value}`} aria-labelledby={`${baseId}-tab-${value}`} className={cn('pt-4', className)}>
      {children}
    </div>
  )
}
