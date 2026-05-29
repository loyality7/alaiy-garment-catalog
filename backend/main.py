"""
FastAPI application — REST + WebSocket endpoints for the garment catalog system.
Endpoints:
  POST /upload        → accepts multiple images, creates jobs, pushes to Celery
  GET  /jobs          → returns all job states
  GET  /groups        → returns all style groups
  POST /group         → trigger grouping of all classified images
  POST /generate      → trigger catalog PPT generation
  GET  /download      → download the final Catalog.pptx
  GET  /image/{path}  → serve processed images
  WS   /ws            → real-time job state broadcast
"""

import os
import json
import asyncio
import logging
import time
import uuid
from pathlib import Path
import sys

# Ensure project root is in python path so 'backend.xyz' absolute imports work
# no matter which directory uvicorn is started from.
sys.path.insert(0, str(Path(__file__).parent.parent.absolute()))
from typing import List, Dict
from contextlib import asynccontextmanager

from fastapi import FastAPI, UploadFile, File, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from dotenv import load_dotenv
import redis.asyncio as aioredis

load_dotenv()

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379/0")
PROJECT_ROOT = Path(__file__).parent.parent.absolute()
INPUT_DIR = str(PROJECT_ROOT / os.getenv("INPUT_DIR", "input/images").lstrip("./\\"))
OUTPUT_DIR = str(PROJECT_ROOT / os.getenv("OUTPUT_DIR", "output").lstrip("./\\"))

# ── WebSocket connection manager ──
class ConnectionManager:
    """Manages active WebSocket connections and broadcasts."""

    def __init__(self):
        self.active_connections: List[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)
        logger.info(f"WebSocket connected. Total: {len(self.active_connections)}")

    def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)
        logger.info(f"WebSocket disconnected. Total: {len(self.active_connections)}")

    async def broadcast(self, message: dict):
        """Send message to all connected clients."""
        disconnected = []
        for connection in self.active_connections:
            try:
                await connection.send_json(message)
            except Exception:
                disconnected.append(connection)
        for conn in disconnected:
            self.disconnect(conn)


manager = ConnectionManager()

# ── Redis pub/sub listener (receives events from Celery workers) ──
async def redis_listener():
    """Subscribe to Redis pub/sub channel and broadcast to WebSocket clients."""
    try:
        r = aioredis.from_url(REDIS_URL, decode_responses=True)
        pubsub = r.pubsub()
        await pubsub.subscribe("ws_events")
        logger.info("Redis pub/sub listener started")

        async for message in pubsub.listen():
            if message["type"] == "message":
                try:
                    data = json.loads(message["data"])
                    await manager.broadcast(data)
                except json.JSONDecodeError:
                    pass
    except asyncio.CancelledError:
        logger.info("Redis listener cancelled")
    except Exception as e:
        logger.error(f"Redis listener error: {e}")


# ── Lifespan ──
@asynccontextmanager
async def lifespan(app: FastAPI):
    """Start background Redis listener on startup."""
    task = asyncio.create_task(redis_listener())
    logger.info("Garment Catalog API started")
    yield
    task.cancel()
    try:
        await task
    except asyncio.CancelledError:
        pass
    logger.info("Garment Catalog API shutdown")


