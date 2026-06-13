import os
import io
import threading
from datetime import datetime
from PIL import Image, ImageFilter
from huggingface_hub import login

try:
    import torch
    import numpy as np
    from diffusers import (
        StableDiffusionPipeline,
        StableDiffusionImg2ImgPipeline,
        StableDiffusionInpaintPipeline,
        EulerDiscreteScheduler,
    )
    TORCH_AVAILABLE = True
except ImportError:
    TORCH_AVAILABLE = False

# Optional: Hugging Face login for private models
HF_TOKEN = os.getenv("HUGGINGFACE_TOKEN")
try:
    login(token=HF_TOKEN)
except Exception as e:
    print(f"[WARNING] Hugging Face login skipped or failed: {e}")

# Device setup
if TORCH_AVAILABLE:
    device = "cuda" if torch.cuda.is_available() else "cpu"
    # Speed opt
    torch.backends.cudnn.benchmark = True
else:
    device = "cpu"

# Paths
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
GENERATED_FOLDER = os.path.join(SCRIPT_DIR, "static", "generated")
os.makedirs(GENERATED_FOLDER, exist_ok=True)

# Model selection (realistic model used for txt2img / img2img)
MODEL_ID = "SG161222/Realistic_Vision_V5.1_noVAE"
# Inpainting model (can be a specialized inpainting checkpoint)
INPAINT_MODEL_ID = "runwayml/stable-diffusion-inpainting"

_local_pipelines = {
    "txt2img": None,
    "img2img": None,
    "inpaint": None
}

def get_local_pipeline(task, progress_callback=None):
    if not TORCH_AVAILABLE:
        raise RuntimeError("Local PyTorch pipelines are not available because torch/diffusers is not installed.")
    global _local_pipelines
    if _local_pipelines[task] is not None:
        return _local_pipelines[task]

    print(f"[INFO] Loading local pipeline for {task}...")
    if progress_callback:
        progress_callback(1, message=f"Loading local weights for {task} (takes 2-3 mins on first run)...")

    if task == "txt2img":
        _local_pipelines["txt2img"] = StableDiffusionPipeline.from_pretrained(
            MODEL_ID,
            torch_dtype=torch.float16 if device == "cuda" else torch.float32,
        )
        _local_pipelines["txt2img"].scheduler = EulerDiscreteScheduler.from_config(_local_pipelines["txt2img"].scheduler.config)
        _local_pipelines["txt2img"] = _local_pipelines["txt2img"].to(device)
    elif task == "img2img":
        _local_pipelines["img2img"] = StableDiffusionImg2ImgPipeline.from_pretrained(
            MODEL_ID,
            torch_dtype=torch.float16 if device == "cuda" else torch.float32,
        )
        _local_pipelines["img2img"].scheduler = EulerDiscreteScheduler.from_config(_local_pipelines["img2img"].scheduler.config)
        _local_pipelines["img2img"] = _local_pipelines["img2img"].to(device)
    elif task == "inpaint":
        _local_pipelines["inpaint"] = StableDiffusionInpaintPipeline.from_pretrained(
            INPAINT_MODEL_ID,
            torch_dtype=torch.float16 if device == "cuda" else torch.float32,
        )
        _local_pipelines["inpaint"].scheduler = EulerDiscreteScheduler.from_config(_local_pipelines["inpaint"].scheduler.config)
        _local_pipelines["inpaint"] = _local_pipelines["inpaint"].to(device)

    # Enable memory optimizations where available
    pipe = _local_pipelines[task]
    if progress_callback:
        progress_callback(5, message="Pipeline weights loaded. Optimizing memory layout...")

    if device == "cuda":
        try:
            pipe.enable_xformers_memory_efficient_attention()
            print(f"[SUCCESS] xFormers enabled for {task}")
        except Exception as e:
            print(f"[WARNING] xFormers not available: {e}")

        pipe.enable_attention_slicing()
        pipe.enable_vae_slicing()

    print(f"[SUCCESS] Local pipeline for {task} loaded and optimized.")
    if progress_callback:
        progress_callback(10, message="Pipeline optimization complete. Starting inference steps...")
    return pipe


# -----------------------------
# Utilities
# -----------------------------

