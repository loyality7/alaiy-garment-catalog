"""
Groups classified images into style groups using CLIP embeddings.
"""

import logging
import os
import json
from typing import Dict, List, Optional

from backend.models.schemas import (
    ImageJob, StyleGroup, ImageType
)
from backend.pipeline.clip_embedder import get_embedding, cosine_similarity, build_image_grid
from backend.utils.ai_client import call_vision_model, parse_json_response

logger = logging.getLogger(__name__)

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


def _filename_distance(name_a: str, name_b: str) -> int:
    """Calculate distance between filenames based on numerical proximity."""
    import re
    base_a = name_a.split('.')[0]
    base_b = name_b.split('.')[0]

    nums_a = re.findall(r'\d+', base_a)
    nums_b = re.findall(r'\d+', base_b)

    if not nums_a or not nums_b:
        return 999

    try:
        suffix_a = int(nums_a[-1])
        suffix_b = int(nums_b[-1])
        return abs(suffix_a - suffix_b)
    except (ValueError, IndexError):
        return 999


def _assign_spec_labels(
    spec_jobs: List[ImageJob],
    style_groups: Dict[str, StyleGroup],
    all_jobs: Dict[str, ImageJob]
) -> None:
    """Assign spec label and detail images to style groups."""
    if not spec_jobs or not style_groups:
        return

    for spec_job in spec_jobs:
        spec_name = spec_job.filename.lower()
        best_group_id = None
        best_distance = float("inf")

        for gid, group in style_groups.items():
            if spec_job.image_type == ImageType.SPEC_LABEL and group.spec_label_id:
                continue
            if spec_job.image_type == ImageType.DETAIL and group.detail_image_id:
                continue

            for job_id in group.image_ids:
                if job_id in all_jobs:
                    other_name = all_jobs[job_id].filename.lower()
                    dist = _filename_distance(spec_name, other_name)
                    if dist < best_distance:
                        best_distance = dist
                        best_group_id = gid

        if best_group_id and best_distance < 100:
            _add_job_to_group(style_groups[best_group_id], spec_job)
            logger.info(f"Assigned {spec_job.image_type.value} {spec_job.filename} to group {style_groups[best_group_id].name}")


