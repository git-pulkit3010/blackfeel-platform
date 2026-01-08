// --- CONSTANTS & STATE ---
const DEFAULT_IMAGE = ""; // No default design
const designImage = document.getElementById('design-image');
const loadingOverlay = document.getElementById('loading-overlay');
const promptInput = document.getElementById('prompt');
const tshirtBackground = document.getElementById('tshirt-background');
const generatedHistory = []; // Store generated/baked images

// --- EDITOR STATE ---
let editorState = {
    mode: 'ai', // 'ai' or 'upload'
    designImage: null,
    tshirtImage: null,
    isDragging: false,
    dragStartX: 0,
    dragStartY: 0,
    designX: 0,
    designY: 0,
    designScale: 0.4,
    designPosition: 'manual', // Changed to manual by default
    designWidth: 0,
    designHeight: 0,
    showingResult: false
};

// --- CANVAS SETUP ---
const canvas = document.getElementById('editor-canvas');
const ctx = canvas.getContext('2d');
canvas.width = 500;
canvas.height = 600;

// --- TAB SWITCHING ---
function switchTab(mode) {
    // Update Buttons
    document.querySelectorAll('.tab-trigger').forEach(btn => btn.classList.remove('active'));
    event.target.classList.add('active');

    // Update Content
    document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));
    document.getElementById(`tab-${mode}`).classList.add('active');
    
    // Update mode and UI
    editorState.mode = mode;
    editorState.showingResult = false;
    updatePreviewMode();
}

function updatePreviewMode() {
    const editorControls = document.getElementById('editor-controls');
    const editorCanvas = document.getElementById('editor-canvas');
    const aiView = document.getElementById('ai-view');
    const resultView = document.getElementById('result-view');
    
    // Reset result view
    if (resultView) resultView.style.display = 'none';

    if (editorState.showingResult) {
        editorControls.style.display = 'block'; // Keep controls visible
        editorCanvas.style.display = 'none';
        if (aiView) aiView.style.display = 'none';
        if (resultView) resultView.style.display = 'block';
        return;
    }
    
    if (editorState.mode === 'upload' && editorState.designImage) {
        // Show editor controls and canvas, hide AI view
        editorControls.style.display = 'block';
        editorCanvas.style.display = 'block';
        if (aiView) aiView.style.display = 'none';
        
        // Make sure we have the current t-shirt image
        if (!editorState.tshirtImage) {
            const tshirtImg = new Image();
            tshirtImg.onload = () => {
                editorState.tshirtImage = tshirtImg;
                drawEditor();
            };
            tshirtImg.src = tshirtBackground.src;
        } else {
            drawEditor();
        }
    } else {
        // Show AI view, hide editor
        editorControls.style.display = 'none';
        editorCanvas.style.display = 'none';
        if (aiView) aiView.style.display = 'block';
        
        const designLayer = document.getElementById('design-image');
        if (designLayer) {
            designLayer.style.opacity = editorState.designImage ? '1' : '0';
        }
    }
}

// --- AI GENERATION SIMULATION ---
function generateDesign() {
    const prompt = promptInput.value.trim();

    if (!prompt) {
        showToast("Please enter a prompt first.", "error");
        promptInput.focus();
        return;
    }

    // Start Loading
    setLoading(true, "Generating design...");

    // Simulate API Latency (2 seconds)
    setTimeout(() => {
        // Generate a seed from prompt to make it feel deterministic (same prompt = same image)
        const seed = prompt.replace(/\s/g, '').toLowerCase();
        // Using picsum to simulate generated result. 
        const newImageUrl = `https://picsum.photos/seed/${seed}/800/800.jpg`;

        // Update Image
        updateAIimage(newImageUrl);

        setLoading(false);
        showToast("Design generated successfully!");
    }, 2000);
}

function updateAIimage(url) {
    const designLayer = document.getElementById('design-image');
    if (!designLayer) return;
    
    designLayer.style.opacity = '0';
    
    const img = new Image();
    img.onload = () => {
        designLayer.src = url;
        designLayer.style.opacity = '1';
        
        // Store the image for editor mode
        editorState.designImage = img;
    };
    img.crossOrigin = 'anonymous';
    img.src = url;
}