# Simple prompt analyzer to detect preserve instructions
PRESERVE_KEYWORDS = ["preserve", "keep", "retain", "remain", "don't change", "do not change", "unchanged"]
PERSON_KEYWORDS = ["person", "face", "man", "woman", "male", "female", "portrait", "subject"]

try:
    from rembg import remove as rembg_remove
    REMBG_AVAILABLE = True
except Exception:
    REMBG_AVAILABLE = False

try:
    import cv2
    OPENCV_AVAILABLE = True
except Exception:
    OPENCV_AVAILABLE = False
    # cv2-specific operations will fall back to PIL/numpy methods

def analyze_prompt(prompt: str):
    """Return dict with whether preserve requested and target (e.g., 'person' or 'background' or None)."""
    text = prompt.lower()
    preserve = any(k in text for k in PRESERVE_KEYWORDS)
    target = None
    if preserve:
        # check if user specifically wants to preserve person/face or background
        if any(k in text for k in PERSON_KEYWORDS):
            target = "person"
        elif "background" in text:
            target = "background"
        else:
            target = "region"  # generic
    # Also detect if prompt is explicitly about background replacement even if not using preserve keywords
    background_intent = any(w in text for w in ["background", "replace background", "replace the background", "change background", "scene", "environment"])
    return {"preserve": preserve, "target": target, "background_intent": background_intent}


def create_mask_from_foreground(pil_image: Image.Image, alpha_thresh: int = 128, cleanup: bool = True) -> Image.Image:
    """
    Create a high-quality inpainting mask:
    - White (255) = area to inpaint (background)
    - Black (0)   = preserve (foreground/person)
    Steps:
        1. Extract foreground with rembg.
        2. Morphological cleanup (remove specks, fill holes).
        3. Apply Gaussian blur for natural blending at edges.
    """
    if not TORCH_AVAILABLE:
        print("[WARNING] torch/numpy not available — returning full black mask.")
        return Image.new("L", pil_image.size, color=0)
    if not REMBG_AVAILABLE:
        # Fallback: preserve everything to avoid deleting subject
        print("[WARNING] rembg not available — returning full black mask (preserve all).")
        return Image.new("L", pil_image.size, color=0)

    # Ensure input is RGBA
    rgba = pil_image.convert("RGBA")

    try:
        fg = rembg_remove(rgba)
    except Exception as e:
        print(f"[WARNING] rembg failed: {e} — preserving all.")
        return Image.new("L", pil_image.size, color=0)

    if fg.mode != "RGBA":
        fg = fg.convert("RGBA")

    alpha = np.array(fg.split()[-1]).astype(np.uint8)

    # Step 1: Binary foreground mask
    fg_mask = (alpha >= alpha_thresh).astype(np.uint8) * 255  # Foreground = 255, background = 0

    # Step 2: Morphological cleanup (remove specks, fill gaps)
    if cleanup:
        if OPENCV_AVAILABLE:
            try:
                m = fg_mask.copy()
                kernel = np.ones((7, 7), np.uint8)
                m = cv2.morphologyEx(m, cv2.MORPH_CLOSE, kernel, iterations=1)  # Fill holes
                m = cv2.morphologyEx(m, cv2.MORPH_OPEN, kernel, iterations=1)   # Remove noise
                # Slight blur for soft transitions
                m = cv2.GaussianBlur(m, (15, 15), sigmaX=5)
                fg_mask = m
            except Exception as e:
                print(f"[WARNING] OpenCV cleanup failed: {e}")
        else:
            # PIL fallback
            pil_mask = Image.fromarray(fg_mask, mode="L")
            pil_mask = pil_mask.filter(ImageFilter.MaxFilter(7))   # close
            pil_mask = pil_mask.filter(ImageFilter.MinFilter(7))   # open
            pil_mask = pil_mask.filter(ImageFilter.GaussianBlur(radius=5))
            fg_mask = np.array(pil_mask)

    # Step 3: Invert — we want background (white) = to be inpainted
    mask_inpaint = (255 - fg_mask).astype(np.uint8)

    # Step 4: Final smooth blending on edges
    pil_mask_final = Image.fromarray(mask_inpaint, mode="L")
    pil_mask_final = pil_mask_final.filter(ImageFilter.GaussianBlur(radius=4))

    return pil_mask_final



