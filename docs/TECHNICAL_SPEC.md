# Swiperflix — Technical Specification

**Version:** 1.0
**Date:** 2026-02-22

---

## 1. System Overview

Swiperflix is a two-service system: a Python/FastAPI backend (gateway) and a TypeScript/React frontend (player). The gateway syncs video metadata from an OpenList file server into SQLite and exposes a REST API. The player is a Vite-built SPA that consumes this API and renders a gesture-driven video feed.

```
┌─────────────┐     sync      ┌──────────────────┐     API      ┌──────────────────┐
│  OpenList    │◄─────────────│  swiperflix-      │◄────────────│  swiperflix-      │
│  (file srv)  │  POST /fs/list│  gateway          │  /api/v1/*  │  player           │
└──────┬───────┘              │  (FastAPI+SQLite) │             │  (Vite+React SPA) │
       │                      └──────────────────┘             └──────────────────┘
       │  302 redirect                                                │
       └──────────────────────────────────────────────────────────────┘
                          video stream (direct)
```

---

## 2. Gateway Service

### 2.1 Technology Stack

| Component | Technology | Version |
|-----------|-----------|---------|
| Runtime | Python | 3.11+ |
| Framework | FastAPI | 0.121+ |
| ORM | SQLAlchemy | 2.0 |
| Database | SQLite | (bundled) |
| HTTP client | httpx | 0.28 |
| Config | pydantic-settings | 2.12 |
| Validation | Pydantic | 2.12 |

### 2.2 Configuration

All configuration is via environment variables (prefix `OPENLIST_`) loaded by pydantic-settings from `.env` or the process environment.

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `OPENLIST_API_BASE_URL` | str | `http://localhost:5244` | OpenList API endpoint |
| `OPENLIST_DIR_PATH` | str | `/` | Directory to sync |
| `OPENLIST_PASSWORD` | str? | — | Directory password |
| `OPENLIST_TOKEN` | str? | — | OpenList auth token (raw) |
| `OPENLIST_USERNAME` | str? | — | Basic auth username |
| `OPENLIST_USER_PASSWORD` | str? | — | Basic auth password |
| `OPENLIST_PUBLIC_BASE_URL` | str? | — | Public base URL for file links |
| `DATABASE_URL` | str | `sqlite:///./swiperflix.db` | SQLAlchemy connection URL |

### 2.3 Database Schema

Four tables, all managed by SQLAlchemy ORM with auto-creation on startup.

#### `videos`

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | INTEGER | PK, autoincrement | Internal ID |
| path | VARCHAR | UNIQUE, NOT NULL | Original path from OpenList |
| source_url | VARCHAR | NOT NULL | Direct download URL |
| cover | VARCHAR | nullable | Thumbnail URL |
| title | VARCHAR | nullable | Display title |
| duration | INTEGER | nullable | Duration in seconds |
| orientation | ENUM(portrait, landscape) | nullable | Video orientation |
| pick_count | INTEGER | NOT NULL, default 0 | Times served in playlist |
| created_at | DATETIME | NOT NULL | Row creation timestamp |

Indexes: `ix_videos_pick_count` on `(pick_count, id)` for playlist ordering.

#### `reactions`

| Column | Type | Constraints |
|--------|------|-------------|
| id | INTEGER | PK |
| video_id | INTEGER | FK → videos.id (CASCADE) |
| type | ENUM(like, dislike) | NOT NULL |
| source | VARCHAR | nullable (scroll/button/swipe) |
| client_timestamp | DATETIME | nullable |
| session_id | VARCHAR | nullable |
| created_at | DATETIME | NOT NULL |

Unique constraint: `(video_id, type, session_id)` — one reaction per type per session.

#### `impressions`

| Column | Type | Constraints |
|--------|------|-------------|
| id | INTEGER | PK |
| video_id | INTEGER | FK → videos.id (CASCADE) |
| watched_seconds | FLOAT | NOT NULL |
| completed | BOOLEAN | NOT NULL, default false |
| created_at | DATETIME | NOT NULL |

