'use client'

/**
 * EditProfile — own-profile editor for the community layer.
 *
 * Edits bio (280-char counter), handle (availability check on blur), avatar
 * emoji (curated travel/food grid), plus the two privacy switches:
 * discoverable and share_location ("show me on the map to my connections").
 * Saves through PUT /api/community/profile; a 409 surfaces as a handle error.
 *
 * Rendered inside ProfileSheet when viewing your own profile, but is
 * self-contained (fetches the profile itself when `initial` is not given) so
 * it can also be mounted from a settings screen.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { Check, Loader2 } from 'lucide-react'
import { cn } from '@/lib/design/cn'
import { focusRing } from '@/lib/design/tokens'
import type { ProfileView } from './ProfileSheet'

// Mirrors HANDLE_RE / MAX_BIO in lib/community.ts (server-only module — a value
// import here would pull the whole MCP data layer into the client bundle).
const HANDLE_RE = /^[a-z0-9_]{3,24}$/
const MAX_BIO = 280

/** Curated avatar choices — travel + food, matches Hodari's tourist domain. */
const AVATAR_EMOJI = [
  '🧭', '🗺️', '🎒', '🌍', '✈️', '🚆',
  '🛵', '⛺', '🏔️', '🏝️', '🕌', '🏟️',
  '⚽', '📸', '🎫', '🌅', '🚕', '⛩️',
  '🌮', '🍜', '🍣', '🥘', '☕', '🍹',
] as const

type HandleCheck = 'idle' | 'checking' | 'available' | 'taken' | 'invalid'

interface ToggleProps {
  checked: boolean
  onChange: (v: boolean) => void
  label: string
  hint?: string
  disabled?: boolean
}

/** Accessible switch row — label + optional hint, whole row tappable. */
function ToggleRow({ checked, onChange, label, hint, disabled }: ToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'flex w-full items-start justify-between gap-3 rounded-xl border border-border bg-surface px-3.5 py-3 text-left transition-colors',
        focusRing,
        disabled ? 'opacity-50' : 'hover:border-gold/40',
      )}
    >
      <span className="min-w-0">
        <span className="block text-[13px] font-medium text-text">{label}</span>
        {hint && <span className="mt-0.5 block text-[11.5px] leading-relaxed text-text2">{hint}</span>}
      </span>
      <span
        aria-hidden="true"
        className={cn(
          'mt-0.5 inline-flex h-5 w-9 shrink-0 items-center rounded-full border transition-colors',
          checked ? 'border-gold bg-gold' : 'border-border bg-surface3',
        )}
      >
        <span
          className={cn(
            'mx-0.5 h-3.5 w-3.5 rounded-full bg-white shadow transition-transform',
            checked && 'translate-x-4',
          )}
        />
      </span>
    </button>
  )
}

export interface EditProfileProps {
  /** Skip the initial fetch when the caller already has the profile. */
  initial?: ProfileView | null
  /** Called with the updated profile after a successful save. */
  onSaved?: (profile: ProfileView) => void
  /** Back out without saving. */
  onCancel?: () => void
}

