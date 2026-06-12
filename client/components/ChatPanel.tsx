'use client'

import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import {
  Bookmark,
  ChevronDown,
  History,
  Map as MapIcon,
  MapPin,
  Menu,
  MessageSquare,
  Mic,
  Moon,
  PanelLeftClose,
  PanelRightClose,
  Send,
  Square,
  Sun,
  Trash2,
  Volume2,
  VolumeX,
} from 'lucide-react'
import type { ChatMessage, Theme } from '@/lib/types'
import type { MapSnapshot } from '@/lib/mapHistory'
import type { VoiceState } from '@/hooks/useVoice'
import { ModelSwitcher, type ModelId } from './ModelSwitcher'
import { CollapsibleMessage } from './CollapsedReply'
import { TypingIndicator } from './TypingIndicator'
import { OpenMapButton } from './OpenMapButton'

interface Props {
  messages: ChatMessage[]
  loading: boolean
  thinkingSteps: string[]
  streamingStarted: boolean
  onSend: (text: string) => void
  /** Single shared voice instance, owned by the parent (avoids duplicate recorders). */
  voiceState?: VoiceState
  voiceSupported?: boolean
  voiceWarning?: string
  voiceLiveText?: string
  onVoiceToggle?: () => void
  /** Stops everything: dictation, speech output, and the in-flight request. */
  onVoiceStop?: () => void
  historyItems: Array<{ id: string; title: string; updatedAt: number }>
  mapArchive?: MapSnapshot[]
  onSelectMapArchive?: (id: string) => void
  onNewChat: () => void
  onSelectHistory: (id: string) => void
  onDeleteHistory?: (id: string) => void
  mapExpanded: boolean
  mapVisible: boolean
  hasMapData: boolean
  onOpenMapPanel: () => void
  onExpandMap: () => void
  onCollapseMap: () => void
  onOpenMapFromMessage: (message: ChatMessage) => void
  onToggleMapPanel?: () => void
  selectedModel: ModelId
  onModelChange: (id: ModelId) => void
  theme: Theme
  onToggleTheme: () => void
  hasLocation: boolean
  speakReplies?: boolean
  speechOutSupported?: boolean
  onToggleSpeakReplies?: () => void
  onCollapse?: () => void
  onStop?: () => void
  uiMode?: 'chat' | 'voice'
  onEnterChatMode?: () => void
  onEnterVoiceMode?: () => void
}

const CHIPS = [
  '4 hours in Kigali under $60',
  'Vegetarian food nearby',
  'Best food and sights nearby',
  'Plan my trip today',
]

