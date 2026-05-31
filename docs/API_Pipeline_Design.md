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
| GET | `/preview` | Preview catalog slides before generation |
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

Upload one or more garment images. Each file creates a job and enqueues a Celery `process_image` task.

**Request:** `multipart/form-data` with `files` (array of image/* files)

**Response (200):**
```json
{
  "message": "Uploaded 3 images",
  "jobs": [
    {
      "id": "uuid",
      "filename": "DSC03826.JPG",
      "original_path": "C:/.../input/images/DSC03826.JPG",
      "status": "uploaded",
      "image_type": "UNKNOWN",
      "classification": null,
      "style_group": null,
      "spec_data": null,
      "processed_path": null,
      "error": null,
      "created_at": 1712345678.123,
      "updated_at": 1712345678.123
    }
  ]
}
```

**Events published:** `job_update` per file

**Logic:** Validates content type, deduplicates by MD5 hash, saves to `input/images/`, creates Redis job, enqueues Celery task, publishes WebSocket event.

### POST /scan

Scan `input/images/` for files without associated jobs. Creates jobs and enqueues tasks.

**Response (200):** `{"message": "Scanned folder and queued 5 new images", "jobs": [...]}`
**Events published:** `job_update` per file

### GET /jobs

Return all job states from Redis.

**Response (200):** `{"jobs": {"<job_id>": {...}, ...}}`

### GET /groups

Return all style groups.

**Response (200):** `{"groups": {"<group_id>": {...}, ...}}`

### GET /stats

Return pipeline statistics: counts per stage (total, uploaded, classifying, classified, processing, cleaned, assigned, ppt_ready, failed) plus `style_groups` count.

### POST /group

Trigger the grouping phase. Returns a Celery task ID.

**Response (200):** `{"message": "Grouping started", "task_id": "uuid"}`

### GET /preview

Returns slide-by-slide preview data showing what the catalog will contain, without triggering generation. Groups are sorted and orphan spec-label groups are auto-merged (same logic as actual generation).

**Response (200):**
```json
{
  "slides": [
    {
      "style_number": 1,
      "style_name": "Style Name",
      "dominant_color": "Navy Blue",
      "slots": {
        "front": { "job_id": "...", "filename": "...", "image_type": "FRONT", "thumbnail_url": "/thumbnail/..." },
        "back": { ... },
        "detail": { ... },
        "spec_label": { ... }
      }
    }
  ],
  "total": 6
}
```

### POST /generate

Trigger PowerPoint catalog generation. Optional `group_ids` to generate only specific groups.

**Request body (optional):** `{"group_ids": ["id1", "id2"]}`
**Response (200):** `{"message": "Catalog generation started", "task_id": "uuid"}`

### GET /download

Download `output/Catalog.pptx`.

**Response (200):** File download (Content-Type: `application/vnd.openxmlformats-officedocument.presentationml.presentation`)
**Response (404):** If catalog not yet generated

### GET /image/{path}

Serve a processed image by relative path. Tries output directory, then input, then absolute path.

### GET /thumbnail/{job_id}

Serve a thumbnail for a specific job. Prefers `processed_path`, falls back to `original_path`.

### POST /reset

Delete all jobs and style groups from Redis.

**Response (200):** `{"message": "Pipeline reset"}`
**Events published:** `pipeline_reset`

### DELETE /job/{job_id}

Delete a single job, remove from style groups, delete files from disk.

**Response (200):** `{"message": "Job {id} deleted"}`
**Events published:** `job_deleted`

### PATCH /job/{job_id}/classify

Manually override the classification. Updates the job and associated style group slot.

**Query params:** `image_type` (FRONT/BACK/DETAIL/SPEC_LABEL/UNKNOWN), optional `dominant_color`, `garment_type`, `pattern`

**Response (200):** `{"message": "...", "job": {...}}`
**Events published:** `job_update`, potentially `groups_update`

### POST /move-image

Move an image to a different style group (drag-drop support).

**Query params:** `job_id`, `target_group_id`
**Response (200):** `{"message": "Image moved", "job": {...}}`
**Events published:** `image_moved`

### WS /ws

Real-time bidirectional communication.

**On connect:** Server sends `initial_state` with all jobs and groups.
**Server → Client:** Events via Redis pub/sub broadcast — `job_update`, `grouping_*`, `catalog_*`, `image_moved`, `groups_update`, `job_deleted`, `pipeline_reset`, `pong`

---

## Pipeline Stages

### Per-Image State Machine

```
uploaded → classifying → classified → processing → cleaned → (assigned) → ppt_ready
                                                                  (grouping)   (catalog gen)
                                                 → failed (on error, retries 2x)
```

### State Transitions

| From | To | Trigger |
|------|----|---------|
| (none) | uploaded | File uploaded via POST /upload or /scan |
| uploaded | classifying | Celery worker picks up task |
| classifying | classified | AI classification completes |
| classified | processing | Worker begins image processing |
| processing | cleaned | Image processing + optional OCR complete |
| cleaned | assigned | Manual group assignment during grouping |
| assigned | ppt_ready | Catalog generation complete |
| any | failed | Exception in processing, retries exhausted |

---

## Queue Jobs

### process_image(job_id, image_path)

- **Max retries:** 2 (10-second delay)
- **Steps:**
  1. Update status to "classifying"
  2. Call `classify_image()` → get `ClassificationResult`
  3. Update status to "classified" with classification data
  4. Update status to "processing"
  5. Call `process_image()` → get processed bytes
  6. Save processed image to `output/processed_images/`
  7. Update status to "cleaned" with `processed_path`
  8. If SPEC_LABEL: call `extract_spec_data()` → update `spec_data`
  9. Check if all jobs are done; if yes, auto-trigger `run_grouping`
- **On failure:** Updates status to "failed" with error message, retries up to 2 times

### run_grouping()

- **Steps:**
  1. Emit `grouping_started` event
  2. Load all jobs from Redis, convert to `ImageJob` objects
  3. Run `group_images()` — 4-pass algorithm
  4. Update each job's `style_group` assignment, set status to "assigned"
  5. Store style groups in Redis
  6. Emit `grouping_complete` with groups data
- **On failure:** Emit `grouping_failed` with error

### generate_catalog(group_ids=None)

- **Steps:**
  1. Emit `catalog_started` event
  2. Load jobs and style groups from Redis
  3. Optionally filter by `group_ids`
  4. Convert to model objects
  5. Call `ppt_generator.generate_catalog()`
  6. Call `organize_output_files()` → copy to `Processed_Garments/`
  7. Update all jobs to "ppt_ready"
  8. Emit `catalog_complete` with output path
- **On failure:** Emit `catalog_failed` with error

---

## Grouping Algorithm (4 Passes)

| Pass | Method | What It Does |
|------|--------|-------------|
| 1 | Timestamp gap | Sequential filenames with gaps >60s create new groups |
| 1.5 | CLIP Similarity Split | Groups with multiple FRONTs/BACKs or low semantic similarity are split into separate groups via PyTorch and HuggingFace CLIP embeddings |
| 2 | Fuzzy heuristic | Ungrouped images matched by color (>0.7), garment type (>0.6), pattern (>0.5), filename proximity scoring |

### Matching Criteria

- **Color:** Fuzzy similarity > 0.7 or shared base terms (after removing modifiers like "light", "dark")
- **Garment type:** Similarity > 0.6 or shared root words
- **Pattern:** Similarity > 0.5
- **Filename proximity:** Numerical distance (lower = better)

---

## Event Sequence Diagram

```
Client          FastAPI         Redis           Celery
  |               |               |               |
  |── WS /ws ───────────────>│                         │                       │
  │<── initial_state ────────│                         │                       │
  │                          │                         │                       │
  │── POST /upload ─────────>│                         │                       │
  │                          │── HSET jobs ───────────>│                       │
  │                          │── PUBLISH ws_events ───>│                       │
  │                          │── task.delay() ────────>│── broker ────────────>│
  │                          │                         │                       │
  │<── job_update (uploaded)─│<── broadcast ──────────│                       │
  │                          │                         │                       │
  │                          │                         │<── poll ───────────── │
  │                          │                         │                       │── classify()
  │                          │<── broadcast ──────────│<── PUBLISH ws_events ──│
  │<── job_update (classified)                         │                       │
  │                          │                         │                       │── process()
  │                          │<── broadcast ──────────│<── PUBLISH ws_events ──│
  │<── job_update (cleaned)──│                         │                       │
  │                          │                         │                       │── auto-trigger grouping
  │                          │                         │<── broker ───────────│
  │                          │                         │<── poll ──────────────│── group_images()
  │                          │<── broadcast ──────────│<── PUBLISH ws_events ──│
  │<── grouping_complete ────│                         │                       │
  │                          │                         │                       │
  │── POST /generate ───────>│                         │                       │
  │                          │── task.delay() ────────>│── broker ────────────>│
  │                          │                         │<── poll ──────────────│── generate_ppt()
  │                          │<── broadcast ──────────│<── PUBLISH ws_events ──│
  │<── catalog_complete ─────│                         │                       │
  │                          │                         │                       │
  │── GET /download ────────>│                         │                       │
  │<── Catalog.pptx ─────────│                         │                       │
```

---

## Error Handling

| Scenario | Behavior |
|----------|----------|
| AI provider failure | `ai_client.py` retries across providers (Gemini → OpenRouter). If both fail, raises exception. |
| Classification failure | `classifier.py` retries up to 3 attempts. If all fail, raises exception → worker catches → updates job to "failed" → Celery retries the task (2 retries, 10s delay). |
| Grouping failure | Exception caught, `grouping_failed` event emitted, task not retried. |
| Catalog generation failure | Exception caught, `catalog_failed` event emitted, task not retried. |
| WebSocket disconnect | ConnectionManager removes dead connections during broadcast. Client-side auto-reconnects after 3 seconds. |
| Duplicate file uploads | Content-based deduplication via MD5 hash. If same file already exists, reuses existing file without re-saving. |
| Missing catalog | Returns 404 with `"Catalog not yet generated"`. |
| Missing image | Returns 404 with `"Image not found"`. |
