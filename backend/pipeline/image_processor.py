"""
Image processing pipeline: background removal, deskew, crop, brightness/contrast, resize.
Each step is separate and non-destructive.
"""

import io
import logging
import numpy as np
from PIL import Image, ImageEnhance, ImageFilter, ImageOps
import cv2
from rembg import remove

from backend.models.schemas import ImageType

logger = logging.getLogger(__name__)

# Target sizes
PORTRAIT_SIZE = (800, 1100)  # Front/Back views
SQUARE_SIZE = (800, 800)     # Detail shots
SPEC_SIZE = (1000, 700)      # Spec labels


def remove_background(image: Image.Image) -> Image.Image:
    """
    Step 1: Remove background using rembg and place on clean white background.
    rembg uses U2Net model to detect and remove backgrounds safely.
    """
    logger.info("Step 1: Removing background...")

    # Remove background - returns RGBA image if passed a PIL Image
    fg_image = remove(image).convert("RGBA")

    # Create clean white background
    white_bg = Image.new("RGBA", fg_image.size, (255, 255, 255, 255))

    # Composite foreground onto white background
    composite = Image.alpha_composite(white_bg, fg_image)
    return composite.convert("RGB")


def auto_deskew(image: Image.Image) -> Image.Image:
    """
    Step 2: Auto-deskew tilted images using OpenCV.
    Detects dominant angle and rotates to straighten.
    """
    logger.info("Step 2: Auto-deskewing...")

    # Convert PIL to OpenCV format
    img_array = np.array(image)
    gray = cv2.cvtColor(img_array, cv2.COLOR_RGB2GRAY)

    # Edge detection
    edges = cv2.Canny(gray, 50, 150, apertureSize=3)

    # Detect lines using Hough transform
    lines = cv2.HoughLinesP(edges, 1, np.pi / 180, threshold=100,
                            minLineLength=100, maxLineGap=10)

    if lines is None or len(lines) < 3:
        logger.info("No significant lines detected, skipping deskew")
        return image

    # Calculate angles of all detected lines
    angles = []
    for line in lines:
        x1, y1, x2, y2 = line[0]
        angle = np.degrees(np.arctan2(y2 - y1, x2 - x1))
        # Only consider near-horizontal or near-vertical lines
        if abs(angle) < 15 or abs(abs(angle) - 90) < 15:
            angles.append(angle)

    if not angles:
        return image

    # Use median angle to avoid outliers
    median_angle = np.median([a for a in angles if abs(a) < 15]) if any(abs(a) < 15 for a in angles) else 0

    # Only deskew if tilt is small (< 10 degrees) — larger tilts may be intentional
    if abs(median_angle) < 0.5 or abs(median_angle) > 10:
        return image

    logger.info(f"Deskewing by {median_angle:.2f} degrees")
    return image.rotate(-median_angle, expand=True, fillcolor=(255, 255, 255))


