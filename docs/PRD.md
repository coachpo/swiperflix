# Swiperflix — Product Requirements Document

**Version:** 1.0
**Date:** 2026-02-22
**Status:** Living document

---

## 1. Product Overview

Swiperflix is a TikTok-style short-video player that streams content from a self-hosted [OpenList](https://github.com/OpenListTeam/OpenList) media server. It provides a gesture-driven, mobile-first viewing experience for personal media libraries — turning any folder of video files into a swipeable feed.

### 1.1 Problem Statement

Self-hosted media servers (OpenList, Alist, etc.) expose file browsers, not consumption experiences. Users with large video collections lack a quick, casual way to browse and watch clips without navigating folder hierarchies.

### 1.2 Solution

A two-service stack — a lightweight API gateway that syncs metadata from OpenList into a local database, and a browser-based player that renders a vertical-swipe video feed. Both services sit behind a reverse proxy, requiring zero client-side configuration.

### 1.3 Target Users

- Self-hosters running OpenList or compatible file servers
- Users with video collections (short clips, TV episodes, home videos) who want a casual browsing experience
- Single-user or small-group deployments behind a reverse proxy with optional auth

---

## 2. User Experience

### 2.1 Core Interaction Model

The player presents one video at a time in a full-screen vertical layout. Users navigate by swiping (touch) or scrolling (mouse/trackpad). The experience is designed to feel native on mobile while remaining fully functional on desktop.

### 2.2 Gesture System

| Gesture | Input | Behavior |
|---------|-------|----------|
| Swipe up / scroll down | Touch drag or mouse wheel | Advance to next video |
| Swipe down / scroll up | Touch drag or mouse wheel | Return to previous video |
| Single tap | Touch or click | Toggle play/pause |
| Double tap | Touch or click | Like current video (heart animation) |
| Long press (left ⅓) | Touch or click-hold | Rewind in 0.4s steps every 200ms |
| Long press (right ⅓) | Touch or click-hold | 2× playback speed |
| Keyboard ↑/↓ | Arrow keys | Previous / next video |
| Keyboard Space | Spacebar | Toggle play/pause |

### 2.3 Playback Controls

- Play/pause button
- Scrubbable progress bar with buffered range indicator
 Playback speed selector (0.5×, 0.75×, 1×, 1.25×, 1.5×, 2×, 3×)
- Rotation control (90° increments)
 Auto-play next toggle

### 2.4 Reaction System

- **Like** (heart button or double-tap): marks video as liked, stays on current video
- **Dislike** (broken heart button): marks video as disliked, auto-advances to next
- Reactions are idempotent per session — duplicate taps are safe

### 2.5 Reporting
### 2.5 Error Recovery

 Videos that fail to play are retried twice automatically
 After 2 failed retries, the player reports the video as not-playable and auto-advances
 Reports are deduplicated per session — one report per video per session
 Toast feedback confirms the report was logged

### 2.6 Playlist Behavior

- Initial load fetches a batch of videos (default 5)
- As the user approaches the end of the batch, more videos are fetched automatically
- When all pages are exhausted, a fresh playlist is prefetched in the background
- Videos are served in a "least-picked-first" order — less-seen content surfaces first
- Each fetch increments a `pick_count` on returned videos, ensuring fair rotation

---

## 3. Functional Requirements

### 3.1 Video Playback (P0)

| ID | Requirement |
|----|-------------|
| FR-1 | Play video from OpenList source URL via 302 redirect (no proxying) |
| FR-2 | Loop current video until user navigates away |
| FR-3 | Support portrait and landscape orientations with appropriate styling |
| FR-4 | Preload next 3 videos ahead of current position |
| FR-5 | Cache up to 12 video elements for instant back-navigation |
| FR-6 | Auto-play next video when current ends (configurable) |
| FR-7 | Resume playback after buffering stalls |

### 3.2 Navigation (P0)

| ID | Requirement |
|----|-------------|
| FR-8 | Vertical swipe/scroll navigation between videos |
| FR-9 | Keyboard arrow key navigation |
| FR-10 | Slide-in/slide-out transition animations between videos |
| FR-11 | Prevent navigation during active animations |

### 3.3 Reactions & Analytics (P1)

| ID | Requirement |
|----|-------------|
| FR-12 | Like/dislike with server persistence |
| FR-13 | Impression tracking — record watch duration on video change and unmount |
| FR-14 | Not-playable reporting with session-based deduplication |
| FR-15 | Toast notifications for user feedback on actions |

### 3.4 Content Sync (P0)

| ID | Requirement |
|----|-------------|
| FR-16 | Sync video metadata from OpenList directory listings |
| FR-17 | Paginated sync for large directories (100 items per page) |
| FR-18 | Upsert logic — new files added, existing files updated on metadata change |
| FR-19 | CLI tool for manual sync with optional directory override |
| FR-20 | Auto-sync on gateway startup (non-blocking on failure) |

### 3.5 Deployment (P1)

| ID | Requirement |
|----|-------------|
| FR-21 | Docker images for both services (arm64) |
| FR-22 | No application-level auth — delegated to reverse proxy |
| FR-23 | Player uses relative URLs — works behind any reverse proxy without configuration |
| FR-24 | Gateway boots even if OpenList is unreachable |

---

## 4. Non-Functional Requirements

| Requirement | Target |
|-------------|--------|
| First video playback | < 3s on broadband |
| Navigation latency | < 300ms (preloaded videos) |
| Concurrent preloads | 2 simultaneous |
| Video element cache | 12 elements max |
| API timeout | 10s default |
| Playlist page size | 5 default, max 50 |
| Database | SQLite (single-file, zero-config) |
| Browser support | Modern browsers with `<video>` and touch events |
| Mobile-first | Full-screen viewport, safe area insets, no-scroll body |

---

## 5. Out of Scope

- User accounts or authentication (handled at reverse proxy)
- Video transcoding or format conversion
- Comments, sharing, or social features
- Search or filtering within the player
- Multi-directory browsing (single directory per gateway instance)
- Offline playback or PWA caching of video content
- Analytics dashboard or admin UI

---

## 6. Success Metrics

| Metric | Measurement |
|--------|-------------|
| Playback success rate | % of videos that play without not-playable reports |
| Time to first video | Seconds from page load to first frame rendered |
| Navigation smoothness | % of transitions using preloaded elements (no buffering) |
| Impression coverage | % of viewed videos with impression events recorded |
| Fair rotation | Standard deviation of pick_count across videos |

---

## 7. Dependencies

| Dependency | Purpose |
|------------|---------|
| OpenList instance | Source of video files and metadata |
| Reverse proxy (nginx, Caddy, etc.) | Routes `/api/*` to gateway, serves player, handles auth |
| Docker / container runtime | Production deployment |
| GHCR | Container image registry (CI) |

---

## 8. Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| OpenList downtime | No new videos synced | Gateway boots with existing DB; manual resync when restored |
| Large video libraries (10k+) | Slow sync | Paginated sync (100/page), SQLite handles millions of rows |
| Video format incompatibility | Playback failures | Not-playable reporting; browser handles codec support |
| Single SQLite writer | Write contention under load | Acceptable for target scale; upgrade path to PostgreSQL if needed |
| Stale video URLs | 302 redirects to expired links | Stream endpoint resolves fresh URLs via OpenList API |

---

See also: [Architecture](./ARCHITECTURE.md) | [Technical Spec](./TECHNICAL_SPEC.md) | [API Reference](./API_REFERENCE.md) | [Deployment Guide](./DEPLOYMENT_GUIDE.md)