No deduplication — each impression is a separate row.

#### `not_playable_reports`

| Column | Type | Constraints |
|--------|------|-------------|
| id | INTEGER | PK |
| video_id | INTEGER | FK → videos.id (CASCADE) |
| reason | VARCHAR | nullable |
| client_timestamp | DATETIME | nullable |
| session_id | VARCHAR | nullable |
| created_at | DATETIME | NOT NULL |

Unique constraint: `(video_id, session_id)` — one report per session.

### 2.4 API Endpoints

All endpoints under `/api/v1/`. No authentication at the application level.

#### `GET /api/v1/playlist`

Returns a batch of videos ordered by `pick_count` ascending (least-served first), with random tiebreaking.

- **Query params:** `limit` (int, 1–50, default 5)
- **Response:** `{ items: VideoItem[], nextCursor: null }`
- **Side effect:** Increments `pick_count` for all returned video IDs
- **Errors:** 400 (validation)

Note: `nextCursor` is always `null` — the gateway uses pick_count ordering rather than cursor pagination. The player's cursor-based prefetch logic gracefully handles this.

#### `GET /api/v1/videos/{video_id}/stream`

Redirects to the video's source URL.

- **Response:** 302 redirect to download URL
- **Behavior:** If `source_url` is absolute HTTP(S), redirects directly. Otherwise resolves via OpenList's `/api/fs/get` endpoint.
- **Errors:** 404 (video not found), 502 (OpenList resolution failure)

#### `POST /api/v1/videos/{video_id}/like`

Records a like reaction.

- **Body:** `{ source?: string, timestamp?: ISO8601, sessionId?: string }`
- **Response:** `{ ok: true }`
- **Errors:** 404 (video not found), 409 (already reacted for this session+type)

#### `POST /api/v1/videos/{video_id}/dislike`

Same contract as `/like` with `type=dislike`.

#### `POST /api/v1/videos/{video_id}/impression`

Records watch progress.

- **Body:** `{ watchedSeconds: number, completed: boolean }`
- **Response:** `{ ok: true }`
- **Errors:** 404 (video not found)

#### `POST /api/v1/videos/{video_id}/not-playable`

Reports a playback failure.

- **Body:** `{ reason?: string, timestamp?: ISO8601, sessionId?: string }`
- **Response:** `{ ok: true }`
- **Errors:** 404 (video not found), 409 (already reported for this session)

### 2.5 Error Model

All errors follow a consistent shape:

```json
{
  "error": {
    "code": "VIDEO_NOT_FOUND",
    "message": "Video id 123 not found",
    "retryable": false,
    "details": null
  }
}
```

Error codes: `VIDEO_NOT_FOUND` (404), `ALREADY_REACTED` (409), `ALREADY_REPORTED` (409), `OPENLIST_LINK_ERROR` (502).

### 2.6 OpenList Sync

The sync process (`app/sync.py`) fetches file listings from OpenList and upserts video records.

**Algorithm:**
1. Call `POST /api/fs/list` with configured directory path, paginated at 100 items/page
2. Filter out directory entries (keeps all file entries regardless of extension)
3. Build video records with path, source_url, title, and optional metadata (duration, orientation, cover)
4. Upsert into SQLite — match on `path`, update `source_url`/metadata on conflict, insert new entries

**Auth handling:**
- Token auth: raw token in `Authorization` header (no Bearer prefix)
- Basic auth: username/password as httpx auth tuple
- Auto-retry on 401: re-authenticates via `/api/auth/login` and retries

**Trigger points:**
- Automatic on gateway startup (failure logged, does not prevent boot)
- Manual via CLI: `python -m app.sync [--dir /path]`
- Called by `ensure_videos_loaded()` if the videos table is empty when a playlist is requested

---

## 3. Player Service

### 3.1 Technology Stack

| Component | Technology | Version |
|-----------|-----------|---------|
| Build tool | Vite | 6.x |
| UI framework | React | 19.x |
| Language | TypeScript | 5.9 (strict) |
| Styling | Tailwind CSS | 4.x (PostCSS) |
| UI primitives | Radix UI | (dropdown-menu, slider, toast, slot) |
| Icons | Lucide React | 0.555 |
| Utility | class-variance-authority, clsx, tailwind-merge | — |

