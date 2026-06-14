import os
import requests
import base64
import uuid
import threading
from datetime import datetime
import zipfile
import io
from flask import Flask, request, render_template, jsonify, url_for, send_from_directory, send_file
from werkzeug.utils import secure_filename
from dotenv import load_dotenv
from ai_generator import generate_text_to_image, generate_image_to_image

# Global progress tracker dictionary for asynchronous tasks
progress_tracker = {}


# --- Setup and Configuration ---

# Load environment variables from a .env file
load_dotenv()

# Initialize the Flask application pointing to the compiled React assets folder
app = Flask(__name__, static_folder="frontend/dist", static_url_path="")

# Get the Unsplash API key from environment variables
UNSPLASH_ACCESS_KEY = os.getenv("UNSPLASH_ACCESS_KEY")
if not UNSPLASH_ACCESS_KEY:
    print("[WARNING] UNSPLASH_ACCESS_KEY not found in .env file. Key must be configured in UI Settings or .env file.")

# Configure a folder for temporary uploads (for image-to-image generation)
UPLOAD_FOLDER = "uploads"
ALLOWED_EXTENSIONS = {"png", "jpg", "jpeg"}
app.config["UPLOAD_FOLDER"] = UPLOAD_FOLDER
os.makedirs(UPLOAD_FOLDER, exist_ok=True)


def allowed_file(filename):
    """Checks if the uploaded file has an allowed extension."""
    return "." in filename and filename.rsplit(".", 1)[1].lower() in ALLOWED_EXTENSIONS


# Initialize generation mode from environment variable (default: API)
generation_mode = os.getenv("GENERATION_MODE", "API").upper()

@app.route('/api/config', methods=['GET', 'POST'])
def get_or_set_config():
    global generation_mode
    if request.method == 'POST':
        new_mode = request.json.get("generation_mode", "API").upper()
        if new_mode in ["API", "LOCAL"]:
            generation_mode = new_mode
            os.environ["GENERATION_MODE"] = new_mode
            return jsonify({"status": "success", "generation_mode": generation_mode})
        return jsonify({"error": "Invalid mode. Use API or LOCAL"}), 400
    else:
        try:
            import torch
            cuda_available = torch.cuda.is_available()
            device_name = torch.cuda.get_device_name(0) if cuda_available else "CPU"
        except ImportError:
            cuda_available = False
            device_name = "Not Available (PyTorch/torch not installed)"
        return jsonify({
            "generation_mode": generation_mode,
            "cuda_available": cuda_available,
            "device_name": device_name
        })


@app.route('/api/download-project')
def download_project():
    """Zips the project workspace (excluding env, node_modules, git, and heavy folders) and returns it."""
    try:
        memory_file = io.BytesIO()
        root_dir = os.path.dirname(os.path.abspath(__file__))
        
        ignore_dirs = {'.git', '.venv', 'venv', 'node_modules', '__pycache__', 'uploads'}
        ignore_files = {'.env', 'intel-studio.zip'}
        
        with zipfile.ZipFile(memory_file, 'w', zipfile.ZIP_DEFLATED) as zipf:
            for root, dirs, files in os.walk(root_dir):
                # Filter out ignored directories in-place to skip traversing them
                dirs[:] = [d for d in dirs if d not in ignore_dirs]
                
                # Exclude static/generated content
                rel_root = os.path.relpath(root, root_dir)
                is_generated = rel_root == os.path.join("static", "generated") or rel_root.startswith(os.path.join("static", "generated") + os.sep)
                
                for file in files:
                    if file in ignore_files or file.endswith('.pyc') or file.endswith('.zip'):
                        continue
                    if is_generated:
                        continue
                    file_path = os.path.join(root, file)
                    arcname = os.path.relpath(file_path, root_dir)
                    zipf.write(file_path, arcname)
                    
        memory_file.seek(0)
        return send_file(
            memory_file,
            mimetype='application/zip',
            as_attachment=True,
            download_name='intel-studio.zip'
        )
    except Exception as e:
        print(f"[ERROR] Failed to package project: {e}")
        return jsonify({"error": f"Failed to package project: {str(e)}"}), 500


