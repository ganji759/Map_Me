export interface Coordinates {
  lat: number
  lng: number
}

export interface Place {
  place_id: string
  name: string
  address: string
  coordinates: Coordinates
  categories: string[]
  city?: string
  rating?: number
  price_level?: string
  summary?: string
  maps_url?: string
  /** The place's own website (restaurant/hotel site), when known. */
  website?: string
  /** Whether the place is open right now, when known. */
  open_now?: boolean
  /** Direct image URL when available from search/backend */
  photo_url?: string
  /** Legacy photo references or absolute URLs */
  photos?: string[]
  photo_reference?: string
}

export interface TravelLeg {
  distance: string
  duration: string
  encoded_polyline?: string
}

export interface ItineraryStop {
  place_id: string
  name: string
  address: string
  coordinates: Coordinates
  arrival_time?: string
  duration_at_stop?: string
  travel_from_prev?: TravelLeg
  rationale: string
}

export interface Itinerary {
  stops: ItineraryStop[]
  total_duration?: string
  total_distance?: string
  voice_summary: string
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  places?: Place[]
  itinerary?: Itinerary | null
  /** Scheduled visits from plan_visit → "Add to Google Calendar" chips in chat. */
  calendarEvents?: import('./calendar').CalendarEvent[]
}

export type StreamChunk =
  | { type: 'thinking'; agent: string; label: string }
  | { type: 'text'; text: string }

export type Theme = 'dark' | 'light'
