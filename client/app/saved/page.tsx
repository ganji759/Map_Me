'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, Bookmark, Calendar, CalendarPlus, Check, MapPin, Trash2 } from 'lucide-react'
import { googleCalendarUrl } from '@/lib/calendar'

interface SavedItem {
  place_id: string
  place_name: string
  city?: string
  action?: string
  timestamp?: string
  visit_date?: string
  note?: string
}

interface PlaceDetails {
  photoUrls?: string[]
  rating?: number
  address?: string
  isOpen?: boolean
}

function groupByDay(items: SavedItem[]): Record<string, SavedItem[]> {
  const groups: Record<string, SavedItem[]> = {}
  for (const item of items) {
    if (!item.visit_date) continue
    // Normalise to YYYY-MM-DD so the key is always sortable
    const key = item.visit_date.slice(0, 10)
    ;(groups[key] ??= []).push(item)
  }
  return groups
}

/** Returns a human-friendly relative hint, e.g. "Today", "Tomorrow", "in 5 days", "5 days ago". */
function relativeDay(dateStr: string): string {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const target = new Date(dateStr + 'T00:00:00')
  target.setHours(0, 0, 0, 0)
  const diffDays = Math.round((target.getTime() - today.getTime()) / 86_400_000)
  if (diffDays === 0) return 'Today'
  if (diffDays === 1) return 'Tomorrow'
  if (diffDays === -1) return 'Yesterday'
  if (diffDays > 1 && diffDays <= 30) return `in ${diffDays} days`
  if (diffDays < -1 && diffDays >= -30) return `${Math.abs(diffDays)} days ago`
  return ''
}