### 3.2 Application Structure

```
src/
├── main.tsx                          # Entry point — renders <App> into #root
├── App.tsx                           # PlaylistProvider → VideoPlayer + Toaster
├── components/
│   ├── player/
│   │   └── VideoPlayer.tsx           # 1162-line monolith — all player logic
│   └── ui/                           # Radix-based UI primitives
│       ├── badge.tsx
│       ├── button.tsx
│       ├── dropdown-menu.tsx
│       ├── toast.tsx / toaster.tsx / use-toast.ts
│       └── video-slider.tsx          # Custom progress bar
├── providers/
│   └── playlist-provider.tsx         # React Context for playlist state
├── lib/
│   ├── api.ts                        # fetch wrapper with timeout
│   ├── config.ts                     # Endpoint templates
│   ├── types.ts                      # Shared type definitions
│   └── utils.ts                      # cn() helper
└── globals.css                       # Tailwind imports + custom animations
```

### 3.3 State Management

Single React Context (`PlaylistProvider`) manages all playlist state:

| State | Type | Purpose |
|-------|------|---------|
| `videos` | `VideoItem[]` | Current playlist items |
| `currentIndex` | `number` | Index of active video |
| `cursor` | `string \| null` | Pagination cursor for next page |
| `loading` | `boolean` | Initial load state |
| `loadingMore` | `boolean` | Pagination load state |
| `error` | `string?` | Error message |

**Refs (not reactive):**
- `prefetchedNext` — pre-fetched next playlist for seamless transition
- `awaitingPrefetchSwap` — flag for pending playlist swap
- `prefetchPromise` — deduplication of prefetch requests

**Actions:**
- `goNext()` — advance index, trigger prefetch if near tail
- `goPrev()` — decrement index (min 0)
- `likeCurrent()` — send like reaction, stay on video
- `dislikeCurrent()` — send dislike reaction, auto-advance
- `refresh()` — re-bootstrap from scratch

### 3.4 Video Element Management

VideoPlayer manages a pool of `<video>` elements for performance:

| Pool | Size | Purpose |
|------|------|---------|
| `cachedEls` | Map, max 12 | Previously-viewed video elements for instant back-nav |
| `preloadedEls` | Map | Elements currently being preloaded |
| `preloadedUrls` | Set | URLs that have been preloaded |

**Preloading strategy:**
1. On video change, preload next `N` videos (default 3, configurable via `config.preloadCount`)
2. Concurrency limited to 2 simultaneous preloads (`PRELOAD_CONCURRENCY`)
3. Each preload creates a `<video>` element, sets `preload="auto"`, and waits for `canplaythrough`
4. Preloads are abortable via `AbortController` — cancelled when no longer needed
5. Additionally, a `<link rel="preload" as="video">` hint is injected for the immediate next video

**Cache eviction:** LRU — when cache exceeds 12 elements, oldest entries are removed.

### 3.5 Gesture System

All gesture handling is in VideoPlayer.tsx. Constants:

| Constant | Value | Purpose |
|----------|-------|---------|
| `SCROLL_THRESHOLD` | 25px | Min wheel delta for navigation |
| `SWIPE_THRESHOLD` | 45px | Min touch distance for swipe |
| `SWIPE_VELOCITY` | 0.6 px/ms | Min velocity for swipe recognition |
| `LONG_PRESS_DELAY` | 250ms | Hold duration to trigger long-press |
| `REWIND_STEP` | 0.4s | Seconds to rewind per interval |
| `REWIND_INTERVAL` | 200ms | Interval between rewind steps |

**Touch flow:**
1. `touchstart` → record position + timestamp, start long-press timer
2. If held > 250ms → enter press mode (rewind or fast-forward based on X position)
3. `touchend` → if short tap, toggle play/pause; if swipe detected, navigate
4. Double-tap detection via timing between consecutive taps

