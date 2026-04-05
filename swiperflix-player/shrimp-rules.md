# Development Guidelines

## Project Overview

### Tech Stack
- **Framework**: Next.js 16 (App Router)
- **Language**: TypeScript
- **Styling**: Tailwind CSS
- **UI Components**: shadcn/ui (Radix UI + Tailwind)
- **Icons**: Lucide React

## Code Standards

### Component Structure
- Interactive components must use `"use client"` directive at the top.
- Components should be functional and typed with TypeScript.
- Use `cn()` utility from `@/lib/utils` for class merging.

### State Management
- Use React Context (`providers/`) for global state (Playlist, Settings).
- Use local state (`useState`) for UI-specific interactions within components.

## Key File Interaction Standards

### Core Components
- `components/player/VideoPlayer.tsx`: Main player logic. heavily coupled with `PlaylistProvider`.
- `providers/playlist-provider.tsx`: Manages video list, cursor, and loading state.
- `providers/settings-provider.tsx`: Manages API configuration.

### Styling
- Use Tailwind utility classes.
- Maintain `h-full`, `w-full` and `overflow-hidden` for the player container to ensure strict viewport fit.

## Prohibited Actions
- Do not use `useEffect` for data fetching if `useSWR` or React Query concepts can be applied (though this project uses custom `fetch` in providers, stick to that pattern).
- Do not introduce new heavy UI libraries; stick to shadcn/ui and Tailwind.
 - Keep API integration pointed at the real backend; avoid reintroducing mock routes.
