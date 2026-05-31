# Alaiy Garment Catalog

An automated end-to-end system that converts raw, unstructured garment photographs into a professional PowerPoint catalog. The pipeline classifies images (front/back/detail/spec label), extracts specification data from labels, removes backgrounds, organizes images into style groups, and generates a ready-to-use catalog presentation.

> 📚 [Documentation](docs/README.md)

## Quick Start

```bash
docker compose up --build
```

Frontend at `http://localhost:3000`, API at `http://localhost:8000`.

## What It Does (Simple)

1. Upload or scan garment images
2. AI classifies each image as FRONT / BACK / DETAIL / SPEC_LABEL
3. Extracts spec data from labels (ref number, fabric %, GSM)
4. Crops, color-corrects, and resizes images
5. Groups images into style groups (4-pass algorithm)
6. Drag-drop to fix grouping mistakes
7. Generates a PowerPoint catalog
8. Real-time status via WebSocket

---

## Setup

### Prerequisites

- Python 3.11+
- Node.js 20+
- Redis 7+ (or Docker)
- A Gemini API key (or OpenRouter API key as fallback)

### Backend

```bash
cd backend
python -m venv venv
venv\Scripts\activate      # Windows
pip install -r requirements.txt
```

Copy `.env.example` to `.env` and set your API keys:

```bash
cp .env.example .env
# Edit .env: set GEMINI_API_KEY or OPENROUTER_API_KEY
```

Start Redis (required):

```bash
# Docker:
docker run -d -p 6379:6379 redis:7-alpine
```

Start the API server:

```bash
cd backend
uvicorn backend.main:app --reload --port 8000
```

Start the Celery worker in a separate terminal:

```bash
cd backend
celery -A backend.jobs.tasks worker --loglevel=info --concurrency=4
```

### Frontend

```bash
cd frontend
npm install
npm run dev
```

The frontend runs on `http://localhost:3000` and proxies `/api/*` to `http://localhost:8000`.

### Docker (All Services)

```bash
docker compose up --build
```

This starts Redis, backend (UVicorn), Celery worker, and frontend (Next.js dev server).

---

## Project Structure

```
├── backend/
│   ├── main.py              # FastAPI app — REST + WebSocket endpoints
│   ├── models/schemas.py     # Pydantic models and enums
│   ├── jobs/tasks.py         # Celery tasks (process, group, generate)
│   ├── pipeline/
│   │   ├── classifier.py     # AI garment image classifier
│   │   ├── grouper.py        # 4-pass style grouping algorithm
│   │   ├── image_processor.py # Background removal, crop, color correction
│   │   ├── ocr.py            # Spec label extraction via AI
│   │   └── ppt_generator.py  # PowerPoint catalog generation
│   └── utils/
│       ├── ai_client.py      # Unified AI vision client (Gemini / OpenRouter)
│       └── file_utils.py     # File path and I/O helpers
├── frontend/
│   ├── app/page.tsx          # Main page with WebSocket state management
│   ├── components/
│   │   ├── Canvas.jsx        # Main workspace with view modes
│   │   ├── StyleGroup.jsx    # Style group card with drop target
│   │   ├── ImageCard.jsx     # Image thumbnail with status/type badges
│   │   ├── UploadZone.jsx    # Drag-drop upload zone
│   │   ├── PipelinePanel.jsx # Pipeline stats sidebar
│   │   └── FloatingToolbar.jsx # Side toolbar
│   ├── hooks/useWebSocket.js # WebSocket hook with auto-reconnect
│   └── utils/api.js          # API client functions
├── docker-compose.yml        # Full stack orchestration
└── input/                    # Uploaded images and reference.pptx
```

---

## Development Workflow

1. **Upload** — drag-drop or file picker (5 files/batch)
2. **Classify** — AI identifies FRONT/BACK/DETAIL/SPEC_LABEL
3. **Process** — crop, color-correct, resize, optional background removal
4. **Extract** — reads reference number, fabric %, GSM from spec labels
5. **Group** — 4-pass grouping (timestamp → fuzzy → vision confirm)
6. **Review** — drag images between groups, override types
7. **Generate** — creates Catalog.pptx + organized image folder
8. **Download** — exports the final PPTX

## Pipeline States

```
uploaded → classifying → classified → processing → cleaned → assigned → ppt_ready
                                                                              ↓
                                                                        Catalog.pptx
```

---

## Implemented Capabilities

