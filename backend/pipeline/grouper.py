"""
Groups classified images into style groups.
Images with matching (color + garment_type + pattern) belong to the same style.
Uses fuzzy matching to handle slight variations in AI output.
"""

import os
import re
import io
import base64
import logging
from typing import Dict, List, Optional
from difflib import SequenceMatcher
from PIL import Image

from backend.models.schemas import (
    ImageJob, StyleGroup, ImageType
)
from backend.utils.ai_client import call_vision_model, parse_json_response

logger = logging.getLogger(__name__)

# Minimum confidence threshold for auto-grouping
MIN_CONFIDENCE = 0.7
BATCH_GAP_THRESHOLD = int(os.getenv("BATCH_GAP_THRESHOLD", "120"))

def _normalize(text: str) -> str:
    """Normalize text for comparison."""
    return text.lower().strip().replace("-", " ").replace("_", " ")


def _similarity(a: str, b: str) -> float:
    """Calculate string similarity ratio between 0 and 1."""
    if not a or not b:
        return 0.0
    return SequenceMatcher(None, _normalize(a), _normalize(b)).ratio()


def _color_match(color_a: str, color_b: str) -> bool:
    """Check if two color descriptions match dynamically without hardcoded lists."""
    na, nb = _normalize(color_a), _normalize(color_b)
    if not na or not nb:
        return False

    # Standard fuzzy similarity
    if _similarity(na, nb) > 0.7:
        return True

    # Word-overlap matching (e.g. "dark olive green" vs "olive green")
    words_a = set(na.split())
    words_b = set(nb.split())

    # Filter out common tone modifiers
    modifiers = {"light", "dark", "deep", "pale", "bright", "soft", "medium", "matte", "shiny"}
    base_words_a = words_a - modifiers
    base_words_b = words_b - modifiers

    # Match if they share any core color base terms
    if base_words_a.intersection(base_words_b):
        return True

    return False


def _garment_match(type_a: str, type_b: str) -> bool:
    """Check if two garment type descriptions match dynamically."""
    na, nb = _normalize(type_a), _normalize(type_b)
    if not na or not nb:
        return False

    # Standard fuzzy similarity
    if _similarity(na, nb) > 0.6:
        return True

    words_a = set(na.split())
    words_b = set(nb.split())

    # Strip generic suffixes to compare core root words
    generic_terms = {"shirt", "tshirt", "tee", "garment", "wear", "top", "bottom"}
    base_words_a = words_a - generic_terms
    base_words_b = words_b - generic_terms

    # Match if they share a specific root (e.g. "polo" in "polo shirt" vs "polo tee")
    if base_words_a.intersection(base_words_b):
        return True

    # Match if one is a subphrase of the other (e.g. "polo" vs "polo shirt")
    if na in nb or nb in na:
        return True

    return False


def _pattern_match(pat_a: str, pat_b: str) -> bool:
    """Check if two pattern descriptions match."""
    return _similarity(pat_a, pat_b) > 0.5


def _match_score(job_a: ImageJob, job_b: ImageJob) -> float:
    """
    Calculate match score between two jobs based on user priorities.
    """
    if not job_a.classification or not job_b.classification:
        return 0.0

    ca = job_a.classification
    cb = job_b.classification

    score = 0.0

    # PRIORITY 1: Filename proximity — ALWAYS check first
    dist = _filename_distance(job_a.filename, job_b.filename)
    if dist == 0:
        score += 3.0
    elif dist <= 5:
        score += 2.0
    elif dist <= 20:
        score += 1.0
    elif dist <= 50:
        score += 0.3

    # PRIORITY 2: Same type penalty — AFTER filename check
    if job_a.image_type == job_b.image_type and job_a.image_type not in (ImageType.SPEC_LABEL, ImageType.UNKNOWN):
        score -= 1.5  # penalize, NOT instant return

    # PRIORITY 3: Visual traits
    color_matched = _color_match(ca.dominant_color, cb.dominant_color)
    pattern_matched = _pattern_match(ca.pattern, cb.pattern)

    if color_matched and pattern_matched:
        score += 1.5
    elif color_matched:
        score += 0.8

    if _garment_match(ca.garment_type, cb.garment_type):
        score += 0.5

    return score


