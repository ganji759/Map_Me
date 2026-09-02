# Tourist AI Agent (Hodari) — System Architecture

*An agentic tourist assistant for the 2026 FIFA World Cup, built on Gemini 3, Google Cloud Agent Builder, and MongoDB Atlas.*

## 1. System Overview

Hodari is a three-tier system organized around a multi-agent architecture.

A web/mobile client captures user intent through chat, voice, and map interaction. A thin orchestrator agent running on Google Cloud Agent Builder coordinates three specialist sub-agents:

- Planner Agent
- Researcher Agent
- Itinerary Agent

Each is powered by Gemini 3 with a tightly scoped prompt and its own subset of tools.

The tools read and write through the MongoDB MCP server to a MongoDB Atlas cluster that stores:

- User profiles
- Vectorized catalog of places
- Full interaction history

Google Maps Grounding and Google Routes provide external real-world data.

### Communication Flow

- Client ↔ Orchestrator: HTTPS
- Streaming responses: Server-Sent Events (SSE)
- Orchestrator ↔ MongoDB: MCP Protocol
- Explorer/Map Agent ↔ Google Maps: MCP Protocol (Maps Grounding Lite)
- Researcher & Itinerary Agents ↔ External APIs: Gemini Function Calling

Deployment runs on Google Cloud Run behind Agent Builder orchestration.

---

## 2. Why Multi-Agent

A single Gemini instance could solve the problem, but the architecture is intentionally decomposed because:

1. Planning user intent
2. Gathering grounded evidence
3. Building feasible itineraries

require different reasoning styles.

### Benefits

- Parallel information gathering
- Better debugging
- Cleaner separation of concerns
- Faster perceived response times

### Trade-offs

- Higher token usage
- Additional integration complexity

The architecture is intentionally limited to:

- 1 Orchestrator
- 3 Specialist Agents

to avoid unnecessary inter-agent latency.

### Per-Agent Justification

| Agent | Why it exists | What it costs | MVP status |
|---|---|---|---|
| Orchestrator | Owns session state, routing, memory writes, SSE streaming | Always-on entry point | **Core** — always needed |
| Planner | Isolates intent → structured constraints so downstream agents receive clean input | One extra LLM round-trip before any data is fetched | **Core**, but can start as a structured-output call inside the Orchestrator if latency hurts |
| Explorer / Map | Tool-heavy parallel grounding via Maps MCP — a different reasoning mode than planning | Highest token user | **Core** |
| Itinerary | Sequencing / feasibility / routing is distinct optimization reasoning | One extra round-trip | **Core** |

**Build order:** Prove one end-to-end path first — Orchestrator → Explorer/Map → result rendered on the map. Add the Planner and Itinerary agents once the Maps MCP loop works. Do **not** build all four in parallel; the multi-agent split earns its keep only after the core loop is grounded.

---

## 3. Client Tier

The client is a Next.js application functioning as:

- Responsive Web App
- Progressive Web App (PWA)

### Main Components

- Conversational chat panel
- Interactive map with custom pins — rendered via **Maps JavaScript API** (target UX: Uber/Google Maps style with nearby places overlay)
- Swipeable itinerary card stack
- Push-to-talk voice input

### Responsibilities

The client only handles:

- UI state
- Streaming rendering
- Audio capture

All reasoning remains server-side.

---

## 4. Orchestrator Agent

The orchestrator is the entry point for every user request.

### Responsibilities

#### Session State

- Loads user profile
- Loads conversation history
- Persists updates and feedback

#### Routing

Routes requests between:

- Planner
- Researcher
- Itinerary

depending on the request type.

#### Memory Writes

Owns the `save_preference` tool because it manages session-level state.

---

## 5. Planner Agent

The Planner is the first specialist invoked.

### Inputs

- User request
- User profile
- Conversation history

### Outputs

Structured JSON plan containing:

- User goal
- Subtasks
- Constraints

Examples of constraints:

- Budget
- Time
- Dietary restrictions
- Accessibility requirements
- Current location

### Characteristics

- Uses no external tools
- Focuses purely on reasoning
- Output validated using Pydantic

---

## 6. Explorer / Map Agent

The Explorer (also called the Map Agent) performs information gathering. It is the agent directly connected to Google Maps via the Maps Grounding Lite MCP server — this is the primary reason for separating it from the Orchestrator. Routing place search and routing through MCP instead of Gemini Function Calling avoids overloading the vector database with geospatial data and reduces token consumption.

### MCP Connection

- **Server:** `https://mapstools.googleapis.com/mcp`
- **Transport:** Streamable HTTP
- **Auth:** `X-Goog-Api-Key` header — requires "Maps Grounding Lite API" enabled in Google Cloud Console

### Tools

#### search_places (Maps Grounding Lite MCP)

Parameters:

- `text_query` (required): natural-language description of what to find
- `location_bias` (optional): lat/lng coordinates to bias results
- `language_code` (optional)
- `region_code` (optional)

Returns: Place ID, name, coordinates, AI-generated summary, Google Maps link, ratings, price, hours, photos, address.

#### find_similar_preferences (internal tool)

Uses:

- Gemini embeddings (`text-embedding-004`)
- MongoDB Atlas Vector Search

Produces personalized ranking based on user interaction history. This is the **only** tool that touches the vector database — initial place data comes from Maps MCP, not embeddings.

