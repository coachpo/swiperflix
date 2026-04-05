# Swiperflix — Architecture Document

**Version:** 1.0
**Date:** 2026-02-22

---

## 1. System Architecture

Swiperflix is a two-service system with an external dependency on OpenList for video storage. Both services are independently deployable Docker containers designed to sit behind a shared reverse proxy. The repository is a single monorepo that tracks both service directories together while keeping separate build contexts for each service.

```
                          ┌─────────────────────────────────────────────────┐
                          │              Reverse Proxy (nginx/Caddy)        │
                          │                                                 │
                          │   /api/v1/*  ──►  swiperflix-gateway :8000      │
                          │   /*         ──►  swiperflix-player  :3000      │
                          └────────────────────────┬────────────────────────┘
                                                   │
                          ┌────────────────────────┼────────────────────────┐
                          │                        │                        │
                ┌─────────▼──────────┐   ┌────────▼─────────┐   ┌─────────▼──────────┐
                │  swiperflix-gateway │   │ swiperflix-player │   │     OpenList        │
                │  (FastAPI + SQLite) │   │ (Vite + React)   │   │  (file server)      │
                │                    │   │                   │   │                     │
                │  • Playlist API    │   │  • SPA (static)   │   │  • Video storage    │
                │  • Reaction API    │   │  • Gesture player │   │  • File listings    │
                │  • Stream redirect │   │  • Preload engine │   │  • Direct download  │
                │  • OpenList sync   │   │  • Impression     │   │                     │
                │                    │   │    tracking       │   │                     │
                └────────┬───────────┘   └──────────────────┘   └──────────┬──────────┘
                         │                                                  │
                         │  sync: POST /api/fs/list (paginated)            │
                         ├─────────────────────────────────────────────────►│
                         │                                                  │
                         │  stream: GET /api/v1/videos/{id}/stream         │
                         │  → 302 redirect to OpenList download URL        │
                         │                                                  │
                         │  browser fetches video directly from OpenList    │
                         └──────────────────────────────────────────────────┘
```

### 1.1 Design Principles

- **No video proxying.** The gateway never touches video bytes. It resolves URLs and issues 302 redirects. The browser streams directly from OpenList.
- **No application-level auth.** Authentication is delegated entirely to the reverse proxy. The gateway and player expose open endpoints.
- **Relative URLs.** The player uses empty `baseUrl` — all API calls resolve against the current origin. This makes reverse proxy configuration trivial.
- **Single-file patterns.** Gateway routes live in one file (`main.py`). The player's core logic lives in one component (`VideoPlayer.tsx`). The project is small enough that splitting adds indirection without benefit.
- **SQLite by default.** Zero-config persistence. The database file is auto-created and can be deleted to force a full resync.

### 1.2 Service Boundaries

| Service | Responsibility | Data Owned |
|---------|---------------|------------|
| OpenList | Source of truth for video files and directory structure | Video files, file metadata |
| Gateway | Syncs metadata, serves playlist/reaction API, resolves stream URLs | SQLite DB (videos, reactions, impressions, reports) |
| Player | Renders UI, handles gestures, preloads videos, tracks impressions | Client-side state, video element pool |

### 1.3 Communication Patterns

| Pattern | Direction | Protocol | Description |
|---------|-----------|----------|-------------|
| Sync | Gateway → OpenList | HTTP POST (paginated) | Server-initiated crawl of file listings |
| API | Player → Gateway | REST (JSON) | Client-initiated playlist fetch, reactions, impressions |
| Stream | Player → Gateway → OpenList | HTTP 302 redirect | Gateway resolves URL, player follows redirect to source |

---

## 2. Data Flow

### 2.1 Sync Flow (Gateway ← OpenList)

Populates the local database with video metadata from OpenList.

```
Gateway                              OpenList                SQLite
  │                                     │                      │
  │  POST /api/fs/list                  │                      │
  │  { path: "/", page: 1, per_page: 100 }                    │
  ├────────────────────────────────────►│                      │
  │                                     │                      │
  │  { content: [...files], total: N }  │                      │
  │◄────────────────────────────────────┤                      │
  │                                     │                      │
  │  (filter out directories)           │                      │
  │                                     │  UPSERT videos      │
  │                                     │  (match on path)    │
  ├─────────────────────────────────────┼─────────────────────►│
  │                                     │                      │
  │  POST /api/fs/list (page 2...)     │                      │
  ├────────────────────────────────────►│                      │
  │         ... until all pages ...     │                      │
```

