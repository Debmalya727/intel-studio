# ==========================================
# 🐳 IntelStudio Deployment Dockerfile
# ==========================================
# This Dockerfile is optimized for lightweight cloud deployments (API Mode).
# It uses a multi-stage build to compile the React frontend first, bypassing Node.js
# in the final image to keep it lightweight.

# --- Stage 1: Build React Frontend ---
FROM node:20-slim AS frontend-builder
WORKDIR /build
# Copy package definition files
COPY frontend/package*.json ./
# Clean install npm packages
RUN npm ci
# Copy rest of the frontend code and compile
COPY frontend/ ./
RUN npm run build

# --- Stage 2: Production Run Image ---
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

# Copy built frontend assets from builder stage
COPY --from=frontend-builder /build/dist /app/frontend/dist

# Create necessary static and uploads folders
RUN mkdir -p static/generated uploads

# Expose port
EXPOSE 5000

# Start server using gunicorn with port binding support
CMD ["sh", "-c", "gunicorn --bind 0.0.0.0:${PORT:-5000} --workers 2 --threads 4 app:app"]
