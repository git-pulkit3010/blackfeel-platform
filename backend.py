# backend.py
"""
Flask Backend for T-Shirt Design Editor
Integrates with tshirt_overlay_fal.py for final baking
"""

import os
import io
from flask import Flask, request, jsonify, send_file
from flask_cors import CORS
from PIL import Image
from rembg import remove
import fal_client
from dotenv import load_dotenv
import requests
from datetime import datetime

load_dotenv()

app = Flask(__name__)
CORS(app)

# Verify API Key
FAL_KEY = os.getenv("FAL_KEY")
if not FAL_KEY:
    print("❌ FAL_KEY not found in .env file")
    print("Please set: FAL_KEY='your_key' in .env")

UPLOAD_DIR = "uploads"
os.makedirs(UPLOAD_DIR, exist_ok=True)

# ============ UTILITY FUNCTIONS ============

def remove_background_local(image_pil, description="image"):
    """
    Remove background from PIL image locally (no API cost)
    """
    try:
        image_rgba = image_pil.convert("RGBA")
        cleaned = remove(image_rgba)
        return cleaned
    except Exception as e:
        raise Exception(f"Background removal failed for {description}: {str(e)}")

def create_composite_with_transform(tshirt_img, design_img, x, y, width, height):
    """
    Place design on t-shirt at exact coordinates with given size
    Returns: (composite_pil, mask_pil)
    """
    try:
        tshirt = tshirt_img.convert("RGBA")
        design = design_img.convert("RGBA")
        
        # Resize design to exact target size
        design = design.resize((width, height), Image.Resampling.LANCZOS)
        
        # Create composite
        composite = tshirt.copy()
        composite.paste(design, (x, y), design)
        
        # Create mask for inpainting
        mask = Image.new("L", tshirt.size, 0)  # Black background
        design_mask = design.split()[3]  # Alpha channel
        mask.paste(design_mask, (x, y))
        
        # Dilate mask for better blending
        from PIL import ImageFilter
        mask = mask.filter(ImageFilter.MaxFilter(5))
        
        return composite, mask
    except Exception as e:
        raise Exception(f"Composite creation failed: {str(e)}")

def bake_with_fal(composite_pil, mask_pil, position_description="center"):
    """
    Upload to Fal and run Flux inpainting
    Returns: image bytes (PNG)
    """
    try:
        # Save to temp files for upload
        composite_bytes = io.BytesIO()
        mask_bytes = io.BytesIO()
        
        composite_pil.save(composite_bytes, format="PNG")
        mask_pil.save(mask_bytes, format="PNG")
        
        composite_bytes.seek(0)
        mask_bytes.seek(0)
        
        print("[Bake] Uploading to Fal...")
        composite_url = fal_client.upload(composite_bytes.getvalue(), "image/png")
        mask_url = fal_client.upload(mask_bytes.getvalue(), "image/png")
        
        pos_text = position_description.replace("_", " ")
        prompt = (
            f"Blend and integrate the existing graphic design at the {pos_text} "
            "onto the t-shirt fabric. "
            "Keep the exact same design, shapes, and colors. "
            "Only adjust lighting, shadows, and texture to match the fabric. "
            "Make it look like a realistic screen print. "
            "DO NOT change the design, DO NOT add new elements, DO NOT create new designs."
        )
        
        negative_prompt = (
            "different design, new design, changed design, altered design, "
            "different shapes, different colors, different text, "
            "generating new content, creating new art, changing elements, "
            "removing elements, adding elements"
        )
        
        print("[Bake] Calling fal-ai/flux-lora/inpainting...")
        result = fal_client.subscribe(
            "fal-ai/flux-lora/inpainting",
            arguments={
                "prompt": prompt,
                "negative_prompt": negative_prompt,
                "image_url": composite_url,
                "mask_url": mask_url,
                "guidance_scale": 1.2,
                "num_inference_steps": 28,
                "strength": 0.3,
                "enable_safety_checker": False,
            }
        )
        
        if not result or "images" not in result:
            raise ValueError(f"Invalid Fal response: {result}")
        
        final_url = result["images"][0]["url"]
        print(f"[Bake] Generation complete: {final_url}")
        
        # Download final image
        response = requests.get(final_url)
        response.raise_for_status()
        
        return response.content
    except Exception as e:
        raise Exception(f"Fal baking failed: {str(e)}")

