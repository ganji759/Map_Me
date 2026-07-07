import type { Metadata, Viewport } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Hodari — FIFA World Cup 2026',
  description: 'Your matchday guide to the 2026 FIFA World Cup cities.',
  manifest: '/manifest.json',
}

export const viewport: Viewport = {
  themeColor: '#0C0C0E',
  width: 'device-width',
  initialScale: 1,
  // Stops iOS Safari's zoom-on-input-focus (inputs also use >=16px font on
  // mobile). Pinch-zoom stays available on Android; iOS treats this as a
  // focus-zoom opt-out.
  maximumScale: 1,
  // Draw under the notch/home indicator; padding uses env(safe-area-inset-*).
  viewportFit: 'cover',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('hodari_theme');if(t==='dark')document.documentElement.classList.add('dark');else document.documentElement.classList.remove('dark');}catch(e){}})();`,
          }}
        />
      </head>
      <body className="font-sans bg-bg text-text antialiased">{children}</body>
    </html>
  )
}
