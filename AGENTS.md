# SWIPERFLIX — PROJECT KNOWLEDGE BASE

**Generated:** 2026-02-22
**Commit:** 854a235
**Branch:** main

## OVERVIEW

Monorepo for a TikTok-style video player demo. Two services: a FastAPI backend (`swiperflix-gateway`) syncs video metadata from an OpenList instance into SQLite and serves a playlist/reaction API; a Vite + React 19 frontend (`swiperflix-player`) renders a gesture-driven video player consuming that API. Both services sit behind a reverse proxy — no cross-origin config or bearer token auth needed.

## STRUCTURE

```
swiperflix/
├── swiperflix-gateway/     # FastAPI backend (Python 3.11+, SQLite)
├── swiperflix-player/      # Vite frontend (React 19, Tailwind 4, pnpm)
├── .github/workflows/      # CI: build Docker images → GHCR, nightly cleanup
└── README.md
```

Both service directories are tracked directly in the root repository.

## WHERE TO LOOK

| Task | Location | Notes |
|------|----------|-------|
| API endpoints | `swiperflix-gateway/app/main.py` | All routes defined inline (no router split) |
| DB models | `swiperflix-gateway/app/models.py` | Video, Reaction, Impression, NotPlayableReport |
| OpenList integration | `swiperflix-gateway/app/openlist_client.py` | HTTP client, auth, URL resolution |
| Video player UI | `swiperflix-player/src/components/player/VideoPlayer.tsx` | 1163-line monolith — gestures, preloading, playback |
| Playlist state | `swiperflix-player/src/providers/playlist-provider.tsx` | React Context — fetch, paginate, prefetch, like/dislike |
| API client (frontend) | `swiperflix-player/src/lib/api.ts` | Native fetch wrapper with timeout |
| API types/config | `swiperflix-player/src/lib/types.ts`, `src/lib/config.ts` | Shared types, endpoint templates |
| CI pipeline | `.github/workflows/build-images.yml` | Matrix build for both services → GHCR |
| GHCR cleanup | `.github/workflows/cleanup.yml` | Daily: prune old runs + untagged images |

## DATA FLOW

```
OpenList instance
    ↓ (sync: POST /api/fs/list, paginated)
swiperflix-gateway (SQLite)
    ↓ (GET /api/v1/playlist, POST /like, /dislike, /impression, /not-playable)
swiperflix-player (browser)
    ↓ (GET /api/v1/videos/{id}/stream → 302 redirect)
OpenList direct download URL (video plays from source, no proxy)
```

## CONVENTIONS

- **API versioning**: all endpoints under `/api/v1/`
- **Error shape**: `{ error: { code: string, message: string, retryable?: boolean, details?: object } }`
- **No application-level auth**: endpoints are open; auth is handled at the reverse proxy layer
- **Player uses relative URLs**: `baseUrl` is empty string — all API calls resolve against current origin
- **Player build**: Vite builds static output to `dist/`
- **Docker platform**: CI targets `linux/arm64` only
- **Image tags**: `ghcr.io/{repo}-{service}:latest` + `ghcr.io/{repo}-{service}:v{run_number}`
- **Gateway env vars are runtime** (read from `.env` or environment)

## ANTI-PATTERNS (THIS PROJECT)

- Do NOT add new route files — all gateway routes live in `main.py` (single-file pattern)
- Do NOT proxy video streams through the gateway — it 302-redirects to OpenList
- Do NOT use axios or other HTTP libs in the player — native `fetch` with `withTimeout` wrapper
- Do NOT add state management libraries (zustand, redux) — React Context only
- ESLint: `@next/next/no-img-element` is intentionally OFF (native video/img handling needed)
- Do NOT add bearer token auth to the gateway or player — auth belongs at the reverse proxy

## COMMANDS

```bash
# Gateway
cd swiperflix-gateway
pip install -e .
uvicorn app.main:app --reload          # dev server :8000
python -m app.sync                      # sync videos from OpenList
python -m app.sync --dir /tv            # sync specific directory

# Player
cd swiperflix-player
pnpm install
pnpm dev                                # dev server :3000
pnpm build && pnpm preview              # preview built app
pnpm lint                               # eslint --max-warnings=0

# Docker
docker build -t swiperflix-gateway swiperflix-gateway/
docker build -t swiperflix-player swiperflix-player/

```

## NOTES

- No test suite exists in either subproject. No pytest, jest, or vitest configs.
- No docker-compose file — services are built/run independently.
- Gateway boots even if OpenList is unreachable; run `python -m app.sync` once connectivity is restored.
- SQLite DB (`swiperflix.db`) is auto-created; delete it to force full resync.
- `db.py` has an idempotent migration for `pick_count` column — new columns should follow the same `_ensure_*` pattern.
- Player prefetches next 3 videos; when near tail, fetches more via cursor or prefetches a fresh playlist.
- `VideoPlayer.tsx` is a 1163-line component — all gesture/playback/preload logic is colocated there.