export default function SavedPage() {
  const [saved, setSaved] = useState<SavedItem[]>([])
  const [reminders, setReminders] = useState<SavedItem[]>([])
  const [details, setDetails] = useState<Record<string, PlaceDetails>>({})
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<'places' | 'calendar'>('places')
  const [editingReminder, setEditingReminder] = useState<string | null>(null)
  const [reminderInputs, setReminderInputs] = useState<Record<string, { date: string; note: string }>>({})
  const [calendarConnected, setCalendarConnected] = useState(false)
  const [addedToCal, setAddedToCal] = useState<Set<string>>(new Set())
  const fetchedRef = useRef(new Set<string>())

  const userId = typeof window !== 'undefined' ? (localStorage.getItem('hodari_uid') ?? '') : ''

  useEffect(() => {
    fetch('/api/calendar/status').then((r) => r.json()).then((d) => setCalendarConnected(!!d?.connected)).catch(() => {})
  }, [])

  // Add a planned visit to Google Calendar. If the user connected their calendar
  // we insert silently; otherwise we open the prefilled "add event" template
  // (works for everyone, no scopes).
  const addVisitToCalendar = async (item: SavedItem) => {
    const ev = {
      title: item.place_name,
      date: (item.visit_date ?? '').slice(0, 10),
      location: item.city || undefined,
      description: item.note || `Planned with Hodari`,
    }
    if (!ev.date) return
    if (calendarConnected) {
      try {
        const r = await fetch('/api/calendar/add', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(ev),
        }).then((res) => res.json())
        if (r?.added) { setAddedToCal((prev) => new Set(prev).add(item.place_id)); return }
        // needsConnect → fall through to the template link
      } catch { /* fall through */ }
    }
    window.open(googleCalendarUrl(ev), '_blank', 'noopener')
  }

  useEffect(() => {
    if (!userId) { setLoading(false); return }
    Promise.all([
      fetch(`/api/saved?userId=${encodeURIComponent(userId)}`).then((r) => r.json()),
    ]).then(([data]) => {
      setSaved((data.saved ?? []).filter((i: SavedItem) => i.action !== 'reminder') as SavedItem[])
      setReminders((data.saved ?? []).filter((i: SavedItem) => i.action === 'reminder') as SavedItem[])
    }).catch(() => {}).finally(() => setLoading(false))
  }, [userId])

  // Load details + photos for saved places
  useEffect(() => {
    const toFetch = saved.filter((s) => s.place_id && !fetchedRef.current.has(s.place_id))
    toFetch.forEach((item) => {
      fetchedRef.current.add(item.place_id)
      fetch(`/api/place-photos?placeId=${encodeURIComponent(item.place_id)}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => {
          if (!data) return
          setDetails((prev) => ({ ...prev, [item.place_id]: { photoUrls: data.photoUrls, rating: data.rating, address: data.address, isOpen: data.isOpen } }))
        })
        .catch(() => {})
    })
  }, [saved])

  const reminderFor = (placeId: string) => reminders.find((r) => r.place_id === placeId)

  const saveReminder = async (item: SavedItem) => {
    const inp = reminderInputs[item.place_id]
    if (!inp?.date) return
    await fetch('/api/saved', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, placeId: item.place_id, placeName: item.place_name, city: item.city, visitDate: inp.date, note: inp.note ?? '' }),
    })
    setReminders((prev) => {
      const filtered = prev.filter((r) => r.place_id !== item.place_id)
      return [...filtered, { ...item, action: 'reminder', visit_date: inp.date, note: inp.note ?? '' }]
    })
    setEditingReminder(null)
  }

  const calendarGroups = groupByDay(reminders)
  const hasCalendar = Object.keys(calendarGroups).length > 0
  const sortedDays = Object.keys(calendarGroups).sort()

  return (
    // h-screen + internal scroll: the global `html, body { overflow: hidden }`
    // (full-screen chat app) means this page must own its own scroll container,
    // or long saved lists are unreachable.
    <div className="flex h-screen flex-col overflow-hidden bg-[#ffffff] dark:bg-[#15151a]">
      {/* Header */}
      <header className="flex shrink-0 items-center gap-4 border-b border-amber-100/60 bg-[#ffffff]/95 px-5 py-4 backdrop-blur-sm dark:border-amber-900/30 dark:bg-[#15151a]/95">
        <Link href="/chat" aria-label="Back to chat" className="flex items-center gap-2 rounded-lg p-1.5 text-amber-700 transition-colors hover:bg-amber-100 dark:text-amber-400 dark:hover:bg-amber-900/30">
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div>
          <h1 className="font-display text-xl font-semibold text-[#15151a] dark:text-amber-50">Saved Places</h1>
          <p className="text-[11px] uppercase tracking-wider text-amber-700/70 dark:text-amber-500/70">FIFA World Cup 2026 · Your list</p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={() => setTab('places')}
            className={`flex items-center gap-1.5 rounded-full px-4 py-1.5 text-[12px] font-medium transition-colors ${tab === 'places' ? 'bg-amber-600 text-white' : 'border border-amber-200 text-amber-700 hover:bg-amber-50 dark:border-amber-800 dark:text-amber-400 dark:hover:bg-amber-900/20'}`}
          >
            <Bookmark className="h-3.5 w-3.5" />
            Places
          </button>
          <button
            onClick={() => setTab('calendar')}
            className={`flex items-center gap-1.5 rounded-full px-4 py-1.5 text-[12px] font-medium transition-colors ${tab === 'calendar' ? 'bg-amber-600 text-white' : 'border border-amber-200 text-amber-700 hover:bg-amber-50 dark:border-amber-800 dark:text-amber-400 dark:hover:bg-amber-900/20'}`}
          >
            <Calendar className="h-3.5 w-3.5" />
            Plan
          </button>
        </div>
      </header>

      <main className="mx-auto w-full max-w-3xl min-h-0 flex-1 overflow-y-auto px-4 py-6 sm:px-6">
        {loading && (
          <div className="flex items-center justify-center py-24">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-amber-200 border-t-amber-600" />
          </div>
        )}

        {!loading && !userId && (
          <div className="rounded-2xl border border-amber-100 bg-white/60 p-10 text-center dark:border-amber-900/30 dark:bg-amber-950/10">
            <Bookmark className="mx-auto mb-4 h-10 w-10 text-amber-300" />
            <p className="text-[15px] text-amber-800 dark:text-amber-200">Sign in to see your saved places.</p>
            <Link href="/login" className="mt-4 inline-block rounded-full bg-amber-600 px-6 py-2 text-[13px] font-medium text-white transition-colors hover:bg-amber-700">
              Sign in
            </Link>
          </div>
        )}

        {!loading && userId && tab === 'places' && (
          <>
            {saved.length === 0 ? (
              <div className="rounded-2xl border border-amber-100 bg-white/60 p-10 text-center dark:border-amber-900/30 dark:bg-amber-950/10">
                <Bookmark className="mx-auto mb-4 h-10 w-10 text-amber-300" />
                <p className="text-[15px] font-medium text-amber-800 dark:text-amber-200">No saved places yet</p>
                <p className="mt-1.5 text-[13px] text-amber-600/70 dark:text-amber-500/70">
                  Tap the bookmark icon on any place card to save it here.
                </p>
                <Link href="/chat" className="mt-4 inline-block rounded-full bg-amber-600 px-6 py-2 text-[13px] font-medium text-white transition-colors hover:bg-amber-700">
                  Explore places
                </Link>
              </div>
            ) : (
              <div className="space-y-4">
                {saved.map((item) => {
                  const d = details[item.place_id]
                  const reminder = reminderFor(item.place_id)
                  const isEditing = editingReminder === item.place_id
                  const inp = reminderInputs[item.place_id] ?? { date: reminder?.visit_date ?? '', note: reminder?.note ?? '' }
                  return (
                    <div key={item.place_id} className="overflow-hidden rounded-2xl border border-amber-100/80 bg-white/70 shadow-sm dark:border-amber-900/30 dark:bg-[#15151a]/70">
                      <div className="flex gap-4 p-4">
                        {/* Photo */}
                        <div className="h-24 w-24 shrink-0 overflow-hidden rounded-xl bg-amber-100 dark:bg-amber-900/20">
                          {d?.photoUrls?.[0] ? (
                            <img src={d.photoUrls[0]} alt={item.place_name} className="h-full w-full object-cover" />
                          ) : (
                            <div className="flex h-full w-full items-center justify-center">
                              <MapPin className="h-6 w-6 text-amber-300" />
                            </div>
                          )}
                        </div>

                        {/* Info */}
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-semibold text-[15px] text-[#15151a] dark:text-amber-50">{item.place_name}</p>
                          {item.city && <p className="mt-0.5 text-[12px] text-amber-700/70 dark:text-amber-500/70">{item.city}</p>}
                          {d?.rating != null && (
                            <p className="mt-1 text-[11px] text-amber-600">★ {d.rating.toFixed(1)}</p>
                          )}
                          {reminder?.visit_date && !isEditing && (
                            <div className="mt-2 flex items-center gap-1.5 rounded-lg bg-amber-50 px-2.5 py-1.5 text-[11px] text-amber-700 dark:bg-amber-900/20 dark:text-amber-400">
                              <Calendar className="h-3 w-3 shrink-0" />
                              {new Date(reminder.visit_date).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
                              {reminder.note && <span className="ml-1 truncate text-amber-600/70">· {reminder.note}</span>}
                            </div>
                          )}
                        </div>

                        {/* Actions */}
                        <div className="flex shrink-0 flex-col items-end gap-2">
                          <button
                            onClick={() => {
                              setEditingReminder(isEditing ? null : item.place_id)
                              if (!isEditing) setReminderInputs((p) => ({ ...p, [item.place_id]: { date: reminder?.visit_date ?? '', note: reminder?.note ?? '' } }))
                            }}
                            className="rounded-full border border-amber-200 px-3 py-1 text-[10px] font-medium uppercase tracking-wide text-amber-700 transition-colors hover:bg-amber-50 dark:border-amber-800 dark:text-amber-400 dark:hover:bg-amber-900/20"
                          >
                            {isEditing ? 'Cancel' : reminder?.visit_date ? 'Edit visit' : 'Plan visit'}
                          </button>
                          <Link
                            href="/chat"
                            className="rounded-full border border-amber-200 px-3 py-1 text-[10px] font-medium uppercase tracking-wide text-amber-700 transition-colors hover:bg-amber-50 dark:border-amber-800 dark:text-amber-400 dark:hover:bg-amber-900/20"
                          >
                            Ask Hodari
                          </Link>
                        </div>
                      </div>

                      {/* Inline reminder editor */}
                      {isEditing && (
                        <div className="border-t border-amber-100/60 bg-amber-50/50 px-4 py-3 dark:border-amber-900/20 dark:bg-amber-950/20">
                          <div className="flex flex-wrap items-end gap-3">
                            <div className="flex-1 min-w-[150px]">
                              <label className="mb-1 block text-[10px] font-medium uppercase tracking-wider text-amber-700/70 dark:text-amber-500/70">Visit date</label>
                              <input
                                type="date"
                                value={inp.date}
                                min={new Date().toISOString().slice(0, 10)}
                                onChange={(e) => setReminderInputs((p) => ({ ...p, [item.place_id]: { ...inp, date: e.target.value } }))}
                                className="w-full rounded-lg border border-amber-200 bg-white px-3 py-1.5 text-[13px] text-[#15151a] outline-none focus:border-amber-400 dark:border-amber-800 dark:bg-[#15151a] dark:text-amber-50"
                              />
                            </div>
                            <div className="flex-1 min-w-[150px]">
                              <label className="mb-1 block text-[10px] font-medium uppercase tracking-wider text-amber-700/70 dark:text-amber-500/70">Note (optional)</label>
                              <input
                                type="text"
                                value={inp.note}
                                placeholder="e.g. lunch before the match"
                                onChange={(e) => setReminderInputs((p) => ({ ...p, [item.place_id]: { ...inp, note: e.target.value } }))}
                                className="w-full rounded-lg border border-amber-200 bg-white px-3 py-1.5 text-[13px] text-[#15151a] outline-none placeholder:text-amber-300 focus:border-amber-400 dark:border-amber-800 dark:bg-[#15151a] dark:text-amber-50"
                              />
                            </div>
                            <button
                              onClick={() => saveReminder(item)}
                              disabled={!inp.date}
                              className="rounded-full bg-amber-600 px-4 py-2 text-[12px] font-medium text-white transition-colors hover:bg-amber-700 disabled:opacity-40"
                            >
                              Save
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </>
        )}

        {!loading && userId && tab === 'calendar' && (
          <div>
            {!hasCalendar ? (
              <div className="rounded-2xl border border-amber-100 bg-white/60 p-10 text-center dark:border-amber-900/30 dark:bg-amber-950/10">
                <Calendar className="mx-auto mb-4 h-10 w-10 text-amber-300" />
                <p className="text-[15px] font-medium text-amber-800 dark:text-amber-200">No visits planned yet</p>
                <p className="mt-1.5 text-[13px] text-amber-600/70 dark:text-amber-500/70">
                  Go to Places and tap &ldquo;Plan visit&rdquo; on a saved place to add it here.
                </p>
                <button onClick={() => setTab('places')} className="mt-4 inline-block rounded-full bg-amber-600 px-6 py-2 text-[13px] font-medium text-white transition-colors hover:bg-amber-700">
                  View saved places
                </button>
              </div>
            ) : (
              <div className="space-y-10">
                {!calendarConnected && (
                  <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-200 bg-amber-50/60 px-4 py-3 dark:border-amber-900/40 dark:bg-amber-950/20">
                    <p className="text-[13px] text-amber-800 dark:text-amber-300">
                      Connect Google Calendar for one-tap sync, or just use the <strong>Calendar</strong> button on each visit.
                    </p>
                    <a
                      href="/api/auth/google?calendar=1&next=/saved"
                      className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-amber-600 px-4 py-1.5 text-[12px] font-medium text-white transition-colors hover:bg-amber-700"
                    >
                      <CalendarPlus className="h-3.5 w-3.5" />
                      Connect Google Calendar
                    </a>
                  </div>
                )}
                {sortedDays.map((dayKey, dayIndex) => {
                  const items = calendarGroups[dayKey]
                  const dt = new Date(dayKey + 'T00:00:00')
                  const hint = relativeDay(dayKey)
                  const isLast = dayIndex === sortedDays.length - 1
                  return (
                    <div key={dayKey} className="relative">
                      {/* Vertical timeline rail — connects from this day down to the next */}
                      {!isLast && (
                        <div
                          aria-hidden="true"
                          className="absolute left-[22px] top-[52px] bottom-[-2.5rem] w-px bg-amber-200/60 dark:bg-amber-800/40 motion-reduce:hidden"
                        />
                      )}

                      {/* Day header */}
                      <div className="mb-3 flex items-baseline gap-3">
                        {/* Timeline node dot */}
                        <div
                          aria-hidden="true"
                          className="relative z-10 mt-[2px] h-3 w-3 shrink-0 rounded-full border-2 border-amber-600 bg-white dark:bg-[#15151a] motion-reduce:hidden"
                          style={{ marginLeft: '16px' }}
                        />
                        <div className="flex min-w-0 flex-1 flex-wrap items-baseline gap-2">
                          <h2 className="font-display text-[15px] font-semibold text-[#15151a] dark:text-amber-50">
                            {dt.toLocaleDateString('en-US', { weekday: 'long' })}
                            <span className="ml-1.5 font-normal text-amber-700/80 dark:text-amber-400/80">
                              · {dt.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
                            </span>
                          </h2>
                          {hint && (
                            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
                              {hint}
                            </span>
                          )}
                          <span className="ml-auto shrink-0 text-[10px] font-medium uppercase tracking-wider text-amber-500 dark:text-amber-600">
                            {items.length} {items.length === 1 ? 'stop' : 'stops'}
                          </span>
                        </div>
                      </div>

                      {/* Cards for this day */}
                      <div className="space-y-2 pl-8">
                        {items.map((item) => {
                          const d = details[item.place_id]
                          const itemDt = new Date(item.visit_date!)
                          return (
                            <div key={item.place_id} className="flex items-center gap-4 rounded-2xl border border-amber-100/80 bg-white/70 p-4 shadow-sm dark:border-amber-900/30 dark:bg-[#15151a]/70">
                              {/* Date badge */}
                              <div className="flex h-14 w-12 shrink-0 flex-col items-center justify-center rounded-xl bg-amber-600 text-white">
                                <span className="text-[10px] font-medium uppercase">{itemDt.toLocaleDateString('en-US', { month: 'short' })}</span>
                                <span className="text-xl font-bold leading-none">{itemDt.getDate()}</span>
                              </div>

                              {/* Thumbnail */}
                              <div className="h-12 w-12 shrink-0 overflow-hidden rounded-lg bg-amber-100 dark:bg-amber-900/20">
                                {d?.photoUrls?.[0] ? (
                                  <img src={d.photoUrls[0]} alt={item.place_name} className="h-full w-full object-cover" />
                                ) : (
                                  <div className="flex h-full w-full items-center justify-center">
                                    <MapPin className="h-4 w-4 text-amber-300" />
                                  </div>
                                )}
                              </div>

                              {/* Details */}
                              <div className="min-w-0 flex-1">
                                <p className="truncate font-medium text-[14px] text-[#15151a] dark:text-amber-50">{item.place_name}</p>
                                <p className="text-[11px] text-amber-700/70 dark:text-amber-500/70">
                                  {itemDt.toLocaleDateString('en-US', { weekday: 'long' })}
                                  {item.city ? ` · ${item.city}` : ''}
                                </p>
                                {item.note && <p className="mt-0.5 truncate text-[11px] italic text-amber-600/70 dark:text-amber-500/70">{item.note}</p>}
                              </div>

                              {/* Add to Google Calendar */}
                              {addedToCal.has(item.place_id) ? (
                                <span className="flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-medium text-green-600 dark:text-green-400">
                                  <Check className="h-3.5 w-3.5" /> Added
                                </span>
                              ) : (
                                <button
                                  aria-label={`Add ${item.place_name} to Google Calendar`}
                                  title="Add to Google Calendar"
                                  onClick={() => addVisitToCalendar(item)}
                                  className="flex shrink-0 items-center gap-1 rounded-lg border border-amber-200 px-2.5 py-1.5 text-[11px] font-medium text-amber-700 transition-colors hover:border-amber-400 hover:bg-amber-50 dark:border-amber-900/40 dark:text-amber-400 dark:hover:bg-amber-900/20"
                                >
                                  <CalendarPlus className="h-3.5 w-3.5" />
                                  Calendar
                                </button>
                              )}

                              {/* Remove */}
                              <button
                                aria-label={`Remove ${item.place_name} from plan`}
                                onClick={async () => {
                                  await fetch('/api/saved', {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({ userId, placeId: item.place_id, placeName: item.place_name, city: item.city, visitDate: null, note: '' }),
                                  })
                                  setReminders((prev) => prev.filter((r) => r.place_id !== item.place_id))
                                }}
                                className="shrink-0 rounded-lg p-2 text-amber-300 transition-colors hover:text-amber-600 dark:text-amber-800 dark:hover:text-amber-500"
                              >
                                <Trash2 className="h-4 w-4" />
                              </button>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  )
}
