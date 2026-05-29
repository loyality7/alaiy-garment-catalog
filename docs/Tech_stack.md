# Technology Stack

## Frontend

### Next.js 16 (React 19)
- **Why:** Provides SSR/SSG capabilities, file-based routing, API rewrites for proxying to the backend, TypeScript support, and a large ecosystem.
- **Usage:** Frontend framework for the single-page application at `frontend/app/page.tsx`. API rewrites configured in `next.config.ts` proxy `/api/*` to the FastAPI backend.
- **Version:** 16.2.6 (React 19.2.4)

### TailwindCSS v4
- **Why:** Utility-first CSS framework for rapid UI development with consistent design tokens and responsive layouts.
- **Usage:** All component styling; custom design tokens (colors, shadows, status colors) defined in `globals.css` using CSS custom properties with Tailwind's `@theme` directive.

### TypeScript v5
- **Why:** Type safety for frontend code. Note: All components and hooks in the project are written as `.jsx`/`.js` files, despite TypeScript being configured and a `tsconfig.json` present.

### @lineiconshq/free-icons (LineIcons)
- **Why:** Icon library for toolbar and action buttons. Provides SVG icons used throughout the UI.

### Geist Fonts (by Vercel)
- **Why:** Modern, system-like font family optimized for screen readability. Used via `next/font/google`.

## Backend

### Python 3.11 (slim base image)
- **Why:** Standard Python runtime with good async support. The `slim` variant in Docker reduces image size.
- **Usage:** All backend code runs in this environment.

### FastAPI 0.115
- **Why:** High-performance async Python web framework with automatic OpenAPI documentation, Pydantic integration, and native WebSocket support.
- **Usage:** REST API server and WebSocket endpoint defined in `backend/main.py`. Handles all HTTP requests, WebSocket connections, and Redis pub/sub broadcasting.

### Uvicorn
- **Why:** ASGI server for running FastAPI. Supports hot-reload in development.
- **Usage:** Runs the FastAPI app, either directly or via Docker Compose with `--reload` flag.

### Python-Multipart
- **Why:** Required by FastAPI for parsing `multipart/form-data` uploads.

### Pydantic 2.9
- **Why:** Data validation using Python type hints. Integrated deeply with FastAPI.
- **Usage:** Defines all data models in `backend/models/schemas.py` — `ImageJob`, `StyleGroup`, `ClassificationResult`, `SpecData`, `PipelineStats`, `WebSocketMessage`.

### Celery 5.4
- **Why:** Distributed task queue for asynchronous background processing. Supports Redis as broker and result backend.
- **Usage:** Three task types defined in `backend/jobs/tasks.py`:
  - `process_image` — Per-image classification, processing, and OCR
  - `run_grouping` — 4-pass style grouping
  - `generate_catalog` — PowerPoint generation

### Redis 5.1 / aioredis
- **Why:** In-memory data store serving four roles: Celery broker, Celery result backend, primary job/group state store, and pub/sub event bus.
- **Usage:**
  - `redis` (sync client): Used by endpoints and workers for CRUD on jobs and style groups
  - `redis.asyncio` (async client): Used by the background pub/sub listener that broadcasts events to WebSocket clients

### httpx 0.27
- **Why:** Modern async HTTP client for Python.
- **Usage:** Making HTTP requests to AI providers (Gemini API, OpenRouter API) in `backend/utils/ai_client.py`.

### python-dotenv
- **Why:** Loads environment variables from `.env` files.
- **Usage:** Called in `backend/main.py` and `backend/utils/file_utils.py` to load configuration.

### aiofiles
- **Why:** Async file I/O (listed in requirements but not used in the current codebase).

## Database

### Redis 7 (Alpine)
- **Why:** Chosen over a traditional RDBMS because the system needs a fast, schema-less key-value store for job state, a pub/sub channel for real-time events, and a Celery broker — all provided by Redis.
- **Usage:**
  - Hash key `jobs`: Stores all image processing jobs (keyed by UUID)
  - Key `style_groups`: JSON-encoded dict of all style groups
  - Pub/sub channel `ws_events`: Event bus between Celery workers and FastAPI
  - Standard Celery broker/backend usage

## Queue System

### Celery + Redis (self-hosted)
- **Why:** Standard Python distributed task queue. Redis integration provides zero additional infrastructure.
- **Worker concurrency:** 4 (configured in Docker Compose and manual start command)
- **Task serialization:** JSON
- **Retry policy:** 2 max retries, 10-second delay for `process_image`; no retries for `run_grouping` and `generate_catalog`

## AI Models

### Gemini 2.5 Flash (primary)
- **Why:** Google's fast, cost-effective vision-language model with native image understanding. Used for both classification and OCR.
- **Usage:** All AI vision tasks use this as the primary provider (configured via `AI_PROVIDER=gemini` and `GEMINI_MODEL=gemini-2.5-flash`).
- **API:** Google Gemini API via `streamGenerateContent` endpoint.

### OpenRouter (fallback, google/gemini-flash-2.5)
- **Why:** Provides access to multiple models through a single API with fallback capability. The specific model used is the same Gemini Flash variant.
- **Usage:** Configured as fallback when Gemini is unavailable; also used when `AI_PROVIDER=openrouter`.

### AI Usage Locations:
1. **Image classification** (`backend/pipeline/classifier.py`): Determines FRONT/BACK/DETAIL/SPEC_LABEL
2. **Spec data extraction** (`backend/pipeline/ocr.py`): Reads structured data from label images
3. **Grouping Pass 3 – Solo resolution** (`backend/pipeline/grouper.py:174-228`): Vision-based verification of single-image groups
4. **Grouping Pass 4 – Suspicious group confirmation** (`backend/pipeline/grouper.py:254-314`): Vision-based verification of groups with conflicts

## Image Processing Libraries

### Pillow 10.4
- **Why:** Python Imaging Library fork; the standard for basic image operations.
- **Usage:** Image open/convert/resize/rotate/save, EXIF orientation correction, image enhancement (brightness, contrast, sharpness), base64 encoding for AI API calls.

### OpenCV (opencv-python-headless 4.10)
- **Why:** Computer vision library for advanced image analysis.
- **Usage:** Grayscale conversion, Canny edge detection, Hough line detection (deskew, now removed), contour detection for smart cropping.

### rembg 2.0
- **Why:** Background removal using the U²Net deep learning model.
- **Usage:** Step 1 of image processing pipeline — but **disabled by default** (`REMOVE_BG=false`). When enabled, removes garment background and composites onto white.

### ONNX Runtime 1.19
- **Why:** Required by rembg for running the U²Net model.

## PPT Generation

### python-pptx 1.0
- **Why:** The standard Python library for creating and modifying PowerPoint files.
- **Usage:** Full catalog generation in `backend/pipeline/ppt_generator.py` — creates slides with custom backgrounds, text boxes, image placements, and formatting.

## Infrastructure Dependencies

### Docker Compose
- **Services:** Redis 7-Alpine, backend (Python), celery_worker (Python), frontend (Node.js 20)
- **Networking:** All services connected via Docker network; backend accessible on port 8000, frontend on port 3000
- **Volumes:** `redis_data` for Redis persistence; bind mounts for `./input`, `./output`, `./backend`, `./frontend` for live code reloading

### Docker (Backend Dockerfile)
- **Base image:** `python:3.11-slim`
- **System dependencies:** OpenCV system libraries (`libgl1-mesa-glx`, `libglib2.0-0`, etc.)
- **Model pre-caching:** Downloads rembg U²Net model at build time to avoid first-run stall
