# Swiperflix — Deployment Guide

**Version:** 1.0
**Date:** 2026-02-22

---

## 1. Prerequisites

- Docker (with buildx for ARM64 cross-compilation if building on x86)
- Git with submodule support
- An accessible OpenList instance with video files

For local development (without Docker):
- Python 3.11+
- Node.js 22+ and pnpm

---

## 2. Repository Setup

```bash
# Clone with submodules
git clone --recurse-submodules <repo-url>

# Or if already cloned without submodules
git submodule update --init --recursive

# Pull latest changes from both submodules
git submodule update --remote --merge
```

Both `swiperflix-gateway/` and `swiperflix-player/` are independent git submodules tracking the `main` branch.

---

## 3. Environment Variables

### Gateway

Copy `swiperflix-gateway/example.env` to `swiperflix-gateway/.env` and configure:

| Variable | Default | Required | Description |
|----------|---------|----------|-------------|
| `OPENLIST_API_BASE_URL` | `http://localhost:5244` | Yes | OpenList API endpoint |
| `OPENLIST_DIR_PATH` | `/` | No | Directory to sync videos from |
| `OPENLIST_PASSWORD` | — | No | Directory password (if OpenList directory is password-protected) |
| `OPENLIST_TOKEN` | — | No | OpenList auth token (raw, without `Bearer` prefix) |
| `OPENLIST_USERNAME` | — | No | Username for basic auth / auto-login on 401 |
| `OPENLIST_USER_PASSWORD` | — | No | Password for basic auth / auto-login on 401 |
| `OPENLIST_PUBLIC_BASE_URL` | — | No | Override base URL for building file download links |
| `DATABASE_URL` | `sqlite:///./swiperflix.db` | No | SQLAlchemy database URL |

**Auth priority:** Token → Basic auth → Auto-login (username + password → fetch token on 401).

### Player

No environment variables needed. The player uses relative URLs (`/api/v1/...`) and expects the gateway to be reachable at the same origin via reverse proxy.

---

## 4. Docker Deployment

### 4.1 Building Images

```bash
# Gateway
docker build -t swiperflix-gateway swiperflix-gateway/

# Player
docker build -t swiperflix-player swiperflix-player/
```

For ARM64 cross-compilation (if building on x86):

```bash
docker buildx build --platform linux/arm64 -t swiperflix-gateway swiperflix-gateway/
docker buildx build --platform linux/arm64 -t swiperflix-player swiperflix-player/
```

### 4.2 Running Containers

```bash
# Gateway — mount a volume for SQLite persistence
docker run -d \
  --name swiperflix-gateway \
  --env-file swiperflix-gateway/.env \
  -v swiperflix-data:/data \
  -p 8000:8000 \
  swiperflix-gateway

# Player
docker run -d \
  --name swiperflix-player \
  -p 3000:3000 \
  swiperflix-player
```

**Important:** If using `DATABASE_URL=sqlite:////data/swiperflix.db` (as in `example.env`), mount a volume at `/data` to persist the database across container restarts.

### 4.3 Image Details

| Service | Base Image | Final Image | Port | Entrypoint |
|---------|-----------|-------------|------|------------|
| Gateway | `python:3.11-slim` | ~150MB | 8000 | `entrypoint.sh` (runs sync, then uvicorn) |
| Player | `nginx:alpine` (multi-stage from `node:22-alpine`) | ~30MB | 3000 | nginx serving static `dist/` |

### 4.4 Gateway Entrypoint

The gateway's `entrypoint.sh` runs two steps:
1. `python -m app.sync` — syncs video metadata from OpenList
2. `exec uvicorn app.main:app --host $HOST --port $PORT` — starts the API server

If OpenList is unreachable during sync, the sync fails but the server still starts. Videos will be synced on the first playlist request (if the table is empty) or via manual CLI.

---

## 5. Reverse Proxy Configuration

Both services are designed to sit behind a reverse proxy. The player uses relative URLs, so both must be served from the same origin.

### 5.1 Routing Rules

| Path | Target |
|------|--------|
| `/api/v1/*` | `gateway:8000` |
| `/*` | `player:3000` |

### 5.2 nginx Example

```nginx
server {
    listen 443 ssl;
    server_name swiperflix.example.com;

    ssl_certificate     /etc/ssl/certs/swiperflix.pem;
    ssl_certificate_key /etc/ssl/private/swiperflix.key;

    # Optional: basic auth
    # auth_basic "Swiperflix";
    # auth_basic_user_file /etc/nginx/.htpasswd;

    location /api/ {
        proxy_pass http://gateway:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location / {
        proxy_pass http://player:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

### 5.3 Player's Built-in Proxy

The player's Docker image includes an nginx config that proxies `/api/` to `http://gateway:8000`. This works when both containers share a Docker network where the gateway is reachable as `gateway`. In this setup, you can expose only the player's port and skip the external reverse proxy for simple deployments:

