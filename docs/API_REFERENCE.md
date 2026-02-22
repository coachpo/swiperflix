# Swiperflix Gateway — API Reference

**Version:** 1.0
**Base Path:** `/api/v1`

---

## Overview

All endpoints are served by the swiperflix-gateway (FastAPI). No application-level authentication is required — auth is expected at the reverse proxy layer.

**Content-Type:** `application/json` for all request and response bodies.

**Error Shape:** All error responses follow a consistent structure:

```json
{
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable description",
    "retryable": false,
    "details": {}
  }
}
```

`retryable` and `details` are optional and may be omitted.

---

## Endpoints

### GET /api/v1/playlist

Returns a batch of videos ordered by least-picked first (fair rotation). Each call atomically increments `pick_count` for returned videos.

**Query Parameters:**

| Parameter | Type | Default | Constraints | Description |
|-----------|------|---------|-------------|-------------|
| `limit` | integer | 5 | 1–50 | Number of videos to return |

**Response:** `200 OK`

```json
{
  "items": [
    {
      "id": "42",
      "url": "/api/v1/videos/42/stream",
      "cover": null,
      "title": "clip.mp4",
      "duration": null,
      "orientation": "landscape"
    }
  ],
  "nextCursor": null
}
```

| Field | Type | Description |
|-------|------|-------------|
| `items[].id` | string | Video ID (integer internally, exposed as string) |
| `items[].url` | string | Relative stream URL (302 redirect) |
| `items[].cover` | string \| null | Cover image URL (currently always null) |
| `items[].title` | string \| null | Filename from OpenList |
| `items[].duration` | integer \| null | Duration in seconds (currently always null — OpenList doesn't provide this) |
| `items[].orientation` | `"portrait"` \| `"landscape"` \| null | Video orientation (currently always null) |
| `nextCursor` | string \| null | Always `null` — cursor pagination is not implemented server-side |

**Notes:**
- If the videos table is empty, the gateway runs an inline sync from OpenList before responding.
- Selection algorithm: `ORDER BY pick_count ASC, RANDOM()` — least-seen videos surface first with random tiebreaking among equal pick counts.

**Example:**

```bash
curl http://localhost:8000/api/v1/playlist?limit=3
```

---

### GET /api/v1/videos/{video_id}/stream

Redirects to the video's direct download URL. No video bytes flow through the gateway.

**Path Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `video_id` | string | Video ID |

**Response:** `302 Found`

```
HTTP/1.1 302 Found
Location: https://openlist.example.com/d/path/to/video.mp4
```

The client (browser `<video>` element) follows the redirect and streams directly from OpenList.

**URL Resolution Logic:**
1. If the video's `source_url` is an absolute HTTP(S) URL, redirect directly to it.
2. Otherwise, call OpenList's `POST /api/fs/get` to resolve the download URL (checks `raw_url`, `proxy_url`, `url`, `download_url`, `link` fields in order).

**Error Responses:**

| Status | Code | Description |
|--------|------|-------------|
| 404 | `VIDEO_NOT_FOUND` | Video ID does not exist in the database |
| 502 | `OPENLIST_LINK_ERROR` | Failed to resolve download URL from OpenList |

**Example:**

```bash
curl -v http://localhost:8000/api/v1/videos/42/stream
# < HTTP/1.1 302 Found
# < location: https://openlist.example.com/d/clip.mp4
```

---

### POST /api/v1/videos/{video_id}/like

Records a like reaction for a video. Deduplicated by `(video_id, type, session_id)`.

**Path Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `video_id` | string | Video ID |

**Request Body:**

```json
{
  "source": "button",
  "timestamp": "2026-02-22T05:00:00Z",
  "sessionId": "abc123"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `source` | `"scroll"` \| `"button"` \| `"swipe"` \| null | No | How the reaction was triggered |
| `timestamp` | ISO 8601 datetime \| null | No | Client-side timestamp |
| `sessionId` | string \| null | No | Client session ID for deduplication |

**Response:** `200 OK`

```json
{
  "ok": true
}
```

**Error Responses:**

| Status | Code | Description |
|--------|------|-------------|
| 404 | `VIDEO_NOT_FOUND` | Video ID does not exist |
| 409 | `ALREADY_REACTED` | Like already recorded for this video + session |

**Example:**

```bash
curl -X POST http://localhost:8000/api/v1/videos/42/like \
  -H "Content-Type: application/json" \
  -d '{"source": "swipe", "sessionId": "sess_001"}'
```

---

### POST /api/v1/videos/{video_id}/dislike

Records a dislike reaction. Identical interface to `/like`.

**Path Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `video_id` | string | Video ID |

**Request Body:** Same as `/like`.

**Response:** `200 OK` — `{ "ok": true }`

**Error Responses:**

| Status | Code | Description |
|--------|------|-------------|
| 404 | `VIDEO_NOT_FOUND` | Video ID does not exist |
| 409 | `ALREADY_REACTED` | Dislike already recorded for this video + session |

**Example:**

```bash
curl -X POST http://localhost:8000/api/v1/videos/42/dislike \
  -H "Content-Type: application/json" \
  -d '{"source": "scroll", "sessionId": "sess_001"}'
```

---

### POST /api/v1/videos/{video_id}/impression

Tracks how long a user watched a video. Not deduplicated — multiple impressions per video are expected (e.g., rewatching).

**Path Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `video_id` | string | Video ID |

**Request Body:**

```json
{
  "watchedSeconds": 12.5,
  "completed": false
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `watchedSeconds` | float | Yes | Seconds of video watched |
| `completed` | boolean | Yes | Whether the video played to completion |

**Response:** `200 OK`

```json
{
  "ok": true
}
```

**Error Responses:**

| Status | Code | Description |
|--------|------|-------------|
| 404 | `VIDEO_NOT_FOUND` | Video ID does not exist |

**Example:**

```bash
curl -X POST http://localhost:8000/api/v1/videos/42/impression \
  -H "Content-Type: application/json" \
  -d '{"watchedSeconds": 30.2, "completed": true}'
```

---

### POST /api/v1/videos/{video_id}/not-playable

Reports a video that failed to play. Deduplicated by `(video_id, session_id)`. The player auto-triggers this after 2 failed retry attempts.

**Path Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `video_id` | string | Video ID |

**Request Body:**

```json
{
  "reason": "stuck",
  "timestamp": "2026-02-22T05:00:00Z",
  "sessionId": "abc123"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `reason` | string \| null | No | Why the video couldn't play (e.g., `"stuck"`, `"error"`) |
| `timestamp` | ISO 8601 datetime \| null | No | Client-side timestamp |
| `sessionId` | string \| null | No | Client session ID for deduplication |

**Response:** `200 OK`

```json
{
  "ok": true
}
```

**Error Responses:**

| Status | Code | Description |
|--------|------|-------------|
| 404 | `VIDEO_NOT_FOUND` | Video ID does not exist |
| 409 | `ALREADY_REPORTED` | Not-playable already reported for this video + session |

**Example:**

```bash
curl -X POST http://localhost:8000/api/v1/videos/42/not-playable \
  -H "Content-Type: application/json" \
  -d '{"reason": "stuck", "sessionId": "sess_001"}'
```

---

## Error Code Reference

| Code | HTTP Status | Description |
|------|-------------|-------------|
| `VIDEO_NOT_FOUND` | 404 | Requested video ID does not exist in the database |
| `ALREADY_REACTED` | 409 | Duplicate like or dislike for the same video + session + type |
| `ALREADY_REPORTED` | 409 | Duplicate not-playable report for the same video + session |
| `OPENLIST_LINK_ERROR` | 502 | Gateway failed to resolve the download URL from OpenList |

---

## Data Models

### VideoItem

Returned in playlist responses.

```
id:          string              — Database primary key (auto-increment integer, exposed as string)
url:         string              — Relative stream endpoint (/api/v1/videos/{id}/stream)
cover:       string | null       — Cover image URL
title:       string | null       — Filename from OpenList
duration:    integer | null      — Duration in seconds
orientation: "portrait" | "landscape" | null
```

### Database Tables

| Table | Purpose | Key Constraints |
|-------|---------|-----------------|
| `videos` | Video metadata synced from OpenList | `path` UNIQUE |
| `reactions` | Like/dislike records | UNIQUE(`video_id`, `type`, `session_id`) |
| `impressions` | Watch progress tracking | No dedup constraint |
| `not_playable_reports` | Playback failure reports | UNIQUE(`video_id`, `session_id`) |

---

## Notes

- Video IDs are auto-increment integers internally but always exposed as strings in the API.
- The `source` field on reactions accepts `"scroll"`, `"button"`, or `"swipe"` — these correspond to the gesture that triggered the reaction in the player UI.
- Session IDs are generated client-side per page load. They are not validated or authenticated server-side.
- CORS is wide open (`allow_origins=["*"]`, `allow_credentials=false`). Access control is expected at the reverse proxy.
- The gateway auto-generates OpenAPI docs at `/docs` (Swagger UI) and `/redoc` (ReDoc).

---

See also: [Architecture](./ARCHITECTURE.md) | [Technical Spec](./TECHNICAL_SPEC.md) | [PRD](./PRD.md)