// --- IMAGE UPLOAD & EDITOR FUNCTIONALITY ---
const fileInput = document.getElementById('file-input');
const scaleSlider = document.getElementById('scale');
const scaleValue = document.getElementById('scaleValue');
const positionBtns = document.querySelectorAll('.position-btn');
const resetBtn = document.getElementById('reset-position');
const downloadBtn = document.getElementById('download-preview');
const bakeBtn = document.getElementById('bake-design');

// Initialize upload listeners
function initializeUploadListeners() {
    // File input change listener
    fileInput.addEventListener('change', function (e) {
        const file = e.target.files[0];
        if (file) {
            handleFile(file);
        }
    });

    // Drag and Drop
    const dropArea = document.getElementById('drop-area');
    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
        dropArea.addEventListener(eventName, preventDefaults, false);
    });

    function preventDefaults(e) {
        e.preventDefault();
        e.stopPropagation();
    }

    dropArea.addEventListener('drop', (e) => {
        const dt = e.dataTransfer;
        const file = dt.files[0];
        handleFile(file);
    });
    
    // Scale slider
    scaleSlider.addEventListener('input', (e) => {
        editorState.designScale = parseInt(e.target.value) / 100;
        scaleValue.textContent = e.target.value;
        calculateDesignPosition();
        drawEditor();
    });
    
    // Position buttons
    positionBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            positionBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            editorState.designPosition = btn.dataset.position;
            calculateDesignPosition();
            drawEditor();
        });
    });
    
    // Reset button
    resetBtn.addEventListener('click', () => {
        editorState.designScale = 0.4;
        editorState.designPosition = 'manual';
        editorState.designX = 0;
        editorState.designY = 0;
        scaleSlider.value = 40;
        scaleValue.textContent = '40';
        calculateDesignPosition();
        drawEditor();
        showToast("Design position reset", "success");
    });
    
    // Download preview button
    downloadBtn.addEventListener('click', () => {
        if (!canvas) return;
        const link = document.createElement('a');
        link.href = canvas.toDataURL('image/png');
        link.download = 'tshirt-preview.png';
        link.click();
        showToast("Preview downloaded", "success");
    });
    
    // Bake design button
    bakeBtn.addEventListener('click', bakeDesign);
    
    // Canvas mouse events for dragging
    canvas.addEventListener('mousedown', startDrag);
    canvas.addEventListener('mousemove', drag);
    canvas.addEventListener('mouseup', stopDrag);
    canvas.addEventListener('mouseleave', stopDrag);
}

function handleFile(file) {
    if (!file.type.startsWith('image/')) {
        showToast("Please upload an image file.", "error");
        return;
    }

    setLoading(true, "Removing background...");

    // Use backend to remove background
    const formData = new FormData();
    formData.append('image', file);
    
    fetch('/api/remove-bg', {
        method: 'POST',
        body: formData
    })
    .then(response => {
        if (!response.ok) throw new Error('Background removal failed');
        return response.blob();
    })
    .then(blob => {
        const reader = new FileReader();
        reader.onload = function(e) {
            const img = new Image();
            img.onload = () => {
                editorState.designImage = img;
                
                // Make sure we have the current t-shirt image
                if (!editorState.tshirtImage) {
                    const tshirtImg = new Image();
                    tshirtImg.onload = () => {
                        editorState.tshirtImage = tshirtImg;
                        calculateDesignPosition();
                        updatePreviewMode();
                        setLoading(false);
                        showToast("Image uploaded and background removed!");
                    };
                    tshirtImg.src = tshirtBackground.src;
                } else {
                    calculateDesignPosition();
                    updatePreviewMode();
                    setLoading(false);
                    showToast("Image uploaded and background removed!");
                }
            };
            img.src = e.target.result;
        };
        reader.readAsDataURL(blob);
    })
    .catch(err => {
        console.error("Background removal error:", err);
        showToast("Using original image (background removal failed)", "warning");
        
        // Fallback to original image
        const reader = new FileReader();
        reader.onload = function(e) {
            const img = new Image();
            img.onload = () => {
                editorState.designImage = img;
                
                // Make sure we have the current t-shirt image
                if (!editorState.tshirtImage) {
                    const tshirtImg = new Image();
                    tshirtImg.onload = () => {
                        editorState.tshirtImage = tshirtImg;
                        calculateDesignPosition();
                        updatePreviewMode();
                        setLoading(false);
                        showToast("Image uploaded!");
                    };
                    tshirtImg.src = tshirtBackground.src;
                } else {
                    calculateDesignPosition();
                    updatePreviewMode();
                    setLoading(false);
                    showToast("Image uploaded!");
                }
            };
            img.src = e.target.result;
        };
        reader.readAsDataURL(file);
    });
}