export function EditProfile({ initial, onSaved, onCancel }: EditProfileProps) {
  const [profile, setProfile] = useState<ProfileView | null>(initial ?? null)
  const [loading, setLoading] = useState(!initial)

  const [handle, setHandle] = useState(initial?.handle ?? '')
  const [bio, setBio] = useState(initial?.bio ?? '')
  const [emoji, setEmoji] = useState(initial?.avatar_emoji ?? AVATAR_EMOJI[0])
  const [discoverable, setDiscoverable] = useState(initial?.discoverable ?? true)
  const [shareLocation, setShareLocation] = useState(initial?.share_location ?? false)

  const [handleCheck, setHandleCheck] = useState<HandleCheck>('idle')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  // Captured on toggle-on so the map dot appears without waiting for a heartbeat.
  const pendingLocation = useRef<{ lat: number; lng: number } | null>(null)

  useEffect(() => {
    if (initial) return
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch('/api/community/profile')
        if (!res.ok) throw new Error()
        const { profile: p } = (await res.json()) as { profile: ProfileView }
        if (cancelled) return
        setProfile(p)
        setHandle(p.handle)
        setBio(p.bio)
        setEmoji(p.avatar_emoji)
        setDiscoverable(p.discoverable)
        setShareLocation(p.share_location)
      } catch {
        if (!cancelled) setError('Could not load your profile.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [initial])

  /**
   * Availability probe on blur. GET ?handle= 404s for hidden users too, so a
   * "looks free" handle can still 409 on save — that path is handled there.
   */
  const checkHandle = useCallback(async () => {
    const h = handle.trim().toLowerCase()
    if (!profile || h === profile.handle) { setHandleCheck('idle'); return }
    if (!HANDLE_RE.test(h)) { setHandleCheck('invalid'); return }
    setHandleCheck('checking')
    try {
      const res = await fetch(`/api/community/profile?handle=${encodeURIComponent(h)}`)
      setHandleCheck(res.ok ? 'taken' : 'available')
    } catch {
      setHandleCheck('idle')
    }
  }, [handle, profile])

  const onToggleShareLocation = useCallback((next: boolean) => {
    setShareLocation(next)
    pendingLocation.current = null
    if (next && typeof navigator !== 'undefined' && navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => { pendingLocation.current = { lat: pos.coords.latitude, lng: pos.coords.longitude } },
        () => {},
        { maximumAge: 60_000, timeout: 8_000 },
      )
    }
  }, [])

  const save = useCallback(async () => {
    if (!profile || saving) return
    setSaving(true)
    setError(null)
    setSaved(false)
    try {
      const body: Record<string, unknown> = {
        bio,
        avatar_emoji: emoji,
        discoverable,
        share_location: shareLocation,
      }
      const h = handle.trim().toLowerCase()
      if (h !== profile.handle) {
        if (!HANDLE_RE.test(h)) {
          setError('Handles are 3-24 characters: lowercase letters, digits, underscores.')
          setSaving(false)
          return
        }
        body.handle = h
      }
      if (shareLocation && pendingLocation.current) body.location = pendingLocation.current
      if (!shareLocation) body.location = null

      const res = await fetch('/api/community/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json().catch(() => ({}))
      if (res.status === 409) {
        setHandleCheck('taken')
        setError('That handle is already taken.')
        return
      }
      if (!res.ok) {
        setError(typeof data.error === 'string' ? data.error : 'Could not save your profile.')
        return
      }
      const updated = data.profile as ProfileView
      setProfile(updated)
      setHandleCheck('idle')
      setSaved(true)
      onSaved?.(updated)
    } catch {
      setError('Could not save your profile.')
    } finally {
      setSaving(false)
    }
  }, [profile, saving, bio, emoji, discoverable, shareLocation, handle, onSaved])

  if (loading) {
    return (
      <div className="flex items-center gap-2.5 py-8">
        <div className="thinking-ring" />
        <span className="text-[11px] tracking-wide text-text2">Loading your profile…</span>
      </div>
    )
  }
  if (!profile) {
    return <p className="py-8 text-[13px] text-text2">{error ?? 'Could not load your profile.'}</p>
  }

  const handleMsg: Record<HandleCheck, { text: string; tone: string } | null> = {
    idle: null,
    checking: { text: 'Checking…', tone: 'text-text3' },
    available: { text: 'Available', tone: 'text-green' },
    taken: { text: 'Already taken', tone: 'text-danger' },
    invalid: { text: '3-24 chars: a-z, 0-9, _', tone: 'text-danger' },
  }
  const handleState = handleMsg[handleCheck]

  return (
    <div className="flex flex-col gap-5">
      {/* Avatar picker */}
      <div>
        <p className="mb-2 font-mono text-[11px] uppercase tracking-[0.14em] text-text3">Avatar</p>
        <div role="listbox" aria-label="Choose an avatar" className="grid grid-cols-6 gap-1.5">
          {AVATAR_EMOJI.map((e) => (
            <button
              key={e}
              type="button"
              role="option"
              aria-selected={emoji === e}
              aria-label={`Avatar ${e}`}
              onClick={() => setEmoji(e)}
              className={cn(
                'flex aspect-square items-center justify-center rounded-xl border text-xl transition-colors',
                focusRing,
                emoji === e
                  ? 'border-gold bg-gold/10'
                  : 'border-border bg-surface hover:border-gold/40',
              )}
            >
              {e}
            </button>
          ))}
        </div>
      </div>

      {/* Handle */}
      <div>
        <label htmlFor="profile-handle" className="mb-1.5 block font-mono text-[11px] uppercase tracking-[0.14em] text-text3">
          Handle
        </label>
        <div className="relative">
          <span aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[13px] text-text3">@</span>
          <input
            id="profile-handle"
            type="text"
            value={handle}
            onChange={(e) => { setHandle(e.target.value.toLowerCase()); setHandleCheck('idle') }}
            onBlur={() => void checkHandle()}
            maxLength={24}
            autoComplete="off"
            spellCheck={false}
            aria-invalid={handleCheck === 'taken' || handleCheck === 'invalid'}
            aria-describedby={handleState ? 'profile-handle-status' : undefined}
            className={cn(
              'w-full rounded-xl border border-border bg-surface py-2.5 pl-8 pr-3 font-mono text-[13px] text-text placeholder:text-text3',
              focusRing,
              (handleCheck === 'taken' || handleCheck === 'invalid') && 'border-danger/60',
            )}
            placeholder="your_handle"
          />
        </div>
        {handleState && (
          <p id="profile-handle-status" aria-live="polite" className={cn('mt-1 text-[11.5px]', handleState.tone)}>
            {handleState.text}
          </p>
        )}
      </div>

      {/* Bio */}
      <div>
        <div className="mb-1.5 flex items-baseline justify-between">
          <label htmlFor="profile-bio" className="font-mono text-[11px] uppercase tracking-[0.14em] text-text3">
            Bio
          </label>
          <span className={cn('font-mono text-[11px]', bio.length > MAX_BIO - 20 ? 'text-gold' : 'text-text3')}>
            {bio.length}/{MAX_BIO}
          </span>
        </div>
        <textarea
          id="profile-bio"
          value={bio}
          onChange={(e) => setBio(e.target.value.slice(0, MAX_BIO))}
          rows={3}
          maxLength={MAX_BIO}
          className={cn(
            'w-full resize-none rounded-xl border border-border bg-surface px-3 py-2.5 text-[13px] leading-relaxed text-text placeholder:text-text3',
            focusRing,
          )}
          placeholder="Where are you headed this summer?"
        />
      </div>

      {/* Privacy */}
      <div className="flex flex-col gap-2">
        <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-text3">Privacy</p>
        <ToggleRow
          checked={discoverable}
          onChange={setDiscoverable}
          label="Discoverable"
          hint="Other travellers can find you by handle and send you invites."
        />
        <ToggleRow
          checked={shareLocation}
          onChange={onToggleShareLocation}
          label="Show me on the map to my connections"
          hint="Only people you've accepted see your approximate location. Turn it off anytime."
        />
        <p className="rounded-xl border border-border bg-surface2/60 px-3.5 py-3 text-[11.5px] leading-relaxed text-text2">
          Your chats are end-to-end encrypted on this device — Hodari&apos;s servers and the AI
          can&apos;t read them. The AI only ever sees your bio, reviews, and shared pins.
        </p>
      </div>

      {error && <p className="text-[12.5px] text-danger" role="alert">{error}</p>}

      <div className="flex items-center gap-2 border-t border-border pt-4">
        <button
          type="button"
          onClick={() => void save()}
          disabled={saving}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-full bg-gold px-4 py-2 text-[12px] font-medium text-white transition-colors hover:bg-brand-dark disabled:opacity-60',
            focusRing,
          )}
        >
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : saved ? <Check className="h-3.5 w-3.5" /> : null}
          {saving ? 'Saving…' : saved ? 'Saved' : 'Save profile'}
        </button>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className={cn(
              'rounded-full border border-border px-3.5 py-2 text-[12px] text-text2 transition-colors hover:border-gold/50 hover:text-gold',
              focusRing,
            )}
          >
            Back
          </button>
        )}
      </div>
    </div>
  )
}
