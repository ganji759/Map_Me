'use client'

import { Check } from 'lucide-react'

const DOT_TONES = ['#FFA94D', '#FF8C2F', '#F56A00']

/** Three bouncing brand-orange dots — the wave animation reused below. */
function WaveDots() {
  return (
    <span className="inline-flex items-center gap-1.5">
      {DOT_TONES.map((tone, i) => (
        <span
          key={tone}
          className="typing-dot h-2 w-2 rounded-full"
          style={{ backgroundColor: tone, animationDelay: `${i * 0.18}s` }}
        />
      ))}
    </span>
  )
}

const TYPING_STYLE = `
  .typing-dot {
    opacity: 0.5;
    animation: typing-bounce 1.2s ease-in-out infinite;
  }
  @keyframes typing-bounce {
    0%, 60%, 100% { transform: translateY(0); opacity: 0.5; }
    30% { transform: translateY(-5px); opacity: 1; }
  }
  @media (prefers-reduced-motion: reduce) {
    .typing-dot { animation: none; opacity: 0.8; }
  }
`

/** Assistant-style bubble with three bouncing brand-orange dots. */
export function TypingIndicator() {
  return (
    <div
      className="inline-flex items-center gap-1.5 rounded-2xl rounded-tl-md border border-gray-200/80 bg-white px-4 py-3.5 shadow-[0_2px_12px_rgba(0,0,0,0.05)] dark:border-white/[0.08] dark:bg-[#15151a] dark:shadow-[0_2px_12px_rgba(0,0,0,0.45)]"
      aria-label="Hodari is thinking"
    >
      <WaveDots />
      <style>{TYPING_STYLE}</style>
    </div>
  )
}

/** Drop a leading status glyph the backend may prepend (✓, •, -) so the active
 *  step reads as in-progress rather than already-done. */
function cleanLabel(label: string): string {
  return label.replace(/^[\s✓✔•\-–]+/, '').trim()
}

/**
 * Live "thinking" trace: each pipeline step the AI reports becomes a line.
 * Finished steps get a check; the most recent step is the current action and
 * shows the animated wave dots after its text — text, dots, then the next text,
 * until generation finishes. Falls back to plain dots before any step arrives.
 */
export function ThinkingTrace({ steps }: { steps: string[] }) {
  const cleaned = steps.map(cleanLabel).filter(Boolean)
  if (cleaned.length === 0) return <TypingIndicator />

  const current = cleaned[cleaned.length - 1]
  const done = cleaned.slice(0, -1)

  return (
    <div
      className="inline-flex max-w-full flex-col gap-1.5 rounded-2xl rounded-tl-md border border-gray-200/80 bg-white px-4 py-3 shadow-[0_2px_12px_rgba(0,0,0,0.05)] dark:border-white/[0.08] dark:bg-[#15151a] dark:shadow-[0_2px_12px_rgba(0,0,0,0.45)]"
      aria-label={`Hodari is ${current}`}
      aria-live="polite"
    >
      {done.map((label, i) => (
        <div
          key={`${label}-${i}`}
          className="flex items-center gap-2 text-[12.5px] text-gray-400 dark:text-gray-500"
        >
          <Check className="h-3.5 w-3.5 shrink-0 text-[#1FA463]" />
          <span className="truncate">{label}</span>
        </div>
      ))}
      <div className="flex items-center gap-2 text-[13px] font-medium text-gray-800 dark:text-gray-100">
        <span>{current}</span>
        <WaveDots />
      </div>
      <style>{TYPING_STYLE}</style>
    </div>
  )
}
