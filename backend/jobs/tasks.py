"""
Celery tasks for the garment catalog pipeline.
Each image goes through: classify → process → (OCR if spec) → group → PPT.
State changes are emitted via WebSocket after every step.
"""

import os
import json
import asyncio
import logging
import time
from typing import Dict, Optional

from celery import Celery
from dotenv import load_dotenv

load_dotenv()

logger = logging.getLogger(__name__)

# ── Celery app ──
REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379/0")
celery_app = Celery("garment_catalog", broker=REDIS_URL, backend=REDIS_URL)

celery_app.conf.update(
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    timezone="UTC",
    enable_utc=True,
    task_track_started=True,
    worker_prefetch_multiplier=1,
)

# ── In-memory job store (shared via Redis in production) ──
# We use Redis keys directly so both worker and API server share state.
import redis

_redis_client = None


def get_redis() -> redis.Redis:
    """Get Redis client singleton."""
    global _redis_client
    if _redis_client is None:
        _redis_client = redis.Redis.from_url(REDIS_URL, decode_responses=True)
    return _redis_client


def _store_job(job_dict: dict) -> None:
    """Store a job in Redis."""
    r = get_redis()
    r.hset("jobs", job_dict["id"], json.dumps(job_dict))


def _get_job(job_id: str) -> Optional[dict]:
    """Get a job from Redis."""
    r = get_redis()
    data = r.hget("jobs", job_id)
    if data:
        return json.loads(data)
    return None


def _get_all_jobs() -> Dict[str, dict]:
    """Get all jobs from Redis."""
    r = get_redis()
    all_data = r.hgetall("jobs")
    return {k: json.loads(v) for k, v in all_data.items()}


def _store_style_groups(groups: dict) -> None:
    """Store style groups in Redis."""
    r = get_redis()
    r.set("style_groups", json.dumps(groups))


def _get_style_groups() -> dict:
    """Get style groups from Redis."""
    r = get_redis()
    data = r.get("style_groups")
    if data:
        return json.loads(data)
    return {}


def _emit_ws_event(event: str, job_id: str = None, data: dict = None) -> None:
    """
    Publish a WebSocket event via Redis pub/sub.
    The FastAPI server subscribes to this channel and broadcasts to clients.
    """
    r = get_redis()
    message = {
        "event": event,
        "job_id": job_id,
        "data": data or {},
        "timestamp": time.time()
    }
    r.publish("ws_events", json.dumps(message))


def _update_job_status(job_id: str, status: str, extra: dict = None) -> dict:
    """Update job status and emit WebSocket event."""
    job = _get_job(job_id)
    if not job:
        logger.error(f"Job {job_id} not found")
        return {}

    job["status"] = status
    job["updated_at"] = time.time()

    if extra:
        job.update(extra)

    _store_job(job)
    _emit_ws_event("job_update", job_id, job)
    return job


def _run_async(coro):
    """Run an async function from a sync Celery task."""
    try:
        loop = asyncio.get_event_loop()
        if loop.is_running():
            import concurrent.futures
            with concurrent.futures.ThreadPoolExecutor() as pool:
                future = pool.submit(asyncio.run, coro)
                return future.result()
        else:
            return loop.run_until_complete(coro)
    except RuntimeError:
        return asyncio.run(coro)


