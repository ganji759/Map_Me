'use client'

import { useState, useRef, useEffect } from 'react'

export type ModelId = 'gemini-3.5' | 'gpt-4o' | 'claude-opus-4'

export interface ModelConfig {
  id: ModelId
  name: string
  provider: 'Google' | 'OpenAI' | 'Anthropic'
  tag: string
  color: string
  dot: string
  available: boolean
}

export const MODELS: ModelConfig[] = [
  {
    id: 'gemini-3.5',
    name: 'Gemini 3.5',
    provider: 'Google',
    tag: 'Active',
    color: '#4285F4',
    dot: 'bg-[#4285F4]',
    available: true,
  },
  {
    id: 'gpt-4o',
    name: 'GPT-4o',
    provider: 'OpenAI',
    tag: 'Soon',
    color: '#10A37F',
    dot: 'bg-[#10A37F]',
    available: false,
  },
  {
    id: 'claude-opus-4',
    name: 'Claude Opus 4',
    provider: 'Anthropic',
    tag: 'Soon',
    color: '#F56A00',
    dot: 'bg-[#F56A00]',
    available: false,
  },
]

interface Props {
  selected: ModelId
  onChange: (id: ModelId) => void
}

export function ModelSwitcher({ selected, onChange }: Props) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const current = MODELS.find((m) => m.id === selected)!

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [])

  return (
    <div ref={ref} className="relative">
      {/* Trigger chip */}
      <button
        onClick={() => setOpen((v) => !v)}
        className={`flex items-center gap-2 font-mono text-[11px] tracking-wide px-3 py-1.5 rounded-lg border transition-all duration-200 ${
          open ? 'border-gold/50 bg-surface2 text-text' : 'border-border bg-surface text-text2 hover:border-border/80 hover:text-text'
        }`}
      >
        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${current.dot}`} />
        <span>{current.name}</span>
        <svg viewBox="0 0 24 24" className={`w-3 h-3 fill-current transition-transform ${open ? 'rotate-180' : ''}`}>
          <path d="M7 10l5 5 5-5z"/>
        </svg>
      </button>

      {/* Dropdown */}
      {open && (
        <div className="absolute right-0 top-full mt-2 w-56 bg-surface border border-border rounded-xl shadow-2xl z-50 overflow-hidden animate-fade-up">
          <p className="font-mono text-[10px] text-text3 tracking-widest uppercase px-4 pt-3 pb-2">AI Model</p>
          {MODELS.map((m) => (
            <button
              key={m.id}
              disabled={!m.available}
              onClick={() => { if (m.available) { onChange(m.id); setOpen(false) } }}
              className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors ${
                m.id === selected
                  ? 'bg-surface2'
                  : m.available
                  ? 'hover:bg-surface2'
                  : 'opacity-40 cursor-not-allowed'
              }`}
            >
              <span className={`w-2 h-2 rounded-full shrink-0 ${m.dot}`} />
              <div className="flex-1 min-w-0">
                <p className="font-sans text-sm text-text leading-none mb-0.5">{m.name}</p>
                <p className="font-mono text-[10px] text-text3">{m.provider}</p>
              </div>
              {m.id === selected ? (
                <svg viewBox="0 0 24 24" className="w-3.5 h-3.5 fill-gold shrink-0">
                  <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/>
                </svg>
              ) : !m.available ? (
                <span className="font-mono text-[9px] text-text3 border border-border rounded px-1.5 py-0.5 shrink-0">Soon</span>
              ) : null}
            </button>
          ))}
          <div className="h-3" />
        </div>
      )}
    </div>
  )
}