function calculateDesignPosition() {
    if (!editorState.designImage || !editorState.tshirtImage) return;

    const tshirtWidth = editorState.tshirtImage.naturalWidth || 500;
    const tshirtHeight = editorState.tshirtImage.naturalHeight || 600;

    // Calculate size based on scale
    const imgAspect = editorState.designImage.width / editorState.designImage.height;
    const baseSize = Math.min(tshirtWidth, tshirtHeight) * editorState.designScale;

    editorState.designWidth = Math.round(baseSize);
    editorState.designHeight = Math.round(baseSize / imgAspect);

    // Position based on mode
    if (editorState.designPosition === 'manual') {
        // Keep current manual position, but ensure it's initialized to center if not set
        if (editorState.designX === 0 && editorState.designY === 0) {
            // Initialize to center position if not already set
            const posMap = {
                'top_left': { x: 0.1, y: 0.1 },
                'top': { x: 0.5, y: 0.1 },
                'top_right': { x: 0.9, y: 0.1 },
                'left': { x: 0.1, y: 0.5 },
                'center': { x: 0.5, y: 0.5 },
                'right': { x: 0.9, y: 0.5 },
                'bottom_left': { x: 0.1, y: 0.8 },
                'bottom': { x: 0.5, y: 0.8 },
                'bottom_right': { x: 0.9, y: 0.8 }
            };
            const pos = posMap['center'];
            editorState.designX = Math.round(tshirtWidth * pos.x - editorState.designWidth / 2);
            editorState.designY = Math.round(tshirtHeight * pos.y - editorState.designHeight / 2);
        }
        return;
    }

    // Calculate position based on preset
    const posMap = {
        'top_left': { x: 0.1, y: 0.1 },
        'top': { x: 0.5, y: 0.1 },
        'top_right': { x: 0.9, y: 0.1 },
        'left': { x: 0.1, y: 0.5 },
        'center': { x: 0.5, y: 0.5 },
        'right': { x: 0.9, y: 0.5 },
        'bottom_left': { x: 0.1, y: 0.8 },
        'bottom': { x: 0.5, y: 0.8 },
        'bottom_right': { x: 0.9, y: 0.8 }
    };

    const pos = posMap[editorState.designPosition] || posMap['center'];
    editorState.designX = Math.round(tshirtWidth * pos.x - editorState.designWidth / 2);
    editorState.designY = Math.round(tshirtHeight * pos.y - editorState.designHeight / 2);
}