# ── FastAPI App ──
app = FastAPI(
    title="Alaiy Garment Catalog API",
    description="Automated garment catalog builder with real-time pipeline visibility",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Sync Redis helper for endpoints ──
import redis as sync_redis

def get_sync_redis() -> sync_redis.Redis:
    return sync_redis.Redis.from_url(REDIS_URL, decode_responses=True)


# ── REST Endpoints ──

@app.post("/upload")
async def upload_images(files: List[UploadFile] = File(...)):
    """
    Upload one or more garment images.
    Creates a job per image and pushes each to the Celery processing queue.
    """
    from backend.jobs.tasks import process_image

    r = get_sync_redis()
    created_jobs = []

    for file in files:
        # Validate file type
        if not file.content_type or not file.content_type.startswith("image/"):
            continue

        # Read file
        content = await file.read()
        filename = file.filename or f"image_{uuid.uuid4().hex[:8]}.jpg"

        # Save to input directory
        import hashlib
        input_dir = Path(INPUT_DIR)
        input_dir.mkdir(parents=True, exist_ok=True)

        save_path = input_dir / filename
        content_hash = hashlib.md5(content).hexdigest()
        file_reused = False

        if save_path.exists():
            with open(save_path, "rb") as f:
                existing_hash = hashlib.md5(f.read()).hexdigest()
            if existing_hash == content_hash:
                file_reused = True
            else:
                name, ext = os.path.splitext(filename)
                counter = 1
                while save_path.exists():
                    test_path = input_dir / f"{name}_{counter}{ext}"
                    if test_path.exists():
                        with open(test_path, "rb") as f:
                            if hashlib.md5(f.read()).hexdigest() == content_hash:
                                save_path = test_path
                                file_reused = True
                                break
                    else:
                        save_path = test_path
                        break
                    counter += 1

        if not file_reused:
            with open(save_path, "wb") as f:
                f.write(content)

        # Create job
        job_id = str(uuid.uuid4())
        job = {
            "id": job_id,
            "filename": save_path.name,
            "original_path": str(save_path),
            "status": "uploaded",
            "image_type": "UNKNOWN",
            "classification": None,
            "style_group": None,
            "spec_data": None,
            "processed_path": None,
            "error": None,
            "created_at": time.time(),
            "updated_at": time.time(),
        }

        # Store in Redis
        r.hset("jobs", job_id, json.dumps(job))
        created_jobs.append(job)

        # Emit upload event
        event = {
            "event": "job_update",
            "job_id": job_id,
            "data": job,
            "timestamp": time.time(),
        }
        r.publish("ws_events", json.dumps(event))

        # Push to Celery queue
        process_image.delay(job_id, str(save_path))

        logger.info(f"Uploaded and queued: {filename} → job {job_id}")

    return JSONResponse({
        "message": f"Uploaded {len(created_jobs)} images",
        "jobs": created_jobs,
    })


@app.post("/scan")
async def scan_input_folder():
    """
    Scan the input directory for images that don't have associated jobs in Redis,
    create jobs for them, and trigger the Celery tasks.
    """
    from backend.jobs.tasks import process_image

    input_dir = Path(INPUT_DIR)
    if not input_dir.exists():
        input_dir.mkdir(parents=True, exist_ok=True)
        return {"message": "Input directory was empty and has been created", "jobs": []}

    r = get_sync_redis()
    
    # Get existing jobs to avoid duplication
    all_data = r.hgetall("jobs")
    existing_paths = set()
    for raw in all_data.values():
        job = json.loads(raw)
        if job.get("original_path"):
            existing_paths.add(str(Path(job["original_path"]).resolve()))

    created_jobs = []
    
    # Supported image extensions
    valid_exts = {".jpg", ".jpeg", ".png", ".webp"}
    
    for file_path in input_dir.iterdir():
        if file_path.is_file() and file_path.suffix.lower() in valid_exts:
            resolved_path = str(file_path.resolve())
            if resolved_path not in existing_paths:
                # Create job
                job_id = str(uuid.uuid4())
                job = {
                    "id": job_id,
                    "filename": file_path.name,
                    "original_path": str(file_path),
                    "status": "uploaded",
                    "image_type": "UNKNOWN",
                    "classification": None,
                    "style_group": None,
                    "spec_data": None,
                    "processed_path": None,
                    "error": None,
                    "created_at": time.time(),
                    "updated_at": time.time(),
                }
                
                r.hset("jobs", job_id, json.dumps(job))
                
                # Push to Celery
                process_image.delay(job_id, str(file_path))
                
                # Publish individual websocket event so UI updates instantly
                event = {
                    "event": "job_update",
                    "job_id": job_id,
                    "data": job,
                    "timestamp": time.time(),
                }
                r.publish("ws_events", json.dumps(event))
                
                created_jobs.append(job)
                logger.info(f"Scanned and queued local image: {file_path.name} → job {job_id}")

    return {
        "message": f"Scanned folder and queued {len(created_jobs)} new images",
        "jobs": created_jobs
    }


@app.get("/jobs")
async def get_all_jobs():
    """Return all job states."""
    r = get_sync_redis()
    all_data = r.hgetall("jobs")
    jobs = {k: json.loads(v) for k, v in all_data.items()}
    return {"jobs": jobs}


@app.get("/groups")
async def get_style_groups():
    """Return all style groups."""
    r = get_sync_redis()
    data = r.get("style_groups")
    groups = json.loads(data) if data else {}
    return {"groups": groups}


@app.get("/stats")
async def get_pipeline_stats():
    """Return pipeline statistics — counts per stage."""
    r = get_sync_redis()
    all_data = r.hgetall("jobs")

    stats = {
        "total": 0,
        "uploaded": 0,
        "classifying": 0,
        "classified": 0,
        "processing": 0,
        "cleaned": 0,
        "assigned": 0,
        "ppt_ready": 0,
        "failed": 0,
    }

    for raw in all_data.values():
        job = json.loads(raw)
        stats["total"] += 1
        status = job.get("status", "uploaded")
        if status in stats:
            stats[status] += 1

    # Count style groups
    groups_data = r.get("style_groups")
    groups = json.loads(groups_data) if groups_data else {}
    stats["style_groups"] = len(groups)

    return stats


@app.post("/group")
async def trigger_grouping():
    """Trigger the grouping phase (cluster images into style groups)."""
    from backend.jobs.tasks import run_grouping
    task = run_grouping.delay()
    return {"message": "Grouping started", "task_id": task.id}


@app.post("/generate")
async def trigger_catalog_generation():
    """Trigger PowerPoint catalog generation."""
    from backend.jobs.tasks import generate_catalog
    task = generate_catalog.delay()
    return {"message": "Catalog generation started", "task_id": task.id}


@app.get("/download")
async def download_catalog():
    """Download the generated Catalog.pptx."""
    catalog_path = Path(OUTPUT_DIR) / "Catalog.pptx"
    if not catalog_path.exists():
        raise HTTPException(status_code=404, detail="Catalog not yet generated")
    return FileResponse(
        path=str(catalog_path),
        filename="Catalog.pptx",
        media_type="application/vnd.openxmlformats-officedocument.presentationml.presentation",
    )


@app.get("/image/{filepath:path}")
async def serve_image(filepath: str):
    """Serve a processed image by its relative path."""
    # Try output directory first
    full_path = Path(OUTPUT_DIR) / filepath
    if not full_path.exists():
        # Try input directory
        full_path = Path(INPUT_DIR) / filepath
    if not full_path.exists():
        # Try absolute path
        full_path = Path(filepath)
    if not full_path.exists():
        raise HTTPException(status_code=404, detail="Image not found")

    return FileResponse(str(full_path))


@app.get("/thumbnail/{job_id}")
async def get_thumbnail(job_id: str):
    """Get a thumbnail for a specific job's image."""
    r = get_sync_redis()
    raw = r.hget("jobs", job_id)
    if not raw:
        raise HTTPException(status_code=404, detail="Job not found")

    job = json.loads(raw)

    # Prefer processed image, fall back to original
    image_path_raw = job.get("processed_path") or job.get("original_path")
    if not image_path_raw:
        raise HTTPException(status_code=404, detail="Image path not in job")

    image_path = Path(image_path_raw)
    if not image_path.is_absolute():
        image_path = PROJECT_ROOT / image_path

    if not image_path.exists():
        raise HTTPException(status_code=404, detail="Image file not found on disk")

    return FileResponse(str(image_path))


@app.post("/reset")
async def reset_pipeline():
    """Reset all jobs and style groups (for development/testing)."""
    r = get_sync_redis()
    r.delete("jobs")
    r.delete("style_groups")

    event = {"event": "pipeline_reset", "data": {}, "timestamp": time.time()}
    r.publish("ws_events", json.dumps(event))

    return {"message": "Pipeline reset"}


@app.delete("/job/{job_id}")
async def delete_job(job_id: str):
    """Delete a single job and remove it from any style group."""
    r = get_sync_redis()

    raw = r.hget("jobs", job_id)
    if not raw:
        raise HTTPException(status_code=404, detail="Job not found")

    job = json.loads(raw)

    # Remove from style groups
    groups_raw = r.get("style_groups")
    if groups_raw:
        groups = json.loads(groups_raw)
        for gid, group in groups.items():
            if job_id in group.get("image_ids", []):
                group["image_ids"].remove(job_id)
            for slot in ["front_image_id", "back_image_id", "detail_image_id", "spec_label_id"]:
                if group.get(slot) == job_id:
                    group[slot] = None
        r.set("style_groups", json.dumps(groups))

    # Delete from Redis
    r.hdel("jobs", job_id)

    # Delete files from disk
    for path_key in ["original_path", "processed_path"]:
        fpath = job.get(path_key)
        if fpath and Path(fpath).exists():
            Path(fpath).unlink()

    event = {"event": "job_deleted", "job_id": job_id, "data": {}, "timestamp": time.time()}
    r.publish("ws_events", json.dumps(event))

    return {"message": f"Job {job_id} deleted"}


@app.patch("/job/{job_id}/classify")
async def override_classification(job_id: str, image_type: str, dominant_color: str = None, garment_type: str = None, pattern: str = None):
    """Manually override the classification of a job."""
    r = get_sync_redis()

    raw = r.hget("jobs", job_id)
    if not raw:
        raise HTTPException(status_code=404, detail="Job not found")

    job = json.loads(raw)

    valid_types = {"FRONT", "BACK", "DETAIL", "SPEC_LABEL", "UNKNOWN"}
    if image_type not in valid_types:
        raise HTTPException(status_code=400, detail=f"Invalid image_type. Must be one of: {valid_types}")

    job["image_type"] = image_type

    if not job.get("classification"):
        job["classification"] = {}

    job["classification"]["image_type"] = image_type
    if dominant_color is not None:
        job["classification"]["dominant_color"] = dominant_color
    if garment_type is not None:
        job["classification"]["garment_type"] = garment_type
    if pattern is not None:
        job["classification"]["pattern"] = pattern

    job["updated_at"] = time.time()
    r.hset("jobs", job_id, json.dumps(job))

    event = {"event": "job_update", "job_id": job_id, "data": job, "timestamp": time.time()}
    r.publish("ws_events", json.dumps(event))

    return {"message": f"Classification overridden for job {job_id}", "job": job}


@app.post("/move-image")
async def move_image_to_group(job_id: str, target_group_id: str):
    """Manually move an image to a different style group (drag-drop support)."""
    r = get_sync_redis()

    # Get job
    raw = r.hget("jobs", job_id)
    if not raw:
        raise HTTPException(status_code=404, detail="Job not found")
    job = json.loads(raw)

    # Get groups
    groups_raw = r.get("style_groups")
    if not groups_raw:
        raise HTTPException(status_code=404, detail="No style groups")
    groups = json.loads(groups_raw)

    if target_group_id not in groups:
        raise HTTPException(status_code=404, detail="Target group not found")

    # Remove from old group
    old_group_id = job.get("style_group")
    if old_group_id and old_group_id in groups:
        old_group = groups[old_group_id]
        if job_id in old_group["image_ids"]:
            old_group["image_ids"].remove(job_id)
            # Clear slot references
            for slot in ["front_image_id", "back_image_id", "detail_image_id", "spec_label_id"]:
                if old_group.get(slot) == job_id:
                    old_group[slot] = None

    # Add to new group
    target_group = groups[target_group_id]
    if job_id not in target_group["image_ids"]:
        target_group["image_ids"].append(job_id)

    # Auto-assign to correct slot based on image type
    img_type = job.get("image_type", "UNKNOWN")
    slot_map = {
        "FRONT": "front_image_id",
        "BACK": "back_image_id",
        "DETAIL": "detail_image_id",
        "SPEC_LABEL": "spec_label_id",
    }
    slot = slot_map.get(img_type)
    if slot and not target_group.get(slot):
        target_group[slot] = job_id

    # Update job
    job["style_group"] = target_group_id
    r.hset("jobs", job_id, json.dumps(job))
    r.set("style_groups", json.dumps(groups))

    # Broadcast update
    event = {
        "event": "image_moved",
        "job_id": job_id,
        "data": {"from_group": old_group_id, "to_group": target_group_id, "job": job},
        "timestamp": time.time(),
    }
    r.publish("ws_events", json.dumps(event))

    return {"message": "Image moved", "job": job}


# ── WebSocket Endpoint ──

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    """
    WebSocket for real-time pipeline updates.
    On connect: sends current state snapshot.
    Ongoing: receives broadcasts from Redis pub/sub.
    """
    await manager.connect(websocket)

    try:
        # Send initial state snapshot
        r = get_sync_redis()
        all_jobs = r.hgetall("jobs")
        jobs = {k: json.loads(v) for k, v in all_jobs.items()}

        groups_raw = r.get("style_groups")
        groups = json.loads(groups_raw) if groups_raw else {}

        await websocket.send_json({
            "event": "initial_state",
            "data": {"jobs": jobs, "groups": groups},
            "timestamp": time.time(),
        })

        # Keep connection alive — listen for client messages
        while True:
            data = await websocket.receive_text()
            # Client can send ping or manual actions
            if data == "ping":
                await websocket.send_json({"event": "pong"})

    except WebSocketDisconnect:
        manager.disconnect(websocket)
    except Exception as e:
        logger.error(f"WebSocket error: {e}")
        manager.disconnect(websocket)
