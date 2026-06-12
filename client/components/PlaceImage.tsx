'use client'

import type { Place } from '@/lib/types'

interface Props {
  place: Pick<Place, 'name' | 'photos' | 'photo_url' | 'photo_reference'>
  className?: string
  width?: number
  height?: number
  /** Place photos download immediately by default so cards render instantly;
      pass 'lazy' only for long off-screen lists (e.g. saved-places grid). */
  loading?: 'eager' | 'lazy'
  onLoad?: () => void
}

export function PlaceImage({ place, className, width, height, loading = 'eager', onLoad }: Props) {
  const src =
    place.photo_url ??
    place.photos?.[0] ??
    (place.photo_reference
      ? `/api/place-photo?ref=${encodeURIComponent(place.photo_reference)}`
      : null)

  if (!src) {
    return (
      <div
        className={`flex items-center justify-center bg-gray-100 text-[10px] text-gray-400 dark:bg-gray-800 ${className ?? ''}`}
        style={width && height ? { width, height } : undefined}
        aria-label={place.name}
      >
        No photo
      </div>
    )
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={place.name}
      className={className}
      width={width}
      height={height}
      loading={loading}
      fetchPriority={loading === 'eager' ? 'high' : 'auto'}
      decoding="async"
      onLoad={onLoad}
      onError={(e) => {
        const el = e.currentTarget
        el.style.display = 'none'
        onLoad?.()
      }}
    />
  )
}
