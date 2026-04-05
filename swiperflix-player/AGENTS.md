# SWIPERFLIX PLAYER — KNOWLEDGE BASE

## OVERVIEW

Gesture-first short-video player. Next.js 16 App Router, React 19, TypeScript, Tailwind CSS 4, shadcn/ui (Radix primitives). Single-page app — one route, all logic client-side. Uses relative URLs (same origin) — no API base URL or auth token configuration needed.

## STRUCTURE

```
app/                        # App Router entry
├── layout.tsx              # Root layout (Inter font, metadata)
├── page.tsx                # Home: PlaylistProvider → VideoPlayer + Toaster
├── globals.css             # Tailwind imports + custom styles
├── manifest.webmanifest    # PWA manifest
└── icon.svg

components/
├── player/
│   └── VideoPlayer.tsx     # Main player (1163 lines) — gestures, preload, playback, animations
└── ui/                     # shadcn/ui primitives (button, badge, card, dropdown-menu, select, slider, toast, etc.)
    └── video-slider.tsx    # Custom progress bar for video playback

providers/
└── playlist-provider.tsx   # React Context: playlist state, pagination, prefetch, like/dislike

lib/
├── api.ts                  # API client (native fetch + timeout wrapper)
├── config.ts               # Endpoint templates, empty baseUrl (relative URLs)
├── types.ts                # VideoItem, PlaylistResponse, ApiConfig
└── utils.ts                # cn() helper (clsx + tailwind-merge)

hooks/                      # Empty — no custom hooks yet
docs/                       # API proposal, impression/not-playable specs
```

## WHERE TO LOOK

| Task | File | Notes |
|------|------|-------|
| Modify gestures/playback | `components/player/VideoPlayer.tsx` | All gesture + video logic colocated |
| Change playlist fetching | `providers/playlist-provider.tsx` | Cursor pagination, prefetch, like/dislike |
| Add API endpoint call | `lib/api.ts` | Follow `requestJson()` pattern with `withTimeout` |
| Change API config/paths | `lib/config.ts` | Endpoint templates with `{id}` placeholder |
| Add/modify types | `lib/types.ts` | VideoItem, PlaylistResponse, ApiConfig |
| Add UI component | `components/ui/` | shadcn/ui pattern (Radix + CVA + cn()) |
| Modify styling | `app/globals.css` | Tailwind 4 + tw-animate-css |

## COMPONENT TREE & DATA FLOW

```
RootLayout (layout.tsx)
└── Home (page.tsx, "use client")
    ├── PlaylistProvider          ← fetches playlist, manages navigation state
    │   └── VideoPlayer           ← subscribes via usePlaylist(), renders video
    │       ├── <video> elements  ← pool of 12 cached elements, 3 preloaded ahead
    │       ├── Gesture handlers  ← wheel/touch/keyboard/long-press
    │       └── Controls UI       ← play/pause, speed, progress bar, like/dislike buttons
    └── Toaster                   ← toast notifications
```

Data flow: PlaylistProvider fetches → VideoPlayer reads `current` video → user gesture triggers provider action (goNext/likeCurrent/etc.) → provider updates state → VideoPlayer re-renders.

## CONVENTIONS

- **No external HTTP library** — native `fetch` with `withTimeout()` wrapper (10s default)
- **Relative URLs** — `baseUrl` is empty string; all API calls resolve against current origin
- **State management**: React Context only (PlaylistProvider). No zustand/redux.
- **UI components**: shadcn/ui pattern — Radix primitives + `class-variance-authority` + `cn()` utility
- **Styling**: Tailwind CSS 4 via PostCSS. `cn()` = `clsx` + `tailwind-merge`.
- **Path aliases**: `@/` maps to project root (tsconfig paths)
- **ESLint**: extends `eslint-config-next`, `@next/next/no-img-element` OFF (intentional for native media)
- **Lint rule**: `--max-warnings=0` — zero warnings policy
- **Next.js output**: `standalone` mode (for Docker deployment)
- **Preloading**: 3 videos ahead, pool of 12 `<video>` elements, concurrency limit of 2

## ANTI-PATTERNS

- Do NOT add state management libraries — use React Context
- Do NOT use axios or other HTTP clients — use native fetch via `lib/api.ts`
- Do NOT create new page routes — this is a single-page app
- Do NOT add `"use server"` — all logic is client-side
- Do NOT modify shadcn/ui base components in `components/ui/` without reason — they follow upstream patterns
- Do NOT add `@ts-ignore` or `as any` — strict TypeScript is enforced
- Do NOT add `NEXT_PUBLIC_API_BASE_URL` or `NEXT_PUBLIC_API_BEARER_TOKEN` — the player uses relative URLs, no auth

## NOTES

- `VideoPlayer.tsx` (1163 lines) is the complexity hotspot. All gesture detection, video element pooling, preloading, animation, impression tracking, and error handling live here.
- Playlist prefetch strategy: near tail (last 2 items) → fetch more via cursor. No cursor left → prefetch fresh playlist in background. On depletion → swap to prefetched data.
- `dislikeCurrent()` auto-advances to next video; `likeCurrent()` stays on current.
- Impression events fire on video change and component unmount.
- Long-press left third = rewind in ~0.4s steps. Long-press right third = 2× speed.
- `hooks/` directory exists but is empty — all hook logic is in providers or components.
