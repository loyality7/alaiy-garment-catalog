"""
File utility functions for path handling, image loading, and file operations.
"""

import os
import base64
import shutil
from pathlib import Path
from typing import Optional
from dotenv import load_dotenv

load_dotenv()

PROJECT_ROOT = Path(__file__).parent.parent.parent.absolute()
INPUT_DIR = str(PROJECT_ROOT / os.getenv("INPUT_DIR", "input/images").lstrip("./\\"))
OUTPUT_DIR = str(PROJECT_ROOT / os.getenv("OUTPUT_DIR", "output").lstrip("./\\"))
REFERENCE_PPT = str(PROJECT_ROOT / os.getenv("REFERENCE_PPT", "input/reference.pptx").lstrip("./\\"))


def get_input_dir() -> Path:
    """Get the input images directory path."""
    path = Path(INPUT_DIR)
    path.mkdir(parents=True, exist_ok=True)
    return path


def get_output_dir() -> Path:
    """Get the output directory path."""
    path = Path(OUTPUT_DIR)
    path.mkdir(parents=True, exist_ok=True)
    return path


def get_processed_images_dir() -> Path:
    """Get the processed images output directory."""
    path = get_output_dir() / "processed_images"
    path.mkdir(parents=True, exist_ok=True)
    return path


def get_reference_ppt() -> Path:
    """Get the reference PowerPoint path."""
    return Path(REFERENCE_PPT)


def get_catalog_output_path() -> Path:
    """Get the output catalog PowerPoint path (legacy/fallback)."""
    return get_output_dir() / "Catalog.pptx"


def get_new_catalog_output_path() -> Path:
    """Get a new versioned output catalog path to prevent overwriting."""
    out_dir = get_output_dir()
    base_name = "Catalog"
    ext = ".pptx"
    
    counter = 1
    while True:
        path = out_dir / f"{base_name}_v{counter}{ext}"
        if not path.exists():
            return path
        counter += 1


def get_latest_catalog_output_path() -> Path:
    """Get the latest versioned catalog path for downloading."""
    out_dir = get_output_dir()
    base_name = "Catalog"
    ext = ".pptx"
    
    import re
    max_v = 0
    latest = out_dir / f"{base_name}{ext}"
    
    for f in out_dir.glob(f"{base_name}_v*{ext}"):
        match = re.search(r'_v(\d+)\.pptx$', f.name)
        if match:
            v = int(match.group(1))
            if v > max_v:
                max_v = v
                latest = f
                
    if max_v == 0 and not latest.exists():
        latest = out_dir / f"{base_name}_v1{ext}"
        
    return latest


def save_uploaded_file(file_content: bytes, filename: str) -> str:
    """
    Save an uploaded file to the input images directory.
    Returns the full path as string.
    """
    dest_dir = get_input_dir()
    dest_path = dest_dir / filename

    # Handle duplicate filenames
    if dest_path.exists():
        name, ext = os.path.splitext(filename)
        counter = 1
        while dest_path.exists():
            dest_path = dest_dir / f"{name}_{counter}{ext}"
            counter += 1

    with open(dest_path, "wb") as f:
        f.write(file_content)

    return str(dest_path)


def save_processed_image(image_bytes: bytes, filename: str) -> str:
    """
    Save a processed image to the output directory.
    Returns the full path as string.
    """
    dest_dir = get_processed_images_dir()
    dest_path = dest_dir / filename

    with open(dest_path, "wb") as f:
        f.write(image_bytes)

    return str(dest_path)


def load_image_as_base64(image_path: str) -> str:
    """
    Load an image file and return it as a base64 encoded string.
    Used for sending images to OpenRouter API.
    """
    with open(image_path, "rb") as f:
        image_data = f.read()
    return base64.b64encode(image_data).decode("utf-8")


def get_image_mime_type(image_path: str) -> str:
    """Get the MIME type based on file extension."""
    ext = Path(image_path).suffix.lower()
    mime_map = {
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".png": "image/png",
        ".webp": "image/webp",
        ".gif": "image/gif",
        ".bmp": "image/bmp",
    }
    return mime_map.get(ext, "image/jpeg")


def get_base64_data_url(image_path: str) -> str:
    """Get a complete data URL for an image (for OpenRouter API)."""
    mime = get_image_mime_type(image_path)
    b64 = load_image_as_base64(image_path)
    return f"data:{mime};base64,{b64}"


def list_input_images() -> list[str]:
    """List all image files in the input directory."""
    input_dir = get_input_dir()
    valid_extensions = {".jpg", ".jpeg", ".png", ".webp", ".bmp"}
    images = []
    for f in input_dir.iterdir():
        if f.is_file() and f.suffix.lower() in valid_extensions:
            images.append(str(f))
    return sorted(images)


def ensure_directories():
    """Create all necessary directories."""
    get_input_dir()
    get_output_dir()
    get_processed_images_dir()


def get_relative_path(full_path: str) -> str:
    """Convert an absolute path to a relative path from the output directory."""
    try:
        return str(Path(full_path).relative_to(get_output_dir()))
    except ValueError:
        return full_path


def copy_file(src: str, dst: str) -> str:
    """Copy a file from src to dst. Returns destination path."""
    Path(dst).parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(src, dst)
    return dst


def get_structured_output_dir() -> Path:
    """Get the Processed_Garments output directory."""
    path = get_output_dir() / "Processed_Garments"
    path.mkdir(parents=True, exist_ok=True)
    return path


def organize_output_files(style_groups: dict, jobs: dict) -> str:
    """
    Copy processed images into Processed_Garments/ with proper naming:
      StyleName_front.jpg, StyleName_back.jpg, StyleName_detail.jpg
    Returns the output directory path.
    """
    output_dir = get_structured_output_dir()

    for gid, group in style_groups.items():
        # Build a clean style name (filesystem safe)
        raw_name = group.get("name") or f"Style_{group.get('style_number', 0)}"
        style_name = (
            raw_name.replace(" ", "_")
            .replace("/", "-")
            .replace("\\", "-")
            .replace(":", "")
            .replace("'", "")
            .replace('"', "")
        )

        slot_map = {
            "front_image_id": "front",
            "back_image_id": "back",
            "detail_image_id": "detail",
            "spec_label_id": "spec",
        }

        for slot_key, suffix in slot_map.items():
            job_id = group.get(slot_key)
            if not job_id or job_id not in jobs:
                continue

            job = jobs[job_id]
            src_path = job.get("processed_path") or job.get("original_path")
            if not src_path or not Path(src_path).exists():
                continue

            dst_filename = f"{style_name}_{suffix}.jpg"
            dst_path = output_dir / dst_filename
            shutil.copy2(src_path, dst_path)

    return str(output_dir)
