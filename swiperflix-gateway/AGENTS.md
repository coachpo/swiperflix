# SWIPERFLIX GATEWAY — KNOWLEDGE BASE

## OVERVIEW

FastAPI backend that syncs video metadata from OpenList into SQLite and serves a playlist/reaction API. Single-file route pattern. Python 3.11+, SQLAlchemy ORM, Pydantic settings. No application-level auth — endpoints are open (auth expected at reverse proxy).

## STRUCTURE

```
app/
├── main.py              # FastAPI app + ALL routes + startup
├── models.py            # SQLAlchemy ORM: Video, Reaction, Impression, NotPlayableReport
├── schemas.py           # Pydantic request/response models
├── db.py                # Engine, SessionLocal, init_db(), idempotent migrations
├── config.py            # Pydantic Settings (env-driven, OPENLIST_ prefix)
├── openlist_client.py   # HTTP client for OpenList API (httpx)
├── sync.py              # CLI: python -m app.sync (upsert videos from OpenList)
├── utils.py             # error_response() helper
└── __init__.py
```

## WHERE TO LOOK

| Task | File | Notes |
|------|------|-------|
| Add/modify endpoint | `app/main.py` | All routes inline, no router split |
| Add DB column | `app/models.py` + `app/db.py` | Add column to model, add `_ensure_*` migration in db.py |
| Change API response shape | `app/schemas.py` | Pydantic models with `from_attributes=True` |
| Modify OpenList sync | `app/sync.py` + `app/openlist_client.py` | sync.py = CLI orchestrator, client = HTTP calls |
| Change env config | `app/config.py` | Pydantic Settings, `OPENLIST_` prefix, `.env` file |

## API ENDPOINTS

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/v1/playlist?limit=5` | Least-picked videos (ordered by pick_count), increments pick_count |
| GET | `/api/v1/videos/{id}/stream` | 302 redirect to OpenList download URL |
| POST | `/api/v1/videos/{id}/like` | Record like (deduped by video_id + type + session_id) |
| POST | `/api/v1/videos/{id}/dislike` | Record dislike (same dedup) |
| POST | `/api/v1/videos/{id}/impression` | Track watchedSeconds + completed |
| POST | `/api/v1/videos/{id}/not-playable` | Report playback issue (deduped by video_id + session_id) |

## CONVENTIONS

- **Singleton pattern**: `get_settings()` and `get_openlist_client()` return module-level singletons
- **DB sessions**: `get_db()` generator yields session, used via `Depends(get_db)`
- **Error responses**: always use `error_response()` from utils — raises `HTTPException` with structured body
- **Migrations**: idempotent `_ensure_*` functions in `db.py`, called from `init_db()`. No Alembic.
- **OpenList auth**: token stored raw (no "Bearer" prefix) in `Authorization` header. Falls back to basic auth.
- **CORS**: wide open (`allow_origins=["*"]`, `allow_credentials=False`)

## ANTI-PATTERNS

- Do NOT split routes into separate router files — everything lives in `main.py`
- Do NOT use Alembic — migrations are manual idempotent functions in `db.py`
- Do NOT proxy video content — `/stream` returns 302 redirect only
- Do NOT suppress `BLE001` broadly — it's used only for startup sync resilience (`noqa: BLE001`)
- Do NOT hardcode OpenList URLs — use `settings.build_file_url()` for path encoding
- Do NOT add bearer token auth — auth belongs at the reverse proxy layer

## DEPENDENCY GRAPH

```
main.py → models, config, db, openlist_client, schemas, utils
sync.py → config, db, models, openlist_client
openlist_client.py → config
db.py → config (+ imports models in init_db)
models.py → db (Base)
utils.py → schemas
schemas.py → (standalone)
config.py → (standalone, pydantic-settings)
```

## NOTES

- Startup event calls `init_db()` then `ensure_videos_loaded()` — sync failure is caught and logged, app still boots.
- `pick_count` drives fair playlist distribution — least-picked videos served first with random tiebreaker.
- OpenList client handles 401 retries: if response body has `code: 401`, it re-authenticates and retries once.
- `fetch_files()` paginates via `per_page=100` until all entries retrieved.
- Video IDs are auto-increment integers internally but exposed as strings in the API.
