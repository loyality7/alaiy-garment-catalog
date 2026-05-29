"""
Groups classified images into style groups.
Images with matching (color + garment_type + pattern) belong to the same style.
Uses fuzzy matching to handle slight variations in AI output.
"""

import logging
from typing import Dict, List, Optional
from difflib import SequenceMatcher

from backend.models.schemas import (
    ImageJob, StyleGroup, ImageType
)

logger = logging.getLogger(__name__)

# Minimum confidence threshold for auto-grouping
MIN_CONFIDENCE = 0.7


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


async def group_images(jobs: Dict[str, ImageJob]) -> Dict[str, StyleGroup]:
    """
    Group classified images into style groups using heuristics (filename proximity + visual traits).
    """
    logger.info(f"Grouping {len(jobs)} images into styles...")
    
    if not jobs:
        return {}

    return _heuristic_group_images(jobs)


def _heuristic_group_images(jobs: Dict[str, ImageJob]) -> Dict[str, StyleGroup]:
    """
    Fallback heuristic-based grouping algorithm.
    """
    logger.info("Running heuristic grouping...")
    style_groups: Dict[str, StyleGroup] = {}
    unassigned: List[ImageJob] = []
    style_counter = 0

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
            )
            _add_job_to_group(group, job)
            style_groups[group.id] = group

    # Try to assign spec labels to their nearest style group
    spec_jobs = [j for j in jobs.values() if j.image_type == ImageType.SPEC_LABEL]
    _assign_spec_labels(spec_jobs, style_groups, jobs)

    # Try to assign low-confidence images
    for job in unassigned:
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
            job.style_group = best_group_id
        else:
            # Create a solo group for unmatched images
            style_counter += 1
            group = StyleGroup(
                name=f"Unassigned Style {style_counter}",
                style_number=style_counter,
            )
            _add_job_to_group(group, job)
            style_groups[group.id] = group

    logger.info(f"Created {len(style_groups)} style groups")
    return style_groups


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

        if best_group_id and best_distance < 100:
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
