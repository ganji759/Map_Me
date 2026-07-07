'use client'

/**
 * Stars — star-rating display + input for the community layer.
 *
 * `StarRating` is a read-only row (supports halves visually via partial fill).
 * `StarRatingInput` is a WAI-ARIA radiogroup: five radios with a roving
 * tabindex, Arrow/Home/End keyboard support, and click-to-set. Both use the
 * app's amber accent so they match the rating stars already shown in
 * PlaceDetailsPanel.
 */

import { useCallback, useRef } from 'react'
import { Star } from 'lucide-react'
import { cn } from '@/lib/design/cn'
import { focusRing } from '@/lib/design/tokens'

const SIZES = { sm: 'h-3.5 w-3.5', md: 'h-4 w-4', lg: 'h-6 w-6' } as const

export interface StarRatingProps {
  /** 0–5; fractional values render a partially-filled star. */
  value: number
  size?: keyof typeof SIZES
  /** Append the numeric value after the stars (e.g. "4.5"). */
  showValue?: boolean
  className?: string
}

/** Read-only star row. */
export function StarRating({ value, size = 'sm', showValue = false, className }: StarRatingProps) {
  const clamped = Math.max(0, Math.min(5, value))
  return (
    <span
      className={cn('inline-flex items-center gap-0.5', className)}
      role="img"
      aria-label={`Rated ${clamped.toFixed(1)} out of 5`}
    >
      {[1, 2, 3, 4, 5].map((i) => {
        const fill = Math.max(0, Math.min(1, clamped - (i - 1)))
        return (
          <span key={i} className="relative inline-flex" aria-hidden="true">
            <Star className={cn(SIZES[size], 'text-border fill-surface3')} />
            {fill > 0 && (
              <span
                className="absolute inset-0 overflow-hidden"
                style={{ width: `${fill * 100}%` }}
              >
                <Star className={cn(SIZES[size], 'fill-amber-500 text-amber-500')} />
              </span>
            )}
          </span>
        )
      })}
      {showValue && (
        <span className="ml-1 font-mono text-[11px] text-text2">{clamped.toFixed(1)}</span>
      )}
    </span>
  )
}

export interface StarRatingInputProps {
  /** Current rating, 0 (unset) or 1–5. */
  value: number
  onChange: (value: number) => void
  label?: string
  size?: keyof typeof SIZES
  disabled?: boolean
  className?: string
}

/** Interactive 1–5 star picker (radiogroup semantics, keyboard operable). */
export function StarRatingInput({
  value,
  onChange,
  label = 'Rating',
  size = 'lg',
  disabled = false,
  className,
}: StarRatingInputProps) {
  const groupRef = useRef<HTMLDivElement>(null)

  const focusStar = useCallback((n: number) => {
    const btn = groupRef.current?.querySelector<HTMLButtonElement>(`button[data-star="${n}"]`)
    btn?.focus()
  }, [])

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (disabled) return
      let next: number | null = null
      switch (e.key) {
        case 'ArrowRight':
        case 'ArrowUp':
          next = Math.min(5, (value || 0) + 1)
          break
        case 'ArrowLeft':
        case 'ArrowDown':
          next = Math.max(1, (value || 1) - 1)
          break
        case 'Home':
          next = 1
          break
        case 'End':
          next = 5
          break
        default:
          return
      }
      e.preventDefault()
      onChange(next)
      focusStar(next)
    },
    [disabled, value, onChange, focusStar],
  )

  // Roving tabindex: the selected star is tabbable; with nothing selected, star 1 is.
  const tabbable = value >= 1 && value <= 5 ? value : 1

  return (
    <div
      ref={groupRef}
      role="radiogroup"
      aria-label={label}
      onKeyDown={onKeyDown}
      className={cn('inline-flex items-center gap-1', className)}
    >
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          role="radio"
          data-star={n}
          aria-checked={value === n}
          aria-label={`${n} star${n > 1 ? 's' : ''}`}
          tabIndex={n === tabbable ? 0 : -1}
          disabled={disabled}
          onClick={() => onChange(n)}
          className={cn(
            'rounded-md p-0.5 transition-transform',
            focusRing,
            disabled ? 'cursor-not-allowed opacity-50' : 'hover:scale-110 active:scale-95',
          )}
        >
          <Star
            className={cn(
              SIZES[size],
              'transition-colors',
              n <= value ? 'fill-amber-500 text-amber-500' : 'fill-transparent text-text3',
            )}
          />
        </button>
      ))}
    </div>
  )
}
