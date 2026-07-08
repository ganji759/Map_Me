'use client'

/**
 * MobileChatSheet — draggable bottom sheet that hosts the chat panel on phones
 * (<768px). Three snap points: collapsed (a peek strip over the map), half,
 * and full. Plain CSS heights + pointer handlers on the grab bar — no gesture
 * library. Children stay mounted at every snap so composer text and chat
 * scroll position survive collapsing.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { focusRing } from '@/lib/design/tokens'

export type SheetSnap = 'collapsed' | 'half' | 'full'

/** Height of the collapsed peek (grabber + summary row), excluding safe area. */
export const SHEET_PEEK_PX = 132

const HALF_RATIO = 0.52
/** Gap left above the fully-open sheet so the map still peeks through. */
const FULL_TOP_GAP_PX = 10
const TAP_SLOP_PX = 6
/** Flick faster than this (px/ms) skips straight to the far snap point. */
const FLICK_VELOCITY = 0.5
/** Keyboard eating more than this share of the viewport promotes half → full. */
const KEYBOARD_EAT_RATIO = 0.35

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
  const dragRef = useRef<{
    pointerId: number
    startY: number
    startHeight: number
    moved: boolean
    lastY: number
    lastT: number
    /** Smoothed velocity, px/ms; positive = finger moving up (sheet growing). */
    vy: number
  } | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const snapRef = useRef(snap)
  snapRef.current = snap

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
      dragRef.current = {
        pointerId: e.pointerId,
        startY: e.clientY,
        startHeight: currentHeight,
        moved: false,
        lastY: e.clientY,
        lastT: e.timeStamp,
        vy: 0,
      }
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
    // Exponentially-smoothed velocity so the release decision reflects the
    // final flick, not the whole drag.
    const dt = e.timeStamp - drag.lastT
    if (dt > 0) {
      const inst = (drag.lastY - e.clientY) / dt
      drag.vy = drag.vy * 0.4 + inst * 0.6
    }
    drag.lastY = e.clientY
    drag.lastT = e.timeStamp
    const vh = window.innerHeight
    const next = Math.min(snapPx('full', vh), Math.max(SHEET_PEEK_PX, drag.startHeight + delta))
    setDragHeight(next)
  }, [])

  const endDrag = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current
      if (!drag || drag.pointerId !== e.pointerId) return
      dragRef.current = null
      if (drag.moved && dragHeight != null) {
        // A fast flick skips intermediate snaps: up → full, down → collapsed.
        if (Math.abs(drag.vy) > FLICK_VELOCITY) onSnapChange(drag.vy > 0 ? 'full' : 'collapsed')
        else settle(dragHeight)
      } else {
        onSnapChange(snap === 'collapsed' ? 'half' : 'collapsed') // tap toggles
      }
      setDragHeight(null)
    },
    [dragHeight, settle, onSnapChange, snap],
  )

  // iOS: focusing the composer opens the keyboard, which shrinks the visual
  // viewport without firing focus again. When it eats a big slice (>35%) the
  // half snap leaves almost no conversation visible — promote to full.
  useEffect(() => {
    const vv = window.visualViewport
    if (!vv) return
    const onResize = () => {
      if (snapRef.current === 'full') return
      const eaten = (window.innerHeight - vv.height) / window.innerHeight
      if (eaten <= KEYBOARD_EAT_RATIO) return
      const ae = document.activeElement
      const editing =
        ae instanceof HTMLElement && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA')
      if (editing && rootRef.current?.contains(ae)) onSnapChange('full')
    }
    vv.addEventListener('resize', onResize)
    return () => vv.removeEventListener('resize', onResize)
  }, [onSnapChange])

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
    <>
      {/* Dim scrim behind the full snap — tap sends the sheet back to half. */}
      {snap === 'full' && dragHeight == null && (
        <div
          aria-hidden
          onClick={() => onSnapChange('half')}
          className="fixed inset-0 z-[110] bg-black/30 md:hidden"
        />
      )}
      <div
        ref={rootRef}
        className="pb-safe fixed inset-x-0 bottom-0 z-[120] flex flex-col overflow-hidden rounded-t-2xl border-t border-[var(--border)] bg-[var(--bg-chat)] shadow-[0_-10px_36px_rgba(0,0,0,0.22)] transition-[height] duration-[var(--dur-base)] ease-[var(--ease-glide)] motion-reduce:transition-none md:hidden"
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
          className={`flex min-h-[44px] shrink-0 cursor-grab touch-none select-none items-center justify-center py-2.5 active:cursor-grabbing ${focusRing}`}
        >
          <span className="sheet-grabber" aria-hidden />
        </div>
        {collapsedLook && peek}
        <div className={`min-h-0 flex-1 ${collapsedLook ? 'pointer-events-none invisible' : ''}`}>
          {children}
        </div>
      </div>
    </>
  )
}