Triggers:
1. Automatic on gateway startup (non-blocking — failure is logged, boot continues)
2. Manual CLI: `python -m app.sync [--dir /path]`
3. Lazy: if playlist is requested and videos table is empty, sync runs inline

Auth chain: Token → Basic auth → Auto-login retry on 401.

### 2.2 Playlist Flow (Player → Gateway)

Fetches a batch of videos for the swipe feed.

```
Player                               Gateway                    SQLite
  │                                     │                          │
  │  GET /api/v1/playlist?limit=5       │                          │
  ├────────────────────────────────────►│                          │
  │                                     │  SELECT ... ORDER BY     │
  │                                     │  pick_count ASC, RANDOM()│
  │                                     ├─────────────────────────►│
  │                                     │                          │
  │                                     │  UPDATE pick_count += 1  │
  │                                     ├─────────────────────────►│
  │                                     │                          │
  │  { items: [...], nextCursor: null } │                          │
  │◄────────────────────────────────────┤                          │
  │                                     │
  │  (store in PlaylistProvider)        │
  │  (begin preloading next 3)         │
```

Playlist selection algorithm: Videos are ordered by `pick_count` ascending with random tiebreaking. Each fetch atomically increments `pick_count` for returned videos, ensuring fair rotation across the library. `nextCursor` is always `null` — the gateway doesn't implement cursor pagination; the player's cursor handling gracefully degrades.

### 2.3 Stream Flow (Player → OpenList via Gateway redirect)

Video playback uses a redirect pattern — no bytes flow through the gateway.

```
Player (browser)                     Gateway                    OpenList
  │                                     │                          │
  │  <video src="/api/v1/videos/42/stream">                        │
  │  GET /api/v1/videos/42/stream       │                          │
  ├────────────────────────────────────►│                          │
  │                                     │  lookup source_url       │
  │                                     │  (if relative, resolve   │
  │                                     │   via OpenList /fs/get)  │
  │                                     │                          │
  │  302 Location: https://openlist/... │                          │
  │◄────────────────────────────────────┤                          │
  │                                     │                          │
  │  GET https://openlist/d/file.mp4    │                          │
  ├───────────────────────────────────────────────────────────────►│
  │                                     │                          │
  │  video bytes (direct stream)        │                          │
  │◄──────────────────────────────────────────────────────────────┤
```

### 2.4 Reaction Flow (Player → Gateway)

Like, dislike, impression, and not-playable reports follow the same pattern.

```
Player                               Gateway                    SQLite
  │                                     │                          │
  │  POST /api/v1/videos/42/like        │                          │
  │  { source: "button", sessionId: "abc" }                        │
  ├────────────────────────────────────►│                          │
  │                                     │  INSERT INTO reactions   │
  │                                     │  (dedup on session+type) │
  │                                     ├─────────────────────────►│
  │                                     │                          │
  │  { ok: true }                       │                          │
  │◄────────────────────────────────────┤                          │
```

Reactions are fire-and-forget from the player's perspective — errors are caught and logged but never interrupt the user experience.

---

## 3. Service Internals

### 3.1 Gateway Architecture

```
app/
├── main.py              # FastAPI app + all route handlers (single-file pattern)
├── models.py            # SQLAlchemy ORM models (Video, Reaction, Impression, NotPlayableReport)
├── schemas.py           # Pydantic request/response schemas
├── config.py            # pydantic-settings config (env vars)
├── db.py                # Engine, session factory, table creation, migrations
├── openlist_client.py   # httpx client for OpenList API (auth, listing, URL resolution)
├── sync.py              # Sync orchestrator (CLI entry point)
└── utils.py             # Helpers (error_response() — structured error raiser)
```

Key design decisions:

