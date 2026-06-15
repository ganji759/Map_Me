/**
 * Google Calendar helpers.
 *
 * Two layers (see BILLING.md / calendar):
 *  - `googleCalendarUrl` builds a "render template" link that opens Google
 *    Calendar pre-filled — works for ANY user, no OAuth scope, no verification.
 *  - The OAuth API path (api/calendar/*) inserts events silently once a user has
 *    connected their calendar.
 */

export interface CalendarEvent {
  title: string
  /** YYYY-MM-DD */
  date: string
  /** Optional HH:MM (24h). When absent the event is all-day. */
  startTime?: string
  endTime?: string
  location?: string
  description?: string
}

/** YYYY-MM-DD → the next calendar day, YYYY-MM-DD (UTC math, TZ-safe). */
function nextDay(date: string): string {
  const [y, m, d] = date.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d + 1))
  return dt.toISOString().slice(0, 10)
}

/** "HH:MM" → "HHMM"; one hour later capped at 23:59 when no end given. */
function plusOneHour(time: string): string {
  const [h, m] = time.split(':').map(Number)
  const nh = Math.min(h + 1, 23)
  return `${String(nh).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

/**
 * Build a Google Calendar "add event" URL. All-day unless `startTime` is given.
 * Times are floating (rendered in the user's own timezone), which is right for a
 * "you planned to visit here" reminder.
 */
export function googleCalendarUrl(ev: CalendarEvent): string {
  const params = new URLSearchParams({ action: 'TEMPLATE', text: ev.title })
  const ymd = ev.date.replace(/-/g, '')

  if (ev.startTime) {
    const end = ev.endTime || plusOneHour(ev.startTime)
    const s = `${ymd}T${ev.startTime.replace(':', '')}00`
    const e = `${ymd}T${end.replace(':', '')}00`
    params.set('dates', `${s}/${e}`)
  } else {
    // All-day events use an exclusive end date (the next day).
    params.set('dates', `${ymd}/${nextDay(ev.date).replace(/-/g, '')}`)
  }

  if (ev.location) params.set('location', ev.location)
  if (ev.description) params.set('details', ev.description)
  return `https://calendar.google.com/calendar/render?${params.toString()}`
}

/** Event body for the Google Calendar API (events.insert). */
export function toCalendarApiEvent(ev: CalendarEvent, timeZone: string) {
  const base = {
    summary: ev.title,
    location: ev.location || undefined,
    description: ev.description || undefined,
  }
  if (ev.startTime) {
    const end = ev.endTime || plusOneHour(ev.startTime)
    return {
      ...base,
      start: { dateTime: `${ev.date}T${ev.startTime}:00`, timeZone },
      end: { dateTime: `${ev.date}T${end}:00`, timeZone },
    }
  }
  return {
    ...base,
    start: { date: ev.date },
    end: { date: nextDay(ev.date) },
  }
}
