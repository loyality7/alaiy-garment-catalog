# Technology Stack

## Quick Overview

| Layer | Technology | Version | Why |
|-------|-----------|---------|-----|
| Frontend | Next.js | 16.2.6 | React framework with API rewrites |
| Frontend | React | 19.2.4 | UI components |
| Frontend | TailwindCSS | 4 | Utility CSS with custom design tokens |
| Frontend | TypeScript | 5 | Type safety (JSX files in practice) |
| Backend | Python | 3.11 | ASGI + async support |
| Backend | FastAPI | 0.115 | Async REST + WebSocket + Pydantic |
| Backend | Celery | 5.4 | Distributed task queue |
| Backend | Redis | 7 | State store, broker, pub/sub |
| Backend | Pillow | 10.4 | Image open/save/resize/enhance |
| Backend | OpenCV | 4.10 | Contour detection, cropping |
| Backend | rembg | 2.0 | Background removal (U²Net) |
| Backend | python-pptx | 1.0 | PowerPoint generation |
| AI | Gemini 2.5 Flash | — | Primary vision model |
| AI | OpenRouter | — | Fallback provider |
| Infra | Docker Compose | — | 4-service orchestration |

---

## Frontend

| Dependency | Version | Role | Where Used |
|-----------|---------|------|------------|
| Next.js | 16.2.6 | SSR, file routing, API rewrites | `next.config.ts` proxies `/api/*` → backend |
| React | 19.2.4 | Component rendering | All `.jsx` files |
| TailwindCSS | 4 | Utility CSS with custom design tokens | `globals.css` + inline classes |
| TypeScript | 5 | Type safety | `tsconfig.json` config (JSX files used despite config) |
| Axios | 1.7.9 | HTTP client | `api.js` — all API communication |
| Geist Fonts | — | Typography | `layout.tsx` via next/font/google |
| LineIcons | 1.0.6 | SVG icons | Toolbar + action buttons |

## Backend

| Library | Version | Role | Where Used |
|---------|---------|------|------------|
| FastAPI | 0.115 | REST + WebSocket server | `main.py` — 14 endpoints + WS |
| Uvicorn | 0.30.6 | ASGI runner | Starts FastAPI, used in Docker + CLI |
| python-multipart | 0.0.9 | File upload parsing | Required by FastAPI for form data |
| Pydantic | 2.9.2 | Data validation | `schemas.py` — all models |
| Celery | 5.4 | Async job queue | `tasks.py` — 3 task types |
| Redis | 5.1 | State + broker + pub/sub | Jobs (hash), groups (string), ws_events (pub/sub) |
| httpx | 0.27.2 | Async HTTP client | `ai_client.py` — calls Gemini/OpenRouter APIs |
| python-dotenv | 1.0.1 | Env file loader | `main.py`, `file_utils.py` |
| aiofiles | 24.1.0 | Async file I/O | Listed in requirements, not used in code |
| websockets | 12.0 | WebSocket support | Required by FastAPI's WebSocket implementation |

## Image Processing

| Library | Version | Role | Where Used |
|---------|---------|------|------------|
| Pillow | 10.4 | Open, EXIF transpose, resize, enhance, save | `image_processor.py`, `classifier.py`, `ocr.py`, `grouper.py` |
| OpenCV | 4.10 | Grayscale conversion, edge detection, contour finding | `image_processor.py` — smart crop |
| rembg | 2.0 | Background removal using U²Net model | `image_processor.py` — disabled by default (`REMOVE_BG=false`) |
| ONNX Runtime | 1.19 | Model runtime for rembg / U²Net inference | Required dependency of rembg |

## AI Integration

All routing via `ai_client.py` — tries Gemini, falls back to OpenRouter.

| Integration | Module | What It Does | Prompt Type |
|-------------|--------|-------------|-------------|
| Image classification | `pipeline/classifier.py` | Determines FRONT/BACK/DETAIL/SPEC_LABEL with confidence, color, garment type, pattern, style name | 80-line detailed prompt with type rules and common mistakes |
| Spec label OCR | `pipeline/ocr.py` | Reads structured data from label images: ref_number, fabric_composition, gsm, date, remarks | Structured extraction prompt |
| Grouping Pass 3 | `pipeline/grouper.py:174-228` | Vision-based verification of single-image groups against filename neighbors | Grid comparison prompt |
| Grouping Pass 4 | `pipeline/grouper.py:254-314` | Vision-based verification of suspicious groups for confirmation/splitting | Conflict resolution prompt |

**Provider configuration:**
- Primary: `GEMINI_MODEL=gemini-2.5-flash` via Google Gemini API
- Fallback: `OPENROUTER_MODEL=google/gemini-flash-2.5` via OpenRouter API
- Selection: Controlled by `AI_PROVIDER` env var ("gemini" or "openrouter")

### Why Gemini 2.5 Flash

Google's fast, cost-effective vision-language model with native image understanding. Used for both classification and OCR. Its low latency and high accuracy make it suitable for real-time pipeline processing.

### Why OpenRouter (Fallback)

Provides access to multiple models through a single API. Used as backup when Gemini API is unavailable, ensuring pipeline reliability.

## Infrastructure

| Component | Image | Config | Purpose |
|-----------|-------|--------|---------|
| Redis | `redis:7-alpine` | Healthcheck: redis-cli ping, port 6379 | State store, Celery broker, pub/sub event bus |
| Backend | Custom (Python 3.11-slim) | `Dockerfile` with OpenCV system deps | FastAPI server on port 8000 |
| Celery worker | Same backend image | `celery -A backend.jobs.tasks worker --concurrency=4` | Async task processing |
| Frontend | `node:20-alpine` | `npm run dev` | Next.js dev server on port 3000 |

### Docker Compose Volumes

| Volume | Mount | Purpose |
|--------|-------|---------|
| `redis_data` | `/data` | Redis persistence |
| Bind | `./input:/app/input` | Shared image storage between services |
| Bind | `./output:/app/output` | Shared output storage |
| Bind | `./backend:/app/backend` | Live code reload for API |
| Bind | `./frontend:/app` | Live code reload for UI (with `/app/node_modules` excluded) |

### Backend Dockerfile Details

- Base: `python:3.11-slim`
- System packages: `libgl1-mesa-glx`, `libglib2.0-0`, `libsm6`, `libxext6`, `libxrender-dev` (required by OpenCV)
- Pre-caches rembg U²Net model at build time to avoid first-run stall
- CMD: `uvicorn backend.main:app --host 0.0.0.0 --port 8000`

## Why Each Technology

| Technology | Why Chosen |
|-----------|-----------|
| FastAPI | Async Python web framework with auto OpenAPI docs, Pydantic integration, native WebSocket support |
| Celery | Standard distributed task queue for Python; Redis integration provides zero additional infrastructure |
| Redis | Single technology serving 4 roles: state store, pub/sub, Celery broker, Celery backend |
| Pillow | Standard Python imaging library; required for open/save/resize/enhance |
| OpenCV | Advanced computer vision (contour detection, edge analysis) not available in Pillow |
| rembg | Pre-trained deep learning model (U²Net) for background removal |
| python-pptx | Only mature Python library for programmatic PowerPoint generation |
| Next.js | React framework with SSR, file routing, API rewrites for backend proxying |
| TailwindCSS | Utility-first CSS with rapid prototyping and consistent design tokens |
| Docker Compose | Single-command orchestration for multi-service architecture |
