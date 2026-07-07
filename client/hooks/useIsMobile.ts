'use client'

import { useEffect, useState } from 'react'

const MOBILE_QUERY = '(max-width: 767px)'

/**
 * True below the md breakpoint (<768px). Drives the phone layout: map as the
 * base layer with the chat in a draggable bottom sheet, instead of the
 * side-by-side desktop panels.
 *
 * Starts false and resolves in an effect: /chat is statically prerendered, so
 * reading matchMedia in the initializer would produce a hydration mismatch on
 * phones. Costs one desktop-layout frame before the mobile layout applies.
 */
export function useIsMobile(): boolean {
  const [mobile, setMobile] = useState(false)

  useEffect(() => {
    const mq = window.matchMedia(MOBILE_QUERY)
    const onChange = () => setMobile(mq.matches)
    onChange()
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  return mobile
}
