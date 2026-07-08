'use client'

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion, useDragControls, useReducedMotion } from 'framer-motion'
import { X } from 'lucide-react'
import { cn } from '@/lib/design/cn'
import { focusRing } from '@/lib/design/tokens'
import { backdrop, slideIn } from './motion'
import { useMounted } from './use-mounted'

type Side = 'right' | 'left' | 'bottom'

export interface SheetProps {
  open: boolean
  onClose: () => void
  side?: Side
  title?: string
  children: React.ReactNode
  className?: string
}

const ANCHOR: Record<Side, string> = {
  right: 'top-0 right-0 h-full w-full max-w-sm border-l',
  left: 'top-0 left-0 h-full w-full max-w-sm border-r',
  bottom: 'bottom-0 inset-x-0 max-h-[85dvh] rounded-t-2xl border-t',
}

/**
 * Below sm every side sheet becomes a bottom sheet, so all phone surfaces
 * (chat sheet, community, profile, share) speak the same dialect. Resolved in
 * an effect — the Sheet only renders post-mount (portal), so no hydration risk.
 */
function useIsSmallScreen(): boolean {
  const [small, setSmall] = useState(false)
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 639px)')
    const onChange = () => setSmall(mq.matches)
    onChange()
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])
  return small
}

/** Sheet — slide-over panel (right/left/bottom). Esc + backdrop close, scroll-locked. */
export function Sheet({ open, onClose, side = 'right', title, children, className }: SheetProps) {
  const reduced = useReducedMotion()
  const mounted = useMounted()
  const small = useIsSmallScreen()
  const panelRef = useRef<HTMLDivElement>(null)
  const dragControls = useDragControls()
  const titleId = title ? 'sheet-title' : undefined
  const effectiveSide: Side = small ? 'bottom' : side
  const isBottom = effectiveSide === 'bottom'

  useEffect(() => {
    if (!open) return
    const prevFocus = document.activeElement as HTMLElement | null
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    panelRef.current?.focus()
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
      prevFocus?.focus?.()
    }
  }, [open, onClose])

  if (!mounted) return null

  return createPortal(
    <AnimatePresence>
      {open && (
        /* z-[220]: above the mobile chat bottom sheet (z-[120]) and the full-map
           chrome, below the place-details modal (z-[250]). */
        <div className="fixed inset-0 z-[220]">
          <motion.div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            variants={backdrop}
            initial="hidden"
            animate="show"
            exit="exit"
            onClick={onClose}
          />
          <motion.div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            tabIndex={-1}
            variants={slideIn(effectiveSide, !!reduced)}
            initial="hidden"
            animate="show"
            exit="exit"
            // Bottom variant: swipe down on the grab handle to dismiss.
            drag={isBottom && !reduced ? 'y' : false}
            dragControls={dragControls}
            dragListener={false}
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0, bottom: 0.4 }}
            onDragEnd={(_, info) => {
              if (info.offset.y > 96 || info.velocity.y > 600) onClose()
            }}
            className={cn('absolute glass border-border/70 flex flex-col outline-none', ANCHOR[effectiveSide], className)}
          >
            {isBottom && (
              <div
                aria-hidden
                onPointerDown={(e) => dragControls.start(e)}
                className="flex min-h-[44px] w-full shrink-0 cursor-grab touch-none select-none items-center justify-center active:cursor-grabbing"
              >
                <span className="h-1.5 w-11 rounded-full bg-border" />
              </div>
            )}
            <div
              className={cn(
                'flex items-center justify-between gap-4 px-5 border-b border-border/50 shrink-0',
                isBottom ? 'pb-3 pt-0' : 'py-4',
              )}
            >
              {title && <h2 id={titleId} className="font-display text-lg font-semibold text-text">{title}</h2>}
              <button
                onClick={onClose}
                aria-label="Close"
                className={cn('ml-auto p-1.5 rounded-lg text-text3 hover:text-gold hover:bg-gold/5 transition-colors max-md:p-3', focusRing)}
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto scrollbar-hide p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom,0px))]">{children}</div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  )
}
