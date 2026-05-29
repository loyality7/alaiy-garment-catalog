# Feature Breakdown

## Feature List (Simple)

| # | Feature | Status |
|---|---------|--------|
| 1 | Image Upload (drag-drop, batch of 5) | Done |
| 2 | Input Folder Scan | Done |
| 3 | AI Classification (FRONT/BACK/DETAIL/SPEC_LABEL) | Done |
| 4 | Spec Data Extraction (OCR via AI) | Done |
| 5 | Image Processing (crop, color, resize) | Done |
| 6 | Style Grouping (4-pass algorithm) | Done |
| 7 | Drag-and-Drop Reassignment + Undo/Redo | Done |
| 8 | Classification Override | Done |
| 9 | PowerPoint Catalog Generation | Done |
| 10 | Real-Time WebSocket Pipeline Visibility | Done |
| 11 | Workspace Partitioning (by upload batch) | Done |
| 12 | Pipeline Statistics Dashboard | Done |

---

## Detailed Breakdown

### 1. Image Upload

**Files:** `UploadZone.jsx`, `api.js`, `main.py` (`/upload`), `file_utils.py`

Uploads images via drag-drop or file picker in batches of 5. Backend validates MIME type, deduplicates by MD5, saves to `input/images/`, creates a Redis job, and enqueues a Celery task per image.

- **Input:** Array of File objects (jpg, png, webp)
- **Output:** JSON with jobs array; Redis job entries; Celery queue
- **Limit:** No byte-level progress — only batch pending/done/error states

### 2. Input Folder Scan

**Files:** `main.py` (`/scan`), `file_utils.py`

Scans `input/images/` for .jpg/.jpeg/.png/.webp files not yet tracked in Redis. Creates jobs and enqueues tasks for each new file.

- **Input:** Filesystem state
- **Output:** JSON with new jobs
- **Limit:** Manual trigger only (no file watcher)

### 3. AI Image Classification

**Files:** `classifier.py`, `schemas.py`, `ai_client.py`, `tasks.py`

Resizes image to 1024px, sends to Gemini 2.5 Flash with a detailed prompt. Returns: image_type, confidence, dominant_color, garment_type, pattern, style_name. Up to 3 retries.

- **Input:** Image file path
- **Output:** ClassificationResult object
- **Limit:** No heuristic fallback if AI fails

### 4. Spec Data Extraction (OCR)

**Files:** `ocr.py`, `schemas.py`, `tasks.py`

Only runs for SPEC_LABEL images. Resized to 1536px for readability, sent to AI. Returns ref_number, fabric_composition, gsm, date, remarks.

- **Input:** SPEC_LABEL image path
- **Output:** SpecData object
- **Limit:** Vision model OCR (not traditional OCR engine)

### 5. Image Processing

**Files:** `image_processor.py`, `tasks.py`

5 steps: (1) background removal via rembg (disabled by default), (2) auto-rotate landscape garments -90°, (3) smart crop via OpenCV contour detection, (4) brightness/contrast histogram correction + slight sharpen, (5) max-dimension resize to 1000px.

- **Input:** Image path + ImageType
- **Output:** JPEG bytes (quality 95)
- **Limit:** `REMOVE_BG=false` by default; deskew removed (caused issues with striped fabrics); fixed 1000px max

### 6. Style Grouping (4-Pass)

**Files:** `grouper.py`, `schemas.py`, `tasks.py`

| Pass | Method | Detail |
|------|--------|--------|
| 1 | Timestamp gap | Same batch (>60s gap = new group) |
| 1.5 | Split | Multi-FRONT/BACK groups split into separate groups |
| 2 | Fuzzy heuristic | Color (>0.7), garment type (>0.6), pattern (>0.5), filename proximity scored |
| 3 | AI vision | Solo images verified against neighbor thumbnails |
| 4 | AI vision (optional) | Suspicious groups (mixed types, duplicate FRONTs) verified |

- **Input:** Dict of ImageJob objects
- **Output:** Dict of StyleGroup objects with image ID references
- **Limit:** AI passes cost API calls; Pass 4 capped at 10 groups; spec labels assigned by filename proximity

### 7. Drag-and-Drop Reassignment

**Files:** `ImageCard.jsx`, `StyleGroup.jsx`, `page.tsx`, `main.py` (`/move-image`), `api.js`

Custom drag ghost overlay. Drop target on StyleGroup. Backend moves job between groups, auto-assigns slot by image_type. Undo (Ctrl+Z) and redo (Ctrl+Y) tracked in-memory.

- **Input:** job_id, target_group_id
- **Output:** Updated Redis state + WebSocket event
- **Limit:** Undo lost on page refresh; no multi-select drag

### 8. Classification Override

**Files:** `Canvas.jsx`, `main.py` (`/job/{id}/classify`), `api.js`

Detail panel shows FRONT/BACK/DETAIL/SPEC_LABEL buttons. Click updates the job's image_type and corresponding group slot.

- **Input:** job_id, image_type (optional: color, garment, pattern)
- **Output:** Updated job JSON
- **Limit:** Only type can be overridden from UI; no confirmation dialog

### 9. PowerPoint Catalog Generation

**Files:** `ppt_generator.py`, `schemas.py`, `tasks.py`, `file_utils.py`

**Slide layout:** Dark header (style number + name + subtitle), cream body with framed FRONT/BACK/DETAIL images, spec panel (REF/CONTENT/GSM/REMARKS/DATE), footer with page number + "asmara" logo (text).

**Cover:** Dark slide with "ELEMENTS" title, "COLLECTION — SS26" subtitle, company info, style count.

**Output files:** `output/Catalog.pptx` + `output/Processed_Garments/StyleName_front.jpg` etc.

- **Input:** Dict of StyleGroup + Dict of ImageJob
- **Output:** PPTX file + organized image folder
- **Limit:** Logo is styled text; reference PPT optional; no slide preview; no versioning

### 10. Real-Time WebSocket Visibility

**Files:** `main.py`, `tasks.py`, `useWebSocket.js`, `page.tsx`

ConnectionManager tracks active clients. Celery workers publish to Redis pub/sub. FastAPI listener broadcasts to WebSocket clients.

**Events:** initial_state, job_update, grouping_started/completed/failed, catalog_started/completed/failed, image_moved, groups_update, job_deleted, pipeline_reset, solo_resolved, pong

- **Limit:** Fire-and-forget — missed events on disconnect gap; no event log

### 11. Workspace Partitioning

**Files:** `page.tsx`

Jobs sorted by `created_at`. Gap >60s = new workspace. Tabs shown in header when multiple workspaces exist. Auto-selects latest workspace on new upload batch.

- **Input:** Jobs with created_at timestamps
- **Output:** Workspace tabs + filtered job/group state
- **Limit:** Client-side only; no cross-workspace moves

### 12. Pipeline Statistics Dashboard

**Files:** `PipelinePanel.jsx`, `FloatingToolbar.jsx`, `main.py` (`/stats`)

Left panel showing per-stage counts, overall progress %, style group count. Toggled via FloatingToolbar button.

- **Limit:** Current snapshot only; no history or time-per-stage