@celery_app.task(bind=True, max_retries=2, default_retry_delay=10)
def process_image(self, job_id: str, image_path: str):
    """
    Main image processing task.
    Pipeline: classify → process → (OCR if spec label) → update state.
    """
    print(f"\n{'='*50}\n[PIPELINE START] Job {job_id} | Image: {image_path}\n{'='*50}")
    try:
        logger.info(f"Starting pipeline for job {job_id}: {image_path}")

        # ── Step 1: Classification ──
        print(f"[{job_id}] Stage 1: Classifying image...")
        _update_job_status(job_id, "classifying")

        from backend.pipeline.classifier import classify_image
        classification = _run_async(classify_image(image_path))

        classification_dict = {
            "image_type": classification.image_type.value,
            "confidence": classification.confidence,
            "dominant_color": classification.dominant_color,
            "garment_type": classification.garment_type,
            "pattern": classification.pattern,
            "style_name": classification.style_name,
        }

        _update_job_status(job_id, "classified", {
            "image_type": classification.image_type.value,
            "classification": classification_dict,
        })

        logger.info(f"Job {job_id} classified as {classification.image_type.value} "
                     f"(confidence: {classification.confidence:.2f})")

        # ── Step 2: Image Processing ──
        _update_job_status(job_id, "processing")

        from backend.pipeline.image_processor import process_image as proc_img
        from backend.utils.file_utils import save_processed_image

        processed_bytes = proc_img(image_path, classification.image_type)

        # Generate processed filename
        job = _get_job(job_id)
        original_name = job.get("filename", "image")
        name_base = os.path.splitext(original_name)[0]
        processed_filename = f"{name_base}_processed.jpg"
        processed_path = save_processed_image(processed_bytes, processed_filename)

        _update_job_status(job_id, "cleaned", {
            "processed_path": processed_path,
        })

        logger.info(f"Job {job_id} processed and saved to {processed_path}")

        # ── Step 3: OCR (only for spec labels) ──
        if classification.image_type.value == "SPEC_LABEL":
            from backend.pipeline.ocr import extract_spec_data
            spec_data = _run_async(extract_spec_data(image_path))

            spec_dict = {
                "ref_number": spec_data.ref_number,
                "fabric_composition": spec_data.fabric_composition,
                "gsm": spec_data.gsm,
                "date": spec_data.date,
                "remarks": spec_data.remarks,
            }

            _update_job_status(job_id, "cleaned", {
                "spec_data": spec_dict,
            })

            logger.info(f"Job {job_id} OCR complete: {spec_dict}")

        # Mark as ready for assignment
        _update_job_status(job_id, "cleaned")

        logger.info(f"Pipeline complete for job {job_id}")

        # Auto-trigger grouping if ALL jobs are now done (cleaned or failed)
        all_jobs = _get_all_jobs()
        pending_statuses = {"uploaded", "classifying", "classified", "processing"}
        still_pending = any(
            j.get("status") in pending_statuses for j in all_jobs.values()
        )
        if not still_pending and len(all_jobs) > 1:
            # Check if grouping hasn't already been done
            existing_groups = _get_style_groups()
            if not existing_groups:
                logger.info("All images processed — auto-triggering grouping...")
                run_grouping.delay()

        return {"job_id": job_id, "status": "cleaned"}

    except Exception as e:
        logger.error(f"Pipeline failed for job {job_id}: {e}", exc_info=True)
        _update_job_status(job_id, "failed", {"error": str(e)})
        raise self.retry(exc=e)


@celery_app.task(bind=True)
def run_grouping(self):
    """
    Group all cleaned images into style groups.
    Called after all individual image processing is done.
    """
    try:
        logger.info("Starting grouping phase...")
        _emit_ws_event("grouping_started")

        from backend.models.schemas import ImageJob, ClassificationResult, SpecData
        from backend.pipeline.grouper import group_images

        # Load all jobs from Redis
        all_jobs_raw = _get_all_jobs()

        # Convert to ImageJob objects
        jobs = {}
        for jid, jdata in all_jobs_raw.items():
            job = ImageJob(
                id=jdata["id"],
                filename=jdata.get("filename", ""),
                original_path=jdata.get("original_path", ""),
                status=jdata.get("status", "uploaded"),
                image_type=jdata.get("image_type", "UNKNOWN"),
                processed_path=jdata.get("processed_path"),
            )

            if jdata.get("classification"):
                c = jdata["classification"]
                job.classification = ClassificationResult(
                    image_type=c.get("image_type", "UNKNOWN"),
                    confidence=c.get("confidence", 0),
                    dominant_color=c.get("dominant_color", ""),
                    garment_type=c.get("garment_type", ""),
                    pattern=c.get("pattern", ""),
                    style_name=c.get("style_name", ""),
                )

            if jdata.get("spec_data"):
                s = jdata["spec_data"]
                job.spec_data = SpecData(**s)

            jobs[jid] = job

        # Run grouping
        style_groups = _run_async(group_images(jobs, emit_event=_emit_ws_event))

        # Update job assignments
        for jid, job in jobs.items():
            if job.style_group:
                _update_job_status(jid, "assigned", {
                    "style_group": job.style_group
                })

        # Store style groups
        groups_dict = {}
        for gid, group in style_groups.items():
            groups_dict[gid] = {
                "id": group.id,
                "name": group.name,
                "style_number": group.style_number,
                "dominant_color": group.dominant_color,
                "garment_type": group.garment_type,
                "pattern": group.pattern,
                "image_ids": group.image_ids,
                "front_image_id": group.front_image_id,
                "back_image_id": group.back_image_id,
                "detail_image_id": group.detail_image_id,
                "spec_label_id": group.spec_label_id,
                "spec_data": group.spec_data.model_dump() if group.spec_data else None,
            }

        _store_style_groups(groups_dict)
        _emit_ws_event("grouping_complete", data={"groups": groups_dict})

        logger.info(f"Grouping complete: {len(style_groups)} groups")
        return {"groups": len(style_groups)}

    except Exception as e:
        logger.error(f"Grouping failed: {e}", exc_info=True)
        _emit_ws_event("grouping_failed", data={"error": str(e)})
        raise