- **Single router file.** All 6 endpoints are defined in `main.py`. No blueprint/router splitting — the API surface is small enough that one file is clearer.
- **Idempotent migrations.** New columns are added via `_ensure_*` functions in `db.py` that check column existence before altering. No Alembic.
- **Sync-on-empty.** If a playlist request finds zero videos, the gateway runs a sync inline before responding. This handles cold starts gracefully.
- **Session-scoped deduplication.** Reactions and not-playable reports use `(video_id, session_id)` unique constraints. The player generates a session ID per page load.

### 3.2 Player Architecture

```
                    ┌──────────────────────────────────┐
                    │           main.tsx                │
                    │  ReactDOM.createRoot(#root)       │
                    └──────────────┬───────────────────┘
                                   │
                    ┌──────────────▼───────────────────┐
                    │            App.tsx                │
                    │  PlaylistProvider                 │
                    │    └── VideoPlayer + Toaster      │
                    └──────────────┬───────────────────┘
                                   │
              ┌────────────────────┼────────────────────┐
              │                    │                     │
    ┌─────────▼──────┐  ┌────────▼─────────┐  ┌───────▼────────┐
    │ PlaylistProvider│  │   VideoPlayer    │  │    Toaster     │
    │ (React Context) │  │  (1162 lines)    │  │  (Radix toast) │
    │                 │  │                  │  │                │
    │ • fetch playlist│  │ • Video element  │  └────────────────┘
    │ • pagination    │  │   pool & cache   │
    │ • prefetch next │  │ • Gesture system │
    │ • like/dislike  │  │ • Animations     │
    │ • cursor mgmt   │  │ • Playback ctrl  │
    └─────────────────┘  │ • Impression     │
                         │   tracking       │
                         │ • Preload engine │
                         │ • UI controls    │
                         └─────────────────┘
```

Component responsibilities:

- **PlaylistProvider** — Data layer. Fetches playlists, manages pagination, handles reactions. Exposes `videos`, `currentIndex`, `goNext()`, `goPrev()`, `likeCurrent()`, `dislikeCurrent()` via context.
- **VideoPlayer** — Presentation + interaction layer. Manages the video element pool, gesture recognition, animations, playback controls, preloading, and impression tracking. This is intentionally a monolith — all player logic is colocated to avoid prop-drilling and context overhead for tightly coupled state.
- **Toaster** — Notification layer. Displays feedback for reactions and reports.

### 3.3 Video Element Pool

The player maintains three collections for video element lifecycle:

```
                    ┌─────────────────────────────────────┐
                    │         Video Element Pool           │
                    │                                      │
                    │  preloadedEls (Map<id, HTMLVideo>)   │
                    │  ├── video-7  [loading...]           │
                    │  ├── video-8  [canplaythrough]       │
                    │  └── video-9  [loading...]           │
                    │                                      │
                    │  cachedEls (Map<id, HTMLVideo>)      │
                    │  ├── video-1  [paused, cached]       │  max 12
                    │  ├── video-2  [paused, cached]       │  LRU eviction
                    │  ├── video-3  [paused, cached]       │
                    │  └── ...                             │
                    │                                      │
                    │  preloadedUrls (Set<url>)            │
                    │  └── tracks which URLs are preloaded │
                    └─────────────────────────────────────┘
```

Lifecycle:
1. Video enters preload queue → `<video>` element created, `src` set, `preload="auto"`
2. `canplaythrough` fires → element moves to `preloadedEls`
3. User navigates to video → element attached to DOM, playback starts
4. User navigates away → element detached, moved to `cachedEls`
5. Cache exceeds 12 → oldest entries evicted (element paused, src cleared)

Concurrency: Max 2 simultaneous preloads (`PRELOAD_CONCURRENCY`). Additional preloads queue behind active ones. Each preload is cancellable via `AbortController`.

### 3.4 Gesture System

All gesture handling is in VideoPlayer.tsx. The system uses a state machine:

```
  idle ──► pressing ──► swiping ──► animating ──► idle
   │           │
   │           └──► long-press (rewind / fast-forward)
   │
   └──► tap (play/pause)
   └──► double-tap (like)
```

Touch flow:
1. `touchstart` → record position + timestamp, start long-press timer
2. If held > 250ms → enter press mode (rewind or fast-forward based on X position)
3. `touchend` → if short tap, toggle play/pause; if swipe detected, navigate
4. Double-tap detection via timing between consecutive taps