function drawEditor() {
    if (!editorState.tshirtImage || !editorState.designImage || !ctx) return;
    
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    // Draw t-shirt background
    ctx.drawImage(editorState.tshirtImage, 0, 0, canvas.width, canvas.height);
    
    // Calculate scaled position for canvas
    const scaleX = canvas.width / (editorState.tshirtImage.naturalWidth || 500);
    const scaleY = canvas.height / (editorState.tshirtImage.naturalHeight || 600);
    
    const canvasX = editorState.designX * scaleX;
    const canvasY = editorState.designY * scaleY;
    const canvasWidth = editorState.designWidth * scaleX;
    const canvasHeight = editorState.designHeight * scaleY;
    
    // Draw design
    ctx.drawImage(editorState.designImage, canvasX, canvasY, canvasWidth, canvasHeight);
    
    // Draw selection border
    ctx.strokeStyle = '#fafafa';
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 5]);
    ctx.strokeRect(canvasX, canvasY, canvasWidth, canvasHeight);
    ctx.setLineDash([]);
    
    // Draw corner handles
    const handleSize = 6;
    ctx.fillStyle = '#fafafa';
    const corners = [
        { x: canvasX, y: canvasY },
        { x: canvasX + canvasWidth, y: canvasY },
        { x: canvasX, y: canvasY + canvasHeight },
        { x: canvasX + canvasWidth, y: canvasY + canvasHeight }
    ];
    
    corners.forEach(corner => {
        ctx.fillRect(corner.x - handleSize/2, corner.y - handleSize/2, handleSize, handleSize);
    });
}

function startDrag(e) {
    if (!editorState.designImage || !canvas) return;

    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    // Check if click is on the design
    const scaleX = canvas.width / (editorState.tshirtImage.naturalWidth || 500);
    const scaleY = canvas.height / (editorState.tshirtImage.naturalHeight || 600);
    const canvasX = editorState.designX * scaleX;
    const canvasY = editorState.designY * scaleY;
    const canvasWidth = editorState.designWidth * scaleX;
    const canvasHeight = editorState.designHeight * scaleY;

    if (x >= canvasX && x <= canvasX + canvasWidth &&
        y >= canvasY && y <= canvasY + canvasHeight) {
        editorState.isDragging = true;
        editorState.dragStartX = x;
        editorState.dragStartY = y;
        editorState.designPosition = 'manual';
        canvas.style.cursor = 'grabbing';
    }
}

function drag(e) {
    if (!editorState.isDragging || !editorState.designImage || !canvas) return;
    
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    const deltaX = x - editorState.dragStartX;
    const deltaY = y - editorState.dragStartY;
    
    const scaleX = canvas.width / (editorState.tshirtImage.naturalWidth || 500);
    const scaleY = canvas.height / (editorState.tshirtImage.naturalHeight || 600);
    
    editorState.designX += Math.round(deltaX / scaleX);
    editorState.designY += Math.round(deltaY / scaleY);
    
    // Clamp to bounds
    const tshirtWidth = editorState.tshirtImage.naturalWidth || 500;
    const tshirtHeight = editorState.tshirtImage.naturalHeight || 600;
    
    editorState.designX = Math.max(0, Math.min(editorState.designX, tshirtWidth - editorState.designWidth));
    editorState.designY = Math.max(0, Math.min(editorState.designY, tshirtHeight - editorState.designHeight));
    
    editorState.dragStartX = x;
    editorState.dragStartY = y;
    
    drawEditor();
    
    // Update position buttons
    positionBtns.forEach(b => b.classList.remove('active'));
    const manualBtn = document.querySelector('[data-position="manual"]');
    if (manualBtn) manualBtn.classList.add('active');
}

function stopDrag() {
    editorState.isDragging = false;
    if (canvas) canvas.style.cursor = 'grab';
}

