import { forwardRef } from 'react'
import { cn } from '@/lib/design/cn'

type Pad = 'none' | 'sm' | 'md' | 'lg'

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Frosted glass surface (for panels floating over the map) instead of solid. */
  glass?: boolean
  /** Lift + gold border on hover — use for clickable cards. */
  interactive?: boolean
  padding?: Pad
}

const PAD: Record<Pad, string> = { none: '', sm: 'p-3', md: 'p-4', lg: 'p-5' }

/** Card — the standard surface container (solid or `.glass`), rounded-2xl. */
export const Card = forwardRef<HTMLDivElement, CardProps>(function Card(
  { glass, interactive, padding = 'md', className, ...props },
  ref,
) {
  return (
    <div
      ref={ref}
      className={cn(
        'rounded-2xl',
        glass ? 'glass' : 'bg-surface border border-border',
        interactive &&
          'transition-all duration-[var(--dur-fast)] ease-[var(--ease-out-soft)] hover:border-gold/40 [@media(hover:hover)]:hover:-translate-y-0.5 cursor-pointer motion-reduce:hover:translate-y-0',
        PAD[padding],
        className,
      )}
      {...props}
    />
  )
})

/** Mono uppercase micro-label, e.g. a card eyebrow. */
export function CardLabel({ className, ...props }: React.HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn('font-mono text-[10px] text-gold tracking-[0.15em] uppercase', className)} {...props} />
}
