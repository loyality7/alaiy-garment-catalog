"""
OCR module for extracting spec data from garment label/spec card images.
Uses AI vision models (NVIDIA NIM primary, OpenRouter fallback).
"""

import logging
from PIL import Image
import io
import base64

from backend.models.schemas import SpecData
from backend.utils.ai_client import call_vision_model, parse_json_response

logger = logging.getLogger(__name__)

OCR_PROMPT = """You are an OCR system specialized in reading garment specification labels and cards.

This image shows a garment spec label/card. Extract the following information:

1. ref_number: The reference number or style code (e.g., "ASM-NXT-003", "REF-001", etc.)
2. fabric_composition: The fabric content/composition (e.g., "55.3% Recycled Polyester, 44.7% Organic Cotton")
3. gsm: The fabric weight in GSM (Grams per Square Meter) - just the number and unit (e.g., "202 g/m²" or "202")
4. date: Any date mentioned (e.g., "30-03-2026")
5. remarks: Any additional remarks, codes, or notes (e.g., "AFS-4357")

If a field is not visible or not present, use an empty string "".

Respond with ONLY valid JSON, no markdown, no explanation:
{
  "ref_number": "extracted value",
  "fabric_composition": "extracted value",
  "gsm": "extracted value",
  "date": "extracted value",
  "remarks": "extracted value"
}"""


def _resize_for_api(image_path: str, max_size: int = 1536) -> str:
    """Resize image for API. Spec labels need higher resolution for text readability."""
    img = Image.open(image_path)
    w, h = img.size

    if max(w, h) > max_size:
        ratio = max_size / max(w, h)
        new_w = int(w * ratio)
        new_h = int(h * ratio)
        img = img.resize((new_w, new_h), Image.LANCZOS)

    buffer = io.BytesIO()
    img.save(buffer, format="JPEG", quality=90)
    buffer.seek(0)

    return f"data:image/jpeg;base64,{base64.b64encode(buffer.read()).decode('utf-8')}"


async def extract_spec_data(image_path: str) -> SpecData:
    """
    Extract specification data from a garment label/spec card image.
    Returns a SpecData object with ref_number, fabric_composition, gsm, date, remarks.
    """
    try:
        image_data_url = _resize_for_api(image_path)

        # Call AI (NIM first, OpenRouter fallback)
        content = await call_vision_model(
            prompt=OCR_PROMPT,
            image_data_url=image_data_url,
            max_tokens=500,
            temperature=0.1,
        )

        data = parse_json_response(content)

        return SpecData(
            ref_number=str(data.get("ref_number", "")),
            fabric_composition=str(data.get("fabric_composition", "")),
            gsm=str(data.get("gsm", "")),
            date=str(data.get("date", "")),
            remarks=str(data.get("remarks", "")),
        )

    except Exception as e:
        logger.error(f"OCR extraction failed for {image_path}: {e}")
        raise