async function bakeDesign() {
    if (!editorState.designImage || !editorState.tshirtImage) {
        showToast("Please upload a design first", "error");
        return;
    }
    
    setLoading(true, "Baking design...");
    
    try {
        // Prepare images
        const tshirtCanvas = document.createElement('canvas');
        tshirtCanvas.width = editorState.tshirtImage.naturalWidth || 500;
        tshirtCanvas.height = editorState.tshirtImage.naturalHeight || 600;
        const tshirtCtx = tshirtCanvas.getContext('2d');
        tshirtCtx.drawImage(editorState.tshirtImage, 0, 0);
        
        const designCanvas = document.createElement('canvas');
        designCanvas.width = editorState.designImage.width;
        designCanvas.height = editorState.designImage.height;
        const designCtx = designCanvas.getContext('2d');
        designCtx.drawImage(editorState.designImage, 0, 0);
        
        // Convert to blobs
        const tshirtBlob = await new Promise(resolve => tshirtCanvas.toBlob(resolve, 'image/png'));
        const designBlob = await new Promise(resolve => designCanvas.toBlob(resolve, 'image/png'));
        
        // Create FormData
        const formData = new FormData();
        formData.append('tshirt_image', tshirtBlob, 'tshirt.png');
        formData.append('design_image', designBlob, 'design.png');
        formData.append('position', editorState.designPosition);
        formData.append('scale', editorState.designScale);
        formData.append('x', editorState.designX);
        formData.append('y', editorState.designY);
        formData.append('width', editorState.designWidth);
        formData.append('height', editorState.designHeight);
        
        // Send to backend
        const response = await fetch('/api/bake', {
            method: 'POST',
            body: formData
        });
        
        const data = await response.json();
        
        if (response.ok) {
            setLoading(false);
            showToast("Design baked successfully!", "success");
            
            const imageUrl = `http://localhost:5000${data.image_url}`;
            
            // 1. Store result
            generatedHistory.push({
                timestamp: new Date().toISOString(),
                image: imageUrl
            });
            
            // 2. Update UI to show result
            const resultImg = document.getElementById('result-image');
            if (resultImg) resultImg.src = imageUrl;
            
            editorState.showingResult = true;
            updatePreviewMode();

            // 3. Download the baked image (Optional backup)
            // const link = document.createElement('a');
            // link.href = imageUrl;
            // link.download = 'tshirt-final.png';
            // link.click();
        } else {
            throw new Error(data.error || "Baking failed");
        }
    } catch (error) {
        setLoading(false);
        showToast(`Error: ${error.message}`, "error");
        console.error("Baking error:", error);
    }
}

// --- CONTROLS ---
function changeShirtColor(color) {
    // Mapping colors to images
    const colorMap = {
        '#ffffff': 'images/tshirt-white.png',
        '#18181b': 'images/tshirt-black-nobg.png',
        '#7f1d1d': 'images/tshirt-red.png',
        '#2563eb': 'images/tshirt-blue.png'
    };

    const imagePath = colorMap[color];
    if (imagePath && tshirtBackground) {
        tshirtBackground.src = imagePath;
        
        // Update editor state if in upload mode
        if (editorState.mode === 'upload') {
            const img = new Image();
            img.crossOrigin = "anonymous";
            img.onload = () => {
                editorState.tshirtImage = img;
                drawEditor();
            };
            img.src = imagePath;
        }
    }
}

// --- UTILS ---
function setLoading(isLoading, message = "Processing...") {
    const loadingText = document.getElementById('loading-text');
    if (loadingText) loadingText.textContent = message;
    
    if (isLoading) {
        loadingOverlay.classList.add('active');
        // Disable buttons
        document.querySelectorAll('button').forEach(b => b.disabled = true);
    } else {
        loadingOverlay.classList.remove('active');
        // Enable buttons
        document.querySelectorAll('button').forEach(b => b.disabled = false);
    }
}

function showToast(message, type = 'success') {
    const container = document.getElementById('toast-container');
    if (!container) return;
    
    const toast = document.createElement('div');
    toast.className = 'toast';

    // Icon
    let icon = '';
    if (type === 'success') {
        icon = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#4ade80" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg>`;
    } else if (type === 'warning') {
        icon = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fbbf24" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>`;
    } else {
        icon = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#f87171" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>`;
    }

    toast.innerHTML = `${icon}<span>${message}</span>`;
    container.appendChild(toast);

    // Remove after 3 seconds
    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateX(20px)';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

// Initialize the application
document.addEventListener('DOMContentLoaded', function () {
    initializeUploadListeners();
    
    // Initialize t-shirt image for editor
    if (tshirtBackground) {
        const tshirtImg = new Image();
        tshirtImg.crossOrigin = "anonymous";
        tshirtImg.onload = () => {
            editorState.tshirtImage = tshirtImg;
        };
        tshirtImg.src = tshirtBackground.src;
    }
    
    
    // Initial update of preview mode
    updatePreviewMode();
});