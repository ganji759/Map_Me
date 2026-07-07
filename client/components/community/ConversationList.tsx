'use client'

/**
 * ConversationList — the Chats tab: every conversation the user belongs to,
 * newest activity first (server order), with unread dot, DM presence dot,
 * and a "New group" action. Selecting a row opens the thread in the panel.
 */
import { Users, Plus, MessageSquare } from 'lucide-react'
import { cn } from '@/lib/design/cn'
import { focusRing } from '@/lib/design/tokens'
import type { ConversationSummary, PresenceInfo, UserAttribution } from '@/lib/community'
import { conversationTitle, formatWhen } from '@/lib/communityClient'
import { EmojiAvatar } from './EmojiAvatar'

export interface ConversationListProps {
  conversations: ConversationSummary[] | null
  presence: Record<string, PresenceInfo>
  currentUserId: string
  onOpen: (conversation: ConversationSummary) => void
  onNewGroup: () => void
  /** False while E2EE is unavailable — group creation is disabled. */
  canCompose: boolean
}

function dmPeer(conv: ConversationSummary, currentUserId: string): UserAttribution | null {
  if (conv.type !== 'dm') return null
  return conv.members.find((m) => m.user_id !== currentUserId) ?? null
}

export function ConversationList({
  conversations,
  presence,
  currentUserId,
  onOpen,
  onNewGroup,
  canCompose,
}: ConversationListProps) {
  return (
    <div className="flex flex-col gap-3">
      <button
        type="button"
        onClick={onNewGroup}
        disabled={!canCompose}
        title={canCompose ? 'Start a group chat with your connections' : 'Encrypted chat unavailable on this device'}
        className={cn(
          'inline-flex h-9 items-center justify-center gap-1.5 self-start rounded-full border border-gold/40 px-3.5 text-[12px] font-medium text-gold transition-colors hover:bg-gold/10 disabled:cursor-not-allowed disabled:opacity-40',
          focusRing,
        )}
      >
        <Plus className="h-3.5 w-3.5" aria-hidden />
        New group
      </button>

      {conversations === null ? (
        <div className="flex items-center gap-2.5 py-3">
          <div className="thinking-ring" />
          <span className="text-[11px] tracking-wide text-text2">Loading chats…</span>
        </div>
      ) : conversations.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border px-4 py-8 text-center">
          <MessageSquare className="h-5 w-5 text-text3" aria-hidden />
          <p className="max-w-[240px] text-[12.5px] leading-relaxed text-text3">
            No chats yet. Message a connection, or start a group.
          </p>
        </div>
      ) : (
        <ul className="flex flex-col gap-1.5" aria-label="Conversations">
          {conversations.map((conv) => {
            const peer = dmPeer(conv, currentUserId)
            const title = conversationTitle(conv, currentUserId)
            const memberCount = conv.member_ids.length
            return (
              <li key={conv.conversation_id}>
                <button
                  type="button"
                  onClick={() => onOpen(conv)}
                  className={cn(
                    'flex w-full items-center gap-3 rounded-xl border border-transparent px-2.5 py-2.5 text-left transition-colors hover:border-border hover:bg-surface',
                    focusRing,
                  )}
                >
                  {peer ? (
                    <EmojiAvatar
                      emoji={peer.avatar_emoji}
                      name={title}
                      size="md"
                      presence={presence[peer.user_id] ?? { online: false, last_seen_at: null }}
                    />
                  ) : (
                    <span
                      aria-hidden
                      className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-border bg-surface2 text-text2"
                    >
                      <Users className="h-4 w-4" />
                    </span>
                  )}

                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline justify-between gap-2">
                      <span
                        className={cn(
                          'truncate text-[13.5px]',
                          conv.unread ? 'font-semibold text-text' : 'font-medium text-text',
                        )}
                      >
                        {title}
                      </span>
                      <span className="shrink-0 font-mono text-[10px] text-text3">
                        {formatWhen(conv.last_message_at ?? conv.created_at)}
                      </span>
                    </span>
                    <span className="mt-0.5 flex items-center gap-1.5">
                      <span className="truncate text-[11.5px] text-text3">
                        {conv.type === 'dm'
                          ? peer
                            ? `@${peer.handle}`
                            : 'Direct message'
                          : conv.type === 'pin'
                            ? `Pin chat · ${memberCount} people`
                            : `${memberCount} people`}
                      </span>
                      {conv.unread && (
                        <span
                          aria-label="Unread messages"
                          role="img"
                          className="h-1.5 w-1.5 shrink-0 rounded-full bg-gold"
                        />
                      )}
                    </span>
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
