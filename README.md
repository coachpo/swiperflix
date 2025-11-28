# Swiperflix (Gateway + Player)

Two-service stack for the Swiperflix demo:
- **swiperflix-gateway** — FastAPI backend that syncs playlists from an OpenList instance into SQLite and serves the API the player consumes.
- **swiperflix-player** — Next.js 16 (App Router) frontend video player that talks to the gateway.

CI builds/publishes Docker images to GHCR; `deploy/` contains a Caddy + Docker Compose setup to run both services behind one port.

## Repository Layout
- `swiperflix-gateway/` — backend service (FastAPI, Python 3.11+)
- `swiperflix-player/` — frontend player (Next.js 16, pnpm)
- `deploy/` — Caddyfile, docker-compose, deploy script, env templates
- `.github/workflows/` — CI for building/pushing images and cleaning GHCR

## Prerequisites
- Git with submodule support (`git clone --recurse-submodules` recommended)
- Python 3.11+ (gateway)
- Node.js 18.18+ (Node 20 recommended) and `pnpm` (player)
- Docker + Docker Compose plugin (for the production-style stack)

## Clone with Submodules
```bash
git clone --recurse-submodules <repo-url>
# or if already cloned
git submodule update --init --recursive
```

## Environment Variables
Gateway (`swiperflix-gateway`, see `example.env`):
- `OPENLIST_API_BASE_URL` (default `http://localhost:5244`)
- `OPENLIST_DIR_PATH` (default `/`)
- `OPENLIST_PASSWORD` (optional)
- `OPENLIST_TOKEN` (optional bearer)
- `OPENLIST_USERNAME` (optional basic auth)
- `OPENLIST_USER_PASSWORD` (optional basic auth)
- `OPENLIST_PUBLIC_BASE_URL` (optional public base for file URLs)

Player (`swiperflix-player`, see `example.env`):
- `NEXT_PUBLIC_API_BASE_URL` (default `http://localhost:8000`)
- `NEXT_PUBLIC_API_BEARER_TOKEN` (optional; falls back to `NEXT_PUBLIC_API_TOKEN`)

## Local Development
### Start the gateway (API)
```bash
cd swiperflix-gateway
python -m venv .venv && source .venv/bin/activate
pip install -e .
cp example.env .env  # or export vars manually
uvicorn app.main:app --reload  # listens on 8000
```
Notes:
- `./entrypoint.sh` will sync from OpenList then launch uvicorn.
- SQLite lives at `swiperflix.db` in the gateway directory (auto-created).

### Start the player (Next.js)
```bash
cd swiperflix-player
pnpm install
cp example.env .env.local  # optional if defaults are fine
pnpm dev  # listens on http://localhost:3000
```
The player expects the gateway at `http://localhost:8000` unless overridden by env.

### Quick check
1) Launch gateway, verify `http://localhost:8000/api/v1/playlist`.  
2) Launch player, open `http://localhost:3000` and swipe through clips.

## Docker / Production Stack
```bash
cd deploy
# edit gateway.env with OPENLIST_* if your OpenList needs auth
./deploy.sh
```
- Caddy listens on `http://localhost:8066`, proxies `/api/*` to gateway:8000 and everything else to player:3000.
- Gateway image: `ghcr.io/coachpo/swiperflix-gateway:latest`; Player image: `ghcr.io/coachpo/swiperflix-player:latest`.
- SQLite persisted at `deploy/data/swiperflix.db`.
- `deploy.sh` pulls images, ensures `data/`, then runs `docker compose -f docker-compose.prod.yml up -d`.

## Updating Submodules
```bash
git submodule update --remote --merge
```

## Additional Docs
- Gateway details: `swiperflix-gateway/README.md`
- Player details & API contract: `swiperflix-player/README.md` and `swiperflix-player/docs/api.md`
- Deployment script: `deploy/deploy.sh`

## Troubleshooting
- 404/connection errors from player: confirm `NEXT_PUBLIC_API_BASE_URL` points to the running gateway.
- Port clash on 8066: adjust `ports` in `deploy/docker-compose.prod.yml`.
- Stale playlist: delete `swiperflix-gateway/swiperflix.db` and restart to resync from OpenList.

## License
See component licenses in each submodule.
