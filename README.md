---
title: IntelStudio
emoji: 🎨
colorFrom: blue
colorTo: indigo
sdk: docker
app_port: 5000
---
# Live link : https://huggingface.co/spaces/debmalyap/intel-studio
# 🎨 IntelStudio - Premium AI Creativity Platform

IntelStudio is a state-of-the-art AI-powered image generation and editing suite. It features a premium, responsive glassmorphic user interface designed for high-fidelity artwork creation and rapid prototyping. It supports both cloud-based API models and fully local GPU-accelerated pipelines.

---

## ✨ Features

- **🚀 Dual Inference Engine**:
  - **Serverless API Mode**: Fast, zero-setup generation powered by Hugging Face's inference API (utilizing `black-forest-labs/FLUX.1-schnell` and `stabilityai/stable-diffusion-xl-base-1.0`).
  - **Local PyTorch Mode**: Runs models directly on your hardware using PyTorch and `diffusers` (supporting Stable Diffusion txt2img, img2img, and inpaint pipelines).
- **⚙️ API Settings Panel**: Configure your personal credentials (Unsplash, Hugging Face, Pollinations) dynamically through the UI. Credentials persist in browser storage and fall back to server `.env` files.
- **🪄 Advanced Style & Generation Presets**:
  - Direct parameter control for **Negative Prompts** and **Manual Seed Inputs** (with a quick-randomize option).
  - One-click **Art Style Presets** (Photorealistic, Anime / Manga, 3D Render, Cyberpunk, Oil Painting).
- **🕒 Local Creation History**: Keep track of your latest creations (up to 30 items) in a persistent gallery card grid. Preview, re-download, or delete individual history items.
- **📥 Local Setup Zip Exporter**: Pack and download the entire local workspace code on-the-fly as a compressed `.zip` archive to run on a local machine with GPU acceleration.

---

## 🛠️ Technology Stack

- **Frontend**: React 19, Vite 8, Framer Motion, Lucide Icons, Vanilla HSL CSS (Obsidian glassmorphic design system).
- **Backend**: Python 3.11, Flask, Gunicorn.
- **AI/ML Engine**: PyTorch, Hugging Face Hub Client, Diffusers, PIL, Numpy, Rembg (foreground/background auto-masking).

---

## 📦 Local Installation & Setup

To run IntelStudio locally on your machine (supporting both CPU fallback and CUDA GPU acceleration):

### Prerequisites
- Python 3.10 or 3.11 (Python 3.12 is also supported, but ensure correct PyTorch wheels).
- Node.js 18+ (for building the React client).
- (Optional) NVIDIA GPU with CUDA installed for hardware acceleration.

### Step 1: Clone the Repository
```bash
git clone https://github.com/Debmalya727/intel-studio.git
cd intel-studio
```

### Step 2: Set Up Python Virtual Environment
```bash
# Create virtual environment
python -m venv .venv

# Activate virtual environment
# On Windows:
.venv\Scripts\activate
# On macOS/Linux:
source .venv/bin/activate

# Install dependencies
pip install -r requirements.txt
```

### Step 3: Build the React Frontend
```bash
cd frontend
npm install
npm run build
cd ..
```

### Step 4: Configure Environment Variables
Create a `.env` file in the root directory:
```env
HUGGINGFACE_TOKEN=your_hugging_face_token_here
UNSPLASH_ACCESS_KEY=your_unsplash_access_key_here
GENERATION_MODE=API
```

### Step 5: Start the Application
```bash
python app.py
```
Open your browser and navigate to `http://127.0.0.1:5000`.

---

## 🐋 Production Docker Deployment

A multi-stage `Dockerfile` is provided for containerized deployment (e.g. Hugging Face Spaces):

```bash
docker build -t intel-studio .
docker run -p 5000:5000 intel-studio
```

---

## 📄 License

Distributed under the MIT License. See `LICENSE` for more information.
