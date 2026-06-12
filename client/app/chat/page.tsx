'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import HodariApp from '@/components/LandingPage'

/** The chat app lives behind the Google sign-in gate. */
export default function ChatPage() {
  const router = useRouter()
  const [authed, setAuthed] = useState(false)

  useEffect(() => {
    // Already hydrated (localStorage set by a prior sign-in).
    if (localStorage.getItem('hodari_email')) {
      setAuthed(true)
      return
    }
    // Just came back from the OAuth redirect: the httpOnly session cookie is set
    // but localStorage isn't yet — hydrate it from the cookie, then enter.
    fetch('/api/auth/me')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.authed && data.user?.email) {
          localStorage.setItem('hodari_uid', data.user.user_id)
          localStorage.setItem('hodari_email', data.user.email)
          if (data.user.name) localStorage.setItem('hodari_name', data.user.name)
          setAuthed(true)
        } else {
          router.replace('/login')
        }
      })
      .catch(() => router.replace('/login'))
  }, [router])

  if (!authed) return null
  return <HodariApp />
}
