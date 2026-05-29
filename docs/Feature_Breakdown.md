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

## Breakdown

### 1. Image Upload with Batch Processing

**Purpose:** Accept multiple garment images via drag-drop or file picker, with batch upload (5 files at a time) and per-file progress display.

**Files involved:**
- `frontend/components/UploadZone.jsx` — Drag-drop zone, file picker, progress UI
- `frontend/utils/api.js:35-46` — `uploadFiles()` function
- `backend/main.py:139-231` — `POST /upload` endpoint
- `backend/utils/file_utils.py` — File saving utilities

**Workflow:**
1. User drops files or selects via file picker
2. Files filtered by MIME type (image/jpeg, image/png, image/webp)
3. Uploaded in batches of 5 as `multipart/form-data`
4. Backend validates content type, deduplicates by MD5 hash, saves to `input/images/`
5. Per-file job created in Redis with status "uploaded"
6. Celery `process_image` task enqueued for each file
7. Event published to WebSocket

**Inputs:** Array of `File` objects (jpg, png, webp)
**Outputs:** JSON response with job array; Redis job entries; Celery task queue

**Limitations:**
- No overall upload progress tracking (only per-batch pending/done/error states)
- Upload progress is tracked client-side only (50%→100% per batch, not actual byte progress)

---

### 2. Input Folder Scan

**Purpose:** Discover images already present in `input/images/` and create jobs for them without re-uploading.

**Files involved:**
- `backend/main.py:234-303` — `POST /scan` endpoint
- `backend/utils/file_utils.py:118-127` — `list_input_images()`

**Workflow:**
1. Scans `input/images/` for files with extensions .jpg, .jpeg, .png, .webp
2. Compares against existing jobs' `original_path` values to avoid duplicates
3. For each new file: creates job in Redis, enqueues Celery task, publishes event

**Inputs:** Filesystem state of `input/images/`
**Outputs:** JSON with newly created job array

**Limitations:**
- Does not watch for new files (manual trigger required)

---

### 3. AI Image Classification

**Purpose:** Classify each garment image into one of four types: FRONT, BACK, DETAIL, or SPEC_LABEL, with confidence score, dominant color, garment type, pattern, and style name.

**Files involved:**
- `backend/pipeline/classifier.py` — Classification logic, prompt, retry
- `backend/models/schemas.py:12-38` — `ImageType` enum, `ClassificationResult` model
- `backend/utils/ai_client.py` — Unified AI client
- `backend/jobs/tasks.py:135-232` — Integration in `process_image` task

**Workflow:**
1. Image resized to max 1024px for API efficiency
2. Sent to Gemini 2.5 Flash with detailed classification prompt
3. Response parsed as JSON → `ClassificationResult`
4. Up to 3 retry attempts on failure
5. Result stored in job: `image_type`, `classification` (confidence, dominant_color, garment_type, pattern, style_name)
6. Job status updated to "classified"

**Inputs:** Image file path
**Outputs:** `ClassificationResult` with `image_type`, `confidence`, `dominant_color`, `garment_type`, `pattern`, `style_name`

**Limitations:**
- Relies entirely on AI; no fallback heuristic classification

---

### 4. Spec Data Extraction (OCR)

**Purpose:** Extract structured data from garment specification label images: reference number, fabric composition, GSM, date, remarks.

**Files involved:**
- `backend/pipeline/ocr.py` — OCR logic and prompt
- `backend/models/schemas.py:40-47` — `SpecData` model
- `backend/jobs/tasks.py:191-207` — Integration in `process_image` task

**Workflow:**
1. Only runs for images classified as SPEC_LABEL
2. Image resized to max 1536px (higher resolution for text readability)
3. Sent to AI vision model with structured extraction prompt
4. Response parsed into `SpecData` object
5. Stored in job's `spec_data` field

**Inputs:** SPEC_LABEL image file path
**Outputs:** `SpecData` with `ref_number`, `fabric_composition`, `gsm`, `date`, `remarks`

**Limitations:**
- Not a traditional OCR engine; relies on vision model's text-reading capability
- Accuracy depends on image resolution and model capability

---

### 5. Image Processing Pipeline

**Purpose:** Clean and standardize garment images through smart cropping, auto-rotation, brightness/contrast correction, and resizing.

**Files involved:**
- `backend/pipeline/image_processor.py` — All processing steps
- `backend/jobs/tasks.py:169-188` — Integration in `process_image` task

**Workflow (5 steps):**
1. **Background removal** (disabled by default): Uses `rembg` (U²Net model) → composites onto white background
2. **Auto-rotation**: If image is landscape and type is FRONT/BACK, rotates -90 degrees
3. **Smart crop**: OpenCV contour detection finds garment bounding box → tight crop with 5% padding. Detects sideways garments (wider than tall) and rotates.
4. **Brightness/contrast correction**: Histogram analysis → targets ~140 brightness, boosts low contrast, slight sharpening (1.1x)
5. **Resize**: Max dimension capped at 1000px maintaining aspect ratio