**Wheel flow:**
- Vertical delta > threshold → navigate (deltaY < 0 = next, > 0 = prev)

### 3.6 Animation System

Video transitions use CSS animations applied via class toggling:

| Class | Direction | Purpose |
|-------|-----------|---------|
| `animate-slide-in-up` | Next | Incoming video slides up from bottom |
| `animate-slide-in-down` | Prev | Incoming video slides down from top |
| `animate-slide-out-up` | Next | Outgoing video slides up and out |
| `animate-slide-out-down` | Prev | Outgoing video slides down and out |

The animation system uses two host `<div>` elements — one for the active video, one for the outgoing. On navigation, the outgoing video is placed in the outgoing host with exit animation, while the new video enters the active host with entrance animation.

### 3.7 Impression Tracking

- `sendImpressionOnce()` fires when the video changes or the component unmounts
- Tracks `watchedSeconds` (clamped to known duration) and `completed` flag
- Deduplicated client-side via `impressionsSent` ref (Set of video IDs)
- Fires silently — errors are logged but don't interrupt the user

### 3.8 API Client

`lib/api.ts` provides typed functions wrapping native `fetch`:

| Function | Method | Endpoint |
|----------|--------|----------|
| `fetchPlaylist(config, cursor?)` | GET | `/api/v1/playlist` |
| `sendReaction(config, id, action)` | POST | `/api/v1/videos/{id}/like\|dislike` |
| `sendImpression(config, id, payload)` | POST | `/api/v1/videos/{id}/impression` |
| `reportNotPlayable(config, id, payload)` | POST | `/api/v1/videos/{id}/not-playable` |

All requests use `withTimeout()` (10s default). `requestJson<T>()` handles response parsing and error extraction.

### 3.9 Build & Deployment

- **Dev:** `pnpm dev` → Vite dev server on port 3000, proxies `/api` to `localhost:8000`
- **Build:** `pnpm build` → `tsc -b && vite build` → static assets in `dist/`
- **Production:** Dockerfile builds static assets, serves via nginx on port 3000
- **Proxy:** nginx config routes `/api/` to gateway, serves SPA with `try_files` fallback

---

## 4. Type Definitions

### 4.1 Shared Types (Frontend)

```typescript
type VideoItem = {
  id: string;
  url: string;
  cover?: string;
  title?: string;
  duration?: number;
  orientation?: "portrait" | "landscape";
};

type PlaylistResponse = {
  items: VideoItem[];
  nextCursor?: string | null;
};

type ApiConfig = {
  baseUrl: string;          // "" (relative URLs)
  playlistPath: string;     // "/api/v1/playlist"
  likePath: string;         // "/api/v1/videos/{id}/like"
  dislikePath: string;      // "/api/v1/videos/{id}/dislike"
  impressionPath: string;   // "/api/v1/videos/{id}/impression"
  notPlayablePath: string;  // "/api/v1/videos/{id}/not-playable"
  preloadCount: number;     // 3
};
```

### 4.2 Request/Response Schemas (Backend)

```python
class VideoItem(BaseModel):
    id: str
    url: str
    cover: str | None
    title: str | None
    duration: int | None
    orientation: Literal["portrait", "landscape"] | None

class PlaylistResponse(BaseModel):
    items: list[VideoItem]
    nextCursor: str | None

class ReactionRequest(BaseModel):
    source: Literal["scroll", "button", "swipe"] | None
    timestamp: datetime | None
    sessionId: str | None

class ImpressionRequest(BaseModel):
    watchedSeconds: float
    completed: bool

class NotPlayableReportRequest(BaseModel):
    reason: str | None
    timestamp: datetime | None
    sessionId: str | None

class ErrorResponse(BaseModel):
    error: ErrorBody  # { code, message, retryable?, details? }
```

---

See also: [Architecture](./ARCHITECTURE.md) | [PRD](./PRD.md) | [API Reference](./API_REFERENCE.md) | [Deployment Guide](./DEPLOYMENT_GUIDE.md)
