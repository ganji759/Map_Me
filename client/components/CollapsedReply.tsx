'use client'

import { useEffect, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { ChevronDown } from 'lucide-react'

const LONG_LINE_THRESHOLD = 8
const PREVIEW_LINES = 4

/**
 * Reveals `target` left-to-right like a typewriter, independent of how the
 * underlying text arrives (Gemini streams in large bursts, so without this the
 * reply just pops in). The reveal decelerates as it catches up — fast when a
 * big chunk lands, settling smoothly at the end — and keeps tracking the target
 * as it grows mid-stream. Disabled (returns the full string) when not animating
 * or when the user prefers reduced motion. No sound; purely visual.
 */
function useTypewriter(target: string, enabled: boolean): string {
  const [count, setCount] = useState(enabled ? 0 : target.length)
  const targetRef = useRef(target)
  targetRef.current = target

  useEffect(() => {
    if (!enabled) {
      setCount(target.length)
      return
    }
    let raf = 0
    const tick = () => {
      setCount((prev) => {
        const full = targetRef.current.length
        if (prev >= full) return prev
        const remaining = full - prev
        // Calm, readable pace: ~1 char min per frame, a little faster the
        // further behind we are so large bursts still catch up smoothly.
        const step = Math.max(1, Math.ceil(remaining / 34))
        return Math.min(full, prev + step)
      })
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled])

  if (!enabled) return target
  return target.slice(0, Math.min(count, target.length))
}

function lineCount(text: string): number {
  return text.split('\n').length
}

function previewText(text: string): string {
  const lines = text.split('\n')
  if (lines.length <= PREVIEW_LINES) return `${text.slice(0, 400).trim()}…`
  return `${lines.slice(0, PREVIEW_LINES).join('\n').trim()}…`
}

interface CollapsibleMessageProps {
  content: string
  streaming?: boolean
  showCaret?: boolean
  /** Type this reply out left-to-right (the active/last assistant message). */
  animate?: boolean
}

/** Long assistant replies — full text by default; collapse only past 8 lines. */
export function CollapsibleMessage({ content, streaming = false, showCaret = false, animate = false }: CollapsibleMessageProps) {
  const reduced = useReducedMotion()
  const [expanded, setExpanded] = useState(true)

  const revealed = useTypewriter(content, animate && !reduced)
  const typing = revealed.length < content.length

  const long = lineCount(content) > LONG_LINE_THRESHOLD
  // While typing we always show the growing text (expanded); collapse only once
  // the full reply has landed and settled.
  const visible = !long || expanded || typing ? revealed : previewText(content)
  const caret = showCaret || typing

  return (
    <div>
      <AnimatePresence mode="wait">
        <motion.div
          key={expanded ? 'open' : 'closed'}
          initial={reduced ? false : { height: 'auto', opacity: 0.85 }}
          animate={{ height: 'auto', opacity: 1 }}
          exit={reduced ? undefined : { opacity: 0.85 }}
          transition={{ duration: reduced ? 0 : 0.25, ease: [0.22, 1, 0.36, 1] }}
        >
          <div className="prose-hodari w-full text-left text-[14px] leading-relaxed text-[var(--text-primary)]">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{visible}</ReactMarkdown>
            {caret && <span className="stream-caret stream-caret-fade" aria-hidden />}
          </div>
        </motion.div>
      </AnimatePresence>
      {long && !streaming && !typing && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-2 flex items-center gap-1 text-[11px] font-medium text-[#F56A00] transition-colors hover:text-[#D45400] dark:text-[#FF8C2F] dark:hover:text-[#FFA94D]"
        >
          {expanded ? 'Show less' : 'Show more'}
          <ChevronDown className={`h-3 w-3 transition-transform ${expanded ? 'rotate-180' : ''}`} />
        </button>
      )}
    </div>
  )
}

interface CollapsedReplyProps {
  content: string | null
  loading: boolean
  streaming: boolean
  onOpen: () => void
  /** Voice + map uses a separate bottom-right Open chat button. */
  hideOpenChat?: boolean
}

// Compact floating card when chat is collapsed over the map.
export function CollapsedReply({ content, loading, streaming, onOpen, hideOpenChat }: CollapsedReplyProps) {
  const showThinking = loading && !streaming && !content

  return (
    <div className="pointer-events-auto absolute left-4 top-4 z-20 w-[340px] max-w-[80vw] animate-fade-up overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--bg-header)]/95 shadow-[0_8px_30px_rgba(0,0,0,0.12)] backdrop-blur-md dark:shadow-[0_8px_30px_rgba(0,0,0,0.5)]">
      <div className="flex items-center justify-between border-b border-[var(--border)] px-4 py-2.5">
        <span className="text-[11px] font-medium uppercase tracking-wider text-[#F56A00] dark:text-[#FF8C2F]">Hodari</span>
        {!hideOpenChat && (
          <button
            type="button"
            onClick={onOpen}
            title="Open full chat"
            className="text-[11px] text-gray-500 transition-colors hover:text-[#F56A00] dark:text-gray-400 dark:hover:text-[#FF8C2F]"
          >
            Open chat
          </button>
        )}
      </div>

      <div className="scrollbar-hide max-h-[42vh] overflow-y-auto px-4 py-3">
        {showThinking ? (
          <div className="flex items-center gap-2.5 py-1">
            <div className="thinking-ring" />
            <span className="text-[11px] tracking-wide text-gray-500">Thinking…</span>
          </div>
        ) : content ? (
          <CollapsibleMessage content={content} streaming={streaming} showCaret={streaming} animate={streaming} />
        ) : (
          <p className="text-[14px] leading-relaxed text-gray-500">
            Tap the mic and ask me anything — your reply shows up here.
          </p>
        )}
      </div>
    </div>
  )
}
