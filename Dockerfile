# ==========================================
# 🐳 IntelStudio Deployment Dockerfile
# ==========================================
# This Dockerfile is optimized for lightweight cloud deployments (API Mode).
# It uses requirements-prod.txt to install only necessary web dependencies,
# bypassing heavy local PyTorch installations. This results in a fast build
# and low RAM footprint (< 150MB), perfect for Render, Heroku, or Hugging Face.

FROM python:3.11-slim

# Set environment variables
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    GENERATION_MODE=API \
    PORT=5000

WORKDIR /app

# Install system dependencies (like curl or build utils if needed)
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# Copy dependencies first for cache optimization
COPY requirements-prod.txt /app/

# Install python packages
RUN pip install --no-cache-dir -r requirements-prod.txt

# Copy project files
COPY . /app/

# Create necessary static and uploads folders
RUN mkdir -p static/generated uploads

# Expose port
EXPOSE 5000

# Start server using gunicorn with port binding support
CMD ["sh", "-c", "gunicorn --bind 0.0.0.0:${PORT:-5000} --workers 2 --threads 4 app:app"]