def letterbox_resize_with_mask(image: Image.Image, mask: Image.Image, desired: int = 512):
    """
    Resize image and mask to square `desired x desired` with letterbox (padding),
    preserving alignment between image and mask.
    Returns PIL images (RGB, L).
    """
    if not TORCH_AVAILABLE:
        raise RuntimeError("letterbox_resize_with_mask requires numpy which is not installed.")
    img = np.array(image.convert("RGB"))
    m = np.array(mask.convert("L"))

    h, w = img.shape[:2]
    scale = desired / max(h, w)
    new_w, new_h = int(round(w * scale)), int(round(h * scale))

    # Resize image and mask
    if OPENCV_AVAILABLE:
        img_resized = cv2.resize(img, (new_w, new_h), interpolation=cv2.INTER_AREA)
        mask_resized = cv2.resize(m, (new_w, new_h), interpolation=cv2.INTER_NEAREST)
    else:
        img_resized = np.array(Image.fromarray(img).resize((new_w, new_h), resample=Image.LANCZOS))
        mask_resized = np.array(Image.fromarray(m).resize((new_w, new_h), resample=Image.NEAREST))

    # pad to square
    pad_w = desired - new_w
    pad_h = desired - new_h
    top = pad_h // 2
    bottom = pad_h - top
    left = pad_w // 2
    right = pad_w - left

    if OPENCV_AVAILABLE:
        img_padded = cv2.copyMakeBorder(img_resized, top, bottom, left, right, cv2.BORDER_CONSTANT, value=[0, 0, 0])
        mask_padded = cv2.copyMakeBorder(mask_resized, top, bottom, left, right, cv2.BORDER_CONSTANT, value=255)  # pad mask as background by default
    else:
        # numpy pad fallback
        img_padded = np.pad(img_resized, ((top, bottom), (left, right), (0, 0)), mode="constant", constant_values=0)
        mask_padded = np.pad(mask_resized, ((top, bottom), (left, right)), mode="constant", constant_values=255)

    return Image.fromarray(img_padded), Image.fromarray(mask_padded, mode="L")


# -----------------------------
# Generation functions
# -----------------------------

def _make_full_and_negative_prompts(prompt: str):
    full_prompt = (
        f"{prompt}, ultra-realistic, photorealistic, high detail, 8k, cinematic lighting, sharp focus"
    )
    negative_prompt = (
        "cartoon, painting, illustration, anime, blurry, low quality, cgi, 3d render, doll-like, deformed, different person"
    )
    return full_prompt, negative_prompt


from huggingface_hub import InferenceClient

def get_inference_client():
    hf_token = os.getenv("HUGGINGFACE_TOKEN")
    return InferenceClient(api_key=hf_token)

def generate_text_to_image_api(prompt: str, height: int = 512, width: int = 512, progress_callback=None) -> str:
    """API-based text-to-image using FLUX.1-schnell with progress simulation."""
    if not prompt or not prompt.strip():
        return {"error": "Empty prompt"}
    
    import time
    stop_progress = False
    
    def progress_simulator():
        percent = 10
        while not stop_progress and percent < 90:
            if progress_callback:
                progress_callback(percent, message="Generating canvas via Serverless API...")
            time.sleep(0.5)
            percent += 15
            if percent > 90:
                percent = 90
                
    if progress_callback:
        threading.Thread(target=progress_simulator).start()
        
    try:
        client = get_inference_client()
        print(f"[INFO] Generating Text-to-Image via API (FLUX.1-schnell): {prompt}")
        output_image = client.text_to_image(
            prompt=prompt,
            model="black-forest-labs/FLUX.1-schnell",
            width=width,
            height=height
        )
        
        stop_progress = True
        if progress_callback:
            progress_callback(95, message="Saving generated pixels to disk...")
            
        timestamp = datetime.now().strftime("%Y%m%d%H%M%S%f")
        filename = f"text2img_{timestamp}.png"
        filepath = os.path.join(GENERATED_FOLDER, filename)
        output_image.save(filepath)
        
        if progress_callback:
            progress_callback(100, message="Success!")
        return filepath
    except Exception as e:
        stop_progress = True
        print(f"[ERROR] API Text-to-Image failed: {e}")
        return {"error": f"API Text-to-Image failed: {str(e)}"}


