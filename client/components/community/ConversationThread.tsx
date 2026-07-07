'use client'

/**
 * ConversationThread — an open encrypted conversation.
 *
 * - Unwraps (or reuses) the conversation key, decrypts on render; a message
 *   that cannot be decrypted shows a subtle "key unavailable" placeholder.
 * - Polls /api/community/messages with the after_seq cursor every 3s while
 *   open; the server advances the read cursor on each poll.
 * - Bubbles: own = right/accent (--bubble-user), others = left/surface with
 *   sender handle + avatar in groups; timestamps grouped by day.
 * - Auto-scroll stays pinned to the bottom unless the user scrolled up.
 * - Composer: text + image attach (downscaled to ≤1280px JPEG client-side,
 *   encrypted, 400KB ciphertext cap) + share-a-pin affordance (onSharePin).
 *   Composing is disabled — never silently plaintext — when E2EE or the
 *   conversation key is unavailable on this device.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, ImagePlus, Lock, MapPin, Send, Users } from 'lucide-react'
import { cn } from '@/lib/design/cn'
import { focusRing } from '@/lib/design/tokens'
import type { ConversationSummary, EncryptedMessage, PresenceInfo, UserAttribution } from '@/lib/community'
import {
  CommunityApiError,
  MAX_CIPHERTEXT_B64,
  conversationTitle,
  dayLabel,
  fetchMessages,
  formatLastSeen,
  sendMessage,
  timeLabel,
} from '@/lib/communityClient'
import { decryptBytes, decryptText, encryptBytes, encryptText } from '@/lib/e2ee'
import { ConversationKeyError, resolveConversationKey } from './conversationKeys'
import { prepareImageForSending } from './attachImage'
import { EmojiAvatar } from './EmojiAvatar'

const POLL_MS = 3000
const PIN_THRESHOLD_PX = 80

interface ViewMessage {
  seq: number
  sender_id: string
  msg_type: 'text' | 'image'
  created_at: string
  text: string | null
  imageUrl: string | null
  /** Decryption failed — render the "key unavailable" placeholder. */
  locked: boolean
}

export interface ConversationThreadProps {
  conversation: ConversationSummary
  currentUserId: string
  /** Device-level E2EE readiness (from the panel's ensureKeypair result). */
  canCompose: boolean
  /** Why composing is disabled when canCompose is false. */
  e2eeNotice?: string | null
  presence: Record<string, PresenceInfo>
  onBack: () => void
  /** Share-a-pin affordance — the integration agent opens its pin picker. */
  onSharePin?: (conversationId: string) => void
}