# --- Main Routes ---

@app.route('/')
def index():
    """Renders the main built React index.html page."""
    return send_from_directory(app.static_folder, "index.html")


@app.route('/static/generated/<path:filename>')
def serve_generated(filename):
    """Serves generated artwork files from the static/generated folder."""
    return send_from_directory(os.path.join(app.root_path, 'static', 'generated'), filename)


@app.route('/search', methods=['POST'])
def search():
    """
    Handles text-based image search by querying the Unsplash API.
    This replaces the old local CLIP-based search.
    """
    try:
        query = request.json.get("query")
        if not query:
            return jsonify({"error": "Query is empty"}), 400

        # Prioritize custom client key from headers, otherwise fall back to server key
        client_key = request.headers.get("X-Unsplash-Key")
        unsplash_key = client_key if client_key and client_key.strip() else UNSPLASH_ACCESS_KEY
        if not unsplash_key:
            return jsonify({"error": "Unsplash API Access Key is not configured. Please set it in Settings."}), 400

        # --- Unsplash API Call ---
        headers = {"Authorization": f"Client-ID {unsplash_key}"}
        params = {"query": query, "per_page": 9, "orientation": "squarish"}
        api_url = "https://api.unsplash.com/search/photos"

        response = requests.get(api_url, headers=headers, params=params)
        response.raise_for_status()  # Raises an HTTPError for bad responses (4xx or 5xx)

        data = response.json()

        # Format the API response to match what the frontend JavaScript expects
        results = [{"image_path": photo['urls']['regular']} for photo in data['results']]

        return jsonify(results)

    except requests.exceptions.RequestException as e:
        # Handle network or API-specific errors
        return jsonify({"error": f"Failed to connect to Unsplash API: {e}"}), 500
    except Exception as e:
        # Handle other potential errors
        print(f"[ERROR] in /search: {e}")
        return jsonify({"error": "An unexpected error occurred during search."}), 500
# --- AI Image Generation Routes ---

@app.route('/api/progress/<task_id>', methods=['GET'])
def get_progress(task_id):
    task = progress_tracker.get(task_id)
    if not task:
        return jsonify({"error": "Task not found"}), 404
    return jsonify(task)


@app.route("/generate-text-image", methods=["POST"])
def generate_text_image_route():
    """Handles text-to-image generation asynchronously."""
    try:
        prompt = request.json.get("prompt", "")
        if not prompt:
            return jsonify({"error": "Prompt is required"}), 400

        # Extract parameters for generation
        steps_val = request.json.get("steps")
        guidance_val = request.json.get("guidance_scale")
        height_val = request.json.get("height")
        width_val = request.json.get("width")
        
        # New advanced parameters
        negative_prompt = request.json.get("negative_prompt")
        seed_val = request.json.get("seed")
        model = request.json.get("model")
        
        # API Keys from client headers
        hf_token_header = request.headers.get("X-HF-Token")
        hf_token = hf_token_header if hf_token_header and hf_token_header.strip() else None

        steps = int(steps_val) if steps_val is not None else 30
        guidance_scale = float(guidance_val) if guidance_val is not None else 8.0
        height = int(height_val) if height_val is not None else 512
        width = int(width_val) if width_val is not None else 512
        seed = int(seed_val) if seed_val is not None and str(seed_val).strip() != "" else None

        task_id = str(uuid.uuid4())
        progress_tracker[task_id] = {
            "percent": 0,
            "status": "processing",
            "message": "Queued and initializing task...",
            "result": None,
            "error": None
        }

        # Start generation in a background thread
        ctx = app.app_context()
        def run_generation():
            with ctx:
                try:
                    def progress_callback(percent, message=None):
                        progress_tracker[task_id]["percent"] = percent
                        if message is not None:
                            progress_tracker[task_id]["message"] = message

                    output_path = generate_text_to_image(
                        prompt,
                        steps=steps,
                        guidance_scale=guidance_scale,
                        height=height,
                        width=width,
                        hf_token=hf_token,
                        negative_prompt=negative_prompt,
                        seed=seed,
                        model=model,
                        progress_callback=progress_callback
                    )
                    if isinstance(output_path, dict) and "error" in output_path:
                        progress_tracker[task_id]["status"] = "error"
                        progress_tracker[task_id]["error"] = output_path["error"]
                    else:
                        filename = os.path.basename(output_path)
                        image_url = f"/static/generated/{filename}"
                        progress_tracker[task_id]["status"] = "success"
                        progress_tracker[task_id]["result"] = image_url
                except Exception as e:
                    print(f"[ERROR] in background text2img: {e}")
                    progress_tracker[task_id]["status"] = "error"
                    progress_tracker[task_id]["error"] = str(e)

        threading.Thread(target=run_generation).start()
        return jsonify({"task_id": task_id})

    except Exception as e:
        print(f"[ERROR] in /generate-text-image: {e}")
        return jsonify({"error": "Failed to start image generation"}), 500


