import type { Config } from 'tailwindcss'

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // Semantic tokens driven by CSS vars — supports opacity modifiers (bg-bg/50, etc.)
        bg:       'rgb(var(--color-bg)       / <alpha-value>)',
        surface:  'rgb(var(--color-surface)  / <alpha-value>)',
        surface2: 'rgb(var(--color-surface2) / <alpha-value>)',
        surface3: 'rgb(var(--color-surface3) / <alpha-value>)',
        text:     'rgb(var(--color-text)     / <alpha-value>)',
        text2:    'rgb(var(--color-text2)    / <alpha-value>)',
        text3:    'rgb(var(--color-text3)    / <alpha-value>)',
        border:   'rgb(var(--color-border)   / <alpha-value>)',
        // Fixed accent colors — same in both themes
        gold:       { DEFAULT: '#F56A00', light: '#FF8C2F', dim: '#7A3500' },
        green:      { DEFAULT: '#00C47A', dim: '#0A4A36' },
        danger:     { DEFAULT: '#FF5A57', dim: '#7A1F1D' },
        brand:      { DEFAULT: '#F56A00', dark: '#C44A00' },
        // The chat UI was built on Tailwind's yellow-orange `amber` scale, which
        // clashed with the landing page's vivid orange (#F56A00). Re-anchor the
        // whole `amber` scale onto that orange so every existing `amber-*` class
        // across the app renders in the single brand palette — `amber-600` lands
        // exactly on the landing's primary #F56A00. (Keeps light/dark consistent.)
        amber: {
          50:  '#FFF4EC',
          100: '#FFE2CC',
          200: '#FFD0AC',
          300: '#FFA94D',
          400: '#FF8C2F',
          500: '#FF7A1A',
          600: '#F56A00',
          700: '#D45400',
          800: '#A84200',
          900: '#7A3500',
          950: '#431C00',
        },
      },
      fontFamily: {
        display: ['"Playfair Display"', 'Georgia', 'serif'],
        mono:    ['"DM Mono"', 'Menlo', 'monospace'],
        sans:    ['Outfit', 'system-ui', 'sans-serif'],
      },
      // Entrance/loop animation classes live in app/globals.css (single source —
      // see the "Motion system" section there). This file previously duplicated
      // slide-in-right / fade-up / pulse_dot as unused near-duplicates; removed.
    },
  },
  plugins: [],
}

export default config
