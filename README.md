# Swiperflix

TikTok-style video player demo. Two-service stack:
- **swiperflix-gateway** — FastAPI backend that syncs playlists from an [OpenList](https://github.com/OpenListTeam/OpenList) instance into SQLite and serves the API the player consumes.
- **swiperflix-player** — Next.js 16 (App Router, React 19) frontend with gesture-driven video playback.

CI builds Docker images to GHCR (`linux/arm64`).

## Architecture

```
OpenList instance
    ↓  POST /api/fs/list (paginated sync)
swiperflix-gateway (SQLite)
    ↓  GET /api/v1/playlist, POST /like, /dislike, /impression, /not-playable
swiperflix-player (browser)
    ↓  GET /api/v1/videos/{id}/stream → 302 redirect
OpenList direct download URL (no proxy)
```

## Repository Layout

```
swiperflix/
├── swiperflix-gateway/      # FastAPI, Python 3.11+, SQLAlchemy, SQLite
├── swiperflix-player/       # Next.js 16, React 19, Tailwind CSS 4, pnpm
├── .github/workflows/       # CI: build-images.yml + cleanup.yml
└── .gitmodules              # Both submodules track main branch
```

Both subdirectories are independent git submodules (`git@github.com:coachpo/swiperflix-{gateway,player}.git`).

## Prerequisites

- Git with submodule support
- Python 3.11+ (gateway)
- Node.js 22+ and `pnpm` (player)

## Clone

```bash
git clone --recurse-submodules <repo-url>
# or if already cloned
git submodule update --init --recursive
```

## Environment Variables

### Gateway (`swiperflix-gateway/example.env`)

| Variable | Default | Notes |
|----------|---------|-------|
| `OPENLIST_API_BASE_URL` | `http://localhost:5244` | OpenList API endpoint |
| `OPENLIST_DIR_PATH` | `/` | Directory to sync |
| `API_BEARER_TOKEN` | `this-is-the-key-for-local-dev` | Empty = auth disabled |
| `OPENLIST_PASSWORD` | — | Directory password |
| `OPENLIST_TOKEN` | — | OpenList bearer token (raw, no prefix) |
| `OPENLIST_USERNAME` | — | Basic auth username |
| `OPENLIST_USER_PASSWORD` | — | Basic auth password |
| `OPENLIST_PUBLIC_BASE_URL` | — | Public base for file URLs |

### Player (`swiperflix-player/example.env`)

| Variable | Default | Notes |
|----------|---------|-------|
| `NEXT_PUBLIC_API_BASE_URL` | `http://localhost:8000` | Gateway URL (build-time) |
| `NEXT_PUBLIC_API_BEARER_TOKEN` | — | Optional; falls back to `NEXT_PUBLIC_API_TOKEN` |

## Local Development

### Gateway (API)

```bash
cd swiperflix-gateway
python -m venv .venv && source .venv/bin/activate
pip install -e .
cp example.env .env
uvicorn app.main:app --reload    # http://localhost:8000
```

Sync videos manually if OpenList was unreachable at startup:

```bash
python -m app.sync               # sync default directory
python -m app.sync --dir /tv     # sync specific directory
```

SQLite DB (`swiperflix.db`) is auto-created. Delete it to force full resync.

### Player (Next.js)

```bash
cd swiperflix-player
pnpm install
cp example.env .env.local        # optional if defaults are fine
pnpm dev                         # http://localhost:3000
```

### Quick Check

1. Gateway: `http://localhost:8000/api/v1/playlist`
2. Player: `http://localhost:3000` — swipe through clips

## API Reference

All endpoints under `/api/v1/`. Auth via `Authorization: Bearer <token>`.

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/playlist?limit=5` | Yes | Playlist (least-picked first, increments pick_count) |
| GET | `/videos/{id}/stream` | No | 302 redirect to source URL |
| POST | `/videos/{id}/like` | Yes | Like (deduped per session) |
| POST | `/videos/{id}/dislike` | Yes | Dislike (deduped per session) |
| POST | `/videos/{id}/impression` | Yes | Watch progress tracking |
| POST | `/videos/{id}/not-playable` | Yes | Report playback issue |

Error shape: `{ error: { code, message, retryable?, details? } }`

Full API spec: `swiperflix-player/docs/api.md`

## Docker

```bash
# Gateway
docker build -t swiperflix-gateway swiperflix-gateway/
docker run --env-file swiperflix-gateway/example.env -p 8000:8000 swiperflix-gateway

# Player (env vars baked at build time)
docker build \
  --build-arg NEXT_PUBLIC_API_BASE_URL=https://api.example.com \
  --build-arg NEXT_PUBLIC_API_BEARER_TOKEN=your-token \
  -t swiperflix-player swiperflix-player/
docker run -p 3000:3000 swiperflix-player
```

CI targets `linux/arm64`. Images tagged `ghcr.io/{repo}-{service}:latest` + `:v{run_number}`.

## Updating Submodules

```bash
git submodule update --remote --merge
```

## Additional Docs

- Gateway: `swiperflix-gateway/README.md`
- Player: `swiperflix-player/README.md`
- API contract: `swiperflix-player/docs/api.md`

## Troubleshooting

- **404/connection errors from player**: confirm `NEXT_PUBLIC_API_BASE_URL` points to the running gateway.
- **Stale playlist**: delete `swiperflix-gateway/swiperflix.db` and restart to resync.
- **Gateway boots with no videos**: OpenList was unreachable at startup. Run `python -m app.sync` manually.

## License

See component licenses in each submodule.
