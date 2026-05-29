# Alaiy Garment Catalog

An automated end-to-end system that converts raw, unstructured garment photographs into a professional PowerPoint catalog. The pipeline classifies images (front/back/detail/spec label), extracts specification data from labels, removes backgrounds, organizes images into style groups, and generates a ready-to-use catalog presentation.

## Implemented Capabilities

- **Image upload** via drag-drop or file picker, with batch processing (5 files at a time)
- **Scans input folder** for existing images and queues them automatically
- **AI classification** of garment images into FRONT, BACK, DETAIL, and SPEC_LABEL types using Gemini 2.5 Flash
- **Spec data extraction** from label images: reference number, fabric composition, GSM, date, remarks
- **Image processing**: smart cropping, auto-rotation, brightness/contrast correction, resizing (background removal is disabled by default)
- **Style grouping** using a 4-pass algorithm (timestamp proximity, fuzzy heuristic matching, AI vision confirmation)
- **Drag-and-drop** manual correction of image-to-group assignments
- **Classification override** via detail panel
- **PowerPoint catalog generation** with cover slide, per-slide layouts (front/back/detail + specs), matching a reference PPT layout
- **Real-time pipeline visibility** via WebSocket: per-image status (uploaded → classifying → classified → processing → cleaned → assigned → ppt_ready)
- **Workspace partitioning** by upload time batches (60-second gap threshold)
- **Undo/redo** for drag-and-drop moves (Ctrl+Z / Ctrl+Y)
- **File organization** output: `Processed_Garments/StyleName_front.jpg`, etc.

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

## Development Workflow

1. Upload images via the frontend UI or place them in `input/images/` and use the "Scan" button
2. Images are classified by AI (Gemini → OpenRouter fallback)
3. Processed images are cropped, color-corrected, and optionally background-removed
4. After all images are processed, click "Group" to run the 4-pass grouping algorithm
5. Review groups; drag images between groups to correct assignments
6. Click "Generate Catalog" to produce `output/Catalog.pptx`
7. Download the PPTX file via the "Download" button

## Limitations

- Background removal (`rembg`) is **disabled by default** (`REMOVE_BG=false`) due to potential quality issues
- The "asmara" logo in the PowerPoint is rendered as styled text (no logo image file)
- The frontend uses `.jsx` files despite TypeScript being configured
- No automated test suite is present
- The reference PPT (`input/reference.pptx`) is optional; if absent, default slide dimensions (13.33×7.5 inches) are used
- The frontend does not implement a "Slide Preview before export" feature (listed as a bonus goal)
- Output versioning is not implemented
- There is no confirmation dialog for reclassification or grouping override (only for reset and delete)