Wheel flow: Vertical delta > 25px threshold → navigate (deltaY < 0 = next, > 0 = prev).

Animation lock prevents navigation during active transitions.

---

## 4. Deployment Topology

### 4.1 Production Architecture

```
┌──────────────────────────────────────────────────────────┐
│                    Host Machine                           │
│                                                          │
│  ┌──────────────────────────────────────────────────┐    │
│  │         Reverse Proxy (nginx / Caddy)            │    │
│  │                                                  │    │
│  │  :443 (HTTPS)                                    │    │
│  │  ├── /api/v1/*  → gateway:8000                   │    │
│  │  └── /*         → player:3000                    │    │
│  │                                                  │    │
│  │  (Optional: basic auth, IP allowlist, etc.)      │    │
│  └──────────────────────────────────────────────────┘    │
│                                                          │
│  ┌─────────────────────┐  ┌──────────────────────────┐   │
│  │  swiperflix-gateway  │  │  swiperflix-player       │   │
│  │  (Docker, arm64)     │  │  (Docker, arm64)         │   │
│  │                      │  │                          │   │
│  │  FastAPI :8000       │  │  nginx :3000             │   │
│  │  SQLite (volume)     │  │  static dist/ assets     │   │
│  └─────────────────────┘  └──────────────────────────┘   │
│                                                          │
└──────────────────────────────────────────────────────────┘
         │
         │  Network
         ▼
┌──────────────────┐
│    OpenList       │
│  (file server)    │
│  :5244            │
└──────────────────┘
```

### 4.2 Docker Images

| Service | Base Image | Entrypoint | Port | Notes |
|---------|-----------|------------|------|-------|
| Gateway | `python:3.11-slim` | `uvicorn app.main:app` | 8000 | SQLite DB should be on a volume |
| Player | `nginx:alpine` | nginx serving `dist/` | 3000 | Multi-stage: Node build → nginx serve |

Both images target `linux/arm64` only (CI constraint).

### 4.3 Player nginx Configuration

The player's production nginx config handles two concerns:

1. **SPA routing:** `try_files $uri $uri/ /index.html` — all non-file paths serve the SPA entry point
2. **API proxy:** `/api/` requests are proxied to the gateway (when running standalone without an external reverse proxy)

### 4.4 CI/CD Pipeline

```
GitHub Actions
  │
  ├── build-images.yml (on push to main)
  │   ├── Matrix: [gateway, player]
  │   ├── Build: docker buildx (arm64)
  │   ├── Push: ghcr.io/{repo}-{service}:latest
  │   └── Tag:  ghcr.io/{repo}-{service}:v{run_number}
  │
  └── cleanup.yml (daily cron)
      ├── Delete old workflow runs (>30 days)
      └── Prune untagged GHCR images
```

---

## 5. Security Model

### 5.1 Authentication

There is no application-level authentication. The security model assumes both services sit behind a reverse proxy that handles auth (basic auth, SSO, IP allowlisting, etc.).

```
Client → Reverse Proxy (auth) → Gateway/Player (open endpoints)
```

This is a deliberate design choice for simplicity in single-user or small-group deployments.

### 5.2 Trust Boundaries

| Boundary | Trust Level | Notes |
|----------|-------------|-------|
| Client ↔ Reverse Proxy | Untrusted | Proxy enforces auth |
| Reverse Proxy ↔ Services | Trusted | Internal network |
| Gateway ↔ OpenList | Trusted | Token/basic auth |
| Gateway ↔ SQLite | Trusted | Local filesystem |
| Client ↔ OpenList (stream) | Semi-trusted | 302 redirect exposes OpenList URL to client |

### 5.3 Data Sensitivity

- No user accounts or PII stored
- Session IDs are ephemeral (generated per page load, not persisted or validated server-side)
- Reactions and impressions are anonymous analytics
- OpenList credentials are server-side only (env vars, never exposed to client)
- SQLite has no access control — physical access = full access

---