def _extract_timestamp(filename: str) -> int:
    base = filename.split('.')[0]
    nums = re.findall(r'\d+', base)
    if not nums:
        return 0
    return int(nums[-1])


def _build_image_grid(solo_job: ImageJob, neighbors: list) -> str:
    all_images = [solo_job] + neighbors[:5]  # max 6 images
    thumbs = []
    
    for job in all_images:
        img = Image.open(job.original_path).convert("RGB")
        img.thumbnail((300, 300))
        thumbs.append(img)
    
    # Stitch horizontally
    grid_w = sum(t.width for t in thumbs)
    grid_h = max(t.height for t in thumbs)
    grid = Image.new("RGB", (grid_w, grid_h), (30, 30, 30))
    
    x = 0
    for thumb in thumbs:
        grid.paste(thumb, (x, 0))
        x += thumb.width
    
    buf = io.BytesIO()
    grid.save(buf, format="JPEG", quality=80)
    b64 = base64.b64encode(buf.getvalue()).decode()
    return f"data:image/jpeg;base64,{b64}"


async def _vision_confirm_solos(solo_groups: list, all_jobs: Dict, style_groups: Dict, emit_event=None):
    for group in solo_groups:
        if not group.image_ids:
            continue
        solo_job = all_jobs[group.image_ids[0]]
        
        # Find filename neighbors
        neighbors = [
            j for j in all_jobs.values()
            if j.id != solo_job.id
            and _filename_distance(solo_job.filename, j.filename) < 100
        ]
        
        if not neighbors:
            continue
            
        # Build grid image
        grid_b64 = _build_image_grid(solo_job, neighbors)
        
        # Ask vision model
        prompt = (
            f"Image 1 is ungrouped. Images 2-{len(neighbors)+1} are filename neighbors.\n"
            f"Solo type: {solo_job.image_type}\n"
            f"Solo color: {solo_job.classification.dominant_color if solo_job.classification else 'unknown'}\n\n"
            "Which images show the SAME physical garment as Image 1?\n"
            "Reply JSON only, no markdown:\n"
            '[{"belongs_with": ["filename1", "filename2"]}]'
        )
        
        try:
            response = await call_vision_model(prompt, grid_b64)
            data = parse_json_response(response)
            
            # Handle both list and dict responses
            if isinstance(data, list):
                data = data[0] if data else {}
            
            # Merge solo into matched group
            matched_filenames = data.get("belongs_with", [])
            for filename in matched_filenames:
                matched_job = next(
                    (j for j in all_jobs.values() if j.filename == filename), 
                    None
                )
                if matched_job and matched_job.style_group:
                    # Move solo into this group
                    target_group = style_groups[matched_job.style_group]
                    _add_job_to_group(target_group, solo_job)
                    # Delete old solo group
                    if group.id in style_groups:
                        del style_groups[group.id]
                    logger.info(f"Pass 3: Vision merged solo {solo_job.filename} into group {target_group.name}")
                    
                    if emit_event:
                        emit_event("solo_resolved", data={"job_id": solo_job.id, "merged_into": target_group.id})
                    break
        except Exception as e:
            logger.error(f"Vision confirmation failed for {solo_job.filename}: {e}")


def _is_suspicious(group: StyleGroup, jobs: Dict[str, ImageJob]) -> bool:
    if group.is_heuristic:
        return True
    
    types = [jobs[jid].classification.garment_type 
             for jid in group.image_ids 
             if jid in jobs and jobs[jid].classification]
    
    # Suspicious if garment types wildly different
    if len(set(types)) > 2:
        return True
    
    # Suspicious if duplicate slots
    image_types = [jobs[jid].image_type 
                   for jid in group.image_ids if jid in jobs]
    if image_types.count(ImageType.FRONT) > 1:
        return True
    if image_types.count(ImageType.BACK) > 1:
        return True
        
    return False

