import { forwardRef } from 'react'
import { Loader2 } from 'lucide-react'
import { cn } from '@/lib/design/cn'
import { focusRing } from '@/lib/design/tokens'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger'
type Size = 'sm' | 'md' | 'lg'

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
  /** Pill (fully rounded) instead of the default rounded-xl. */
  pill?: boolean
  /** Square icon-only button (no horizontal padding). */
  iconOnly?: boolean
  /** Shows a spinner and disables the button. */
  loading?: boolean
  leftIcon?: React.ReactNode
  rightIcon?: React.ReactNode
}

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-gold text-bg hover:bg-gold-light active:bg-gold disabled:hover:bg-gold',
  secondary:
    'bg-surface/60 text-text border border-border hover:text-gold hover:border-gold/40',
  ghost: 'text-text2 hover:text-gold hover:bg-gold/5',
  danger: 'bg-danger/10 text-danger border border-danger/30 hover:bg-danger/15',
}

const SIZES: Record<Size, string> = {
  sm: 'h-8 text-[13px] gap-1.5',
  md: 'h-10 text-sm gap-2',
  lg: 'h-12 text-[15px] gap-2',
}

const PAD: Record<Size, string> = { sm: 'px-3', md: 'px-4', lg: 'px-5' }
const ICON_PAD: Record<Size, string> = { sm: 'w-8', md: 'w-10', lg: 'w-12' }
const SPIN: Record<Size, string> = { sm: 'w-3.5 h-3.5', md: 'w-4 h-4', lg: 'w-[18px] h-[18px]' }

/**
 * Button — the gold primary action plus secondary / ghost / danger variants.
 * Handles `loading` (spinner + disabled) and `iconOnly` square sizing.
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', pill, iconOnly, loading, leftIcon, rightIcon, disabled, className, children, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        'inline-flex items-center justify-center font-sans font-medium select-none',
        'btn-press transition-colors duration-[var(--dur-fast)] disabled:opacity-40 disabled:cursor-not-allowed',
        pill ? 'rounded-full' : 'rounded-xl',
        SIZES[size],
        iconOnly ? ICON_PAD[size] : PAD[size],
        VARIANTS[variant],
        focusRing,
        className,
      )}
      {...props}
    >
      {loading ? <Loader2 className={cn('animate-spin motion-reduce:animate-none', SPIN[size])} aria-hidden /> : leftIcon}
      {!iconOnly && children}
      {!loading && rightIcon}
    </button>
  )
})