def smart_crop(image: Image.Image) -> Image.Image:
    """
    Step 3: Smart crop — detect garment bounding box and tight crop.
    Maintains aspect ratio, adds consistent padding.
    """
    logger.info("Step 3: Smart cropping...")

    img_array = np.array(image)
    gray = cv2.cvtColor(img_array, cv2.COLOR_RGB2GRAY)

    # Threshold to find non-white areas (garment)
    _, thresh = cv2.threshold(gray, 240, 255, cv2.THRESH_BINARY_INV)

    # Find contours
    contours, _ = cv2.findContours(thresh, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

    if not contours:
        return image

    # Get bounding box of largest contour (the garment)
    largest = max(contours, key=cv2.contourArea)
    x, y, w, h = cv2.boundingRect(largest)

    # Check if the detected area is significant enough
    img_h, img_w = img_array.shape[:2]
    if w < img_w * 0.1 or h < img_h * 0.1:
        return image

    # Add padding (5% of each dimension)
    pad_x = int(w * 0.05)
    pad_y = int(h * 0.05)

    x1 = max(0, x - pad_x)
    y1 = max(0, y - pad_y)
    x2 = min(img_w, x + w + pad_x)
    y2 = min(img_h, y + h + pad_y)

    # Crop
    cropped = image.crop((x1, y1, x2, y2))
    return cropped


def auto_brightness_contrast(image: Image.Image) -> Image.Image:
    """
    Step 4: Auto-correct brightness and contrast.
    Uses histogram analysis to determine optimal adjustments.
    """
    logger.info("Step 4: Auto brightness/contrast...")

    img_array = np.array(image)
    gray = cv2.cvtColor(img_array, cv2.COLOR_RGB2GRAY)

    # Analyze histogram
    mean_brightness = np.mean(gray)
    std_contrast = np.std(gray)

    # Target brightness: ~140 (slightly bright for catalog look)
    brightness_factor = 1.0
    if mean_brightness < 100:
        brightness_factor = 140 / max(mean_brightness, 1)
        brightness_factor = min(brightness_factor, 1.5)  # Cap adjustment
    elif mean_brightness > 180:
        brightness_factor = 140 / mean_brightness
        brightness_factor = max(brightness_factor, 0.8)

    # Target contrast: moderate increase for catalog clarity
    contrast_factor = 1.0
    if std_contrast < 40:
        contrast_factor = 1.3  # Boost low-contrast images
    elif std_contrast < 60:
        contrast_factor = 1.15

    # Apply adjustments
    result = image
    if abs(brightness_factor - 1.0) > 0.05:
        enhancer = ImageEnhance.Brightness(result)
        result = enhancer.enhance(brightness_factor)

    if abs(contrast_factor - 1.0) > 0.05:
        enhancer = ImageEnhance.Contrast(result)
        result = enhancer.enhance(contrast_factor)

    # Slight sharpening for catalog quality
    enhancer = ImageEnhance.Sharpness(result)
    result = enhancer.enhance(1.1)

    return result


def resize_to_format(image: Image.Image, image_type: ImageType) -> Image.Image:
    """
    Step 5: Resize to target format without stretching.
    FRONT/BACK → portrait, DETAIL → square.
    Maintains aspect ratio by fitting within target and adding white padding.
    """
    logger.info(f"Step 5: Resizing for {image_type.value}...")

    if image_type in (ImageType.FRONT, ImageType.BACK):
        target = PORTRAIT_SIZE
    elif image_type == ImageType.DETAIL:
        target = SQUARE_SIZE
    elif image_type == ImageType.SPEC_LABEL:
        target = SPEC_SIZE
    else:
        target = PORTRAIT_SIZE

    target_w, target_h = target

    # Calculate scaling to fit within target while maintaining aspect ratio
    img_w, img_h = image.size
    ratio = min(target_w / img_w, target_h / img_h)

    new_w = int(img_w * ratio)
    new_h = int(img_h * ratio)

    # Resize with high quality
    resized = image.resize((new_w, new_h), Image.LANCZOS)

    # Create white canvas and center the image
    canvas = Image.new("RGB", target, (255, 255, 255))
    offset_x = (target_w - new_w) // 2
    offset_y = (target_h - new_h) // 2
    canvas.paste(resized, (offset_x, offset_y))

    return canvas


def process_image(image_path: str, image_type: ImageType) -> bytes:
    """
    Full image processing pipeline.
    Runs all 5 steps in sequence and returns processed image bytes.
    """
    logger.info(f"Processing image: {image_path} (type: {image_type.value})")

    # Load original image and apply EXIF orientation immediately!
    original = Image.open(image_path)
    original = ImageOps.exif_transpose(original).convert("RGB")

    # Step 1: Background removal (skip for spec labels, or if REMOVE_BG is false)
    import os
    remove_bg_enabled = os.getenv("REMOVE_BG", "false").lower() == "true"
    
    if image_type != ImageType.SPEC_LABEL and remove_bg_enabled:
        image = remove_background(original)
    else:
        image = original

    # Step 2: Auto-deskew
    image = auto_deskew(image)

    # Step 3: Smart crop
    image = smart_crop(image)

    # Step 4: Brightness/contrast correction
    image = auto_brightness_contrast(image)

    # Step 5: Resize to standard format
    image = resize_to_format(image, image_type)

    # Convert to bytes
    output_buffer = io.BytesIO()
    image.save(output_buffer, format="JPEG", quality=95)
    output_buffer.seek(0)

    logger.info(f"Processing complete for {image_path}")
    return output_buffer.getvalue()