ENABLE_CONFIRMATION_PASS = os.getenv("ENABLE_CONFIRMATION_PASS", "true").lower() == "true"

async def _vision_confirm_groups(suspicious_groups: list, solo_groups: list, all_jobs: Dict, style_groups: Dict, emit_event=None):
    confirmed_count = 0
    split_count = 0
    
    solo_filenames = [all_jobs[g.image_ids[0]].filename for g in solo_groups if g.image_ids and g.image_ids[0] in all_jobs]
    
    for group in suspicious_groups:
        if len(group.image_ids) < 2:
            continue
            
        group_jobs = [all_jobs[jid] for jid in group.image_ids if jid in all_jobs]
        grid_b64 = _build_image_grid(group_jobs[0], group_jobs[1:])
        
        prompt = f"""
        These images are claimed to be the same garment.
        Do ALL of them show the same physical garment?
        If any do NOT belong, list their filenames in "remove".
        
        Here are nearby solo images that might belong to this group: {solo_filenames}
        Should any of these be added to this group? List in "add".
        
        Reply JSON only, no markdown: '{{"all_same": true, "remove": [], "add": []}}'
        """
        
        try:
            response = await call_vision_model(prompt, grid_b64)
            data = parse_json_response(response)
            
            # Handle both list and dict responses
            if isinstance(data, list):
                data = data[0] if data else {}
            
            if data.get("remove"):
                for fname in data.get("remove"):
                    bad_job = next((j for j in group_jobs if j.filename == fname), None)
                    if bad_job:
                        # Remove from group
                        if bad_job.id in group.image_ids: group.image_ids.remove(bad_job.id)
                        if group.front_image_id == bad_job.id: group.front_image_id = None
                        if group.back_image_id == bad_job.id: group.back_image_id = None
                        if group.detail_image_id == bad_job.id: group.detail_image_id = None
                        
                        # Create new solo group for it
                        new_group = StyleGroup(name=f"Split from {group.name}", style_number=group.style_number, is_heuristic=True)
                        _add_job_to_group(new_group, bad_job)
                        style_groups[new_group.id] = new_group
                        split_count += 1
                        
            if data.get("add"):
                for fname in data.get("add"):
                    add_job = next((j for j in all_jobs.values() if j.filename == fname), None)
                    if add_job and add_job.style_group:
                        old_group_id = add_job.style_group
                        _add_job_to_group(group, add_job)
                        if old_group_id in style_groups:
                            if add_job.id in style_groups[old_group_id].image_ids:
                                style_groups[old_group_id].image_ids.remove(add_job.id)
                            if len(style_groups[old_group_id].image_ids) == 0:
                                del style_groups[old_group_id]
            confirmed_count += 1
        except Exception as e:
            logger.error(f"Pass 4 Vision confirm failed for group {group.name}: {e}")

    if emit_event:
        emit_event("grouping_pass4_complete", data={"confirmed": confirmed_count, "split": split_count})


