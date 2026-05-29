# API & Pipeline Design

## Quick Reference

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/upload` | Upload images → creates jobs → Celery task |
| POST | `/scan` | Scan input folder for new images |
| GET | `/jobs` | All job states |
| GET | `/groups` | All style groups |
| GET | `/stats` | Pipeline counts per stage |
| POST | `/group` | Trigger style grouping |
| POST | `/generate` | Trigger PPT generation |
| GET | `/download` | Download Catalog.pptx |
| GET | `/image/{path}` | Serve a processed image |
| GET | `/thumbnail/{job_id}` | Job thumbnail |
| POST | `/reset` | Delete all jobs + groups |
| DELETE | `/job/{job_id}` | Delete one job |
| PATCH | `/job/{job_id}/classify` | Override classification |
| POST | `/move-image` | Move image between groups |
| WS | `/ws` | Real-time pipeline updates |

---

## Detailed Endpoints

### POST /upload

Upload multiple images. Each file:
- Validated as image/* content type
- Deduplicated by MD5 hash
- Saved to `input/images/`
- Creates a Redis job (status: `uploaded`)
- Enqueues a Celery `process_image` task

**Request:** `multipart/form-data` with `files`
**Response:**
```json
{
  "message": "Uploaded 3 images",
  "jobs": [{ "id": "uuid", "filename": "...", "status": "uploaded", ... }]
}
```

### POST /scan

Scans `input/images/` for .jpg/.jpeg/.png/.webp files not yet in Redis. Creates jobs and tasks for each.

### GET /jobs

Returns `{"jobs": {"<job_id>": {...}}}` — all job data from Redis hash.

### GET /groups

Returns `{"groups": {"<group_id>": {...}}}` — all style groups from Redis.

### GET /stats

Returns counts per stage + style group count. Stages: total, uploaded, classifying, classified, processing, cleaned, assigned, ppt_ready, failed.

### POST /group

Runs the 4-pass grouping algorithm. Returns Celery task ID. Can also auto-trigger when all images finish processing.

### POST /generate

Generates Catalog.pptx. Optional `{"group_ids": [...]}` to filter which groups to include.

### GET /download

Serves `output/Catalog.pptx`. Returns 404 if not yet generated.

### GET /image/{path}

Serves any image. Tries output → input → absolute path.

### GET /thumbnail/{job_id}

Serves a job's image. Prefers processed → original path.

### POST /reset

Deletes all Redis job/group keys, broadcasts `pipeline_reset` event.

### DELETE /job/{job_id}

Removes job from Redis + group + deletes files from disk.

### PATCH /job/{job_id}/classify

Override `image_type` and optionally `dominant_color`, `garment_type`, `pattern`. Updates both the job and its group's slot reference.

### POST /move-image

Move a job between groups. Auto-assigns slot based on image_type.

### WS /ws

On connect: sends `initial_state` with all jobs + groups.
Client sends `"ping"` → server responds `{"event": "pong"}`.
Server broadcasts: `job_update`, `grouping_*`, `catalog_*`, `image_moved`, etc.

---

## Pipeline Stages

### Per-Image State Machine

```
uploaded → classifying → classified → processing → cleaned
                                                    ↓
                                              (grouping)
                                                    ↓
                                              assigned → ppt_ready
                                              (catalog gen)
```

All states can transition to `failed` on error (2 retries for process_image).

### Celery Tasks

| Task | Retries | Steps |
|------|---------|-------|
| `process_image` | 2 (10s delay) | classify → process → OCR (if SPEC_LABEL) → auto-trigger grouping |
| `run_grouping` | 0 | Load jobs → 4-pass group → store groups → emit events |
| `generate_catalog` | 0 | Load groups → generate PPTX → organize files → emit event |

### Grouping Algorithm (4 Passes)

| Pass | Method | What |
|------|--------|------|
| 1 | Timestamp gap | Sequential filenames, gap >60s = new group |
| 1.5 | Split | Groups with multiple FRONTs/BACKs split |
| 2 | Fuzzy heuristic | Color, garment type, pattern similarity scoring |
| 3 | AI vision | Solo images checked against filename neighbors |
| 4 | AI vision (optional) | Suspicious groups verified by vision model |

---

## Event Sequence

```
Client          FastAPI         Redis           Celery
  |               |               |               |
  |-- WS /ws ---->|               |               |
  |<-- init_state-|               |               |
  |               |               |               |
  |-- POST upload>|-- HSET job -->|               |
  |               |-- PUBLISH --->|               |
  |               |-- task.delay->|-- broker ---->|
  |               |               |               |-- classify()
  |<-- job_update |<-- broadcast <|<- PUBLISH ----|
  |               |               |               |-- process()
  |<-- job_update |<-- broadcast <|<- PUBLISH ----|
  |               |               |               |-- auto-group
  |               |               |<-- broker ----|
  |               |               |               |-- group_images()
  |<-- group_done |<-- broadcast <|<- PUBLISH ----|
  |               |               |               |
  |-- POST gen --->|-- task.delay>|-- broker ---->|
  |               |               |               |-- generate_ppt()
  |<-- catalog_ok |<-- broadcast <|<- PUBLISH ----|
  |               |               |               |
  |-- GET downl-->|-- serve file->|               |
  |<-- Catalog.pptx               |               |
```

## Error Handling

| Scenario | Behavior |
|----------|----------|
| AI provider down | Retries Gemini → OpenRouter, both fail → fails task |
| Classification fails | 3 retries → task `failed` status → 2 more Celery retries |
| Grouping fails | Emits `grouping_failed`, no retry |
| PPT generation fails | Emits `catalog_failed`, no retry |
| WebSocket disconnect | Server silently removes, client reconnects in 3s |
| Duplicate file upload | MD5 dedup — reuses existing file |
| Catalog not found | Returns 404 |
| Image not found | Returns 404 |
