import torch
from PIL import Image
from transformers import CLIPProcessor, CLIPModel
import numpy as np
import logging
import os

logger = logging.getLogger(__name__)

class CLIPEmbedder:
    _instance = None
    _model = None
    _processor = None
    _cache = {}

    def __new__(cls):
        if cls._instance is None:
            cls._instance = super(CLIPEmbedder, cls).__new__(cls)
        return cls._instance
        
    def _load_model(self):
        if self._model is None or self._processor is None:
            logger.info("Loading CLIP model (openai/clip-vit-base-patch32) on CPU...")
            self._model = CLIPModel.from_pretrained("openai/clip-vit-base-patch32")
            self._processor = CLIPProcessor.from_pretrained("openai/clip-vit-base-patch32")
            self._model.eval()
            logger.info("CLIP model loaded successfully.")

    def get_embedding(self, image_path: str) -> np.ndarray:
        if image_path in self._cache:
            return self._cache[image_path]
            
        self._load_model()
        
        try:
            image = Image.open(image_path).convert("RGB")
            inputs = self._processor(images=image, return_tensors="pt")
            
            with torch.no_grad():
                outputs = self._model.get_image_features(**inputs)
                
            # Normalize embedding
            if hasattr(outputs, 'pooler_output'):
                embedding = outputs.pooler_output.cpu().numpy()[0]
            elif isinstance(outputs, torch.Tensor):
                embedding = outputs.cpu().numpy()[0]
            else:
                embedding = outputs[0].cpu().numpy()[0]

            norm = np.linalg.norm(embedding)
            if norm > 0:
                embedding = embedding / norm
            
            self._cache[image_path] = embedding
            return embedding
        except Exception as e:
            logger.error(f"Failed to generate embedding for {image_path}: {e}")
            return np.zeros(512)

    def cosine_similarity(self, emb_a: np.ndarray, emb_b: np.ndarray) -> float:
        if emb_a.shape == (0,) or emb_b.shape == (0,):
            return 0.0
            
        dot_product = np.dot(emb_a, emb_b)
        norm_a = np.linalg.norm(emb_a)
        norm_b = np.linalg.norm(emb_b)
        if norm_a == 0 or norm_b == 0:
            return 0.0
        return float(dot_product / (norm_a * norm_b))

_embedder_instance = CLIPEmbedder()

def get_embedding(image_path: str) -> np.ndarray:
    return _embedder_instance.get_embedding(image_path)

def cosine_similarity(emb_a: np.ndarray, emb_b: np.ndarray) -> float:
    return _embedder_instance.cosine_similarity(emb_a, emb_b)

def build_image_grid(image_paths: list[str], max_size: int = 1024) -> str:
    import io, base64
    if not image_paths:
        return ""
        
    images = []
    for path in image_paths:
        try:
            img = Image.open(path).convert("RGB")
            img.thumbnail((max_size // len(image_paths), max_size))
            images.append(img)
        except Exception as e:
            logger.error(f"Failed to load {path} for grid: {e}")
            
    if not images:
        return ""
        
    total_width = sum(img.width for img in images)
    max_height = max(img.height for img in images)
    
    grid = Image.new("RGB", (total_width, max_height), color=(255, 255, 255))
    
    x_offset = 0
    for img in images:
        grid.paste(img, (x_offset, 0))
        x_offset += img.width
        
    buffer = io.BytesIO()
    grid.save(buffer, format="JPEG", quality=85)
    b64 = base64.b64encode(buffer.getvalue()).decode("utf-8")
    return f"data:image/jpeg;base64,{b64}"