async def group_images(jobs: Dict[str, ImageJob], emit_event=None) -> Dict[str, StyleGroup]:
    """
    3-Pass Grouping Algorithm:
    Pass 1: Timestamp-gap grouping (deterministic)
    Pass 2: Heuristic fuzzy matching (for renamed/WhatsApp files)
    Pass 3: Vision confirm (for remaining solos)
    """
    logger.info(f"Grouping {len(jobs)} images...")
    if not jobs:
        return {}

    style_groups: Dict[str, StyleGroup] = {}
    style_counter = 0

    # --- PASS 1: Timestamp Gap ---
    # Only run Pass 1 if we actually detect timestamps
    has_timestamps = any(_extract_timestamp(j.filename) > 0 for j in jobs.values())
    if has_timestamps:
        sorted_jobs = sorted(jobs.values(), key=lambda j: _extract_timestamp(j.filename))
        current_group: Optional[StyleGroup] = None
        last_timestamp = -1

        for job in sorted_jobs:
            # Skip spec labels in Pass 1 so they don't form their own groups
            if job.image_type == ImageType.SPEC_LABEL:
                continue

            ts = _extract_timestamp(job.filename)
            if ts == 0:
                continue  # Skip files without timestamps in Pass 1
                
            is_new_batch = False
            if not current_group:
                is_new_batch = True
            elif last_timestamp > 0 and (ts - last_timestamp) > BATCH_GAP_THRESHOLD:
                is_new_batch = True
                
            if is_new_batch:
                style_counter += 1
                name = job.classification.style_name if job.classification else f"Style {style_counter}"
                current_group = StyleGroup(
                    name=name or f"Style {style_counter}",
                    style_number=style_counter,
                    dominant_color=job.classification.dominant_color if job.classification else None,
                    garment_type=job.classification.garment_type if job.classification else None,
                    pattern=job.classification.pattern if job.classification else None
                )
                style_groups[current_group.id] = current_group

            _add_job_to_group(current_group, job)
            last_timestamp = ts
            
    if emit_event:
        emit_event("grouping_pass1_complete", data={"groups": len(style_groups)})

    # --- PASS 1.5: Reclassify Overloaded Groups ---
    # If a group has 2+ FRONTs, reclassify the lower confidence one.
    from backend.pipeline.classifier import classify_image
    
    for gid, group in list(style_groups.items()):
        front_jobs = [jobs[jid] for jid in group.image_ids if jid in jobs and jobs[jid].image_type == ImageType.FRONT]
        
        if len(front_jobs) >= 2:
            # Sort by confidence ascending (lowest first)
            front_jobs.sort(key=lambda j: j.classification.confidence if j.classification else 0)
            
            needs_split = False
            for bad_front in front_jobs[:-1]:
                highest_conf = front_jobs[-1].classification.confidence if front_jobs[-1].classification else 0
                bad_conf = bad_front.classification.confidence if bad_front.classification else 0
                
                if bad_conf > 0.85 and highest_conf > 0.85:
                    # Both are very confident, they are likely different garments
                    needs_split = True
                    continue
                
                logger.info(f"Pass 1.5: Force reclassifying suspicious FRONT: {bad_front.filename}")
                try:
                    new_class = await classify_image(bad_front.original_path)
                    if new_class.image_type == ImageType.BACK:
                        logger.info(f"Pass 1.5: Successfully reclassified {bad_front.filename} as BACK")
                        bad_front.image_type = ImageType.BACK
                        bad_front.classification = new_class
                        # Update group slots
                        if group.front_image_id == bad_front.id:
                            group.front_image_id = None
                        if not group.back_image_id:
                            group.back_image_id = bad_front.id
                except Exception as e:
                    logger.error(f"Pass 1.5 reclassify failed: {e}")
            
            if needs_split:
                # If they were both > 0.85, split the group
                group_jobs = sorted([jobs[jid] for jid in group.image_ids if jid in jobs], key=lambda j: _extract_timestamp(j.filename))
                group.image_ids = []
                group.front_image_id = None
                group.back_image_id = None
                group.detail_image_id = None
                group.spec_label_id = None
                
                current_split = group
                front_count = 0
                for j in group_jobs:
                    is_front = (j.image_type == ImageType.FRONT)
                    if is_front and front_count >= 1:
                        style_counter += 1
                        current_split = StyleGroup(
                            name=f"Style {style_counter}",
                            style_number=style_counter,
                            dominant_color=group.dominant_color,
                            garment_type=group.garment_type
                        )
                        style_groups[current_split.id] = current_split
                        front_count = 0
                    
                    _add_job_to_group(current_split, j)
                    if is_front: front_count += 1

    # --- PASS 2: Heuristic Fuzzy (Ungrouped Only) ---
    ungrouped_jobs = {jid: j for jid, j in jobs.items() if not j.style_group}
    if ungrouped_jobs:
        heuristic_groups, style_counter = _heuristic_group_images(ungrouped_jobs, jobs, style_counter)
        style_groups.update(heuristic_groups)
        
    # Assign spec labels to nearest group
    spec_jobs = [j for j in jobs.values() if j.image_type == ImageType.SPEC_LABEL and not j.style_group]
    _assign_spec_labels(spec_jobs, style_groups, jobs)
    
    if emit_event:
        emit_event("grouping_pass2_complete", data={"groups": len(style_groups)})

    # --- PASS 3: Vision Confirm Solos ---
    solo_groups = list(g for g in style_groups.values() if len(g.image_ids) == 1)
    if solo_groups:
        logger.info(f"Pass 3: Vision confirming {len(solo_groups)} solo images")
        await _vision_confirm_solos(solo_groups, jobs, style_groups, emit_event)

    # --- PASS 4: Selective Vision Confirm ---
    if ENABLE_CONFIRMATION_PASS:
        # Re-evaluate solos in case Pass 3 left any
        solo_groups = list(g for g in style_groups.values() if len(g.image_ids) == 1)
        suspicious_groups = list(g for g in style_groups.values() if _is_suspicious(g, jobs))
        if suspicious_groups:
            logger.info(f"Pass 4: Vision confirming {len(suspicious_groups)} suspicious groups")
            # Cap at max 10 to save tokens
            await _vision_confirm_groups(suspicious_groups[:10], solo_groups, jobs, style_groups, emit_event)

    return style_groups