export function ChatPanel({
  messages,
  loading,
  streamingStarted,
  onSend,
  voiceState = 'idle',
  voiceSupported = false,
  voiceWarning,
  voiceLiveText,
  onVoiceToggle,
  onVoiceStop,
  historyItems,
  onNewChat,
  onSelectHistory,
  onDeleteHistory,
  mapArchive = [],
  onSelectMapArchive,
  hasMapData,
  mapVisible,
  onOpenMapPanel,
  onExpandMap,
  onCollapseMap,
  mapExpanded,
  onOpenMapFromMessage,
  onToggleMapPanel,
  selectedModel,
  onModelChange,
  theme,
  onToggleTheme,
  hasLocation,
  speakReplies,
  speechOutSupported,
  onToggleSpeakReplies,
  onCollapse,
  onStop,
  uiMode = 'chat',
  onEnterChatMode,
  onEnterVoiceMode,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const autoScrollRef = useRef(true)
  const [atBottom, setAtBottom] = useState(true)
  const [hasNewBelow, setHasNewBelow] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [historyQuery, setHistoryQuery] = useState('')
  const [caretVisible, setCaretVisible] = useState(false)
  const reduced = useReducedMotion()

  const streaming = loading && streamingStarted
  const voiceActive = voiceState !== 'idle'
  const lastMsgId = messages[messages.length - 1]?.id
  const showThinking = loading && !streamingStarted
  const showWriting = streaming
  const isEmpty = messages.length === 0 && !loading

  const visibleHistoryItems = historyQuery.trim()
    ? historyItems.filter((item) =>
        item.title.toLowerCase().includes(historyQuery.trim().toLowerCase()),
      )
    : historyItems

  function handleScroll() {
    const el = scrollRef.current
    if (!el) return
    const nextAtBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80
    autoScrollRef.current = nextAtBottom
    setAtBottom(nextAtBottom)
    if (nextAtBottom) setHasNewBelow(false)
  }

  function scrollToBottom(behavior: ScrollBehavior = 'smooth') {
    const el = scrollRef.current
    if (el) el.scrollTo({ top: el.scrollHeight, behavior })
    else bottomRef.current?.scrollIntoView({ behavior })
    autoScrollRef.current = true
    setAtBottom(true)
    setHasNewBelow(false)
  }

  useEffect(() => {
    const last = messages[messages.length - 1]
    if (last?.role === 'user') {
      autoScrollRef.current = true
      setAtBottom(true)
      setHasNewBelow(false)
    }
    if (autoScrollRef.current) {
      requestAnimationFrame(() => scrollToBottom(reduced ? 'auto' : 'smooth'))
    } else if (loading || messages.length) {
      setHasNewBelow(true)
    }
  }, [messages, loading, streamingStarted, reduced])

  useEffect(() => {
    if (streaming) setCaretVisible(true)
    else if (caretVisible) {
      const t = setTimeout(() => setCaretVisible(false), 400)
      return () => clearTimeout(t)
    }
  }, [streaming, caretVisible])

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const text = inputRef.current?.value.trim()
    if (!text || loading) return
    autoScrollRef.current = true
    setAtBottom(true)
    onSend(text)
    inputRef.current!.value = ''
  }

  const composer = (
    <div className="mx-auto w-full max-w-[720px]">
      {hasMapData && onToggleMapPanel && (
        <div className="mb-2 flex justify-center">
          <button
            type="button"
            onClick={onToggleMapPanel}
            className="flex items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--bg-header)] px-3 py-1.5 text-xs font-medium text-[var(--text-secondary)] shadow-sm transition-colors hover:border-amber-300 hover:bg-amber-50 dark:hover:bg-amber-900/20"
          >
            {mapVisible && !mapExpanded ? (
              <>
                <PanelRightClose className="h-3.5 w-3.5" />
                Hide map
              </>
            ) : (
              <>
                <MapIcon className="h-3.5 w-3.5" />
                Show map
              </>
            )}
          </button>
        </div>
      )}
      {hasLocation && (
        <p className="mb-2 ml-1 flex items-center gap-1 text-[11px] font-medium uppercase tracking-wider text-[#e07d3a]">
          <MapPin className="h-3 w-3" />
          Location active
        </p>
      )}
      {voiceState === 'listening' && voiceLiveText && (
        <p className="mb-1.5 ml-1 truncate text-[12px] italic text-[var(--text-secondary)]">
          “{voiceLiveText}”
        </p>
      )}
      {voiceWarning && voiceState === 'idle' && (
        <p className="mb-1.5 ml-1 text-[11px] text-[var(--text-secondary)]">{voiceWarning}</p>
      )}
      <form onSubmit={handleSubmit}>
        <div
          className={`flex items-center gap-2 rounded-full border bg-[var(--bg-header)] px-4 py-1 shadow-sm focus-within:border-amber-400 ${
            voiceActive ? 'border-amber-400/70' : 'border-[var(--border)]'
          }`}
        >
          {voiceSupported && onVoiceToggle && (
            <button
              type="button"
              onClick={onVoiceToggle}
              disabled={loading && voiceState === 'idle'}
              aria-label={voiceState === 'listening' ? 'Stop listening and send' : 'Start voice input'}
              title={voiceState === 'listening' ? 'Stop listening and send' : 'Start voice input'}
              className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-colors disabled:opacity-40 ${
                voiceState === 'listening'
                  ? 'bg-red-500 text-white'
                  : 'text-gray-500 hover:bg-amber-50 hover:text-amber-600 dark:hover:bg-amber-900/30'
              }`}
            >
              <Mic className="h-4 w-4" />
            </button>
          )}
          <input
            ref={inputRef}
            type="text"
            placeholder={
              voiceState === 'listening' ? 'Listening…'
              : voiceState === 'thinking' ? 'Thinking…'
              : voiceState === 'speaking' ? 'Hodari is speaking…'
              : voiceState === 'paused' ? 'Paused — tap Stop or the mic'
              : 'Time, budget, preferences, location…'
            }
            className={`min-w-0 flex-1 bg-transparent py-3 text-[13px] text-[var(--text-primary)] outline-none ${
              voiceActive ? 'placeholder:text-amber-600/80' : 'placeholder:text-[var(--text-secondary)]'
            }`}
            disabled={loading}
          />
          {(loading || voiceActive) && (onStop || onVoiceStop) ? (
            <button
              type="button"
              onClick={() => { onVoiceStop?.(); if (!onVoiceStop) onStop?.() }}
              aria-label="Stop"
              title="Stop voice and generation"
              className="flex h-9 shrink-0 items-center gap-1.5 rounded-full bg-red-500 px-3.5 text-[12px] font-medium text-white transition-colors hover:bg-red-600"
            >
              <Square className="h-3 w-3 fill-current" />
              Stop
            </button>
          ) : (
            <button
              type="submit"
              disabled={loading}
              aria-label="Send message"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#e07d3a] text-white transition-colors hover:bg-[#c96a2e] disabled:opacity-40"
            >
              <Send className="h-4 w-4" />
            </button>
          )}
        </div>
      </form>
      {messages.length === 0 && (
        <div className="mt-3 flex flex-wrap justify-center gap-2">
          {CHIPS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => onSend(s)}
              className="rounded-full border border-[var(--border)] px-3.5 py-1.5 text-[13px] text-[var(--text-primary)] transition-colors hover:bg-amber-50 dark:hover:bg-amber-900/30"
            >
              {s}
            </button>
          ))}
        </div>
      )}
    </div>
  )

  const messageList = (
    <>
      <div className="relative min-h-0 overflow-hidden">
        <div ref={scrollRef} onScroll={handleScroll} className="chat-scroll h-full min-h-0 overflow-y-auto px-4 py-5 sm:px-6">
          <div className="mx-auto w-full max-w-[720px] space-y-5">
            {isEmpty && (
              <div className="flex flex-col items-center px-2 pb-6 pt-[8vh] text-center sm:pt-[10vh]">
                <p className="font-display text-5xl font-semibold italic text-amber-600/20">Where to?</p>
                <p className="mx-auto mt-5 max-w-sm text-[13px] leading-relaxed text-[var(--text-secondary)]">
                  Tell me your time, budget, and preferences, and I&apos;ll build your matchday plan.
                </p>
              </div>
            )}

            {messages.map((msg) => (
            <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              {msg.role === 'user' ? (
                <div className="animate-slide-right max-w-[min(680px,90%)] rounded-2xl rounded-br-[4px] bg-[#e07d3a] px-3.5 py-2.5">
                  <p className="text-[13px] leading-relaxed text-white">{msg.content}</p>
                </div>
              ) : (
                <div className="w-full max-w-[min(680px,100%)] text-left">
                  <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wider text-[#e07d3a]">
                    Hodari
                  </p>
                  <div className="animate-slide-left w-full py-1 pl-0.5">
                    {msg.content ? (
                      <CollapsibleMessage
                        content={msg.content}
                        streaming={streaming && msg.id === lastMsgId}
                        showCaret={caretVisible && streaming && msg.id === lastMsgId}
                      />
                    ) : (
                      <TypingIndicator />
                    )}
                  </div>
                  {showWriting && msg.id === lastMsgId && (
                    <p className="animate-fade-up mt-1.5 ml-0.5 text-[11px] text-[var(--text-secondary)]">
                      Hodari is writing…
                    </p>
                  )}
                  {(msg.places?.length || msg.itinerary?.stops?.length) ? (
                    <OpenMapButton
                      message={msg}
                      mapVisible={mapVisible}
                      onOpen={() => onOpenMapFromMessage(msg)}
                    />
                  ) : null}
                </div>
              )}
            </div>
          ))}

          {showThinking && (
            <div className="flex justify-start">
              <div className="w-full max-w-[min(680px,100%)]">
                <p className="mb-1.5 ml-0.5 text-[11px] font-medium uppercase tracking-wider text-[#e07d3a]">
                  Hodari
                </p>
                <div className="animate-fade-up py-1">
                  <TypingIndicator />
                </div>
              </div>
            </div>
          )}

            <div ref={bottomRef} />
          </div>
        </div>

        <AnimatePresence>
          {(!atBottom || hasNewBelow) && messages.length > 0 && (
            <motion.button
              type="button"
              initial={reduced ? false : { opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={reduced ? undefined : { opacity: 0, y: 8 }}
              transition={{ duration: reduced ? 0 : 0.2 }}
              onClick={() => scrollToBottom(reduced ? 'auto' : 'smooth')}
              className="absolute bottom-4 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-[var(--border)] bg-[var(--bg-header)]/95 px-4 py-1.5 text-[13px] text-[var(--text-primary)] shadow-lg backdrop-blur-sm hover:border-amber-300"
            >
              <ChevronDown className="h-4 w-4" />
              New message
            </motion.button>
          )}
        </AnimatePresence>
      </div>

      <div className="relative z-10 shrink-0 border-t border-[var(--border)] bg-[var(--bg-chat)]/95 px-4 py-4 backdrop-blur-md sm:px-6">
        {composer}
      </div>
    </>
  )

  const modeToggle = onEnterChatMode && onEnterVoiceMode ? (
    <div className="flex items-center gap-1 rounded-full border border-[var(--border)] bg-[var(--bg-header)]/90 p-1 shadow-sm backdrop-blur-sm">
      <button
        type="button"
        onClick={onEnterChatMode}
        aria-pressed={uiMode === 'chat'}
        className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-medium transition-colors sm:px-3.5 sm:text-[12px] ${
          uiMode === 'chat' ? 'bg-amber-600 text-white shadow' : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
        }`}
      >
        <MessageSquare className="h-3.5 w-3.5" />
        Chat
      </button>
      <button
        type="button"
        onClick={onEnterVoiceMode}
        aria-pressed={uiMode === 'voice'}
        className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-medium transition-colors sm:px-3.5 sm:text-[12px] ${
          uiMode === 'voice' ? 'bg-amber-600 text-white shadow' : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
        }`}
      >
        <Mic className="h-3.5 w-3.5" />
        Voice
      </button>
    </div>
  ) : null

  return (
    <div className="relative flex h-full flex-col overflow-hidden bg-transparent">
      {historyOpen && (
        <button
          type="button"
          aria-label="Close chat history"
          onClick={() => setHistoryOpen(false)}
          className="fixed inset-0 z-[49] md:hidden"
          style={{ backgroundColor: 'rgba(0, 0, 0, 0.15)' }}
        />
      )}

      <aside
        aria-hidden={!historyOpen}
        className={`fixed left-0 top-0 z-50 h-full w-[240px] border-r border-[var(--border)] shadow-2xl transition-transform duration-[220ms] ease ${
          historyOpen ? 'translate-x-0' : '-translate-x-full pointer-events-none'
        }`}
        style={{ backgroundColor: theme === 'dark' ? '#1A1612' : '#fdf3ee' }}
      >
        <div className="flex items-center justify-between border-b border-[var(--border)] px-4 py-3">
          <span className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-[var(--text-secondary)] dark:text-gray-200">
            <History className="h-3.5 w-3.5" /> History
          </span>
          <button type="button" onClick={() => setHistoryOpen(false)} className="text-[var(--text-secondary)] hover:text-amber-600">
            ×
          </button>
        </div>
        <div className="p-3">
          <input
            type="search"
            value={historyQuery}
            onChange={(e) => setHistoryQuery(e.target.value)}
            placeholder="Search chats…"
            className="mb-3 w-full rounded-lg border border-[var(--border)] bg-[var(--bg-header)] px-3 py-2 text-[13px] text-[var(--text-primary)] outline-none focus:border-amber-400 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200"
          />
          <button
            type="button"
            onClick={() => { onNewChat(); setHistoryOpen(false) }}
            className="w-full rounded-lg border border-[var(--border)] px-3 py-2 text-left text-[11px] uppercase tracking-wider text-[var(--text-primary)] hover:border-amber-300 hover:bg-amber-50 dark:border-amber-500 dark:text-amber-400 dark:hover:bg-amber-900/20"
          >
            New chat
          </button>
          <a
            href="/saved"
            onClick={() => setHistoryOpen(false)}
            className="mt-2 flex w-full items-center gap-2 rounded-lg border border-[var(--border)] px-3 py-2 text-[11px] uppercase tracking-wider text-[var(--text-primary)] transition-colors hover:border-amber-300 hover:bg-amber-50 dark:text-amber-400 dark:hover:bg-amber-900/20"
          >
            <Bookmark className="h-3.5 w-3.5 shrink-0" />
            Saved places
          </a>
          {mapArchive.length > 0 && (
            <div className="mt-5 border-t border-[var(--border)] pt-4">
              <p className="mb-2 flex items-center gap-1.5 px-1 text-[10px] font-medium uppercase tracking-wider text-amber-600">
                <MapIcon className="h-3 w-3" /> Saved maps (kept on device)
              </p>
              <div className="max-h-40 space-y-1.5 overflow-y-auto">
                {mapArchive.slice(0, 12).map((snap) => (
                  <button
                    key={snap.id}
                    type="button"
                    onClick={() => { onSelectMapArchive?.(snap.id); setHistoryOpen(false) }}
                    className="w-full rounded-lg border border-[var(--border)] px-3 py-2 text-left transition-colors hover:border-amber-300 hover:bg-amber-50/80 dark:hover:bg-amber-900/20"
                  >
                    <p className="truncate text-[12px] font-medium text-[var(--text-primary)]">{snap.title}</p>
                    <p className="text-[10px] text-[var(--text-secondary)]">
                      {new Date(snap.savedAt).toLocaleDateString()}
                    </p>
                  </button>
                ))}
              </div>
            </div>
          )}
          <div className="mt-4 space-y-1.5">
            {visibleHistoryItems.length === 0 ? (
              <p className="px-1 text-[13px] text-[var(--text-secondary)]">No recent chats yet.</p>
            ) : (
              visibleHistoryItems.map((item) => (
                <div key={item.id} className="group relative">
                  <button
                    type="button"
                    onClick={() => { onSelectHistory(item.id); setHistoryOpen(false) }}
                    className="w-full rounded-lg px-2 py-2 pr-8 text-left hover:bg-amber-50 dark:text-gray-300 dark:hover:bg-amber-900/10"
                  >
                    <span className="block truncate text-[13px] text-[var(--text-primary)] dark:text-gray-300">{item.title}</span>
                    <span className="mt-0.5 block text-[11px] text-[var(--text-secondary)] dark:text-gray-500">
                      {new Date(item.updatedAt).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </button>
                  {onDeleteHistory && (
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); onDeleteHistory(item.id) }}
                      aria-label="Delete chat"
                      className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-1 text-[var(--text-secondary)] opacity-0 transition-opacity hover:text-red-500 group-hover:opacity-100"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      </aside>

      <div
        className={`flex min-h-0 flex-1 flex-col bg-transparent transition-[margin-left] duration-[220ms] ease ${
          historyOpen ? 'md:ml-[240px]' : 'md:ml-0'
        }`}
      >
        <div
          className="flex shrink-0 flex-wrap items-center justify-between gap-x-3 gap-y-2 bg-transparent px-4 pb-3 pt-3.5 sm:px-5"
          style={{ backgroundColor: theme === 'dark' ? 'rgba(26, 22, 18, 0.35)' : 'rgba(255, 255, 255, 0.3)' }}
        >
          <div className="flex min-w-0 flex-1 items-center gap-3 sm:gap-4">
            <div className="min-w-0">
              <h1 className="font-display text-lg font-semibold text-[var(--text-primary)]">Hodari</h1>
              <p className="mt-0.5 text-[11px] uppercase tracking-wider text-[var(--text-secondary)]">FIFA World Cup 2026 · Guide</p>
            </div>
            {modeToggle}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {speechOutSupported && onToggleSpeakReplies && (
              <button
                type="button"
                onClick={onToggleSpeakReplies}
                aria-label={speakReplies ? 'Mute spoken replies' : 'Speak replies aloud'}
                title={speakReplies ? 'Mute spoken replies' : 'Speak replies aloud'}
                className={`rounded-lg border p-1.5 transition-colors ${speakReplies ? 'border-amber-400/60 text-amber-600' : 'border-[var(--border)] text-[var(--text-secondary)] hover:border-amber-300 hover:text-amber-600'}`}
              >
                {speakReplies ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
              </button>
            )}
            <button
              type="button"
              onClick={onToggleTheme}
              aria-label="Toggle theme"
              className="rounded-lg border border-[var(--border)] p-1.5 text-[var(--text-secondary)] hover:border-amber-300 hover:text-amber-600"
            >
              {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </button>
            <button
              type="button"
              aria-label="Open chat history"
              onClick={() => setHistoryOpen((open) => !open)}
              className="rounded-lg border border-[var(--border)] p-1.5 text-[var(--text-secondary)] hover:border-amber-300 hover:text-amber-600"
            >
              <Menu className="h-4 w-4" />
            </button>
            {hasMapData && (
              <button
                type="button"
                onClick={() => {
                  if (mapExpanded) onCollapseMap()
                  else if (mapVisible) onExpandMap()
                  else onOpenMapPanel()
                }}
                className="flex items-center gap-1.5 rounded-lg border border-[var(--border)] px-3 py-1.5 text-[11px] uppercase tracking-wider text-[var(--text-secondary)] hover:border-amber-300"
              >
                <MapIcon className="h-3.5 w-3.5" />
                {mapExpanded ? 'Compact map' : mapVisible ? 'Full map' : 'Open map'}
              </button>
            )}
            <ModelSwitcher selected={selectedModel} onChange={onModelChange} />
            {onCollapse && (
              <button type="button" onClick={onCollapse} aria-label="Collapse chat" className="rounded-lg border border-[var(--border)] p-1.5 text-[var(--text-secondary)]">
                <PanelLeftClose className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>
        <div className="h-px shrink-0 bg-gradient-to-r from-transparent via-amber-200/40 to-transparent dark:via-amber-800/30" />

        <div className="relative grid min-h-0 flex-1 grid-rows-[1fr_auto] overflow-hidden">
          {messageList}
        </div>
      </div>
    </div>
  )
}
