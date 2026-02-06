# backend.py
import os
import io
import base64
import json
from flask import Flask, request, jsonify, send_file, send_from_directory
from flask_cors import CORS
from PIL import Image
from rembg import remove
import fal_client
from dotenv import load_dotenv
import requests
from datetime import datetime

load_dotenv()

# --- CONFIGURATION ---
# We disable default static handling to serve files from root manually
app = Flask(__name__, static_folder=None)
CORS(app)

# Verify API Keys
FAL_KEY = os.getenv("FAL_KEY")
OPENROUTER_KEY = os.getenv("OPENROUTER_KEY")
UPLOAD_DIR = "uploads"
AI_GEN_DIR = "ai_generated_images"

for d in [UPLOAD_DIR, AI_GEN_DIR]:
    os.makedirs(d, exist_ok=True)

# ============ ROUTING (The Fix) ============

@app.route('/')
def serve_index():
    return send_file('index.html')

# This catches all file requests (style.css, script.js, images/...)
@app.route('/<path:path>')
def serve_static(path):
    # Security: prevent traversing up directories
    if ".." in path or path.startswith("/"):
        return jsonify({"error": "Invalid path"}), 400
    return send_from_directory('.', path)

# ============ UTILITY FUNCTIONS ============

def remove_background_local(image_pil, description="image"):
    try:
        image_rgba = image_pil.convert("RGBA")
        cleaned = remove(image_rgba)
        return cleaned
    except Exception as e:
        print(f"Background removal error: {e}")
        return image_pil.convert("RGBA") # Fallback to original if rembg fails

def create_composite_with_transform(tshirt_img, design_img, x, y, width, height):
    tshirt = tshirt_img.convert("RGBA")
    design = design_img.convert("RGBA")
    design = design.resize((width, height), Image.Resampling.LANCZOS)
    
    composite = tshirt.copy()
    composite.paste(design, (x, y), design)
    
    mask = Image.new("L", tshirt.size, 0)
    design_mask = design.split()[3]
    mask.paste(design_mask, (x, y))
    
    return composite, mask

def bake_with_fal(composite_pil, mask_pil, position_description="center"):
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
            "strength": 0.3,
            "enable_safety_checker": False,
        }
    )
    response = requests.get(result["images"][0]["url"])
    return response.content

# ============ API ROUTES ============

@app.route('/api/generate', methods=['POST'])
def generate_design():
    try:
        data = request.json
        user_prompt = data.get('prompt')
        style = data.get('style', 'realistic')
        
        if not user_prompt: return jsonify({"error": "No prompt"}), 400

        style_modifiers = {
            "realistic": "photorealistic, highly detailed, 8k",
            "vector": "vector art, flat design, svg style, clean lines, no background",
            "anime": "anime style, manga, vibrant colors",
            "vintage": "retro, vintage aesthetic, distressed texture, 90s style"
        }
        full_prompt = f"{user_prompt}, {style_modifiers.get(style, '')}, isolated on white background"
        
        print(f"[Generate] Requesting: {full_prompt}")

        headers = {
            "Authorization": f"Bearer {OPENROUTER_KEY}",
            "HTTP-Referer": "http://localhost:5000",
            "Content-Type": "application/json"
        }
        
        # OpenRouter Call
        response = requests.post(
            "https://openrouter.ai/api/v1/chat/completions",
            headers=headers,
            json={
                "model": "google/gemini-2.5-flash-image", # Correct model name
                "messages": [{"role": "user", "content": full_prompt}],
                "modalities": ["image", "text"]
            }
        )
        
        if response.status_code != 200:
            return jsonify({"error": response.text}), response.status_code

        # --- ROBUST PARSING ---
        result = response.json()
        try:
            raw_image = result['choices'][0]['message']['images'][0]
            
            # Handle Dictionary Format (Fixes your previous bug)
            if isinstance(raw_image, dict):
                if 'url' in raw_image: image_data = raw_image['url']
                elif 'image_url' in raw_image: 
                    # Handle nested {'image_url': {'url': '...'}}
                    if isinstance(raw_image['image_url'], dict):
                        image_data = raw_image['image_url']['url']
                    else:
                        image_data = raw_image['image_url']
                elif 'b64_json' in raw_image: image_data = f"data:image/png;base64,{raw_image['b64_json']}"
                else: image_data = str(raw_image)
            else:
                image_data = raw_image # It's just a string

        except Exception as e:
            print(f"[Generate] Parse Error: {result}")
            return jsonify({"error": "Failed to parse AI response"}), 500

        # Download & Process
        if image_data.startswith('data:'):
            header, encoded = image_data.split(',', 1)
            img_bytes = base64.b64decode(encoded)
        else:
            img_bytes = requests.get(image_data).content

        img = Image.open(io.BytesIO(img_bytes))
        img_clean = remove_background_local(img, "generated")
        
        # Save
        filename = f"ai_{datetime.now().strftime('%Y%m%d_%H%M%S')}.png"
        path = os.path.join(AI_GEN_DIR, filename)
        img_clean.save(path, format='PNG')
        
        return jsonify({
            "success": True, 
            "image_url": f"/ai_generated_images/{filename}",
            "filename": filename
        })

    except Exception as e:
        print(f"[Generate] Error: {e}")
        return jsonify({"error": str(e)}), 500