def _heuristic_group_images(jobs: Dict[str, ImageJob], all_jobs: Dict[str, ImageJob], style_counter: int) -> tuple[Dict[str, StyleGroup], int]:
    """
    Fallback heuristic-based grouping algorithm.
    """
    logger.info("Running heuristic grouping on ungrouped jobs...")
    style_groups: Dict[str, StyleGroup] = {}
    unassigned: List[ImageJob] = []

    sorted_jobs = sorted(
        jobs.values(),
        key=lambda j: j.classification.confidence if j.classification else 0,
        reverse=True
    )

    for job in sorted_jobs:
        # Lower threshold for detail/spec — they are naturally less confident
        min_conf = 0.5 if job.image_type in (ImageType.DETAIL, ImageType.SPEC_LABEL) else MIN_CONFIDENCE
        
        if not job.classification or job.classification.confidence < min_conf:
            unassigned.append(job)
            continue

        # Skip spec labels for grouping — they'll be assigned later
        if job.image_type == ImageType.SPEC_LABEL:
            continue

        # Try to match to existing group
        best_group_id = None
        best_score = 0.0

        for gid, group in style_groups.items():
            # Compare against all jobs already in this group
            for existing_job_id in group.image_ids:
                if existing_job_id in jobs:
                    score = _match_score(job, jobs[existing_job_id])
                    if score > best_score:
                        best_score = score
                        best_group_id = gid

        # Threshold for grouping
        if best_score >= 1.0 and best_group_id:
            _add_job_to_group(style_groups[best_group_id], job)
        else:
            # Create new style group
            style_counter += 1
            classification = job.classification
            group = StyleGroup(
                name=classification.style_name or f"Style {style_counter}",
                style_number=style_counter,
                dominant_color=classification.dominant_color,
                garment_type=classification.garment_type,
                pattern=classification.pattern,
                is_heuristic=True
            )
            _add_job_to_group(group, job)
            style_groups[group.id] = group

    # Try to assign spec labels to their nearest style group
    spec_jobs = [j for j in jobs.values() if j.image_type == ImageType.SPEC_LABEL]
    _assign_spec_labels(spec_jobs, style_groups, jobs)

    # Try to assign low-confidence images
    for job in unassigned:
        if job.style_group:
            continue
            
        best_group_id = None
        best_score = 0.0

        for gid, group in style_groups.items():
            for existing_job_id in group.image_ids:
                if existing_job_id in jobs:
                    score = _match_score(job, jobs[existing_job_id])
                    if score > best_score:
                        best_score = score
                        best_group_id = gid

        if best_score >= 0.4 and best_group_id:
            _add_job_to_group(style_groups[best_group_id], job)
        else:
            # Create a solo group for unmatched images
            style_counter += 1
            group = StyleGroup(
                name=f"Unassigned Style {style_counter}",
                style_number=style_counter,
                is_heuristic=True
            )
            _add_job_to_group(group, job)
            style_groups[group.id] = group

    logger.info(f"Created {len(style_groups)} style groups")
    return style_groups, style_counter


