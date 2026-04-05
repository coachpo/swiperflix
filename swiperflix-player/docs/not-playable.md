# Not-Playable Reporting API

Fast guide for frontend clients to report videos that fail to play.

## Endpoint

- `POST /api/v1/videos/{video_id}/not-playable`
- Auth: `Authorization: Bearer <token>` (same as other endpoints)
- Content-Type: `application/json`

## Request Body

```jsonc
{
  "reason": "string | null",           // short description of failure
  "timestamp": "ISO-8601 string | null", // client time of the issue
  "sessionId": "string | null"         // per-session identifier for dedupe
}
```

Notes:
- All fields optional; include `sessionId` to make the call idempotent per session+video.
- `timestamp` is informational; server still records its own created_at.

## Responses

- `200 OK` — `{ "ok": true }`
- `404 Not Found` — `{ "error": { "code": "VIDEO_NOT_FOUND", ... } }`
- `409 Conflict` — `{ "error": { "code": "ALREADY_REPORTED", ... } }` (duplicate for same session)
- `401 Unauthorized` — missing or bad bearer token

## Example cURL

```bash
curl -X POST "$API_BASE/api/v1/videos/123/not-playable" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"reason":"player stuck at 0s","timestamp":"2025-11-27T10:15:00Z","sessionId":"sess-abc"}'
```

## Frontend Usage (fetch)

```ts
type NotPlayableReport = {
  reason?: string | null;
  timestamp?: string | null; // new Date().toISOString()
  sessionId?: string | null;
};

async function reportNotPlayable(videoId: string, payload: NotPlayableReport) {
  const res = await fetch(`${API_BASE}/api/v1/videos/${videoId}/not-playable`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });

  if (res.ok) return true;

  const data = await res.json();
  if (res.status === 404) throw new Error("Video not found");
  if (res.status === 409) return false; // already reported this session
  throw new Error(data?.error?.message ?? "Report failed");
}
```

## UX Recommendations

- Success: toast "Thanks, we logged the issue." and continue flow.
- 409 duplicate: treat as success or show "Already reported" (no retry needed).
- 404: remove item from list and fetch a new one.
- Network/5xx: allow retry; consider exponential backoff.

## Operational Notes

- Server stores reports in `not_playable_reports` table; duplicates blocked per (video_id, sessionId) if sessionId is sent.
- Endpoint is additive and does not affect playlist/reaction APIs.
