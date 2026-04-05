# Impression Tracking API

Record how much of a video a user watched.

## Endpoint

- `POST /api/v1/videos/{video_id}/impression`
- Auth: `Authorization: Bearer <token>` (same as other endpoints)
- Content-Type: `application/json`

## Request Body

```jsonc
{
  "watchedSeconds": 42.5,  // required, number of seconds the user watched
  "completed": false       // required, whether the user finished the video
}
```

Notes:
- Send the best-known watch time (can be fractional seconds).
- `completed` should be `true` only if the video reached the natural end.

## Responses

- `200 OK` — `{ "ok": true }`
- `404 Not Found` — `{ "error": { "code": "VIDEO_NOT_FOUND", ... } }`
- `401 Unauthorized` — missing or bad bearer token

## Example cURL

```bash
curl -X POST "$API_BASE/api/v1/videos/123/impression" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type": "application/json" \
  -d '{"watchedSeconds": 37.2, "completed": false}'
```

## Frontend Usage (fetch)

```ts
type ImpressionPayload = {
  watchedSeconds: number;
  completed: boolean;
};

async function sendImpression(videoId: string, payload: ImpressionPayload) {
  const res = await fetch(`${API_BASE}/api/v1/videos/${videoId}/impression`, {
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
  throw new Error(data?.error?.message ?? "Impression failed");
}
```

## UX Recommendations

- Fire once per playback session (e.g., on player end or when user exits).
- Retry quietly on transient failures; avoid spamming.
- If 404, drop the item from the current list and fetch a replacement.

## Operational Notes

- Server stores each impression row with timestamp; no deduplication.
- Endpoint is additive and shares auth/config with playlist/reaction routes.