**Inputs:** Image file path + `ImageType`
**Outputs:** JPEG bytes (quality 95)

**Limitations:**
- Background removal (`REMOVE_BG=false` by default) — disabled due to quality concerns
- Deskew step was removed ("incorrectly rotates striped/ribbed garments based on fabric patterns")
- No orientation correction for DETAIL type
- Max dimension configurable via `MAX_IMAGE_DIM` env var (default 1000px)

---

### 6. Style Grouping (4-Pass Algorithm)

**Purpose:** Organize images into garment style groups, where each group represents one unique garment style with front, back, detail, and spec label images.

**Files involved:**
- `backend/pipeline/grouper.py` — Complete grouping algorithm
- `backend/models/schemas.py:70-84` — `StyleGroup` model
- `backend/jobs/tasks.py:235-317` — `run_grouping` Celery task

**Workflow:**

| Pass | Method | What It Does |
|------|--------|-------------|
| 1 | Timestamp gap | Images sorted by filename timestamp. Groups formed when gap > 60 seconds. |
| 1.5 | Split overloaded | Groups with multiple FRONTs or BACKs split into separate groups. |
| 2 | Heuristic fuzzy | Ungrouped images matched via scoring (color similarity, garment type matching, pattern similarity, filename proximity). Minimum threshold: 1.0 for new groups, 0.4 for low-confidence. |
| 3 | AI vision solos | Solo (single-image) groups sent to AI with neighbor grid to confirm assignment. |
| 4 | AI vision suspicious | Groups with suspicious characteristics (multiple garment types, duplicate FRONTs) sent to AI for confirmation/splitting. |

**Matching criteria:**
- Color: Fuzzy similarity > 0.7 or shared base terms (after removing modifiers)
- Garment type: Similarity > 0.6 or shared root words
- Pattern: Similarity > 0.5
- Filename proximity: Numerical distance (lower = better)

**Inputs:** Dict of `ImageJob` objects
**Outputs:** Dict of `StyleGroup` objects with assigned image IDs and slot references

**Limitations:**
- AI confirmation passes cost additional API calls
- `ENABLE_CONFIRMATION_PASS` is on by default; Pass 4 is capped at 10 groups to limit token usage
- SPEC_LABEL images are assigned to nearest group by filename proximity (may be incorrect)
- `BATCH_GAP_THRESHOLD` is hardcoded to 60 seconds via env var

---

### 7. Manual Image Reassignment (Drag & Drop)

**Purpose:** Allow users to correct grouping errors by dragging images between style groups.

**Files involved:**
- `frontend/components/ImageCard.jsx:43-103` — Custom drag ghost implementation
- `frontend/components/StyleGroup.jsx:41-59` — Drop target handlers
- `frontend/app/page.tsx:124-136` — `handleDropImage` with undo history
- `backend/main.py:549-611` — `POST /move-image` endpoint
- `frontend/utils/api.js:92-99` — `moveImage()` function

**Workflow:**
1. User drags an ImageCard (custom ghost overlay)
2. Drops onto a StyleGroup (drop target)
3. `POST /move-image` sends job_id and target_group_id
4. Backend removes from old group, adds to new group, auto-assigns slot by image type
5. Event `image_moved` broadcast via WebSocket
6. Frontend updates state and records move in undo history
7. Ctrl+Z undoes, Ctrl+Y redoes

**Inputs:** `job_id`, `target_group_id`
**Outputs:** Updated job and group in Redis; WebSocket event

**Limitations:**
- Undo history is in-memory only (lost on page refresh)
- No multi-select drag
- No drop feedback validation (user can drop into any group)

---

### 8. Classification Override

**Purpose:** Allow users to manually correct AI classification results from the image detail panel.

**Files involved:**
- `backend/main.py:484-546` — `PATCH /job/{job_id}/classify`
- `frontend/components/Canvas.jsx:391-412` — Override buttons in detail panel
- `frontend/utils/api.js:145-153` — `overrideClassification()` function

**Workflow:**
1. User opens image detail panel (click on any ImageCard)
2. Clicks one of the four type buttons (FRONT/BACK/DETAIL/SPEC_LABEL)
3. `PATCH /job/{job_id}/classify` updates the job in Redis
4. If job belongs to a style group, the group's slot reference is updated accordingly
5. `job_update` and `groups_update` events broadcast

**Inputs:** `job_id`, `image_type` (required), `dominant_color`, `garment_type`, `pattern` (optional)
**Outputs:** Updated job JSON