@celery_app.task(bind=True)
def generate_catalog(self, group_ids: list = None):
    """
    Generate the final PowerPoint catalog from style groups.
    Called after grouping is complete.
    """
    try:
        logger.info("Starting catalog generation...")
        _emit_ws_event("catalog_started")

        from backend.models.schemas import ImageJob, StyleGroup, SpecData, ClassificationResult
        from backend.pipeline.ppt_generator import generate_catalog as gen_ppt

        # Load jobs and groups
        all_jobs_raw = _get_all_jobs()
        groups_raw = _get_style_groups()
        
        if group_ids is not None:
            groups_raw = {k: v for k, v in groups_raw.items() if k in group_ids}

        # Convert to model objects
        jobs = {}
        for jid, jdata in all_jobs_raw.items():
            job = ImageJob(
                id=jdata["id"],
                filename=jdata.get("filename", ""),
                original_path=jdata.get("original_path", ""),
                status=jdata.get("status", "uploaded"),
                image_type=jdata.get("image_type", "UNKNOWN"),
                processed_path=jdata.get("processed_path"),
                style_group=jdata.get("style_group"),
            )
            if jdata.get("spec_data"):
                job.spec_data = SpecData(**jdata["spec_data"])
            jobs[jid] = job

        style_groups = {}
        for gid, gdata in groups_raw.items():
            group = StyleGroup(
                id=gdata["id"],
                name=gdata.get("name", ""),
                style_number=gdata.get("style_number", 0),
                dominant_color=gdata.get("dominant_color", ""),
                garment_type=gdata.get("garment_type", ""),
                pattern=gdata.get("pattern", ""),
                image_ids=gdata.get("image_ids", []),
                front_image_id=gdata.get("front_image_id"),
                back_image_id=gdata.get("back_image_id"),
                detail_image_id=gdata.get("detail_image_id"),
                spec_label_id=gdata.get("spec_label_id"),
            )
            if gdata.get("spec_data"):
                group.spec_data = SpecData(**gdata["spec_data"])
            style_groups[gid] = group

        # Generate PPT
        output_path = gen_ppt(style_groups, jobs)

        # Organize output files into Processed_Garments/ with proper naming
        from backend.utils.file_utils import organize_output_files
        organize_output_files(groups_raw, all_jobs_raw)
        logger.info("Organized output files into Processed_Garments/")

        # Update all jobs to ppt_ready
        for jid in all_jobs_raw:
            _update_job_status(jid, "ppt_ready")

        _emit_ws_event("catalog_complete", data={"path": output_path})
        logger.info(f"Catalog generated at {output_path}")

        return {"path": output_path}

    except Exception as e:
        logger.error(f"Catalog generation failed: {e}", exc_info=True)
        _emit_ws_event("catalog_failed", data={"error": str(e)})
        raise