def _add_job_to_group(group: StyleGroup, job: ImageJob) -> None:
    """Add a job to a style group, assigning to the correct slot."""
    group.image_ids.append(job.id)
    job.style_group = group.id

    if job.image_type == ImageType.FRONT and not group.front_image_id:
        group.front_image_id = job.id
    elif job.image_type == ImageType.BACK and not group.back_image_id:
        group.back_image_id = job.id
    elif job.image_type == ImageType.DETAIL and not group.detail_image_id:
        group.detail_image_id = job.id
    elif job.image_type == ImageType.SPEC_LABEL and not group.spec_label_id:
        group.spec_label_id = job.id
        if job.spec_data:
            group.spec_data = job.spec_data


def _assign_spec_labels(
    spec_jobs: List[ImageJob],
    style_groups: Dict[str, StyleGroup],
    all_jobs: Dict[str, ImageJob]
) -> None:
    """
    Assign spec label images to style groups.
    Uses file naming proximity (sequential filenames = same garment style).
    """
    if not spec_jobs or not style_groups:
        return

    for spec_job in spec_jobs:
        spec_name = spec_job.filename.lower()

        # Strategy: find the style group whose images have the closest filenames
        best_group_id = None
        best_distance = float("inf")

        for gid, group in style_groups.items():
            if group.spec_label_id:  # Already has a spec label
                continue

            for job_id in group.image_ids:
                if job_id in all_jobs:
                    other_name = all_jobs[job_id].filename.lower()
                    # Use filename numerical proximity
                    dist = _filename_distance(spec_name, other_name)
                    if dist < best_distance:
                        best_distance = dist
                        best_group_id = gid

        if best_group_id:
            _add_job_to_group(style_groups[best_group_id], spec_job)
            logger.info(f"Assigned spec label {spec_job.filename} to group {style_groups[best_group_id].name}")


def _filename_distance(name_a: str, name_b: str) -> int:
    """
    Calculate distance between filenames based on numerical proximity.
    Used for pairing spec labels with their corresponding garment images.
    """
    import re

    # Remove extension and get numeric parts
    base_a = name_a.split('.')[0]
    base_b = name_b.split('.')[0]

    nums_a = re.findall(r'\d+', base_a)
    nums_b = re.findall(r'\d+', base_b)

    if not nums_a or not nums_b:
        return 999

    try:
        # Try last number first (DSC03647 style)
        suffix_a = int(nums_a[-1])
        suffix_b = int(nums_b[-1])
        dist_last = abs(suffix_a - suffix_b)

        # Also try largest number (timestamp style: 20260406_095310)
        big_a = max(int(n) for n in nums_a)
        big_b = max(int(n) for n in nums_b)
        dist_big = abs(big_a - big_b)

        # Return whichever gives smaller distance
        return min(dist_last, dist_big)

    except (ValueError, IndexError):
        return 999