# ============ API ROUTES ============

@app.route('/api/bake', methods=['POST'])
def bake_design():
    """
    Main endpoint: receives images + positioning data
    Returns: final baked image
    """
    try:
        # Get files and parameters
        if 'tshirt_image' not in request.files:
            return jsonify({"error": "Missing tshirt_image"}), 400
        if 'design_image' not in request.files:
            return jsonify({"error": "Missing design_image"}), 400
        
        tshirt_file = request.files['tshirt_image']
        design_file = request.files['design_image']
        position = request.form.get('position', 'center')
        scale = float(request.form.get('scale', 0.4))
        x = int(request.form.get('x', 0))
        y = int(request.form.get('y', 0))
        
        print(f"[API] Received bake request: position={position}, scale={scale}, x={x}, y={y}")
        
        # Load images
        tshirt_pil = Image.open(io.BytesIO(tshirt_file.read()))
        design_pil = Image.open(io.BytesIO(design_file.read()))
        
        print("[API] Step 1: Cleaning t-shirt background...")
        tshirt_clean = remove_background_local(tshirt_pil, "t-shirt")
        
        print("[API] Step 2: Cleaning design background...")
        design_clean = remove_background_local(design_pil, "design")
        
        # Get width/height from canvas (editor already calculated these)
        width = int(request.form.get('width'))
        height = int(request.form.get('height'))
        
        print(f"[API] Step 3: Creating composite (x={x}, y={y}, w={width}, h={height})...")
        composite, mask = create_composite_with_transform(
            tshirt_clean, 
            design_clean, 
            x, y, width, height
        )
        
        print("[API] Step 4: Baking with Fal...")
        final_image_bytes = bake_with_fal(composite, mask, position)
        
        # Save to file
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        output_filename = f"tshirt_final_{timestamp}.png"
        output_path = os.path.join(UPLOAD_DIR, output_filename)
        
        with open(output_path, 'wb') as f:
            f.write(final_image_bytes)
        
        print(f"[API] ✅ Success! Saved to: {output_path}")
        
        return jsonify({
            "success": True,
            "message": "Design baked successfully",
            "image_url": f"/api/download/{output_filename}"
        }), 200
        
    except Exception as e:
        print(f"[API] ❌ Error: {str(e)}")
        return jsonify({"error": str(e)}), 500

@app.route('/api/remove-bg', methods=['POST'])
def remove_bg_api():
    """
    Helper endpoint: Remove background from uploaded image and return it
    """
    try:
        if 'image' not in request.files:
            return jsonify({"error": "Missing image"}), 400
        
        file = request.files['image']
        img_pil = Image.open(io.BytesIO(file.read()))
        
        print(f"[API] Removing background for uploaded image: {file.filename}")
        cleaned = remove_background_local(img_pil, "uploaded image")
        
        img_byte_arr = io.BytesIO()
        cleaned.save(img_byte_arr, format='PNG')
        img_byte_arr.seek(0)
        
        return send_file(
            img_byte_arr,
            mimetype='image/png'
        )
    except Exception as e:
        print(f"[API] ❌ Background removal error: {str(e)}")
        return jsonify({"error": str(e)}), 500

@app.route('/api/download/<filename>', methods=['GET'])
def download_image(filename):
    """
    Serve baked images
    """
    try:
        filepath = os.path.join(UPLOAD_DIR, filename)
        if not os.path.exists(filepath):
            return jsonify({"error": "File not found"}), 404
        
        return send_file(
            filepath,
            mimetype='image/png',
            as_attachment=True,
            download_name=filename
        )
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/api/health', methods=['GET'])
def health():
    """
    Quick health check
    """
    return jsonify({
        "status": "ok",
        "fal_key_configured": bool(FAL_KEY)
    }), 200

# ============ MAIN ============

if __name__ == '__main__':
    print("=" * 60)
    print("T-SHIRT DESIGN EDITOR - BACKEND")
    print("=" * 60)
    print(f"FAL_KEY configured: {bool(FAL_KEY)}")
    print("Starting Flask server on http://localhost:5000")
    print("=" * 60)
    
    # Development
    app.run(debug=True, port=5000)