def generate_text_to_image(prompt: str, steps: int = 30, guidance_scale: float = 8.0, height: int = 512, width: int = 512, progress_callback=None) -> str:
    """Hybrid Text-to-Image. Calls API or Local based on environment variables."""
    mode = os.getenv("GENERATION_MODE", "API").upper()
    if mode == "API":
        return generate_text_to_image_api(prompt, height=height, width=width, progress_callback=progress_callback)

    # Local fallback
    if not TORCH_AVAILABLE:
        return {"error": "Local PyTorch/torch is not installed or available on this system. Make sure you install the full requirements.txt."}

    if not prompt or not prompt.strip():
        return {"error": "Empty prompt"}

    full_prompt, negative_prompt = _make_full_and_negative_prompts(prompt)

    try:
        pipe = get_local_pipeline("txt2img", progress_callback=progress_callback)
        
        # Define step callback
        def pipe_callback(step, timestep, latents):
            if progress_callback:
                percent = int(((step + 1) / steps) * 100)
                if percent > 100:
                    percent = 100
                progress_callback(percent, message=f"Rendering canvas step {step + 1} of {steps}...")

        with torch.inference_mode():
            image = pipe(
                prompt=full_prompt,
                negative_prompt=negative_prompt,
                height=height,
                width=width,
                num_inference_steps=steps,
                guidance_scale=guidance_scale,
                callback=pipe_callback,
                callback_steps=1
            ).images[0]

        timestamp = datetime.now().strftime("%Y%m%d%H%M%S%f")
        filename = f"text2img_{timestamp}.png"
        filepath = os.path.join(GENERATED_FOLDER, filename)
        image.save(filepath)
        
        if progress_callback:
            progress_callback(100, message="Success!")
        return filepath
    except Exception as e:
        return {"error": str(e)}


def generate_image_to_image_api(input_image_path: str, prompt: str, strength: float = None, steps: int = 35, guidance_scale: float = 8.0, progress_callback=None) -> str:
    """API-based image-to-image using timbrooks/instruct-pix2pix with progress simulation."""
    if not prompt or not prompt.strip():
        return {"error": "Empty prompt"}
    if not os.path.exists(input_image_path):
        return {"error": "Input image not found"}
        
    import time
    stop_progress = False
    
    def progress_simulator():
        percent = 10
        while not stop_progress and percent < 90:
            if progress_callback:
                progress_callback(percent, message="Transforming image via Serverless API...")
            time.sleep(0.5)
            percent += 15
            if percent > 90:
                percent = 90
                
    if progress_callback:
        threading.Thread(target=progress_simulator).start()
        
    try:
        init_image = Image.open(input_image_path).convert("RGB")
        client = get_inference_client()
        
        # Use configurable API model
        api_model = os.getenv("API_IMG2IMG_MODEL", "timbrooks/instruct-pix2pix")
        print(f"[INFO] Generating Image-to-Image via API ({api_model}): {prompt}")
        
        output_image = client.image_to_image(
            image=init_image,
            prompt=prompt,
            model=api_model,
            guidance_scale=guidance_scale,
            num_inference_steps=steps
        )
        
        stop_progress = True
        if progress_callback:
            progress_callback(95, message="Saving transformed pixels to disk...")
            
        timestamp = datetime.now().strftime("%Y%m%d%H%M%S%f")
        filename = f"img2img_{timestamp}.png"
        filepath = os.path.join(GENERATED_FOLDER, filename)
        output_image.save(filepath)
        
        if progress_callback:
            progress_callback(100, message="Success!")
        return filepath
    except Exception as e:
        stop_progress = True
        print(f"[ERROR] API Image-to-Image failed: {e}")
        return {"error": f"API Image-to-Image failed: {str(e)}"}


