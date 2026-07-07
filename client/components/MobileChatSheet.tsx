'use client'

/**
 * MobileChatSheet — draggable bottom sheet that hosts the chat panel on phones
 * (<768px). Three snap points: collapsed (a peek strip over the map), half,
 * and full. Plain CSS heights + pointer handlers on the grab bar — no gesture
 * library. Children stay mounted at every snap so composer text and chat
 * scroll position survive collapsing.
 */
import { useCallback, useRef, useState } from 'react'

export type SheetSnap = 'collapsed' | 'half' | 'full'

/** Height of the collapsed peek (grabber + summary row), excluding safe area. */
export const SHEET_PEEK_PX = 132

const HALF_RATIO = 0.52
/** Gap left above the fully-open sheet so the map still peeks through. */
const FULL_TOP_GAP_PX = 10
const TAP_SLOP_PX = 6

function snapPx(snap: SheetSnap, viewportH: number): number {
  if (snap === 'collapsed') return SHEET_PEEK_PX
  if (snap === 'half') return Math.round(viewportH * HALF_RATIO)
  return Math.max(SHEET_PEEK_PX, viewportH - FULL_TOP_GAP_PX)
}

interface Props {
  snap: SheetSnap
  onSnapChange: (snap: SheetSnap) => void
  /** Compact summary row shown only while collapsed (tap to expand). */
  peek?: React.ReactNode
  children: React.ReactNode
}

export function MobileChatSheet({ snap, onSnapChange, peek, children }: Props) {
  // Non-null only mid-drag; releases settle onto the nearest snap point.
  const [dragHeight, setDragHeight] = useState<number | null>(null)
  const dragRef = useRef<{ pointerId: number; startY: number; startHeight: number; moved: boolean } | null>(null)

  const settle = useCallback(
    (heightPx: number) => {
      const vh = window.innerHeight
      const options: SheetSnap[] = ['collapsed', 'half', 'full']
      let best: SheetSnap = 'half'
      let bestDist = Number.POSITIVE_INFINITY
      for (const opt of options) {
        const d = Math.abs(snapPx(opt, vh) - heightPx)
        if (d < bestDist) {
          bestDist = d
          best = opt
        }
      }
      onSnapChange(best)
    },
    [onSnapChange],
  )

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const currentHeight = dragHeight ?? snapPx(snap, window.innerHeight)
      dragRef.current = { pointerId: e.pointerId, startY: e.clientY, startHeight: currentHeight, moved: false }
      e.currentTarget.setPointerCapture(e.pointerId)
    },
    [dragHeight, snap],
  )

  const onPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== e.pointerId) return
    const delta = drag.startY - e.clientY
    if (!drag.moved && Math.abs(delta) < TAP_SLOP_PX) return
    drag.moved = true
    const vh = window.innerHeight
    const next = Math.min(snapPx('full', vh), Math.max(SHEET_PEEK_PX, drag.startHeight + delta))
    setDragHeight(next)
  }, [])

  const endDrag = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current
      if (!drag || drag.pointerId !== e.pointerId) return
      dragRef.current = null
      if (drag.moved && dragHeight != null) settle(dragHeight)
      else onSnapChange(snap === 'collapsed' ? 'half' : 'collapsed') // tap toggles
      setDragHeight(null)
    },
    [dragHeight, settle, onSnapChange, snap],
  )

  const height =
    dragHeight != null
      ? `${dragHeight}px`
      : snap === 'collapsed'
        ? `${SHEET_PEEK_PX}px`
        : snap === 'half'
          ? `${Math.round(HALF_RATIO * 100)}dvh`
          : `calc(100dvh - ${FULL_TOP_GAP_PX}px)`

  const collapsedLook = dragHeight == null && snap === 'collapsed'

  return (
    <div
      className="pb-safe fixed inset-x-0 bottom-0 z-[120] flex flex-col overflow-hidden rounded-t-2xl border-t border-[var(--border)] bg-[var(--bg-chat)] shadow-[0_-10px_36px_rgba(0,0,0,0.22)] transition-[height] duration-[240ms] ease-out motion-reduce:transition-none"
      style={{ height, transitionProperty: dragHeight != null ? 'none' : undefined }}
      // When the keyboard opens for the composer, make sure the chat is tall
      // enough that the input isn't hidden behind the shrunken viewport.
      onFocusCapture={(e) => {
        const tag = (e.target as HTMLElement).tagName
        if ((tag === 'INPUT' || tag === 'TEXTAREA') && snap === 'collapsed') onSnapChange('half')
      }}
    >
      <div
        role="button"
        tabIndex={0}
        aria-label={snap === 'collapsed' ? 'Expand chat' : 'Drag to resize chat, tap to collapse'}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            onSnapChange(snap === 'collapsed' ? 'half' : 'collapsed')
          }
        }}
        className="flex min-h-[28px] shrink-0 cursor-grab touch-none select-none items-center justify-center py-2.5 active:cursor-grabbing"
      >
        <span className="sheet-grabber" aria-hidden />
      </div>
      {collapsedLook && peek}
      <div className={`min-h-0 flex-1 ${collapsedLook ? 'pointer-events-none invisible' : ''}`}>
        {children}
      </div>
    </div>
  )
}