@app.route("/generate-image-image", methods=["POST"])
def generate_image_image_route():
    """Handles image-to-image generation asynchronously."""
    try:
        image_file = request.files.get("image")
        prompt = request.form.get("prompt")
        strength_val = request.form.get("strength")
        
        # New advanced parameters
        negative_prompt = request.form.get("negative_prompt")
        seed_val = request.form.get("seed")
        
        strength = float(strength_val) if strength_val is not None else None
        seed = int(seed_val) if seed_val is not None and str(seed_val).strip() != "" else None

        if not image_file or not prompt:
            return jsonify({"error": "An image file and a prompt are required"}), 400

        if not allowed_file(image_file.filename):
            return jsonify({"error": "Invalid file type. Please use png, jpg, or jpeg."}), 400

        # Save the uploaded image securely to the uploads folder
        filename = secure_filename(image_file.filename)
        input_image_path = os.path.join(app.config["UPLOAD_FOLDER"], filename)
        image_file.save(input_image_path)

        task_id = str(uuid.uuid4())
        progress_tracker[task_id] = {
            "percent": 0,
            "status": "processing",
            "message": "Queued and initializing task...",
            "result": None,
            "error": None
        }

        # Start generation in a background thread
        ctx = app.app_context()
        def run_generation():
            with ctx:
                try:
                    def progress_callback(percent, message=None):
                        progress_tracker[task_id]["percent"] = percent
                        if message is not None:
                            progress_tracker[task_id]["message"] = message

                    output_path = generate_image_to_image(
                        input_image_path,
                        prompt,
                        strength=strength,
                        negative_prompt=negative_prompt,
                        seed=seed,
                        progress_callback=progress_callback
                    )
                    if isinstance(output_path, dict) and "error" in output_path:
                        progress_tracker[task_id]["status"] = "error"
                        progress_tracker[task_id]["error"] = output_path["error"]
                    else:
                        with open(output_path, "rb") as f:
                            image_bytes = f.read()
                        image_base64 = base64.b64encode(image_bytes).decode("utf-8")
                        progress_tracker[task_id]["status"] = "success"
                        progress_tracker[task_id]["result"] = image_base64
                except Exception as e:
                    print(f"[ERROR] in background img2img: {e}")
                    progress_tracker[task_id]["status"] = "error"
                    progress_tracker[task_id]["error"] = str(e)

        threading.Thread(target=run_generation).start()
        return jsonify({"task_id": task_id})

    except Exception as e:
        print(f"[ERROR] in /generate-image-image: {e}")
        return jsonify({"error": "Failed to start image-to-image generation"}), 500


# --- Main execution ---
if __name__ == '__main__':
    app.run(debug=True, use_reloader=False)
