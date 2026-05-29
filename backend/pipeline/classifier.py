"""
Image classifier using AI vision models (NVIDIA NIM primary, OpenRouter fallback).
Classifies garment images as FRONT, BACK, DETAIL, or SPEC_LABEL.
Also extracts: dominant color, garment type, and pattern.
"""

import logging
from PIL import Image
import io
import base64

from backend.models.schemas import ClassificationResult, ImageType
from backend.utils.ai_client import call_vision_model, parse_json_response

logger = logging.getLogger(__name__)

CLASSIFICATION_PROMPT = """You are an expert garment image classifier for a professional fashion catalog.

Classify this image into EXACTLY ONE type:

== IMAGE TYPES ==

FRONT:
- Full garment visible from the front
- Shows collar from front side
- Button placket visible (for polo shirts)
- If the inner brand tag inside the back neckline is visible AND the whole garment is shown, it is the FRONT.
- MUST show majority of front fabric panel

BACK:
- Full garment visible from the back
- Continuous back fabric panel
- Back of collar visible
- NO buttons, NO placket, NO inner brand tag visible.
- MUST show majority of back fabric panel

DETAIL:
- Close-up of ONE small area only
- Examples: fabric texture, cuff, hem, seam, inner label/tag, collar edge
- If image is zoomed in on any part — it is DETAIL, NOT FRONT
- Even if collar or inner brand tag is visible, if it fills >50% of the frame = DETAIL
- DETAIL ALWAYS OVERRIDES FRONT OR BACK if the image is a close-up.

SPEC_LABEL:
- Physical paper tag OR printed specification card
- Contains visible TEXT: composition %, GSM, reference numbers, barcodes
- May be held in hand or placed on surface
- If text/numbers dominate the image = SPEC_LABEL

== CRITICAL RULE FOR DETAIL SHOTS ==
If the image shows ONLY a collar, ONLY a cuff, ONLY a fabric texture,
or ONLY an inner label — classify as DETAIL.
DETAIL images belong to the same garment as nearby FRONT/BACK images.
The classifier does NOT decide which garment a DETAIL belongs to.
The grouper handles that using filename proximity.
So always classify zoomed-in shots as DETAIL regardless of what garment it shows.

== COMMON MISTAKES TO AVOID ==
- A close-up of the collar area = DETAIL (not FRONT)
- A back view with no buttons = BACK (not FRONT)  
- A hangtag with text = SPEC_LABEL (not DETAIL)
- Solid colored shirt with shadow = still "solid" pattern

== METADATA EXTRACTION ==
dominant_color: Most prominent fabric color. Be specific: "navy blue", "olive green", "rust brown", "light grey", "off white". If stripes exist, name the base fabric color not the stripe color.
garment_type: Exact type only: "polo shirt", "t-shirt", "pants", "jacket". Do NOT invent terms.
pattern: Exact pattern: "solid", "striped", "ribbed knit", "textured knit", "checkered", "printed graphic"
style_name: Concise name combining color + pattern + type. Example: "Navy Blue Solid Polo Shirt"
confidence: 
  - 0.9-1.0: You are certain. Image is clear and unambiguous.
  - 0.7-0.89: Mostly certain but minor ambiguity.
  - 0.5-0.69: Uncertain. Image is cropped, blurry, or ambiguous.
  - Below 0.5: Highly uncertain. Guess best you can.

Respond ONLY with this exact JSON. No markdown. No explanation:
{
  "image_type": "FRONT|BACK|DETAIL|SPEC_LABEL",
  "confidence": 0.0,
  "dominant_color": "string",
  "garment_type": "string",
  "pattern": "string",
  "style_name": "string"
}"""


def _resize_for_api(image_path: str, max_size: int = 1024) -> str:
    """Resize image for API to reduce token usage while keeping quality."""
    img = Image.open(image_path)
    w, h = img.size

    if max(w, h) > max_size:
        ratio = max_size / max(w, h)
        new_w = int(w * ratio)
        new_h = int(h * ratio)
        img = img.resize((new_w, new_h), Image.LANCZOS)

    buffer = io.BytesIO()
    img.save(buffer, format="JPEG", quality=85)
    buffer.seek(0)

    return f"data:image/jpeg;base64,{base64.b64encode(buffer.read()).decode('utf-8')}"


async def classify_image(image_path: str) -> ClassificationResult:
    """
    Classify a single garment image using AI vision model.
    Returns a ClassificationResult with type, confidence, color, garment_type, pattern.
    """
    try:
        # Resize image for API efficiency
        image_data_url = _resize_for_api(image_path)

        # Call AI (NIM first, OpenRouter fallback)
        content = await call_vision_model(
            prompt=CLASSIFICATION_PROMPT,
            image_data_url=image_data_url,
            max_tokens=500,
            temperature=0.1,
        )

        data = parse_json_response(content)

        # Map image type
        image_type_str = data.get("image_type", "UNKNOWN").upper()
        try:
            image_type = ImageType(image_type_str)
        except ValueError:
            image_type = ImageType.UNKNOWN

        return ClassificationResult(
            image_type=image_type,
            confidence=float(data.get("confidence", 0.5)),
            dominant_color=data.get("dominant_color", ""),
            garment_type=data.get("garment_type", ""),
            pattern=data.get("pattern", ""),
            style_name=data.get("style_name", ""),
        )

    except Exception as e:
        logger.error(f"Classification failed for {image_path}: {e}")
        raise
