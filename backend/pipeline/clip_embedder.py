import torch
from PIL import Image
from transformers import CLIPProcessor, CLIPModel
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

    def get_embedding(self, image_path: str) -> torch.Tensor:
        if image_path in self._cache:
            return self._cache[image_path]
            
        self._load_model()
        
        try:
            image = Image.open(image_path).convert("RGB")
            inputs = self._processor(images=image, return_tensors="pt")
            
            with torch.no_grad():
                embedding = self._model.get_image_features(**inputs)
                
            if not isinstance(embedding, torch.Tensor):
                if hasattr(embedding, 'image_embeds'):
                    embedding = embedding.image_embeds
                elif hasattr(embedding, 'pooler_output'):
                    embedding = embedding.pooler_output
                else:
                    embedding = embedding[0]
                    
            # Normalize embedding
            embedding = embedding / embedding.norm(p=2, dim=-1, keepdim=True)
            embedding = embedding.squeeze()
            
            self._cache[image_path] = embedding
            return embedding
        except Exception as e:
            logger.error(f"Failed to generate embedding for {image_path}: {e}")
            return None

    def cosine_similarity(self, emb_a: torch.Tensor, emb_b: torch.Tensor) -> float:
        if emb_a is None or emb_b is None:
            return 0.0
            
        # Ensure tensors are 1D
        emb_a = emb_a.squeeze()
        emb_b = emb_b.squeeze()
        
        similarity = torch.nn.functional.cosine_similarity(emb_a, emb_b, dim=0)
        return float(similarity.item())

_embedder_instance = CLIPEmbedder()

def get_embedding(image_path: str) -> torch.Tensor:
    return _embedder_instance.get_embedding(image_path)

def cosine_similarity(emb_a: torch.Tensor, emb_b: torch.Tensor) -> float:
    return _embedder_instance.cosine_similarity(emb_a, emb_b)
