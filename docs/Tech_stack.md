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

## Frontend — Detailed

| Dependency | Role | Where Used |
|-----------|------|------------|
| Next.js 16 | SSR, file routing, API rewrites | `next.config.ts` proxies `/api/*` → backend |
| React 19 | Component rendering | All `.jsx` files |
| TailwindCSS 4 | Styling | `globals.css` + inline classes |
| TypeScript 5 | Language | `tsconfig.json` config (JSX files used despite config) |
| Geist Fonts | Typography | `layout.tsx` via next/font/google |
| LineIcons | SVG icons | Toolbar + action buttons |

## Backend — Detailed

| Library | Role | Where Used |
|---------|------|------------|
| FastAPI 0.115 | REST + WebSocket server | `main.py` — 14 endpoints + WS |
| Uvicorn | ASGI runner | Starts FastAPI, used in Docker + CLI |
| python-multipart | File upload parsing | Required by FastAPI for form data |
| Pydantic 2.9 | Data validation | `schemas.py` — all models |
| Celery 5.4 | Async job queue | `tasks.py` — 3 task types |
| Redis 5.1 | State + broker + pub/sub | Jobs (hash), groups (string), ws_events (pub/sub) |
| httpx 0.27 | Async HTTP client | `ai_client.py` — calls Gemini/OpenRouter APIs |
| python-dotenv | Env file loader | `main.py`, `file_utils.py` |
| aiofiles | Async file I/O | Listed in requirements, not used in code |

## Image Processing — Detailed

| Library | Role | Where Used |
|---------|------|------------|
| Pillow 10.4 | Open, EXIF transpose, resize, enhance, save | `image_processor.py`, `classifier.py`, `ocr.py`, `grouper.py` |
| OpenCV 4.10 | Grayscale, edge detection, contours | `image_processor.py` — smart crop |
| rembg 2.0 | Background removal (U²Net) | `image_processor.py` — disabled by default |
| ONNX Runtime 1.19 | Model runtime for rembg | Required dependency |

## AI Integration — Detailed

| Integration | Module | Prompt | Provider |
|-------------|--------|--------|----------|
| Image classification | `classifier.py` | Detailed 80-line prompt with type rules | Gemini 2.5 Flash → OpenRouter |
| Spec label OCR | `ocr.py` | Structured extraction prompt | Gemini 2.5 Flash → OpenRouter |
| Solo group confirmation | `grouper.py` (Pass 3) | "Which images show the SAME garment?" | Gemini 2.5 Flash → OpenRouter |
| Suspicious group check | `grouper.py` (Pass 4) | "Do ALL show the same physical garment?" | Gemini 2.5 Flash → OpenRouter |

All routing via `ai_client.py` — tries Gemini, falls back to OpenRouter.

## Infrastructure — Detailed

| Component | Image | Config | Purpose |
|-----------|-------|--------|---------|
| Redis | `redis:7-alpine` | Healthcheck: redis-cli ping | State store + broker |
| Backend | Custom (`python:3.11-slim`) | `Dockerfile` with system deps for OpenCV | FastAPI server |
| Celery worker | Same backend image | `celery -A backend.jobs.tasks worker` | Async processing |
| Frontend | `node:20-alpine` | `npm run dev` | Next.js dev server |

**Docker Compose** volumes:
- `./input:/app/input` — shared image storage
- `./output:/app/output` — shared output storage
- `./backend:/app/backend` — live reload for API changes
- `./frontend:/app` + `/app/node_modules` — live reload for UI changes