## 6. Technology Choices & Rationale

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Backend framework | FastAPI | Async-capable, auto-generated OpenAPI docs, Pydantic validation |
| Database | SQLite | Zero-config, single-file, sufficient for target scale (single-user) |
| ORM | SQLAlchemy 2.0 | Industry standard, good SQLite support, type-safe queries |
| HTTP client | httpx | Async support, auth handling, timeout control |
| Frontend build | Vite | Fast HMR, native ESM, simple config, React plugin |
| UI framework | React 19 | Component model fits SPA, Context API sufficient for state |
| Styling | Tailwind CSS 4 | Utility-first, no CSS-in-JS runtime, PostCSS pipeline |
| UI primitives | Radix UI | Accessible, unstyled, composable (dropdown, toast, slider) |
| State management | React Context | Single provider, no external deps, sufficient for flat state |
| Package manager | pnpm 10.30.1 | Fast, strict, workspace-aware |
| Container platform | Docker (arm64) | Target deployment is ARM-based (Raspberry Pi, Apple Silicon) |
| Video delivery | 302 redirect | No bandwidth through gateway, OpenList handles streaming |
| Auth model | Reverse proxy | Simplest secure option for self-hosted single-user deployments |

### 6.1 What Was Not Chosen (and Why)

| Alternative | Why Not |
|-------------|---------|
| PostgreSQL | Overkill for single-user; SQLite is zero-config and sufficient |
| Redis | No caching layer needed; SQLite queries are fast enough |
| Zustand/Redux | React Context covers the flat state shape; no need for external state libs |
| Next.js | Originally used; migrated to Vite for simpler SPA model (no SSR needed) |
| Axios | Native fetch is sufficient; `withTimeout` wrapper covers the only missing feature |
| Alembic | Manual idempotent migrations are simpler for a 4-table schema |
| Video proxying | Would bottleneck gateway bandwidth; 302 redirect offloads to OpenList |
| JWT/OAuth | Reverse proxy auth is simpler and more flexible for self-hosted deployments |

---

## 7. Design Decisions & Tradeoffs

| Decision | Rationale | Tradeoff |
|----------|-----------|----------|
| SQLite over PostgreSQL | Zero-config, single-file, easy backups | Single writer limit; not suited for high concurrency |
| 302 redirect over video proxy | Offloads all bandwidth to source server | Gateway loses control over caching headers |
| Monolith VideoPlayer.tsx | Colocated state reduces prop-drilling and re-renders | 1162 lines is hard to navigate and test |
| React Context over state libs | Zero dependencies; sufficient for flat state | No devtools or middleware support |
| No application auth | Simpler deployment; proxy handles it | Misconfigured proxy exposes all endpoints |
| pick_count ordering | Fair rotation; less-seen content surfaces first | Predictable ordering if pick_count values are known |
| Single monorepo root | One checkout and a shared CI context | Services no longer version independently |
| ARM64-only Docker | Matches target hardware (Raspberry Pi, ARM cloud) | No x86 images available |
| Vite SPA over Next.js SSR | Simpler build, no server runtime, nginx-servable | No SSR or SEO (not needed for this use case) |

---

## 8. Known Limitations

- No test suites in either service
- `VideoPlayer.tsx` is a 1162-line monolith (complexity hotspot)
- No database migration tool (manual `_ensure_*` functions)
- No rate limiting at application level
- No health check endpoints
- No structured logging (standard print/logger only)
- `nextCursor` is always `null` (cursor pagination not implemented server-side)
- No WebSocket or real-time updates
- ARM64-only Docker images

### 8.1 Upgrade Paths

| Limitation | Upgrade Path |
|------------|-------------|
| SQLite write contention | Swap to PostgreSQL via `DATABASE_URL` env var (SQLAlchemy abstracts the driver) |
| No tests | Add vitest for player, pytest for gateway |
| Monolithic player | Extract gesture system, preload engine, and animation system into custom hooks |
| ARM64 only | Add `linux/amd64` to CI matrix build platforms |
| No search/filter | Add full-text search on video titles via SQLite FTS5 |
| No health checks | Add `/health` and `/ready` endpoints to gateway |
| No structured logging | Adopt structlog or similar for JSON-formatted log output |

---

See also: [PRD](./PRD.md) | [Technical Spec](./TECHNICAL_SPEC.md) | [API Reference](./API_REFERENCE.md) | [Deployment Guide](./DEPLOYMENT_GUIDE.md)
