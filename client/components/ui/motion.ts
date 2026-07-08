'use client'

import type { Variants } from 'framer-motion'
import { motion as tokens } from '@/lib/design/tokens'

export const EASE = tokens.ease
export const DUR = tokens.duration

/**
 * Variant factories. Pass `reduced` (from framer-motion's `useReducedMotion()`)
 * and movement collapses to a pure cross-fade with zero duration — honoring
 * `prefers-reduced-motion` everywhere instead of per-component guards.
 *
 *   const reduced = useReducedMotion()
 *   <motion.div variants={fadeUp(!!reduced)} initial="hidden" animate="show" exit="exit" />
 */
export function fade(reduced = false): Variants {
  const d = reduced ? 0 : DUR.base
  return {
    hidden: { opacity: 0 },
    show: { opacity: 1, transition: { duration: d, ease: EASE } },
    exit: { opacity: 0, transition: { duration: reduced ? 0 : DUR.fast, ease: EASE } },
  }
}

export function fadeUp(reduced = false): Variants {
  const y = reduced ? 0 : 8
  return {
    hidden: { opacity: 0, y },
    show: { opacity: 1, y: 0, transition: { duration: reduced ? 0 : DUR.base, ease: EASE } },
    exit: { opacity: 0, y, transition: { duration: reduced ? 0 : DUR.fast, ease: EASE } },
  }
}

export function scaleIn(reduced = false): Variants {
  return {
    hidden: { opacity: 0, scale: reduced ? 1 : 0.96, y: reduced ? 0 : 6 },
    show: { opacity: 1, scale: 1, y: 0, transition: { duration: reduced ? 0 : DUR.base, ease: EASE } },
    exit: { opacity: 0, scale: reduced ? 1 : 0.97, transition: { duration: reduced ? 0 : DUR.fast, ease: EASE } },
  }
}

/**
 * Panel entrance (Sheet's right/left/bottom variants). Same glide ease + base
 * duration as every other surface (fade/fadeUp/scaleIn above) so the app
 * reads as one material — arriving is --dur-base, leaving is --dur-fast.
 */
export function slideIn(side: 'right' | 'left' | 'bottom' = 'right', reduced = false): Variants {
  const off = side === 'bottom' ? { y: '100%' } : { x: side === 'right' ? '100%' : '-100%' }
  const zero = side === 'bottom' ? { y: 0 } : { x: 0 }
  return {
    hidden: { ...(reduced ? {} : off), opacity: reduced ? 0 : 1 },
    show: { ...zero, opacity: 1, transition: { duration: reduced ? 0 : DUR.base, ease: EASE } },
    exit: { ...(reduced ? {} : off), opacity: reduced ? 0 : 1, transition: { duration: reduced ? 0 : DUR.fast, ease: EASE } },
  }
}

/** Backdrop fade for modals/sheets. */
export const backdrop: Variants = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { duration: DUR.base } },
  exit: { opacity: 0, transition: { duration: DUR.fast } },
}
