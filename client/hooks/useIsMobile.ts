'use client'

import { useEffect, useLayoutEffect, useState } from 'react'

const MOBILE_QUERY = '(max-width: 767px)'

// useLayoutEffect is a no-op (with a console warning) during SSR, since there
// is no DOM to lay out — fall back to useEffect there. On the client this
// resolves synchronously after the DOM commit but before the browser paints,
// so the (correct, SSR-matching) desktop-shaped first paint never actually
// reaches the screen on a phone — no flash of the wrong layout.
const useIsomorphicLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect

/**
 * True below the md breakpoint (<768px). Drives the phone layout: map as the
 * base layer with the chat in a draggable bottom sheet, instead of the
 * side-by-side desktop panels.
 *
 * Starts false to match the statically-prerendered server HTML (reading
 * matchMedia in the initializer would hydration-mismatch on phones), then
 * flips synchronously pre-paint via useLayoutEffect — no visible frame of the
 * wrong layout, and no double-mounted (costly) map on either branch.
 */
export function useIsMobile(): boolean {
  const [mobile, setMobile] = useState(false)

  useIsomorphicLayoutEffect(() => {
    const mq = window.matchMedia(MOBILE_QUERY)
    const onChange = () => setMobile(mq.matches)
    onChange()
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  return mobile
}