def generate_image_to_image(input_image_path: str, prompt: str, strength: float = None, steps: int = 35, guidance_scale: float = 8.0, preserve_explicit: bool = False, progress_callback=None) -> str:
    """Hybrid img2img:
    Runs locally or via serverless API depending on generation mode.
    """
    mode = os.getenv("GENERATION_MODE", "API").upper()
    if mode == "API":
        return generate_image_to_image_api(
            input_image_path,
            prompt,
            strength=strength,
            steps=steps,
            guidance_scale=guidance_scale,
            progress_callback=progress_callback
        )

    # Local fallback
    if not TORCH_AVAILABLE:
        return {"error": "Local PyTorch/torch is not installed or available on this system. Make sure you install the full requirements.txt."}

    if device == "cpu":
        print("[WARNING] No local GPU detected. Running image-to-image on CPU, which will be slow...")
    else:
        print("[INFO] Running local GPU-accelerated image-to-image generation...")

    if not os.path.exists(input_image_path):
        return {"error": "Input image not found"}
    if not prompt or not prompt.strip():
        return {"error": "Empty prompt"}

    analysis = analyze_prompt(prompt)
    preserve = analysis["preserve"] or preserve_explicit
    target = analysis.get("target")
    background_intent = analysis.get("background_intent", False)

    # Choose default strengths
    if strength is None:
        strength = 0.35 if preserve or background_intent else 0.7

    full_prompt, negative_prompt = _make_full_and_negative_prompts(prompt)

    # Load original image at native resolution (do not resize yet)
    orig_image = Image.open(input_image_path).convert("RGB")

    try:
        # Determine total evaluation steps for callback
        if preserve or background_intent:
            total_eval_steps = steps
        else:
            total_eval_steps = int(steps * strength)
        if total_eval_steps < 1:
            total_eval_steps = 1

        def pipe_callback(step, timestep, latents):
            if progress_callback:
                percent = int(((step + 1) / total_eval_steps) * 100)
                if percent > 100:
                    percent = 100
                progress_callback(percent, message=f"Transforming image step {step + 1} of {total_eval_steps}...")

        if preserve or background_intent:
            if progress_callback:
                progress_callback(2, message="Analyzing image and detecting foreground mask...")
            # Create mask at original resolution
            mask_orig = create_mask_from_foreground(orig_image, alpha_thresh=128, cleanup=True)

            if progress_callback:
                progress_callback(4, message="Resizing canvas assets for model alignment...")
            # Resize both to model-friendly square (512x512) keeping alignment
            desired = 512
            init_image, mask = letterbox_resize_with_mask(orig_image, mask_orig, desired=desired)

            # For inpainting pipeline
            print(f"[INFO] Running local inpainting (preserve target={target}) strength={strength}")
            if progress_callback:
                progress_callback(5, message="Loading local inpainting pipeline...")
            pipe = get_local_pipeline("inpaint", progress_callback=progress_callback)
            with torch.inference_mode():
                out = pipe(
                    prompt=full_prompt,
                    negative_prompt=negative_prompt,
                    image=init_image,
                    mask_image=mask,
                    guidance_scale=guidance_scale,
                    num_inference_steps=steps,
                    callback=pipe_callback,
                    callback_steps=1
                )
                image = out.images[0]

        else:
            if progress_callback:
                progress_callback(2, message="Scaling image for transformation inputs...")
            # Full img2img rewrite (no mask)
            desired = 512
            init_image = orig_image.resize((desired, desired))
            print(f"[INFO] Running local img2img full rewrite strength={strength}")
            if progress_callback:
                progress_callback(5, message="Loading local image-to-image pipeline...")
            pipe = get_local_pipeline("img2img", progress_callback=progress_callback)
            with torch.inference_mode():
                out = pipe(
                    prompt=full_prompt,
                    negative_prompt=negative_prompt,
                    image=init_image,
                    strength=strength,
                    guidance_scale=guidance_scale,
                    num_inference_steps=steps,
                    callback=pipe_callback,
                    callback_steps=1
                )
                image = out.images[0]

        timestamp = datetime.now().strftime("%Y%m%d%H%M%S%f")
        filename = f"img2img_{timestamp}.png"
        filepath = os.path.join(GENERATED_FOLDER, filename)
        image.save(filepath)
        
        if progress_callback:
            progress_callback(100, message="Success!")
        return filepath

    except torch.cuda.OutOfMemoryError:
        if torch.cuda.is_available():
            torch.cuda.empty_cache()
        return {"error": "CUDA Out Of Memory. Try reducing resolution/steps or disable xformers."}
    except Exception as e:
        return {"error": str(e)}


# If run directly, a small test (you can remove or adapt this)
if __name__ == "__main__":
    # Example usage
    sample_input = os.path.join(SCRIPT_DIR, "test_inputs", "input.jpg")  # change to your test image
    sample_prompt = "Replace the background with a futuristic city, the person should remain unchanged, realistic lighting"
    print("Running sample generation... (make sure sample_input exists)")
    result = generate_image_to_image(sample_input, sample_prompt, steps=30, guidance_scale=9.0)
    print("Result:", result)