@app.route('/api/bake', methods=['POST'])
def bake_design():
    try:
        tshirt_file = request.files['tshirt_image']
        design_file = request.files['design_image']
        
        # Parse params with defaults
        x = int(float(request.form.get('x', 0)))
        y = int(float(request.form.get('y', 0)))
        w = int(float(request.form.get('width', 200)))
        h = int(float(request.form.get('height', 200)))
        pos = request.form.get('position', 'center')

        tshirt = Image.open(tshirt_file)
        design = Image.open(design_file)

        # Process
        t_clean = remove_background_local(tshirt, "shirt")
        d_clean = remove_background_local(design, "design")
        comp, mask = create_composite_with_transform(t_clean, d_clean, x, y, w, h)
        
        # Bake
        baked_bytes = bake_with_fal(comp, mask, pos)
        
        # Cleanup Final
        final_img = Image.open(io.BytesIO(baked_bytes))
        final_clean = remove_background_local(final_img, "final")
        
        # Save
        filename = f"tshirt_final_{datetime.now().strftime('%Y%m%d_%H%M%S')}.png"
        path = os.path.join(UPLOAD_DIR, filename)
        final_clean.save(path, format='PNG')

        return jsonify({
            "success": True,
            "image_url": f"/uploads/{filename}",
            "filename": filename
        })

    except Exception as e:
        print(f"[Bake] Error: {e}")
        return jsonify({"error": str(e)}), 500

@app.route('/api/vton', methods=['POST'])
def vton_api():
    try:
        filename = request.json.get('filename')
        file_path = os.path.join(UPLOAD_DIR, filename)
        
        if not os.path.exists(file_path): return jsonify({"error": "File not found"}), 404

        print("[VTON] Starting...")
        with open(file_path, "rb") as f:
            garment_url = fal_client.upload(f.read(), "image/png")
        with open("images/man_model.png", "rb") as f:
            model_url = fal_client.upload(f.read(), "image/jpeg")

        with open('fashn_vton.json', 'r') as f: args = json.load(f)
        args["garment_image"] = garment_url
        args["model_image"] = model_url
        
        result = fal_client.subscribe("fal-ai/fashn/tryon/v1.6", arguments=args)
        
        # Download & Clean
        resp = requests.get(result["images"][0]["url"])
        vton_img = Image.open(io.BytesIO(resp.content))
        vton_clean = remove_background_local(vton_img, "vton")
        
        vton_filename = f"vton_{filename}"
        vton_path = os.path.join(UPLOAD_DIR, "VTON", vton_filename)
        os.makedirs(os.path.dirname(vton_path), exist_ok=True)
        vton_clean.save(vton_path, format="PNG")

        return jsonify({
            "success": True,
            "image_url": f"/uploads/VTON/{vton_filename}"
        })

    except Exception as e:
        print(f"[VTON] Error: {e}")
        return jsonify({"error": str(e)}), 500

@app.route('/api/remove-bg', methods=['POST'])
def api_remove_bg():
    try:
        file = request.files['image']
        img = Image.open(io.BytesIO(file.read()))
        cleaned = remove_background_local(img)
        buff = io.BytesIO()
        cleaned.save(buff, format="PNG")
        buff.seek(0)
        return send_file(buff, mimetype="image/png")
    except Exception as e:
        return jsonify({"error": str(e)}), 500

if __name__ == '__main__':
    # Threaded=True helps prevent single requests from blocking the server
    app.run(debug=True, port=5000, threaded=True)