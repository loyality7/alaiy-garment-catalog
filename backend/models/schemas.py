"""
Pydantic models and enums for the garment catalog pipeline.
"""

from enum import Enum
from typing import Optional, Dict, Any, List
from pydantic import BaseModel, Field
import uuid
import time


class ImageType(str, Enum):
    FRONT = "FRONT"
    BACK = "BACK"
    DETAIL = "DETAIL"
    SPEC_LABEL = "SPEC_LABEL"
    UNKNOWN = "UNKNOWN"


class JobStatus(str, Enum):
    UPLOADED = "uploaded"
    CLASSIFYING = "classifying"
    CLASSIFIED = "classified"
    PROCESSING = "processing"
    CLEANED = "cleaned"
    ASSIGNED = "assigned"
    PPT_READY = "ppt_ready"
    FAILED = "failed"


class ClassificationResult(BaseModel):
    """Result from the image classifier."""
    image_type: ImageType = ImageType.UNKNOWN
    confidence: float = 0.0
    dominant_color: str = ""
    garment_type: str = ""
    pattern: str = ""
    style_name: str = ""


class SpecData(BaseModel):
    """Extracted spec data from label cards."""
    ref_number: str = ""
    fabric_composition: str = ""
    gsm: str = ""
    date: str = ""
    remarks: str = ""


class ImageJob(BaseModel):
    """Represents a single image processing job."""
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    filename: str = ""
    original_path: str = ""
    status: JobStatus = JobStatus.UPLOADED
    image_type: ImageType = ImageType.UNKNOWN
    classification: Optional[ClassificationResult] = None
    style_group: Optional[str] = None
    spec_data: Optional[SpecData] = None
    processed_path: Optional[str] = None
    error: Optional[str] = None
    created_at: float = Field(default_factory=time.time)
    updated_at: float = Field(default_factory=time.time)

    def update_status(self, status: JobStatus) -> None:
        self.status = status
        self.updated_at = time.time()


class StyleGroup(BaseModel):
    """A group of images belonging to the same garment style."""
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    name: str = ""
    style_number: int = 0
    dominant_color: str = ""
    garment_type: str = ""
    pattern: str = ""
    is_heuristic: bool = False
    image_ids: List[str] = Field(default_factory=list)
    front_image_id: Optional[str] = None
    back_image_id: Optional[str] = None
    detail_image_id: Optional[str] = None
    spec_label_id: Optional[str] = None
    spec_data: Optional[SpecData] = None


class WebSocketMessage(BaseModel):
    """Message format for WebSocket broadcasts."""
    event: str
    job_id: Optional[str] = None
    data: Dict[str, Any] = Field(default_factory=dict)


class PipelineStats(BaseModel):
    """Overall pipeline statistics."""
    total: int = 0
    uploaded: int = 0
    classifying: int = 0
    classified: int = 0
    processing: int = 0
    cleaned: int = 0
    assigned: int = 0
    ppt_ready: int = 0
    failed: int = 0
    style_groups: int = 0
