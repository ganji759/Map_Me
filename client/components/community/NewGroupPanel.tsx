'use client'

/**
 * NewGroupPanel — create an encrypted group chat from accepted connections.
 *
 * E2EE flow: fetch every candidate's published pubkey, let the user pick
 * members (those without a pubkey are disabled — the conversation key can't be
 * wrapped for them), generate a fresh AES-GCM conversation key wrapped per
 * member (including ourselves), POST the conversation with the wrapped-key
 * map, and register the live key in the session cache so the thread can
 * encrypt immediately.
 */
import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, Check, Users } from 'lucide-react'
import { cn } from '@/lib/design/cn'
import { focusRing } from '@/lib/design/tokens'
import type { Conversation, UserAttribution } from '@/lib/community'
import {
  CommunityApiError,
  createConversation,
  getPubkeys,
  type ConnectionEdge,
} from '@/lib/communityClient'
import { createConversationKey } from '@/lib/e2ee'
import { registerConversationKey } from './conversationKeys'
import { EmojiAvatar } from './EmojiAvatar'

export interface NewGroupPanelProps {
  currentUserId: string
  /** This device's public JWK (from ensureKeypair) — required to wrap keys. */
  myPubkey: JsonWebKey
  /** Accepted connection edges (from the panel's connections snapshot). */
  accepted: ConnectionEdge[]
  onBack: () => void
  /** Called with the created conversation; the panel opens its thread. */
  onCreated: (conversation: Conversation) => void
}

export function NewGroupPanel({ currentUserId, myPubkey, accepted, onBack, onCreated }: NewGroupPanelProps) {
  const candidates = useMemo(
    () => accepted.map((e) => e.user).filter((u): u is UserAttribution => Boolean(u)),
    [accepted],
  )
  const [title, setTitle] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [pubkeys, setPubkeys] = useState<Record<string, JsonWebKey | null> | null>(null)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    getPubkeys(candidates.map((u) => u.user_id))
      .then((keys) => {
        if (!cancelled) setPubkeys(keys)
      })
      .catch(() => {
        if (!cancelled) setPubkeys({})
      })
    return () => {
      cancelled = true
    }
  }, [candidates])

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const create = async () => {
    if (selected.size === 0 || creating) return
    setCreating(true)
    setError(null)
    try {
      const memberIds = [...selected]
      const memberPubkeys: Record<string, JsonWebKey> = { [currentUserId]: myPubkey }
      for (const id of memberIds) {
        const pub = pubkeys?.[id]
        if (!pub) throw new Error('A selected member has no encryption key yet — deselect them and retry.')
        memberPubkeys[id] = pub
      }
      const { key, wrappedKeys } = await createConversationKey(memberPubkeys)
      const { conversation } = await createConversation({
        type: 'group',
        member_ids: memberIds,
        title: title.trim() || undefined,
        wrapped_keys: wrappedKeys,
      })
      registerConversationKey(conversation.conversation_id, key)
      onCreated(conversation)
    } catch (err) {
      setError(
        err instanceof CommunityApiError || err instanceof Error
          ? err.message
          : 'Could not create the group.',
      )
      setCreating(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onBack}
          aria-label="Back to chats"
          className={cn('rounded-lg p-1.5 text-text3 transition-colors hover:bg-gold/5 hover:text-gold', focusRing)}
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <h3 className="font-display text-base font-semibold text-text">New group</h3>
      </div>

      <div>
        <label htmlFor="group-name" className="mb-1.5 block font-mono text-[10px] uppercase tracking-widest text-text3">
          Group name
        </label>
        <div className="flex items-center rounded-xl border border-border bg-surface/80 px-3.5 transition-colors focus-within:border-gold/40 focus-within:ring-2 focus-within:ring-gold/30">
          <input
            id="group-name"
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={120}
            placeholder="Matchday crew, Kigali eats…"
            className="min-w-0 flex-1 bg-transparent py-2.5 font-sans text-sm text-text outline-none placeholder:text-text3"
          />
        </div>
      </div>

      <div>
        <p className="mb-2 font-mono text-[11px] uppercase tracking-[0.14em] text-text3">
          Members · {selected.size} selected
        </p>
        {candidates.length === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border px-4 py-6 text-center">
            <Users className="h-5 w-5 text-text3" aria-hidden />
            <p className="text-[12.5px] text-text3">Connect with travellers first — groups are built from your connections.</p>
          </div>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {candidates.map((u) => {
              const hasKey = Boolean(pubkeys?.[u.user_id])
              const keysLoading = pubkeys === null
              const isSelected = selected.has(u.user_id)
              return (
                <li key={u.user_id}>
                  <button
                    type="button"
                    disabled={keysLoading || !hasKey}
                    aria-pressed={isSelected}
                    onClick={() => toggle(u.user_id)}
                    className={cn(
                      'flex w-full items-center gap-2.5 rounded-xl border px-3 py-2 text-left transition-colors',
                      isSelected ? 'border-gold/50 bg-gold/[0.06]' : 'border-border bg-surface hover:border-gold/30',
                      (keysLoading || !hasKey) && 'cursor-not-allowed opacity-50',
                      focusRing,
                    )}
                  >
                    <EmojiAvatar emoji={u.avatar_emoji} name={u.name || u.handle} size="sm" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-medium text-text">{u.name || `@${u.handle}`}</span>
                      <span className="block truncate font-mono text-[10.5px] text-text3">
                        {keysLoading ? '…' : hasKey ? `@${u.handle}` : 'No encrypted chat yet'}
                      </span>
                    </span>
                    <span
                      aria-hidden
                      className={cn(
                        'flex h-5 w-5 shrink-0 items-center justify-center rounded-full border transition-colors',
                        isSelected ? 'border-gold bg-gold text-white' : 'border-border text-transparent',
                      )}
                    >
                      <Check className="h-3 w-3" />
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </div>

      {error && (
        <p className="text-[12px] text-danger" role="alert">
          {error}
        </p>
      )}

      <button
        type="button"
        disabled={selected.size === 0 || creating}
        onClick={() => void create()}
        className={cn(
          'inline-flex h-10 items-center justify-center gap-2 rounded-full bg-gold px-5 text-[13px] font-medium text-white transition-colors hover:bg-brand-dark disabled:cursor-not-allowed disabled:opacity-40',
          focusRing,
        )}
      >
        {creating ? 'Creating…' : 'Create encrypted group'}
      </button>
      <p className="-mt-2 text-center text-[11px] leading-relaxed text-text3">
        Messages are end-to-end encrypted — only members&apos; devices can read them.
      </p>
    </div>
  )
}