- **Image upload** via drag-drop or file picker, with batch processing (5 files at a time)
- **Scans input folder** for existing images and queues them automatically
- **AI classification** of garment images into FRONT, BACK, DETAIL, and SPEC_LABEL types using Gemini 2.5 Flash / OpenRouter
- **Spec data extraction** from label images: reference number, fabric composition, GSM, date, remarks
- **Image processing**: smart cropping, auto-rotation, brightness/contrast correction, resizing (background removal is disabled by default)
- **Style grouping** using a multi-pass algorithm with **CLIP semantic visual verification** to ensure high-accuracy garment matching
- **Drag-and-drop** manual correction of image-to-group assignments
- **Classification override** via detail panel
- **Triage Mode** to easily filter and review problematic groups
- **PowerPoint catalog generation** with cover slide, per-slide layouts (front/back/detail + specs), matching a reference PPT layout with embedded logos and Georgia typography
- **Real-time pipeline visibility** via WebSocket: per-image status (uploaded → classifying → classified → processing → cleaned → assigned → ppt_ready)
- **Workspace partitioning** by upload time batches (60-second gap threshold)
- **Undo/redo** for drag-and-drop moves (Ctrl+Z / Ctrl+Y)
- **File organization** output: `Processed_Garments/StyleName_front.jpg`, etc.

---

## File Structure Explained

### Backend

| File | Role |
|------|------|
| `main.py` | FastAPI app — 14 REST endpoints + 1 WebSocket endpoint. Manages Redis connections (sync for endpoints, async for pub/sub listener). ConnectionManager tracks active WebSocket clients. Background `redis_listener` subscribes to `ws_events` channel and broadcasts to all connected clients. |
| `models/schemas.py` | Pydantic models — `ImageType` enum (FRONT/BACK/DETAIL/SPEC_LABEL/UNKNOWN), `JobStatus` enum, `ClassificationResult`, `SpecData`, `ImageJob`, `StyleGroup`, `WebSocketMessage`, `PipelineStats`. |
| `jobs/tasks.py` | Celery tasks: `process_image` (per-image classify+process+OCR), `run_grouping` (4-pass grouping), `generate_catalog` (PPT generation). |
| `pipeline/classifier.py` | Sends image to Gemini API with a detailed classification prompt. Retries up to 3 times. Resizes images to max 1024px for API efficiency. Parses JSON response into `ClassificationResult`. |
| `pipeline/image_processor.py` | 5-step processing: (1) background removal via rembg (disabled by default), (2) auto-rotation of landscape garment images, (3) smart cropping via OpenCV contour detection, (4) brightness/contrast histogram correction, (5) resize (configurable via `MAX_IMAGE_DIM`, default 1000px). |
| `pipeline/ocr.py` | Sends spec label images to AI with extraction prompt. Higher resolution (1536px max). Returns `SpecData` with ref_number, fabric_composition, gsm, date, remarks. |
| `pipeline/clip_embedder.py` | Generates semantic embeddings for images using HuggingFace's CLIP model (via PyTorch) to determine visual similarity between garments. |
| `pipeline/grouper.py` | Multi-pass grouping: Pass 1 (Timestamp Gap), Pass 1.5 (CLIP similarity splits), Pass 2 (Heuristic fuzzy matching). Replaced generative AI grouping with deterministic CLIP embeddings for stability. |
| `pipeline/ppt_generator.py` | Creates PowerPoint using python-pptx. Generates cover slide + per-style slides with dark header (Georgia font), cream body, front/back/detail images in framed positions, spec data panel, and embedded Asmara logo image. |
| `utils/ai_client.py` | Unified AI vision client supporting Gemini (primary) and OpenRouter (fallback). Handles provider selection, retry logic, and response parsing. |
| `utils/file_utils.py` | File path and I/O helpers: directory management, base64 encoding, file saving, output organization into `Processed_Garments/`. |

### Frontend

| Component | File | Role |
|-----------|------|------|
| Page | `page.tsx` | Root component managing application state (jobs, groups), WebSocket message handling, workspace partitioning, undo/redo history |
| Canvas | `Canvas.jsx` | Main workspace with three view modes (Groups, All Images, Ungrouped), action buttons (Group, Generate, Download) |
| StyleGroup | `StyleGroup.jsx` | Container for one garment style, group metadata, spec data summary, image cards, drop target for drag-and-drop |
| ImageCard | `ImageCard.jsx` | Single image thumbnail with type badge, confidence score, status badge, classification metadata, expandable spec data, custom drag ghost |
| UploadZone | `UploadZone.jsx` | Drag-drop and file picker upload with per-batch (5 files) progress display and Local Folder Scan button |
| PipelinePanel | `PipelinePanel.jsx` | Left sidebar showing pipeline stage counts, progress bar, style group count |
| FloatingToolbar | `FloatingToolbar.jsx` | Vertical toolbar with buttons to toggle upload panel, stats panel, and Triage Mode filter |
| useWebSocket | `hooks/useWebSocket.js` | Auto-connecting WebSocket with 3-second reconnect and 30-second ping keepalive |
| api.js | `utils/api.js` | Functions for all REST endpoints with dynamic base URL resolution |

---

## Current State & Known Issues

- The core pipeline uses Docker with Celery workers for heavy visual background processing
- Next.js Turbopack provides hot-reloading for UI components
- No automated test suite is present
