// --- CONSTANTS & STATE ---
const DEFAULT_IMAGE = "https://picsum.photos/seed/art/800/800";
const designImage = document.getElementById('design-image');
const loadingOverlay = document.getElementById('loading-overlay');
const promptInput = document.getElementById('prompt');
const shirtBaseColor = document.getElementById('shirt-base-color');

// --- TAB SWITCHING ---
function switchTab(mode) {
    // Update Buttons
    document.querySelectorAll('.tab-trigger').forEach(btn => btn.classList.remove('active'));
    event.target.classList.add('active');

    // Update Content
    document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));
    document.getElementById(`tab-${mode}`).classList.add('active');
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
    setLoading(true);

    // Simulate API Latency (2 seconds)
    setTimeout(() => {
        // Generate a seed from prompt to make it feel deterministic (same prompt = same image)
        const seed = prompt.replace(/\s/g, '').toLowerCase();
        // Using picsum to simulate generated result. 
        // In a real app, this would be: const result = await api.generate(prompt);
        const newImageUrl = `https://picsum.photos/seed/${seed}/800/800.jpg`;

        // Update Image
        updateImage(newImageUrl);
        
        setLoading(false);
        showToast("Design generated successfully!");
    }, 2000);
}

function updateImage(url) {
    designImage.style.opacity = '0';
    setTimeout(() => {
        designImage.src = url;
        designImage.onload = () => {
            designImage.style.opacity = '1';
        };
    }, 200);
}

// --- IMAGE UPLOAD ---
const fileInput = document.getElementById('file-input');

// Initialize drag and drop and file input listeners
function initializeUploadListeners() {
    // File input change listener
    fileInput.addEventListener('change', function(e) {
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
}

function handleFile(file) {
    if (!file.type.startsWith('image/')) {
        showToast("Please upload an image file.", "error");
        return;
    }

    setLoading(true); // Briefly load to show processing
    
    const reader = new FileReader();
    reader.onload = function(e) {
        updateImage(e.target.result);
        setLoading(false);
        showToast("Image uploaded to shirt.");
    }
    reader.readAsDataURL(file);
}

// --- CONTROLS ---
function updateObjectFit() {
    const mode = document.getElementById('fit-mode').value;
    designImage.style.objectFit = mode;
}

function changeShirtColor(color) {
    // We use the shirt-base-color path which sits on top of the design with 'multiply' blend mode
    // to tint the design without hiding it completely.
    
    // If white, remove tint
    if (color.toLowerCase() === '#ffffff') {
        shirtBaseColor.setAttribute('fill', '#ffffff');
        shirtBaseColor.setAttribute('opacity', '0'); // No tint needed for white shirt
    } else {
        shirtBaseColor.setAttribute('fill', color);
        shirtBaseColor.setAttribute('opacity', '0.4'); // Tint strength
    }
}

// --- UTILS ---
function setLoading(isLoading) {
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
    const toast = document.createElement('div');
    toast.className = 'toast';
    
    // Icon
    let icon = '';
    if (type === 'success') {
        icon = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#4ade80" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg>`;
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
document.addEventListener('DOMContentLoaded', function() {
    initializeUploadListeners();
});