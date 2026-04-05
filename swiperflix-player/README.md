# Swiperflix Player

Gesture-first short‑video player built with Next.js 16, React 19, TypeScript, Tailwind CSS, and shadcn/ui. Swipe, scroll, and long‑press through clips while sending like/dislike/impression events to your backend.

## Highlights

- Wheel or swipe: vertical = next/previous, horizontal = like/dislike (dislike also advances).
- Playback controls: tap to pause/resume, drag the progress bar, speeds 0.75/1/1.5/2×, optional auto‑play next.
- Long‑press edges: left third rewinds in small steps; right third fast‑forwards at 2×.
- Prefetches near the tail and refreshes the playlist when it runs out.
- Uses relative URLs — no API base URL or auth token configuration needed. Designed to sit behind a reverse proxy.

## Requirements

- Node.js 18.18+ (Node 20 recommended)
- pnpm

## Quick Start

```bash
pnpm install
pnpm dev
```

The app runs at http://localhost:3000. Make sure your backend is reachable at the same origin (or via reverse proxy).

## Configuration

No environment variables are required. The player uses relative URLs (`/api/v1/...`) and expects the gateway to be reachable at the same origin via reverse proxy.

API paths are fixed in `lib/config.ts`:

- `playlistPath=/api/v1/playlist`
- `likePath=/api/v1/videos/{id}/like`
- `dislikePath=/api/v1/videos/{id}/dislike`
- `impressionPath=/api/v1/videos/{id}/impression`
- `notPlayablePath=/api/v1/videos/{id}/not-playable`

Preloading: by default the player preloads the next 3 videos.

## Gestures & Controls

- Scroll or swipe up/down: next / previous video.
- Scroll or swipe left/right: like / dislike, then advance.
- Long‑press left third: rewind in ~0.4s steps.
- Long‑press right third: fast‑forward at 2×.
- Tap center: pause/resume (buttons available for play/pause and navigation).
- Drag the progress bar to seek; pick playback speed from the dropdown.

## Backend Expectations

- `GET /api/v1/playlist?cursor=<cursor>` → `{ items: VideoItem[]; nextCursor: string | null }`
- `POST /api/v1/videos/{id}/like`
- `POST /api/v1/videos/{id}/dislike`
- Optional `POST /api/v1/videos/{id}/impression` for watch progress
- `VideoItem`: `{ id: string; url: string; cover?: string; title?: string; duration?: number; orientation?: "portrait" | "landscape" }`

See `docs/api.md` for the full proposal and error model.

## Scripts

- `pnpm dev` — start dev server
- `pnpm build` — production build
- `pnpm start` — serve built app
- `pnpm lint` — run eslint with max-warnings=0

## Project Structure

- `app/` — App Router entry, global styles, manifest.
- `components/` — player and shared UI primitives (shadcn/radix-based).
- `providers/` — React contexts (playlist, settings).
- `lib/` — API client, config, and shared types.
- `hooks/` — reusable client hooks.
- `docs/` — backend API proposal.
- `public/` — static assets.

## Deployment

1. `pnpm install && pnpm build`
2. `pnpm start` to serve the built output.
3. Configure your reverse proxy to route `/api/v1/*` to the gateway.

## License

MIT — see `LICENSE`.
