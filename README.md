# Alaiy Garment Catalog

Converts raw garment photos into a ready PowerPoint catalog.

## Quick Start

```bash
docker compose up --build
```

Frontend at `http://localhost:3000`, API at `http://localhost:8000`.

## What It Does

1. Upload or scan garment images (front/back/detail/spec label)
2. AI classifies each image type + extracts specs from labels
3. Automatically crops, color-corrects, and resizes images
4. Groups images into style groups (4-pass algorithm)
5. Drag-drop to fix any grouping mistakes
6. Generates a professional PowerPoint catalog
7. Real-time status via WebSocket — no refreshing needed

## Setup

**Prerequisites:** Python 3.11+, Node.js 20+, Redis 7+, Gemini API key

### Backend

```bash
cd backend
pip install -r requirements.txt
cp .env.example .env   # set GEMINI_API_KEY
uvicorn backend.main:app --reload --port 8000
```

In another terminal:

```bash
celery -A backend.jobs.tasks worker --loglevel=info
```

### Frontend

```bash
cd frontend
npm install
npm run dev
```

### Docker

```bash
docker compose up --build
```

Starts: Redis, backend, Celery worker, frontend.

---

## Project Structure

```
backend/
├── main.py                # FastAPI — REST + WebSocket
├── models/schemas.py      # Pydantic models
├── jobs/tasks.py          # Celery tasks
├── pipeline/
│   ├── classifier.py      # AI image classification
│   ├── grouper.py         # 4-pass style grouping
│   ├── image_processor.py # Crop, color, resize
│   ├── ocr.py             # Spec label extraction
│   └── ppt_generator.py   # PowerPoint generation
└── utils/
    ├── ai_client.py       # Gemini / OpenRouter client
    └── file_utils.py      # File I/O helpers

frontend/
├── app/page.tsx           # Main app with WebSocket state
├── components/
│   ├── Canvas.jsx         # Workspace (Groups / All / Ungrouped)
│   ├── StyleGroup.jsx     # Group card with drop target
│   ├── ImageCard.jsx      # Thumbnail with status badges
│   ├── UploadZone.jsx     # Drag-drop upload
│   ├── PipelinePanel.jsx  # Stats sidebar
│   └── FloatingToolbar.jsx
├── hooks/useWebSocket.js  # Auto-reconnect WebSocket
└── utils/api.js           # API client
```

## Workflow

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

## Limitations

- Background removal disabled by default (`REMOVE_BG=false`)
- Logo is rendered as text (no image file)
- JSX files despite TypeScript config
- No test suite
- No slide preview before export
- No output versioning