async def group_images(jobs: Dict[str, ImageJob], emit_event=None) -> Dict[str, StyleGroup]:
    """Group classified images using CLIP embeddings and Vision checks."""
    logger.info(f"Grouping {len(jobs)} images using CLIP embeddings...")
    
    if not jobs:
        return {}

    def emit(event_name, data=None):
        if emit_event:
            emit_event(event_name, data)

    # Filter out spec labels, detail shots, and unknown for visual grouping
    visual_jobs = [j for j in jobs.values() if j.image_type not in (ImageType.SPEC_LABEL, ImageType.DETAIL, ImageType.UNKNOWN)]
    spec_and_detail_jobs = [j for j in jobs.values() if j.image_type in (ImageType.SPEC_LABEL, ImageType.DETAIL)]
    
    # Pass 1: Pre-compute CLIP embeddings
    job_embeddings = {}
    for job in visual_jobs:
        path = job.processed_path or job.original_path
        if path and os.path.exists(path):
            job_embeddings[job.id] = get_embedding(path)
            
    style_groups: Dict[str, StyleGroup] = {}
    style_counter = 0
    
    # Pass 1: Greedy similarity grouping
    unassigned = set(j.id for j in visual_jobs)
    
    while unassigned:
        curr_id = unassigned.pop()
        curr_job = jobs[curr_id]
        
        # Create a new group
        style_counter += 1
        name = curr_job.classification.style_name if curr_job.classification else f"Style {style_counter}"
        
        group = StyleGroup(
            name=name,
            style_number=style_counter,
            dominant_color=curr_job.classification.dominant_color if curr_job.classification else "",
            garment_type=curr_job.classification.garment_type if curr_job.classification else "",
            pattern=curr_job.classification.pattern if curr_job.classification else "",
        )
        _add_job_to_group(group, curr_job)
        style_groups[group.id] = group
        
        if curr_id not in job_embeddings:
            continue
            
        curr_emb = job_embeddings[curr_id]
        
        # Find neighbors
        neighbors = []
        for other_id in list(unassigned):
            if other_id not in job_embeddings:
                continue
                
            sim = cosine_similarity(curr_emb, job_embeddings[other_id])
            
            # Penalize similarity if classifications explicitly clash
            if curr_job.classification and jobs[other_id].classification:
                c1 = curr_job.classification
                c2 = jobs[other_id].classification
                if c1.dominant_color and c2.dominant_color:
                    import re
                    c1_words = set(re.findall(r'[a-z]+', c1.dominant_color.lower()))
                    c2_words = set(re.findall(r'[a-z]+', c2.dominant_color.lower()))
                    if not c1_words.intersection(c2_words):
                        sim -= 0.25
                if c1.pattern and c2.pattern:
                    import re
                    c1_pat = set(re.findall(r'[a-z]+', c1.pattern.lower()))
                    c2_pat = set(re.findall(r'[a-z]+', c2.pattern.lower()))
                    if not c1_pat.intersection(c2_pat):
                        sim -= 0.25

            if sim > 0.82:
                neighbors.append((other_id, sim))
            elif 0.75 <= sim <= 0.82:
                # Borderline: use filename distance tiebreaker
                dist = _filename_distance(curr_job.filename, jobs[other_id].filename)
                if dist <= 5:
                    neighbors.append((other_id, sim))
                    
        # Sort neighbors by similarity and add to group
        neighbors.sort(key=lambda x: x[1], reverse=True)
        for nid, _ in neighbors:
            _add_job_to_group(group, jobs[nid])
            unassigned.remove(nid)

    emit("grouping_pass1_complete")
    
    # Pass 2: Assign spec labels and detail shots by proximity
    _assign_spec_labels(spec_and_detail_jobs, style_groups, jobs)
    emit("grouping_pass2_complete")
    
    # Pass 3: Vision confirm solos
    solo_groups = [g for g in style_groups.values() if len(g.image_ids) == 1 and jobs[g.image_ids[0]].image_type != ImageType.SPEC_LABEL]
    
    for solo_group in solo_groups:
        solo_job_id = solo_group.image_ids[0]
        if solo_job_id not in job_embeddings:
            continue
            
        solo_emb = job_embeddings[solo_job_id]
        solo_job = jobs[solo_job_id]
        
        # Find CLIP-similar neighbors across ALL other visual jobs
        candidate_neighbors = []
        for other_id, other_emb in job_embeddings.items():
            if other_id == solo_job_id:
                continue
            sim = cosine_similarity(solo_emb, other_emb)
            if sim > 0.75:
                candidate_neighbors.append((other_id, sim))
                
        if not candidate_neighbors:
            continue
            
        candidate_neighbors.sort(key=lambda x: x[1], reverse=True)
        top_candidates = [cid for cid, _ in candidate_neighbors[:5]] # Max 5 candidates
        
        paths = [solo_job.processed_path or solo_job.original_path]
        for cid in top_candidates:
            paths.append(jobs[cid].processed_path or jobs[cid].original_path)
            
        grid_data_url = build_image_grid(paths)
        if not grid_data_url:
            continue
            
        filenames = [jobs[cid].filename for cid in top_candidates]
        prompt = (f"Image 1 ({solo_job.filename}) is ungrouped. Do any of images 2-{len(paths)} "
                  f"({', '.join(filenames)}) show the SAME physical garment as Image 1? "
                  "Same color, same fabric, different angle. Reply JSON only: "
                  "{\"belongs_with\": [\"filename1\", \"filename2\"]}")
                  
        try:
            resp = await call_vision_model(prompt, grid_data_url, max_tokens=100)
            data = parse_json_response(resp)
            belongs_with = data.get("belongs_with", [])
            
            if belongs_with:
                # Find which group the matched neighbor is in and merge
                matched_id = None
                for cid in top_candidates:
                    if jobs[cid].filename in belongs_with:
                        matched_id = cid
                        break
                        
                if matched_id:
                    target_group_id = jobs[matched_id].style_group
                    if target_group_id and target_group_id in style_groups:
                        # Move solo job to target group
                        _add_job_to_group(style_groups[target_group_id], solo_job)
                        del style_groups[solo_group.id]
                        emit("solo_resolved", {"solo_id": solo_job_id, "merged_into": target_group_id})
        except Exception as e:
            logger.error(f"Vision confirm solo failed for {solo_job_id}: {e}")

    # Pass 4: Suspicious group confirmation
    enable_confirmation = os.getenv("ENABLE_CONFIRMATION_PASS", "false").lower() == "true"
    if enable_confirmation:
        suspicious_groups = []
        for g in style_groups.values():
            fronts = 0
            backs = 0
            garment_types = set()
            for jid in g.image_ids:
                if jid not in jobs: continue
                j = jobs[jid]
                if j.image_type == ImageType.FRONT: fronts += 1
                if j.image_type == ImageType.BACK: backs += 1
                if j.classification and j.classification.garment_type:
                    garment_types.add(j.classification.garment_type.lower())
                    
            if fronts >= 2 or backs >= 2 or len(garment_types) >= 3:
                suspicious_groups.append(g)
                
        # Max 10 groups
        for g in suspicious_groups[:10]:
            # Collect images
            paths = []
            filenames = []
            for jid in g.image_ids:
                j = jobs[jid]
                if j.image_type != ImageType.SPEC_LABEL:
                    p = j.processed_path or j.original_path
                    if p:
                        paths.append(p)
                        filenames.append(j.filename)
                        
            if len(paths) < 2:
                continue
                
            grid_data_url = build_image_grid(paths)
            if not grid_data_url:
                continue
                
            prompt = (f"Do ALL these images ({', '.join(filenames)}) show the same physical garment? "
                      "If any do NOT belong list their filenames. "
                      "Reply JSON: {\"all_same\": true, \"remove\": [\"filename\"]}")
                      
            try:
                resp = await call_vision_model(prompt, grid_data_url, max_tokens=100)
                data = parse_json_response(resp)
                remove_list = data.get("remove", [])
                
                if remove_list:
                    # Remove and make solo
                    for jid in list(g.image_ids):
                        j = jobs[jid]
                        if j.filename in remove_list:
                            # Remove from slots if matched
                            if g.front_image_id == jid: g.front_image_id = None
                            if g.back_image_id == jid: g.back_image_id = None
                            if g.detail_image_id == jid: g.detail_image_id = None
                            g.image_ids.remove(jid)
                            
                            # Create new solo group
                            style_counter += 1
                            new_group = StyleGroup(
                                name=f"Split Style {style_counter}",
                                style_number=style_counter
                            )
                            _add_job_to_group(new_group, j)
                            style_groups[new_group.id] = new_group
            except Exception as e:
                logger.error(f"Vision confirm suspicious failed for group {g.id}: {e}")
                
    emit("grouping_pass4_complete")
    return style_groups