#### web_search (Gemini Function Calling)

Used only when time-sensitive information is required:

- Events
- Transit disruptions
- Festivals

### Key Advantage

All tool calls execute in parallel. Place search and routing go through the Google-managed MCP server — grounded, low-latency, no custom integration maintenance.

Output:

- 5–10 enriched candidate locations per task
- Grounded metadata from Google Maps
- Personalization scores from vector search

---

## 7. Itinerary Agent

Creates the final itinerary.

### Input

- Planner output
- Researcher candidate set

### Tool

#### compute_routes (Maps Grounding Lite MCP)

Uses the same MCP server as the Explorer agent (`https://mapstools.googleapis.com/mcp`).

Parameters:

- Origin: address, coordinates, or Place ID
- Destination: address, coordinates, or Place ID
- Travel mode: DRIVE or WALK

Returns:

- Distance
- Duration
- Route polyline

Note: no step-by-step directions or real-time traffic in Maps Grounding Lite. If turn-by-turn is required in a future version, use the Routes API directly.

### Responsibilities

- Verify itinerary feasibility
- Optimize stop ordering
- Ensure constraints are respected

### Output

Structured itinerary containing:

- Stops
- Travel transitions
- Rationales
- Voice-friendly summary

---

## 8. Data Tier

MongoDB Atlas hosts three collections.

### users Collection

Stores:

- User ID
- Email
- Home country
- Languages
- Dietary preferences
- Budget tier
- Accessibility requirements

### places Collection

Stores:

- Google Place ID
- Name
- City
- GeoJSON location
- Categories
- Price level
- Description
- 768-dimensional embedding vector
- Ratings
- Photos
- Reviews

Atlas Vector Search uses:

- HNSW indexing
- Cosine similarity

> **Phasing — `places` is optional for MVP.** With Maps Grounding Lite returning fresh, grounded places on demand, a pre-vectorized catalog duplicates Google's data and adds embedding generation + index maintenance — all to power exactly one tool (`find_similar_preferences`). For MVP, personalize directly from the `interactions` collection (e.g., re-rank Maps candidates by the user's past likes and preferred categories). Introduce the vectorized `places` catalog only if simple ranking proves insufficient — at that point the complexity is justified by a real need, not assumed upfront.

### interactions Collection

Stores user feedback:

- Liked
- Disliked
- Visited
- Skipped
- Booked

Used to improve future recommendations.

---

## 9. End-to-End Request Flow

### Example Request

> I have 4 hours before the game, $60 budget, vegetarian, no long lines.

### Flow

1. User submits request.
2. Orchestrator loads context.
3. Planner generates structured plan.
4. Researcher gathers and ranks candidates.
5. Itinerary Agent builds schedule.
6. Response streams to client.
7. User feedback updates memory.
8. Future recommendations improve through personalization.

---

## 10. Inter-Agent Contracts

Three schemas are defined and validated using Pydantic.

### Plan

Contains:

- Goal
- Constraints
- Ordered subtasks

### CandidateSet

Contains:

- Grounded locations
- Ranking scores

### Itinerary

Contains:

- Stops
- Travel times
- Rationales
- Voice summary

Malformed outputs trigger:

1. Validation failure
2. One retry
3. Graceful error if retry fails

---

## 11. Deployment Topology

### Services

- Orchestrator
- Planner
- Explorer / Map
- Itinerary

Each *can* run independently on Cloud Run.

> **Phasing — one service for MVP.** Four independently deployed services means four deploys, four cold-start surfaces, and inter-service auth to maintain. For MVP, run all agents in a single Cloud Run service with in-process routing. Split into per-agent services only when one needs independent scaling or isolation (Phase 2).

### Frontend

- Next.js
- Vercel or Cloud Run
- CDN

### Data Layer

- MongoDB Atlas
- MongoDB MCP Server

### Security

- Google Cloud IAM
- Short-lived API keys
- Google Secret Manager

### Observability

- Cloud Run logging
- Distributed tracing
- Structured logs at every agent boundary

---

## 12. Out of Scope for MVP

The following features are intentionally excluded:

- Booking
- Payments
- Email integration
- Calendar synchronization
- OAuth integrations
- Multilingual support

These remain future roadmap items.

### Deferred Architecture (Phase 2)

Distinct from the excluded *features* above, these are pieces of *this* design that should be built later, not first:

- Vectorized `places` catalog + Atlas Vector Search (MVP starts with `interactions`-based ranking)
- Per-agent Cloud Run services (MVP runs as one service)
- Weather-aware itineraries via `lookup_weather` (the tool already ships on the Maps MCP — wire it up later)
- Planner and Itinerary as separate agents (can begin as structured-output steps inside the Orchestrator)

**Rationale:** each adds real cost — maintenance, ops, or tokens — and none is required to prove the core loop: grounded place search → feasible itinerary on a map. Add them when a concrete need appears, not preemptively.

---

## Summary

Hodari is a multi-agent tourist assistant built around:

- Gemini 3
- Google Cloud Agent Builder
- Google Maps APIs
- MongoDB Atlas

The architecture demonstrates:

- Grounded recommendations
- Persistent memory
- Personalized retrieval
- Dynamic itinerary generation
- Multi-agent orchestration
