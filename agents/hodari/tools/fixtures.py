"""World Cup 2026 host-venue reference + lookup tool.

The 16 host stadiums (USA, Canada, Mexico) are public and static, so we keep
them here for reliable venue coordinates and match-day anchoring. Exact fixtures
(which teams, what kickoff) are user-supplied or asked for — we do not hardcode a
schedule we can't guarantee.
"""

from __future__ import annotations

import logging

logger = logging.getLogger(__name__)

# name, city, country, lat, lng, aliases
WORLD_CUP_2026_VENUES: list[dict] = [
    {"stadium": "MetLife Stadium", "city": "New York / New Jersey", "country": "USA", "lat": 40.8135, "lng": -74.0745, "aliases": ["new york", "new jersey", "metlife", "east rutherford", "nyc", "nj"]},
    {"stadium": "SoFi Stadium", "city": "Los Angeles", "country": "USA", "lat": 33.9535, "lng": -118.3392, "aliases": ["los angeles", "la", "inglewood", "sofi"]},
    {"stadium": "AT&T Stadium", "city": "Dallas", "country": "USA", "lat": 32.7473, "lng": -97.0945, "aliases": ["dallas", "arlington", "at&t", "att"]},
    {"stadium": "Mercedes-Benz Stadium", "city": "Atlanta", "country": "USA", "lat": 33.7554, "lng": -84.4008, "aliases": ["atlanta", "mercedes-benz", "mercedes benz"]},
    {"stadium": "NRG Stadium", "city": "Houston", "country": "USA", "lat": 29.6847, "lng": -95.4107, "aliases": ["houston", "nrg"]},
    {"stadium": "Arrowhead Stadium", "city": "Kansas City", "country": "USA", "lat": 39.0489, "lng": -94.4839, "aliases": ["kansas city", "kc", "arrowhead"]},
    {"stadium": "Hard Rock Stadium", "city": "Miami", "country": "USA", "lat": 25.9580, "lng": -80.2389, "aliases": ["miami", "miami gardens", "hard rock"]},
    {"stadium": "Lincoln Financial Field", "city": "Philadelphia", "country": "USA", "lat": 39.9008, "lng": -75.1675, "aliases": ["philadelphia", "philly", "lincoln financial"]},
    {"stadium": "Levi's Stadium", "city": "San Francisco Bay Area", "country": "USA", "lat": 37.4030, "lng": -121.9698, "aliases": ["san francisco", "bay area", "santa clara", "levi's", "levis", "sf"]},
    {"stadium": "Lumen Field", "city": "Seattle", "country": "USA", "lat": 47.5952, "lng": -122.3316, "aliases": ["seattle", "lumen"]},
    {"stadium": "Gillette Stadium", "city": "Boston", "country": "USA", "lat": 42.0909, "lng": -71.2643, "aliases": ["boston", "foxborough", "gillette", "new england"]},
    {"stadium": "BMO Field", "city": "Toronto", "country": "Canada", "lat": 43.6332, "lng": -79.4185, "aliases": ["toronto", "bmo"]},
    {"stadium": "BC Place", "city": "Vancouver", "country": "Canada", "lat": 49.2768, "lng": -123.1119, "aliases": ["vancouver", "bc place"]},
    {"stadium": "Estadio Azteca", "city": "Mexico City", "country": "Mexico", "lat": 19.3029, "lng": -99.1505, "aliases": ["mexico city", "azteca", "ciudad de mexico", "cdmx"]},
    {"stadium": "Estadio Akron", "city": "Guadalajara", "country": "Mexico", "lat": 20.6819, "lng": -103.4625, "aliases": ["guadalajara", "akron"]},
    {"stadium": "Estadio BBVA", "city": "Monterrey", "country": "Mexico", "lat": 25.6692, "lng": -100.2444, "aliases": ["monterrey", "bbva"]},
]


def world_cup_venues(query: str = "") -> list[dict]:
    """Look up 2026 FIFA World Cup host stadium(s) by city or stadium name.

    Use to get the exact stadium and coordinates for match-day planning (so place
    searches can be biased near the venue), or to answer which cities/stadiums
    host the tournament. Returns ALL 16 venues when query is empty.

    Args:
        query: A host city or stadium name (e.g. "New York", "MetLife",
            "Mexico City"). Empty returns the full list.

    Returns:
        List of {stadium, city, country, lat, lng} matches (empty if no match).
    """
    q = (query or "").strip().lower()
    if not q:
        return [{k: v[k] for k in ("stadium", "city", "country", "lat", "lng")} for v in WORLD_CUP_2026_VENUES]

    def pub(v: dict) -> dict:
        return {k: v[k] for k in ("stadium", "city", "country", "lat", "lng")}

    # Strong: the whole query appears in the stadium/city/aliases.
    strong = [v for v in WORLD_CUP_2026_VENUES
              if q in " ".join([v["stadium"].lower(), v["city"].lower(), *v["aliases"]])]
    if strong:
        return [pub(v) for v in strong]

    # Fallback: any meaningful token matches (only when nothing matched directly).
    toks = [t for t in q.split() if len(t) > 3]
    fallback = [v for v in WORLD_CUP_2026_VENUES
                if any(t in " ".join([v["stadium"].lower(), v["city"].lower(), *v["aliases"]]) for t in toks)]
    return [pub(v) for v in fallback]