```bash
# Create a shared network
docker network create swiperflix

# Run gateway (name must be "gateway" to match nginx config)
docker run -d --name gateway --network swiperflix \
  --env-file swiperflix-gateway/.env \
  -v swiperflix-data:/data \
  swiperflix-gateway

# Run player (expose only this port)
docker run -d --name player --network swiperflix \
  -p 3000:3000 \
  swiperflix-player
```

Access the app at `http://localhost:3000`. The player's nginx handles API proxying internally.

---

## 6. CI/CD Pipeline

### 6.1 Build Pipeline (`build-images.yml`)

**Triggers:** Push to `main`, pull requests to `main`, manual dispatch (with service selector).

**Flow:**
1. Checkout repository with submodules
2. Set up QEMU (ARM64 emulation) and Docker Buildx
3. Log in to GitHub Container Registry (GHCR)
4. Build and push images (matrix: gateway + player)

**Image Tags:**
- `ghcr.io/{owner}/{repo}-gateway:latest`
- `ghcr.io/{owner}/{repo}-gateway:v{run_number}`
- `ghcr.io/{owner}/{repo}-player:latest`
- `ghcr.io/{owner}/{repo}-player:v{run_number}`

**Notes:**
- Pull requests build but do not push images.
- Platform: `linux/arm64` only.
- Build cache: GitHub Actions cache + GHCR registry cache.
- Concurrency: only one build per branch at a time (in-progress builds are cancelled).

### 6.2 Cleanup Pipeline (`cleanup.yml`)

**Triggers:** Daily at 03:00 UTC, manual dispatch.

**Actions:**
- Delete old workflow runs (keeps minimum 3)
- Prune untagged container images from GHCR (for both gateway and player packages)

---

## 7. Local Development

### 7.1 Gateway

```bash
cd swiperflix-gateway
python -m venv .venv && source .venv/bin/activate
pip install -e .
cp example.env .env
# Edit .env with your OpenList details

uvicorn app.main:app --reload    # http://localhost:8000
```

### 7.2 Player

```bash
cd swiperflix-player
pnpm install
pnpm dev                         # http://localhost:3000
```

### 7.3 Manual Sync

If OpenList was unreachable at gateway startup:

```bash
cd swiperflix-gateway
python -m app.sync               # sync default directory
python -m app.sync --dir /tv     # sync specific directory
```

---

## 8. Data Persistence

### SQLite Database

- Auto-created at the path specified by `DATABASE_URL` (default: `./swiperflix.db`).
- Tables are created on first startup via `init_db()`.
- The `pick_count` column is added via an idempotent migration in `db.py`.
- Delete the database file to force a full resync from OpenList.

### Backup

```bash
# Simple file copy (stop the gateway first for consistency)
cp /data/swiperflix.db /backup/swiperflix-$(date +%Y%m%d).db

# Or use SQLite's backup command (safe while running)
sqlite3 /data/swiperflix.db ".backup '/backup/swiperflix.db'"
```

### Volume Mounting (Docker)

```bash
# Named volume
docker run -v swiperflix-data:/data ...

# Bind mount
docker run -v /host/path:/data ...
```

Ensure `DATABASE_URL` points to the mounted path (e.g., `sqlite:////data/swiperflix.db`).

---

## 9. Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| Player shows no videos | Gateway has no videos synced | Run `python -m app.sync` or check OpenList connectivity |
| 404 on API calls from player | Reverse proxy not routing `/api/v1/*` to gateway | Check proxy config; ensure gateway is reachable |
| Gateway boots but playlist is empty | OpenList was unreachable at startup | Run `python -m app.sync` manually; check `OPENLIST_API_BASE_URL` |
| 502 on `/stream` endpoint | OpenList download URL resolution failed | Check OpenList is running; verify token/credentials |
| Stale videos in playlist | Database has old data | Delete `swiperflix.db` and restart to force full resync |
| `ALREADY_REACTED` / `ALREADY_REPORTED` 409 | Duplicate reaction/report for same session | Expected behavior — deduplication is working correctly |
| ARM64 image won't run on x86 | CI builds ARM64 only | Build locally without `--platform` flag, or add `linux/amd64` to CI |
| Player can't reach gateway in Docker | Containers not on same network | Use `docker network create` and `--network` flag; gateway must be named `gateway` |

---

## 10. Health Checks

No health check endpoints exist currently. For container orchestration, use:

```bash
# Gateway: check if the API responds
curl -f http://gateway:8000/api/v1/playlist?limit=1

# Player: check if nginx serves the SPA
curl -f http://player:3000/
```

---

See also: [Architecture](./ARCHITECTURE.md) | [API Reference](./API_REFERENCE.md) | [Technical Spec](./TECHNICAL_SPEC.md) | [PRD](./PRD.md)
