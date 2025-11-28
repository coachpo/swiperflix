# Swiperflix

Two-service stack for the Swiperflix demo:

- **swiperflix-gateway** — FastAPI backend that syncs playlists from an OpenList instance into SQLite and serves the API consumed by the player.
- **swiperflix-player** — Next.js (App Router) frontend video player that talks to the gateway.

Submodules track the upstream service repos. CI builds and publishes images to GHCR; deployment uses Caddy + Docker Compose.

## Repository layout
- `swiperflix-gateway/` (submodule): backend service
- `swiperflix-player/` (submodule): frontend service
- `.github/workflows/`: CI to build/push images (`build-images.yml`) and cleanup GHCR/workflow runs (`cleanup.yml`)
- `deploy/`: infra glue (Caddyfile, compose, deploy script, env templates)

## CI (GitHub Actions)
- **build-images.yml**: builds `ghcr.io/<repo>-gateway` and `ghcr.io/<repo>-player`; supports workflow_dispatch with service filter; uses Buildx/QEMU and GHA cache.
- **cleanup.yml**: nightly cleanup of workflow runs and untagged GHCR versions for both images.

## Local development
### Player (Next.js)
```bash
cd swiperflix-player
pnpm install
pnpm dev
```
Env keys: `NEXT_PUBLIC_API_BASE_URL`, optional `NEXT_PUBLIC_API_BEARER_TOKEN` (build-time).

### Gateway (FastAPI)
```bash
cd swiperflix-gateway
python -m venv .venv && source .venv/bin/activate
pip install -e .
uvicorn app.main:app --reload
```
Env keys (prefixed `OPENLIST_`): `API_BASE_URL`, `DIR_PATH`, optional auth fields; see `example.env`.

## Deployment (Docker Compose)
```bash
cd deploy
# fill gateway.env (OPENLIST_*) and player.env if you need runtime overrides
./deploy.sh
```
- Caddy listens on 8066:80 in compose and proxies `/api/*` to gateway:8000 and everything else to player:3000.
- Gateway persists SQLite at `deploy/data/swiperflix.db`.
- Images pulled from GHCR: `ghcr.io/<repo>-gateway:latest`, `ghcr.io/<repo>-player:latest`.

## Submodules
- Update to latest: `git submodule update --remote --merge`
- Add when cloning: `git clone --recurse-submodules git@github.com:coachpo/swiperflix.git`

## Secrets & registry
- CI needs no PAT for public submodules; `GITHUB_TOKEN` is sufficient.
- If submodules become private, add `PAT_TOKEN` with `repo` + `packages` scopes.

## License
See component licenses in each submodule.
