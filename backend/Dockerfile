FROM python:3.11-slim

WORKDIR /app

# Install system dependencies for OpenCV and rembg
RUN apt-get update && apt-get install -y --no-install-recommends \
    libgl1-mesa-glx \
    libglib2.0-0 \
    libsm6 \
    libxext6 \
    libxrender-dev \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements first for Docker layer caching
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Pre-download rembg model (u2net) so first run doesn't stall
RUN python -c "from rembg import remove; from PIL import Image; import io; remove(Image.new('RGB', (10, 10)).tobytes())" || true

# Copy backend code
COPY . /app/backend/

# Create directories
RUN mkdir -p /app/input/images /app/output/processed_images

EXPOSE 8000

CMD ["uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "8000"]
