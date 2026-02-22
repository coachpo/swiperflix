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

Both services are designed to sit behind a reverse proxy. The player uses relative URLs (same origin), so no cross-origin configuration is needed.

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
| `OPENLIST_PASSWORD` | — | Directory password |
| `OPENLIST_TOKEN` | — | OpenList bearer token (raw, no prefix) |
| `OPENLIST_USERNAME` | — | Basic auth username |
| `OPENLIST_USER_PASSWORD` | — | Basic auth password |
| `OPENLIST_PUBLIC_BASE_URL` | — | Public base for file URLs |

### Player

No configuration needed. The player uses relative URLs and expects to be served behind the same reverse proxy as the gateway.

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
pnpm dev                         # http://localhost:3000
```

### Quick Check

1. Gateway: `http://localhost:8000/api/v1/playlist`
2. Player: `http://localhost:3000` — swipe through clips

## API Reference

All endpoints under `/api/v1/`. No authentication required (auth is expected at the reverse proxy layer).

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/playlist?limit=5` | Playlist (least-picked first, increments pick_count) |
| GET | `/videos/{id}/stream` | 302 redirect to source URL |
| POST | `/videos/{id}/like` | Like (deduped per session) |
| POST | `/videos/{id}/dislike` | Dislike (deduped per session) |
| POST | `/videos/{id}/impression` | Watch progress tracking |
| POST | `/videos/{id}/not-playable` | Report playback issue |

Error shape: `{ error: { code, message, retryable?, details? } }`

Full API spec: `swiperflix-player/docs/api.md`

## Docker

```bash
# Gateway
docker build -t swiperflix-gateway swiperflix-gateway/
docker run --env-file swiperflix-gateway/example.env -p 8000:8000 swiperflix-gateway

# Player (no build args needed)
docker build -t swiperflix-player swiperflix-player/
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

- **404/connection errors from player**: ensure the reverse proxy routes `/api/v1/*` to the gateway.
- **Stale playlist**: delete `swiperflix-gateway/swiperflix.db` and restart to resync.
- **Gateway boots with no videos**: OpenList was unreachable at startup. Run `python -m app.sync` manually.

## License

See component licenses in each submodule.
