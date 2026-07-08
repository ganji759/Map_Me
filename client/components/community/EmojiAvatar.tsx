'use client'

/**
 * EmojiAvatar — the community identity mark: the user's avatar_emoji in a
 * soft-rounded tile (same treatment as ProfileSheet), with an optional
 * presence dot whose tooltip shows relative last-seen.
 */
import { useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/design/cn'
import type { PresenceInfo } from '@/lib/community'
import { formatLastSeen } from '@/lib/communityClient'

/** Matches --dur-slow in globals.css — the presence-pulse animation's length. */
const PULSE_MS = 400

type Size = 'sm' | 'md' | 'lg'

const SIZES: Record<Size, string> = {
  sm: 'h-8 w-8 rounded-lg text-base',
  md: 'h-10 w-10 rounded-xl text-xl',
  lg: 'h-14 w-14 rounded-2xl text-3xl',
}
const DOT: Record<Size, string> = { sm: 'h-2.5 w-2.5', md: 'h-3 w-3', lg: 'h-3.5 w-3.5' }

export interface EmojiAvatarProps {
  emoji: string
  /** For the aria-label. */
  name: string
  size?: Size
  /** Renders the presence dot when provided. */
  presence?: PresenceInfo | null
  className?: string
}

export function EmojiAvatar({ emoji, name, size = 'md', presence, className }: EmojiAvatarProps) {
  const online = presence?.online === true

  // One-shot ring on the offline→online transition only — never a perpetual
  // loop. wasOnline starts as the current value so mounting already-online
  // never pulses; only a live flip does.
  const wasOnline = useRef(online)
  const [pulse, setPulse] = useState(false)
  useEffect(() => {
    if (online && !wasOnline.current) {
      setPulse(true)
      const t = setTimeout(() => setPulse(false), PULSE_MS)
      wasOnline.current = online
      return () => clearTimeout(t)
    }
    wasOnline.current = online
  }, [online])

  return (
    <span className={cn('relative inline-flex shrink-0', className)}>
      <span
        role="img"
        aria-label={name}
        className={cn(
          'inline-flex items-center justify-center border border-border bg-surface2 leading-none select-none',
          SIZES[size],
        )}
      >
        {emoji}
      </span>
      {presence !== undefined && presence !== null && (
        <span
          role="img"
          aria-label={online ? 'Online' : 'Offline'}
          title={online ? 'Online now' : formatLastSeen(presence.last_seen_at)}
          className={cn(
            'absolute -bottom-0.5 -right-0.5 rounded-full border-2 border-surface',
            DOT[size],
            online ? 'bg-green' : 'bg-surface3',
            pulse && 'animate-presence-pulse',
          )}
        />
      )}
    </span>
  )
}
