/**
 * Hodari design tokens — the single reference for the visual language.
 *
 * The *source of truth* for color/font is `tailwind.config.ts` + the CSS vars in
 * `app/globals.css` (so dark/light theming works via `html.light`). This file
 * documents that language for JS usage (kitchen-sink, charts, canvas) and adds
 * the shared spacing / radius / motion / z-index scales the primitives use.
 *
 * Editorial "matchday" aesthetic: warm gold accent, Playfair display headings,
 * DM Mono micro-labels, Outfit body, glass surfaces over the map.
 */

/** Semantic colors — CSS-var driven, theme-aware. Use as Tailwind classes (`bg-surface`, `text-text2`). */
export const colorTokens = [
  { name: 'bg', usage: 'app background' },
  { name: 'surface', usage: 'cards, panels' },
  { name: 'surface2', usage: 'raised / hover, skeletons' },
  { name: 'surface3', usage: 'borders-on-hover, wells' },
  { name: 'text', usage: 'primary text' },
  { name: 'text2', usage: 'secondary text' },
  { name: 'text3', usage: 'muted / captions' },
  { name: 'border', usage: 'hairlines, dividers' },
] as const

/** Fixed accents — identical in both themes. */
export const accents = {
  gold: '#F56A00',
  goldLight: '#FF8C2F',
  goldDim: '#7A3500',
  green: '#00C47A',
  danger: '#FF5A57',
} as const

export const fonts = {
  display: '"Playfair Display", Georgia, serif', // headings
  mono: '"DM Mono", Menlo, monospace', // micro-labels, uppercase tags
  sans: 'Outfit, system-ui, sans-serif', // body
} as const

/** 4/8 spacing scale (px) — never hand-pick `13px`. */
export const space = [0, 2, 4, 8, 12, 16, 20, 24, 32, 40, 48, 64] as const

/** Radius scale — matches the rounded-lg / xl / 2xl / full usage in the app. */
export const radius = {
  sm: '0.5rem', // rounded-lg
  md: '0.75rem', // rounded-xl
  lg: '1rem', // rounded-2xl
  full: '9999px',
} as const

/** Type scale (rem) — one scale, two families (display + sans), mono for labels. */
export const typeScale = {
  label: '0.6875rem', // 11px mono uppercase tags
  xs: '0.75rem',
  sm: '0.875rem', // body default
  base: '1rem',
  lg: '1.125rem',
  xl: '1.25rem',
  '2xl': '1.5rem',
  display: '3rem', // hero
} as const

export const shadow = {
  card: '0 12px 32px -12px rgba(0,0,0,0.60)',
  pop: '0 14px 40px -10px rgba(245,106,0,0.30)',
} as const

/** z-index layers — keep overlays ordered. */
export const z = {
  base: 0,
  overlayMap: 10,
  header: 20,
  dropdown: 40,
  modal: 50,
  toast: 60,
  grain: 9999,
} as const

/**
 * Motion — mirrors the CSS vars defined in app/globals.css ("Motion system"
 * section). Keep these two in sync by hand; there's no build step that reads
 * the CSS custom properties into JS.
 */
export const motion = {
  ease: [0.22, 1, 0.36, 1] as const, // var(--ease-glide) — entrances/exits
  easeOutSoft: [0.16, 1, 0.3, 1] as const, // var(--ease-out-soft) — hover/press
  duration: { fast: 0.15, base: 0.25, slow: 0.4 }, // var(--dur-fast/base/slow), seconds
} as const

/**
 * Shared focus ring — apply to every interactive primitive so keyboard focus is
 * always visible (WCAG). Gold ring, offset against the app background.
 */
export const focusRing =
  'outline-none focus-visible:ring-2 focus-visible:ring-gold/60 focus-visible:ring-offset-2 focus-visible:ring-offset-bg'
