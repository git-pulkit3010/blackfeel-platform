# backend.py
"""
Flask Backend for T-Shirt Design Editor
"""

import os
import io
from flask import Flask, request, jsonify, send_file, send_from_directory
from flask_cors import CORS
from PIL import Image
from rembg import remove
import fal_client
from dotenv import load_dotenv
import requests
from datetime import datetime

load_dotenv()

# --- CHANGE 1: Point static_folder to current directory ---
app = Flask(__name__, static_url_path='', static_folder='.')
CORS(app)

# Verify API Key
FAL_KEY = os.getenv("FAL_KEY")
if not FAL_KEY:
    print("❌ FAL_KEY not found in .env file")

UPLOAD_DIR = "uploads"
os.makedirs(UPLOAD_DIR, exist_ok=True)

# --- CHANGE 2: Add Route to serve Frontend ---
@app.route('/')
def serve_frontend():
    return send_file('index.html')

# ============ UTILITY FUNCTIONS ============

def remove_background_local(image_pil, description="image"):
    try:
        image_rgba = image_pil.convert("RGBA")
        cleaned = remove(image_rgba)
        return cleaned
    except Exception as e:
        raise Exception(f"Background removal failed for {description}: {str(e)}")

def create_composite_with_transform(tshirt_img, design_img, x, y, width, height):
    try:
        tshirt = tshirt_img.convert("RGBA")
        design = design_img.convert("RGBA")
        
        # Resize design to exact target size
        design = design.resize((width, height), Image.Resampling.LANCZOS)
        
        # Create composite
        composite = tshirt.copy()
        composite.paste(design, (x, y), design)
        
        # Create mask
        mask = Image.new("L", tshirt.size, 0)
        design_mask = design.split()[3]
        mask.paste(design_mask, (x, y))
        
        return composite, mask
    except Exception as e:
        raise Exception(f"Composite creation failed: {str(e)}")

def bake_with_fal(composite_pil, mask_pil, position_description="center"):
    try:
        composite_bytes = io.BytesIO()
        mask_bytes = io.BytesIO()
        composite_pil.save(composite_bytes, format="PNG")
        mask_pil.save(mask_bytes, format="PNG")
        
        print("[Bake] Uploading to Fal...")
        composite_url = fal_client.upload(composite_bytes.getvalue(), "image/png")
        mask_url = fal_client.upload(mask_bytes.getvalue(), "image/png")
        
        pos_text = position_description.replace("_", " ")
        prompt = (
            f"Blend and integrate the existing graphic design at the {pos_text} "
            "onto the t-shirt fabric. Keep the exact design. "
            "Only adjust lighting and shadows to match fabric."
        )
        
        print("[Bake] Calling fal-ai/flux-lora/inpainting...")
        result = fal_client.subscribe(
            "fal-ai/flux-lora/inpainting",
            arguments={
                "prompt": prompt,
                "image_url": composite_url,
                "mask_url": mask_url,
                "guidance_scale": 1.2,
                "strength": 0.3, # Low strength preserves the original design logo better
                "enable_safety_checker": False,
            }
        )
        
        final_url = result["images"][0]["url"]
        response = requests.get(final_url)
        return response.content
    except Exception as e:
        raise Exception(f"Fal baking failed: {str(e)}")

# ============ API ROUTES ============

@app.route('/api/bake', methods=['POST'])
def bake_design():
    try:
        if 'tshirt_image' not in request.files or 'design_image' not in request.files:
            return jsonify({"error": "Missing images"}), 400
        
        tshirt_file = request.files['tshirt_image']
        design_file = request.files['design_image']
        
        # Parse params
        position = request.form.get('position', 'center')
        x = int(float(request.form.get('x', 0))) # Handle float strings
        y = int(float(request.form.get('y', 0)))
        width = int(float(request.form.get('width', 200)))
        height = int(float(request.form.get('height', 200)))
        
        print(f"[API] Baking: pos={position} x={x} y={y} w={width} h={height}")

        tshirt_pil = Image.open(io.BytesIO(tshirt_file.read()))
        design_pil = Image.open(io.BytesIO(design_file.read()))
        
        # 1. Clean Backgrounds
        tshirt_clean = remove_background_local(tshirt_pil, "t-shirt")
        design_clean = remove_background_local(design_pil, "design")
        
        # 2. Composite
        composite, mask = create_composite_with_transform(tshirt_clean, design_clean, x, y, width, height)
        
        # 3. Bake
        final_image_bytes = bake_with_fal(composite, mask, position)
        
        # 4. Save
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        output_filename = f"tshirt_final_{timestamp}.png"
        output_path = os.path.join(UPLOAD_DIR, output_filename)
        
        with open(output_path, 'wb') as f:
            f.write(final_image_bytes)
        
        return jsonify({
            "success": True,
            "image_url": f"/api/download/{output_filename}"
        }), 200
        
    except Exception as e:
        print(f"[API] Error: {str(e)}")
        return jsonify({"error": str(e)}), 500

@app.route('/api/remove-bg', methods=['POST'])
def remove_bg_api():
    try:
        file = request.files['image']
        img_pil = Image.open(io.BytesIO(file.read()))
        cleaned = remove_background_local(img_pil)
        
        img_byte_arr = io.BytesIO()
        cleaned.save(img_byte_arr, format='PNG')
        img_byte_arr.seek(0)
        return send_file(img_byte_arr, mimetype='image/png')
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/api/download/<filename>', methods=['GET'])
def download_image(filename):
    return send_from_directory(UPLOAD_DIR, filename)

if __name__ == '__main__':
    app.run(debug=True, port=5000)