export function ConversationThread({
  conversation,
  currentUserId,
  canCompose,
  e2eeNotice,
  presence,
  onBack,
  onSharePin,
}: ConversationThreadProps) {
  const convId = conversation.conversation_id
  const isGroup = conversation.type !== 'dm'

  const [keyState, setKeyState] = useState<'loading' | 'ready' | 'unavailable'>('loading')
  const [keyError, setKeyError] = useState<string | null>(null)
  const keyRef = useRef<CryptoKey | null>(null)

  const [raw, setRaw] = useState<EncryptedMessage[]>([])
  const [view, setView] = useState<ViewMessage[]>([])
  const [loadingInitial, setLoadingInitial] = useState(true)
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)

  const lastSeqRef = useRef(0)
  const seenSeqsRef = useRef<Set<number>>(new Set())
  const decryptedSeqsRef = useRef<Set<number>>(new Set())
  const objectUrlsRef = useRef<string[]>([])
  const scrollRef = useRef<HTMLDivElement>(null)
  const pinnedRef = useRef(true)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const membersById = useMemo(() => {
    const map: Record<string, UserAttribution> = {}
    for (const m of conversation.members) map[m.user_id] = m
    return map
  }, [conversation.members])

  const peer = useMemo(
    () => (isGroup ? null : (conversation.members.find((m) => m.user_id !== currentUserId) ?? null)),
    [isGroup, conversation.members, currentUserId],
  )

  const appendRaw = useCallback((msgs: EncryptedMessage[]) => {
    const fresh = msgs.filter((m) => !seenSeqsRef.current.has(m.seq))
    if (fresh.length === 0) return
    for (const m of fresh) {
      seenSeqsRef.current.add(m.seq)
      if (m.seq > lastSeqRef.current) lastSeqRef.current = m.seq
    }
    setRaw((prev) => [...prev, ...fresh].sort((a, b) => a.seq - b.seq))
  }, [])

  // ── Reset + key unwrap + polling per conversation ──────────────────────────
  useEffect(() => {
    let cancelled = false
    lastSeqRef.current = 0
    seenSeqsRef.current = new Set()
    decryptedSeqsRef.current = new Set()
    keyRef.current = null
    pinnedRef.current = true
    setRaw([])
    setView([])
    setKeyState('loading')
    setKeyError(null)
    setSendError(null)
    setLoadingInitial(true)

    resolveConversationKey(conversation, currentUserId)
      .then((key) => {
        if (cancelled) return
        keyRef.current = key
        setKeyState('ready')
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setKeyState('unavailable')
        setKeyError(err instanceof ConversationKeyError ? err.message : 'Encryption key unavailable on this device.')
      })

    const poll = async (initial: boolean) => {
      try {
        const { messages } = await fetchMessages(convId, lastSeqRef.current)
        if (cancelled) return
        appendRaw(messages)
      } catch {
        /* transient poll failure — next tick retries */
      } finally {
        if (!cancelled && initial) setLoadingInitial(false)
      }
    }
    void poll(true)
    const interval = setInterval(() => void poll(false), POLL_MS)

    const urls = objectUrlsRef.current
    return () => {
      cancelled = true
      clearInterval(interval)
      for (const url of urls.splice(0)) URL.revokeObjectURL(url)
    }
    // conversation identity is what matters; members/keys don't change mid-view.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [convId, currentUserId])

  // ── Decrypt newly arrived ciphertext once the key state settles ────────────
  useEffect(() => {
    if (keyState === 'loading') return
    const pending = raw.filter((m) => !decryptedSeqsRef.current.has(m.seq))
    if (pending.length === 0) return
    for (const m of pending) decryptedSeqsRef.current.add(m.seq)

    let cancelled = false
    ;(async () => {
      const additions: ViewMessage[] = []
      for (const m of pending) {
        const base = { seq: m.seq, sender_id: m.sender_id, msg_type: m.msg_type, created_at: m.created_at }
        const key = keyRef.current
        if (!key) {
          additions.push({ ...base, text: null, imageUrl: null, locked: true })
          continue
        }
        try {
          if (m.msg_type === 'image') {
            const bytes = await decryptBytes(key, m.ciphertext, m.iv)
            // Copy into a fresh ArrayBuffer-backed view (satisfies BlobPart typing).
            const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: 'image/jpeg' }))
            objectUrlsRef.current.push(url)
            additions.push({ ...base, text: null, imageUrl: url, locked: false })
          } else {
            const text = await decryptText(key, m.ciphertext, m.iv)
            additions.push({ ...base, text, imageUrl: null, locked: false })
          }
        } catch {
          additions.push({ ...base, text: null, imageUrl: null, locked: true })
        }
      }
      if (!cancelled && additions.length > 0) {
        setView((prev) => [...prev, ...additions].sort((a, b) => a.seq - b.seq))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [raw, keyState])

  // ── Auto-scroll pinned to bottom unless the user scrolled up ───────────────
  const handleScroll = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    pinnedRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < PIN_THRESHOLD_PX
  }, [])

  useEffect(() => {
    if (!pinnedRef.current) return
    const el = scrollRef.current
    if (!el) return
    requestAnimationFrame(() => {
      el.scrollTop = el.scrollHeight
    })
  }, [view])

  // ── Sending ─────────────────────────────────────────────────────────────────
  const composerEnabled = canCompose && keyState === 'ready'

  const sendText = useCallback(async () => {
    const key = keyRef.current
    const text = input.trim()
    if (!key || !text || sending) return
    setSending(true)
    setSendError(null)
    try {
      const { ciphertext, iv } = await encryptText(key, text)
      const msg = await sendMessage(convId, ciphertext, iv, 'text')
      pinnedRef.current = true
      appendRaw([msg])
      setInput('')
    } catch (err) {
      setSendError(err instanceof CommunityApiError ? err.message : 'Could not send — try again.')
    } finally {
      setSending(false)
    }
  }, [input, sending, convId, appendRaw])

  const sendImage = useCallback(
    async (file: File) => {
      const key = keyRef.current
      if (!key || sending) return
      setSending(true)
      setSendError(null)
      try {
        const bytes = await prepareImageForSending(file)
        const { ciphertext, iv } = await encryptBytes(key, bytes)
        if (ciphertext.length > MAX_CIPHERTEXT_B64) {
          throw new Error('That image is too large to send encrypted — try a smaller one.')
        }
        const msg = await sendMessage(convId, ciphertext, iv, 'image')
        pinnedRef.current = true
        appendRaw([msg])
      } catch (err) {
        setSendError(
          err instanceof CommunityApiError || err instanceof Error ? err.message : 'Could not send that image.',
        )
      } finally {
        setSending(false)
      }
    },
    [sending, convId, appendRaw],
  )

  const title = conversationTitle(conversation, currentUserId)
  const peerPresence = peer ? (presence[peer.user_id] ?? { online: false, last_seen_at: null }) : null
  const disabledNotice = !canCompose
    ? (e2eeNotice ?? 'End-to-end encryption is unavailable on this device, so sending is disabled.')
    : keyState === 'unavailable'
      ? (keyError ?? 'Encrypted message — key unavailable on this device.')
      : null

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Thread header */}
      <div className="flex shrink-0 items-center gap-2.5 border-b border-border/60 pb-3">
        <button
          type="button"
          onClick={onBack}
          aria-label="Back to chats"
          className={cn('rounded-lg p-1.5 text-text3 transition-colors hover:bg-gold/5 hover:text-gold', focusRing)}
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        {peer ? (
          <EmojiAvatar emoji={peer.avatar_emoji} name={title} size="sm" presence={peerPresence} />
        ) : (
          <span
            aria-hidden
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border bg-surface2 text-text2"
          >
            <Users className="h-3.5 w-3.5" />
          </span>
        )}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13.5px] font-semibold text-text">{title}</span>
          <span className="block truncate font-mono text-[10px] text-text3">
            {peer
              ? peerPresence?.online
                ? 'Online now'
                : formatLastSeen(peerPresence?.last_seen_at)
              : `${conversation.member_ids.length} people`}
          </span>
        </span>
        <span
          title="Messages are end-to-end encrypted"
          className="inline-flex shrink-0 items-center gap-1 font-mono text-[9.5px] uppercase tracking-[0.14em] text-text3"
        >
          <Lock className="h-3 w-3" aria-hidden />
          E2EE
        </span>
      </div>

      {/* Messages */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="chat-scroll min-h-0 flex-1 overflow-y-auto py-4"
        aria-label="Messages"
      >
        {loadingInitial && view.length === 0 ? (
          <div className="flex items-center gap-2.5 py-3">
            <div className="thinking-ring" />
            <span className="text-[11px] tracking-wide text-text2">Opening secure chat…</span>
          </div>
        ) : view.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-4 text-center">
            <Lock className="h-5 w-5 text-text3" aria-hidden />
            <p className="max-w-[240px] text-[12.5px] leading-relaxed text-text3">
              This conversation is end-to-end encrypted. Say hello — only members&apos; devices can read it.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-1.5">
            {view.map((m, i) => {
              const prev = view[i - 1]
              const newDay = !prev || dayLabel(prev.created_at) !== dayLabel(m.created_at)
              const own = m.sender_id === currentUserId
              const sender = membersById[m.sender_id]
              const showSender = isGroup && !own && (!prev || prev.sender_id !== m.sender_id || newDay)
              return (
                <div key={m.seq}>
                  {newDay && (
                    <div className="my-3 flex items-center gap-3">
                      <span className="h-px flex-1 bg-border" aria-hidden />
                      <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-text3">
                        {dayLabel(m.created_at)}
                      </span>
                      <span className="h-px flex-1 bg-border" aria-hidden />
                    </div>
                  )}
                  <div className={cn('flex', own ? 'justify-end' : 'justify-start')}>
                    <div className={cn('max-w-[82%]', !own && isGroup && 'flex items-end gap-2')}>
                      {!own && isGroup && (
                        <span className="mb-4 shrink-0" aria-hidden={!showSender}>
                          {showSender && sender ? (
                            <EmojiAvatar emoji={sender.avatar_emoji} name={sender.name || sender.handle} size="sm" />
                          ) : (
                            <span className="inline-block w-8" />
                          )}
                        </span>
                      )}
                      <div className="min-w-0">
                        {showSender && sender && (
                          <p className="mb-0.5 ml-1 font-mono text-[10.5px] text-gold">@{sender.handle}</p>
                        )}
                        {m.locked ? (
                          <div
                            className={cn(
                              'flex items-center gap-1.5 rounded-2xl border border-dashed border-border px-3.5 py-2.5',
                              own ? 'rounded-br-md' : 'rounded-bl-md',
                            )}
                          >
                            <Lock className="h-3 w-3 shrink-0 text-text3" aria-hidden />
                            <span className="text-[12px] italic text-text3">
                              Encrypted message — key unavailable on this device
                            </span>
                          </div>
                        ) : m.msg_type === 'image' && m.imageUrl ? (
                          <div
                            className={cn(
                              'overflow-hidden rounded-2xl border border-border',
                              own ? 'rounded-br-md' : 'rounded-bl-md',
                            )}
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={m.imageUrl}
                              alt={`Photo from ${own ? 'you' : sender ? `@${sender.handle}` : 'a member'}`}
                              className="max-h-72 w-full object-cover"
                              loading="lazy"
                            />
                          </div>
                        ) : (
                          <div
                            className={cn(
                              'whitespace-pre-wrap break-words rounded-2xl px-3.5 py-2.5 text-[13px] leading-relaxed',
                              own
                                ? 'rounded-br-md bg-[var(--bubble-user)] text-[var(--text-primary)]'
                                : 'rounded-bl-md border border-border bg-surface text-text',
                            )}
                          >
                            {m.text}
                          </div>
                        )}
                        <p className={cn('mt-0.5 font-mono text-[9.5px] text-text3', own ? 'mr-1 text-right' : 'ml-1')}>
                          {timeLabel(m.created_at)}
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Composer */}
      <div className="shrink-0 border-t border-border/60 pt-3">
        {disabledNotice && (
          <p className="mb-2 flex items-start gap-1.5 rounded-xl border border-border bg-surface2/60 px-3 py-2 text-[11.5px] leading-relaxed text-text2">
            <Lock className="mt-0.5 h-3 w-3 shrink-0 text-text3" aria-hidden />
            {disabledNotice}
          </p>
        )}
        {sendError && (
          <p className="mb-1.5 ml-1 text-[11.5px] text-danger" role="alert">
            {sendError}
          </p>
        )}
        <form
          onSubmit={(e) => {
            e.preventDefault()
            void sendText()
          }}
        >
          <div
            className={cn(
              'flex items-center gap-1.5 rounded-full border border-border bg-surface/90 px-2 py-1 transition-[border-color,box-shadow]',
              'focus-within:border-gold/60 focus-within:ring-2 focus-within:ring-gold/25',
              !composerEnabled && 'opacity-60',
            )}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0]
                e.target.value = ''
                if (file) void sendImage(file)
              }}
            />
            <button
              type="button"
              disabled={!composerEnabled || sending}
              onClick={() => fileInputRef.current?.click()}
              aria-label="Attach a photo"
              title="Attach a photo (encrypted)"
              className={cn(
                'flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-text3 transition-colors hover:bg-gold/10 hover:text-gold disabled:cursor-not-allowed disabled:opacity-40',
                focusRing,
              )}
            >
              <ImagePlus className="h-4 w-4" />
            </button>
            {onSharePin && (
              <button
                type="button"
                disabled={!composerEnabled || sending}
                onClick={() => onSharePin(convId)}
                aria-label="Share a place"
                title="Share a saved place with this chat"
                className={cn(
                  'flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-text3 transition-colors hover:bg-gold/10 hover:text-gold disabled:cursor-not-allowed disabled:opacity-40',
                  focusRing,
                )}
              >
                <MapPin className="h-4 w-4" />
              </button>
            )}
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              disabled={!composerEnabled}
              placeholder={composerEnabled ? 'Encrypted message…' : 'Sending disabled'}
              aria-label="Message"
              className="min-w-0 flex-1 bg-transparent px-1 py-2 font-sans text-[13.5px] text-text outline-none placeholder:text-text3 disabled:cursor-not-allowed"
            />
            <button
              type="submit"
              disabled={!composerEnabled || sending || !input.trim()}
              aria-label="Send message"
              className={cn(
                'flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gold text-white shadow-[0_2px_10px_rgba(245,106,0,0.35)] transition-all duration-150 hover:bg-brand-dark disabled:opacity-40 disabled:shadow-none',
                focusRing,
              )}
            >
              <Send className="h-3.5 w-3.5" />
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