**Limitations:**
- Only image_type can be overridden from the UI; other fields require direct API calls
- No confirmation prompt before override

---

### 9. PowerPoint Catalog Generation

**Purpose:** Generate a professional catalog PowerPoint with one cover slide and per-style slides matching a reference layout.

**Files involved:**
- `backend/pipeline/ppt_generator.py` — Full PPT generation
- `backend/models/schemas.py` — `StyleGroup`, `ImageJob`, `SpecData`
- `backend/jobs/tasks.py:320-395` — `generate_catalog` Celery task
- `backend/utils/file_utils.py:158-199` — `organize_output_files()`

**Slide layout (per style):**
- Dark header bar: style number (large), style name, subtitle (ref + fabric + GSM)
- Cream body: FRONT image (left, framed), BACK image (center, framed), DETAIL image (top right)
- Spec data panel (right, below detail): REF, CONTENT, GSM, REMARKS, DATE
- Footer: company name, page number, "asmara" logo (text)

**Cover slide:** Dark background with "ELEMENTS" title, "COLLECTION — SS26" subtitle, company info, style count.

**Workflow:**
1. Loads reference PPT if available (for dimensions)
2. Sorts groups by style number
3. Merges orphaned spec-label-only groups into the preceding style group
4. Generates cover slide + one style slide per group
5. Saves to `output/Catalog.pptx`
6. Copies sorted images to `output/Processed_Garments/StyleName_{front,back,detail,spec}.jpg`

**Inputs:** Dict of `StyleGroup`, dict of `ImageJob`
**Outputs:** PPTX file at `output/Catalog.pptx`; organized files in `output/Processed_Garments/`

**Limitations:**
- Logo is text ("asmara") rendered with red styling; no actual logo image file included
- Reference PPT is optional; if missing, default 13.333×7.5 inch dimensions are used
- Spec data panel may be empty if no spec label was assigned to the group
- No slide preview before generation
- No output versioning

---

### 10. Real-Time Pipeline Visibility (WebSocket)

**Purpose:** Provide live updates on every pipeline stage transition so users can monitor progress without polling.

**Files involved:**
- `backend/main.py:46-96` — `ConnectionManager`, `redis_listener`
- `backend/main.py:616-651` — `WS /ws` endpoint
- `backend/jobs/tasks.py:87-99` — `_emit_ws_event()` helper
- `frontend/hooks/useWebSocket.js` — Client-side WebSocket hook
- `frontend/app/page.tsx:14-92` — Event handling in main page

**Events:**
- `initial_state` — Full snapshot on connect (all jobs + groups)
- `job_update` — Per-job state change (status, classification, processed_path, etc.)
- `grouping_started` / `grouping_complete` / `grouping_failed`
- `catalog_started` / `catalog_complete` / `catalog_failed`
- `image_moved` — Drag-drop reassignment
- `groups_update` — Style group metadata changed
- `job_deleted` — Job removed
- `pipeline_reset` — All data cleared
- `solo_resolved` — Pass 3 solo image merged
- `grouping_pass*_complete` — Per-pass completion events
- `pong` — Keep-alive response

**Limitations:**
- Events are fire-and-forget; if a client disconnects briefly, they may miss transient states
- No event replay or persistent event log

---

### 11. Workspace Partitioning

**Purpose:** Organize images into workspaces based on upload time batches (>60s gap) to keep related images together.

**Files involved:**
- `frontend/app/page.tsx:178-209` — Workspace derivation and tab switching

**Workflow:**
1. All jobs sorted by `created_at`
2. Groups formed when consecutive uploads have >60s gap
3. Tabs shown in UI when multiple workspaces exist
4. Active workspace filters displayed jobs and groups
5. New upload batch auto-selects the latest workspace

**Inputs:** Jobs array with `created_at` timestamps
**Outputs:** Workspace tabs; filtered job/group state

**Limitations:**
- Workspace determination is client-side only (derived from job timestamps)
- Images cannot be moved between workspaces

---

### 12. Pipeline Statistics Dashboard

**Purpose:** Display pipeline progress with per-stage counts and an overall progress bar.

**Files involved:**
- `frontend/components/PipelinePanel.jsx:19-53` — Stats computation and rendering
- `frontend/components/FloatingToolbar.jsx` — Toggle button
- `backend/main.py:324-354` — `GET /stats` endpoint

**Displayed metrics:**
- Per-stage counts: uploaded, classifying, classified, processing, cleaned, assigned, ppt_ready, failed
- Overall progress % (done = cleaned + assigned + ppt_ready / total)
- Style group count

**Limitations:**
- No historical trend data (current snapshot only)
- No time-per-stage metrics
