// public/js/create-tab.js
window.DEBUG_ENABLED = true; // Ensure debugLog is active (from core.js)
debugLog('create-tab.js script tag executed');

// --- Global State Variables ---
let uploadedFileObject = null; // Stores file object if uploaded via input
let loadedImageUrl = null;    // Stores URL if image loaded from gallery/modal (e.g., "Edit Image")

// --- DOM Element Variables (globally available, initialized in setup) ---
let imageUploadInput, thumbnail, placeholderIcon, clearButton, strengthControl,
    imageStrengthSlider, imageStrengthValueDisplay, aspectRatioButton,
    modelSelect, styleSelectElement, imagePrompt, imageSubmit; // Removed imageForEditUrlInput from this global list, it's better fetched inside handlers to ensure it's fresh after partial reloads.

// imageCostDisplay is initialized directly as it's unlikely to be re-rendered by partials.
const imageCostDisplay = document.getElementById('image-token-cost-display'); 

// --- Utility Function: Create Loading Indicator ---
function createLoadingIndicator(id = 'loading-indicator') {
    const indicator = document.createElement('div');
    indicator.id = id;
    indicator.classList.add('flex', 'items-center', 'justify-center', 'p-4', 'text-gray-500');
    indicator.innerHTML = `
        <svg class="animate-spin -ml-1 mr-3 h-5 w-5 text-blue-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
        </svg>
        <span>Generating...</span>
    `;
    return indicator;
}

// --- Model Style Definitions (Your original object) ---
const modelStyles = {
    'runware:100@1': [ { value: '', label: 'None' } ], // Flux Schnell
    'runware:101@1': [ // Flux Dev
      { value: '', label: 'None' }, { value: 'civitai:180891@838667', label: 'Anime' },
      { value: 'civitai:128568@747534', label: 'Cyberpunk Anime Style', negativePrompt: 'deformed, blurry' },
      { value: 'civitai:748468@837016', label: 'Retro Collage Art' }, { value: 'civitai:788990@882302', label: 'Creepycute' },
      { value: 'civitai:720587@805786', label: 'DecoPulse FLUX' }, { value: 'civitai:15452@935477', label: 'Deep Sea Particle Enhancer' },
      { value: 'khialmaster:643886@720252', label: 'Faetastic Details' }, { value: 'civitai:269592@806653', label: 'Fractal Geometry' },
      { value: 'civitai:747833@843992', label: 'Galactixy Illustrations Style' }, { value: 'civitai:103528@743778', label: 'Geometric Woman' },
      { value: 'civitai:170039@813900', label: 'Graphic Portrait' }, { value: 'civitai:894974@1001494', label: 'Mat Miller Art' },
      { value: 'civitai:682651@764057', label: 'Moebius Style' }, { value: 'civitai:555323@832559', label: 'OB3D Isometric 3D Room' },
      { value: 'civitai:860403@1138383', label: 'Paper Quilling and Layering Style' },
      { value: 'civitai:1000081@1147021', label: 'Classic Oil Painting', negativePrompt: 'deformed, blurry, bad anatomy, worst quality, low quality' },
      { value: 'civitai:44638@755521', label: 'Disney' }, { value: 'civitai:310964@778472', label: 'Furry Enhancer' },
      { value: 'civitai:650743@728041', label: 'MidJourney-style' }, { value: 'civitai:970862@1434002', label: 'Hyper Realism' },
      { value: 'civitai:970862@1434002', label: 'Amateur Snapshot' }, { value: 'civitai:784568@974292', label: 'Amazing scenery' }
    ],
    'rundiffusion:130@100': [ { value: '', label: 'None' } ], // Juggernaut Pro
    'civitai:133005@782002': [ // PhotoMaker (Face / Character)
      { value: '', label: 'None' }, { value: 'cinematic', label: 'Cinematic' }, { value: 'disney_character', label: 'Disney Character' },
      { value: 'Digital Art', label: 'Digital Art' }, { value: 'Fantasy art', label: 'Fantasy Art' }, { value: 'photographic', label: 'Photographic' },
      { value: 'neonpunk', label: 'Neonpunk' }, { value: 'enhance', label: 'Enhance' }, { value: 'Comic Book', label: 'Comic Book' },
      { value: 'lowpoly', label: 'Lowpoly' }, { value: 'line-art', label: 'Line Art' }
    ]
};

// --- Utility Function: Auto-resize textarea ---
function autoResizeTextarea(textarea) {
    if (!textarea) return;
    const rootFontSize = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
    const minHeightRem = 3.5; const maxHeightRem = 13.5;
    const minHeightPx = minHeightRem * rootFontSize; const maxHeightPx = maxHeightRem * rootFontSize;
    textarea.style.height = 'auto'; let newHeight = textarea.scrollHeight;
    if (newHeight < minHeightPx) newHeight = minHeightPx;
    if (newHeight > maxHeightPx) { newHeight = maxHeightPx; textarea.style.overflowY = 'auto'; }
    else { textarea.style.overflowY = 'hidden'; }
    textarea.style.height = newHeight + 'px';
}

// --- Utility Function: Update Cost Display ---
function updateCostDisplay() {
    modelSelect = document.getElementById('image-model-select'); // Ensure fresh reference
    if (!modelSelect || !imageCostDisplay) {
        console.warn('[Create Tab] updateCostDisplay: modelSelect or imageCostDisplay not found.');
        return;
    }

    const selectedOption = modelSelect.options[modelSelect.selectedIndex];
    const modelId = selectedOption.value;
    const modelConfig = window.RUNWARE_MODELS[modelId] || Object.values(window.RUNWARE_MODELS).find(m => m.id === modelId);

    if (!modelConfig) {
        console.warn(`[Cost Update] No config found for model: ${modelId}`);
        imageCostDisplay.textContent = '($N/A)';
        imageSubmit = document.getElementById('image-generate-button'); // Get fresh reference
        if (imageSubmit) imageSubmit.disabled = true;
        return;
    }

    const imageForEditUrlInput = document.getElementById('image-for-edit-url'); // Get fresh reference
    // Check if an image is present, either from file upload OR from URL
    const isImagePresent = uploadedFileObject !== null || (imageForEditUrlInput && imageForEditUrlInput.value !== '');
    
    let cost;
    if (isImagePresent) {
        // If image uploaded/selected, use I2I or PhotoMaker cost
        if (modelConfig.taskType === 'photoMaker') {
            cost = modelConfig.userPrice; // PhotoMaker has a single price
        } else {
            cost = modelConfig.userPriceI2I;
        }
    } else {
        // No image present, use Txt2Img cost
        cost = modelConfig.userPriceT2I;
    }

    if (typeof cost === 'number') {
        imageCostDisplay.textContent = `($${cost.toFixed(4)})`;
        // Button state is handled by updateControlsBasedOnState, don't override here
        debugLog(`[Cost Update] Model: ${modelId}, Cost: ${cost}`);
    } else {
        imageCostDisplay.textContent = '($N/A)';
        imageSubmit = document.getElementById('image-generate-button'); // Get fresh reference
        if (imageSubmit) imageSubmit.disabled = true;
        console.warn(`[Cost Update] Invalid cost for model ${modelId}: ${cost}`);
    }
}

// Function to toggle the visibility of the strength slider
window.toggleImageStrengthControl = (show) => { // Made global for core.js to call
    strengthControl = document.getElementById('image-strength-control'); // Ensure fresh reference
    if (strengthControl) {
        if (show) {
            strengthControl.classList.remove('hidden');
            strengthControl.classList.add('flex'); // Ensure it's displayed as flex
            debugLog('[Create Tab] Showing image strength control.');
        } else {
            strengthControl.classList.add('hidden');
            strengthControl.classList.remove('flex');
            debugLog('[Create Tab] Hiding image strength control.');
        }
    }
};


// --- Helper function to update control states (e.g., disabled/enabled) ---
function updateControlsBasedOnState() {
    // Ensure all required elements are referenced or re-fetched if null
    imagePrompt = document.getElementById('image-prompt-input');
    modelSelect = document.getElementById('image-model-select');
    strengthControl = document.getElementById('image-strength-control');
    aspectRatioButton = document.getElementById('aspect-ratio-dropdown');
    const imageForEditUrlInput = document.getElementById('image-for-edit-url'); // Fetch inside handler for freshness
    imageSubmit = document.getElementById('image-generate-button'); // Fetch inside handler for freshness

    if (!modelSelect || !imagePrompt || !strengthControl || !imageSubmit || !aspectRatioButton || !imageForEditUrlInput) {
        if(imageSubmit) imageSubmit.disabled = true; 
        console.warn('[Create Tab] updateControlsBasedOnState: One or more essential control elements not found. Some controls may not initialize/update correctly.');
        return;
    }

    const modelValue = modelSelect.value;
    const models = window.RUNWARE_MODELS || {};
    const selectedModelConfig = models[modelValue] || null;
    
    const isImageToImageCapable = selectedModelConfig && selectedModelConfig.type !== 'text-to-image';
    const isPhotoMakerSelected = modelValue === 'civitai:133005@782002'; // Specific PhotoMaker ID

    // Check if an image is present, either from file upload OR from URL input
    const hasImagePresent = uploadedFileObject !== null || imageForEditUrlInput.value !== '';
    const hasPromptValue = imagePrompt.value.trim().length > 0;

    // Toggle strength control visibility
    window.toggleImageStrengthControl(hasImagePresent && isImageToImageCapable);

    let disableGenerate = true; // Start with disabled and enable if conditions met

    if (isImageToImageCapable) {
        if (isPhotoMakerSelected) {
            // PhotoMaker requires both prompt and image
            disableGenerate = !hasPromptValue || !hasImagePresent;
        } else {
            // Regular I2I models: require prompt AND (uploaded image OR URL image)
            // Or if no image, then it becomes a Txt2Img and only needs prompt (handled by api choice)
            // The prompt is generally always needed for meaningful results
            disableGenerate = !hasPromptValue || (!hasImagePresent);
        }
    } else { // Text-to-image model
        disableGenerate = !hasPromptValue;
    }

    imageSubmit.disabled = disableGenerate;

    const disableAspectRatio = hasImagePresent && modelValue !== 'civitai:133005@782002'; // Aspect ratio is fixed by image for non-photomaker I2I
    if(aspectRatioButton) { 
        aspectRatioButton.disabled = disableAspectRatio;
        aspectRatioButton.classList.toggle('opacity-50', disableAspectRatio);
        aspectRatioButton.classList.toggle('cursor-not-allowed', disableAspectRatio);
        if (disableAspectRatio) aspectRatioButton.title = "Aspect ratio is determined by the uploaded image";
        else if (hasImagePresent && modelValue === 'civitai:133005@782002') aspectRatioButton.title = "Select Aspect Ratio (May be overridden by Face model)"; // Photomaker might still allow aspect ratio
        else aspectRatioButton.title = "Select Aspect Ratio";
    }
}

// --- Helper function to update style dropdown based on selected model ---
function updateStyleDropdown() {
    styleSelectElement = document.getElementById('style-select'); // Ensure fresh reference
    modelSelect = document.getElementById('image-model-select'); // Ensure fresh reference

    if (!styleSelectElement || !modelSelect) return;

    const modelId = modelSelect.value; 
    styleSelectElement.innerHTML = ''; // Clear existing options

    const noneOption = document.createElement('option');
    noneOption.value = '';
    noneOption.textContent = 'Style: None'; // Clearer "None" option
    styleSelectElement.appendChild(noneOption);

    // Prefer window.PROMPT_BASED_STYLES if available and model uses it
    const modelConfig = window.RUNWARE_MODELS ? window.RUNWARE_MODELS[modelId] : null;

    if (modelConfig && modelConfig.usesPromptBasedStyling && window.PROMPT_BASED_STYLES && window.PROMPT_BASED_STYLES.length > 0) {
        debugLog('[Create Tab] Populating styles from window.PROMPT_BASED_STYLES.');
        // Ensure prompt-based styles match expected structure: { id, name, negativePrompt }
        window.PROMPT_BASED_STYLES.forEach(style => {
            const option = document.createElement('option'); 
            option.value = style.id; 
            // FIX: Ensure style.name is a string, default to empty string if undefined/null
            option.textContent = style.name || ''; 
            if(style.negativePrompt) option.dataset.negativePrompt = style.negativePrompt; // Add negative prompt to option
            styleSelectElement.appendChild(option);
        });
    } else if (modelStyles[modelId]) { // Fallback to local modelStyles if specific for model
        debugLog('[Create Tab] Populating styles from local modelStyles.');
        modelStyles[modelId].forEach(style => {
            if(style.value !== '') { // 'None' is already added
                const option = document.createElement('option'); 
                option.value = style.value; 
                // FIX: Ensure style.label is a string, default to empty string if undefined/null
                option.textContent = style.label || ''; 
                if(style.negativePrompt) option.dataset.negativePrompt = style.negativePrompt; // Add negative prompt to option
                styleSelectElement.appendChild(option);
            }
        });
    }
    styleSelectElement.value = ''; // Default to "None"
    updateHiddenStyleInputs(); // Ensure hidden inputs are updated immediately after style dropdown change
}

// --- Helper function to update hidden inputs for style ---
function updateHiddenStyleInputs() {
    styleSelectElement = document.getElementById('style-select'); // Ensure fresh reference
    if (!styleSelectElement) return;

    const selectedOption = styleSelectElement.options[styleSelectElement.selectedIndex];
    // FIX: Ensure textContent is a string before replacing/trimming
    const label = selectedOption ? (selectedOption.textContent || '').replace('Style: ', '').trim() : ''; 
    const negativePromptValue = selectedOption ? (selectedOption.dataset.negativePrompt || '') : '';
    
    const labelInput = document.getElementById('style-label-input');
    const negPromptInput = document.getElementById('negative-prompt-input');
    if (labelInput) labelInput.value = label;
    if (negPromptInput) negPromptInput.value = negativePromptValue;
}

// --- Helper function to update strength slider UI ---
function updateStrengthSliderUI() {
    imageStrengthSlider = document.getElementById('image-strength-slider'); // Ensure fresh reference
    imageStrengthValueDisplay = document.getElementById('image-strength-value-display'); // Ensure fresh reference
    if (imageStrengthSlider && imageStrengthValueDisplay) {
       imageStrengthValueDisplay.textContent = parseFloat(imageStrengthSlider.value).toFixed(2);
    }
}

// --- Control Initialization and Event Listeners ---
function initializeCreateTabControls() {
    debugLog('[Create Tab] initializeCreateTabControls called');

    // Fetch initial references to DOM elements
    imageUploadInput = document.getElementById('image-upload-input');
    thumbnail = document.getElementById('image-thumbnail-preview');
    placeholderIcon = document.getElementById('thumbnail-placeholder-icon');
    clearButton = document.getElementById('clear-image-upload');
    strengthControl = document.getElementById('image-strength-control');
    imageStrengthSlider = document.getElementById('image-strength-slider');
    imageStrengthValueDisplay = document.getElementById('image-strength-value-display');
    aspectRatioButton = document.getElementById('aspect-ratio-dropdown');
    modelSelect = document.getElementById('image-model-select');
    styleSelectElement = document.getElementById('style-select');
    imagePrompt = document.getElementById('image-prompt-input');
    imageSubmit = document.getElementById('image-generate-button'); // Also initialized here for initial state setup

    // Check if critical elements exist. If not, don't proceed with listeners.
    if (!modelSelect || !styleSelectElement || !imageUploadInput || !imagePrompt || !aspectRatioButton || !strengthControl || !imageSubmit) {
        console.error('[Create Tab] initializeCreateTabControls: CRITICAL - One or more essential control elements not found. Tab functionality will be limited.');
        // Optionally disable the generate button here if the UI is broken
        if (imageSubmit) imageSubmit.disabled = true;
        return;
    }
    
    // --- Attach Listeners (using cloning for elements that might get stale after partial reloads) ---
    // Cloning is a robust way to ensure listeners are not duplicated and are attached to the current DOM elements.
    
    // Image Prompt Textarea
    const newImagePrompt = imagePrompt.cloneNode(true);
    imagePrompt.parentNode.replaceChild(newImagePrompt, imagePrompt);
    imagePrompt = newImagePrompt;
    imagePrompt.addEventListener('input', () => autoResizeTextarea(imagePrompt));
    imagePrompt.addEventListener('input', updateControlsBasedOnState);
    autoResizeTextarea(imagePrompt); 

    // Image Strength Slider
    const newImageStrengthSlider = imageStrengthSlider.cloneNode(true);
    imageStrengthSlider.parentNode.replaceChild(newImageStrengthSlider, imageStrengthSlider);
    imageStrengthSlider = newImageStrengthSlider;
    imageStrengthSlider.addEventListener('input', updateStrengthSliderUI);
    updateStrengthSliderUI(); // Initial call

    // Image Upload Input and Clear Button
    const newImageUploadInput = imageUploadInput.cloneNode(true);
    imageUploadInput.parentNode.replaceChild(newImageUploadInput, imageUploadInput);
    imageUploadInput = newImageUploadInput;

    const newClearButton = clearButton.cloneNode(true);
    clearButton.parentNode.replaceChild(newClearButton, clearButton);
    clearButton = newClearButton;

    // Attach listeners for image upload and clear
    imageUploadInput.addEventListener('change', function(event) {
        const imageForEditUrlInput = document.getElementById('image-for-edit-url'); // Fresh reference
        const file = event.target.files[0];
        if (file) {
            if (!file.type.startsWith('image/')) { window.showToast('Please select an image file.', 'error'); imageUploadInput.value = ''; return; }
            if (file.size > 10 * 1024 * 1024) { // 10MB limit
                window.showToast('Image file is too large (max 10MB).', 'error');
                imageUploadInput.value = ''; 
                // Reset UI to no image state for invalid file
                if(thumbnail) { thumbnail.src = '#'; thumbnail.classList.add('hidden');}
                if(placeholderIcon) placeholderIcon.classList.remove('hidden'); 
                if(clearButton) clearButton.classList.add('hidden');
                uploadedFileObject = null;
                loadedImageUrl = null;
                if(imageForEditUrlInput) imageForEditUrlInput.value = '';
                updateControlsBasedOnState(); updateCostDisplay();
                return;
            }
            uploadedFileObject = file;
            loadedImageUrl = null; // Clear loaded URL if a new file is uploaded
            if(imageForEditUrlInput) imageForEditUrlInput.value = ''; // Also clear hidden URL input
            const reader = new FileReader();
            reader.onload = function(e) {
                if(thumbnail) { thumbnail.src = e.target.result; thumbnail.classList.remove('hidden');}
                if(placeholderIcon) placeholderIcon.classList.add('hidden'); 
                if(clearButton) clearButton.classList.remove('hidden');
                updateControlsBasedOnState(); updateCostDisplay();
            }
            reader.readAsDataURL(file);
        } else {
            // If file input is cleared without new selection, defer to loadedImageUrl
            uploadedFileObject = null; 
            if (!loadedImageUrl) { // Only hide if NO loadedImageUrl is present
                if(thumbnail) { thumbnail.src = '#'; thumbnail.classList.add('hidden');}
                if(placeholderIcon) placeholderIcon.classList.remove('hidden'); 
                if(clearButton) clearButton.classList.add('hidden');
            }
            updateControlsBasedOnState(); updateCostDisplay();
        }
    });
    
    newClearButton.addEventListener('click', () => {
        const imageForEditUrlInput = document.getElementById('image-for-edit-url'); // Fresh reference
        uploadedFileObject = null; 
        loadedImageUrl = null; // Clear the loaded image URL as well
        if(imageUploadInput) imageUploadInput.value = ''; 
        if(imageForEditUrlInput) imageForEditUrlInput.value = ''; // Clear hidden URL input
        if(thumbnail) { thumbnail.src = '#'; thumbnail.classList.add('hidden');}
        if(placeholderIcon) placeholderIcon.classList.remove('hidden'); 
        if(clearButton) clearButton.classList.add('hidden');
        updateControlsBasedOnState(); updateCostDisplay();
    });
    
    // Aspect Ratio Dropdown (assuming its options and button are part of the partial)
    // No cloning needed here if only listeners on the main dropdown button and options container are required
    const aspectRatioDropdownBtn = document.getElementById('aspect-ratio-dropdown'); 
    const aspectRatioOptionsDiv = document.getElementById('aspect-ratio-options');
    if(aspectRatioDropdownBtn && aspectRatioOptionsDiv) {
        // Ensure new listener for dropdown toggle
        // Remove existing listener to prevent duplicates if this function is called multiple times
        if (aspectRatioDropdownBtn._aspectRatioToggleHandler) {
            aspectRatioDropdownBtn.removeEventListener('click', aspectRatioDropdownBtn._aspectRatioToggleHandler);
        }
        const toggleHandler = (e) => { 
            e.preventDefault();
            if(aspectRatioButton.disabled) return; 
            aspectRatioOptionsDiv.classList.toggle('hidden');
        };
        aspectRatioDropdownBtn.addEventListener('click', toggleHandler);
        aspectRatioDropdownBtn._aspectRatioToggleHandler = toggleHandler; // Store reference

        // Re-attach listeners for options
        aspectRatioOptionsDiv.querySelectorAll('.aspect-ratio-option').forEach(option => {
            // Remove existing listener to prevent duplicates
            if (option._aspectRatioOptionHandler) {
                option.removeEventListener('click', option._aspectRatioOptionHandler);
            }
            const optionHandler = (e) => { 
                e.preventDefault();
                const selectedValue = option.dataset.value;
                if(aspectRatioButton) aspectRatioButton.dataset.value = selectedValue; 
                const textSpan = aspectRatioButton ? aspectRatioButton.querySelector('#selected-ratio-text') : null;
                const iconSpan = aspectRatioButton ? aspectRatioButton.querySelector('#selected-ratio-icon') : null;
                if(textSpan) textSpan.textContent = option.textContent.trim().split(' ')[1] || selectedValue;
                if(iconSpan && option.querySelector('i')) iconSpan.innerHTML = option.querySelector('i').outerHTML;
                aspectRatioOptionsDiv.classList.add('hidden');
            };
            option.addEventListener('click', optionHandler);
            option._aspectRatioOptionHandler = optionHandler; // Store reference
        });

        // Click outside to close dropdown
        // Remove existing listener to prevent duplicates
        if (document._aspectRatioGlobalCloseHandler) {
            document.removeEventListener('click', document._aspectRatioGlobalCloseHandler);
        }
        const globalCloseHandler = (event) => { 
            if (aspectRatioButton && !aspectRatioButton.contains(event.target) && 
                aspectRatioOptionsDiv && !aspectRatioOptionsDiv.contains(event.target)) {
                aspectRatioOptionsDiv.classList.add('hidden');
            }
        };
        document.addEventListener('click', globalCloseHandler);
        document._aspectRatioGlobalCloseHandler = globalCloseHandler; // Store reference
    }

    // Model Select
    const newModelSelect = modelSelect.cloneNode(true);
    modelSelect.parentNode.replaceChild(newModelSelect, modelSelect);
    modelSelect = newModelSelect;
    modelSelect.addEventListener('change', handleModelChange);

    // Style Select
    const newStyleSelectElement = styleSelectElement.cloneNode(true);
    styleSelectElement.parentNode.replaceChild(newStyleSelectElement, styleSelectElement);
    styleSelectElement = newStyleSelectElement;
    styleSelectElement.addEventListener('change', updateHiddenStyleInputs); // Only update hidden inputs

    // Initial state updates
    updateControlsBasedOnState(); 
    updateCostDisplay(); 
    updateStyleDropdown(); // This will also call updateHiddenStyleInputs
    
    // Check if an image was loaded via URL (from core.js) and update local state
    const imageForEditUrlInput = document.getElementById('image-for-edit-url'); // Fresh reference
    if (imageForEditUrlInput && imageForEditUrlInput.value) {
        loadedImageUrl = imageForEditUrlInput.value;
        debugLog('[Create Tab] Initializing with loadedImageUrl:', loadedImageUrl);
        // Display thumbnail if loadedImageUrl is present
        if(thumbnail) {
            thumbnail.src = loadedImageUrl;
            thumbnail.classList.remove('hidden');
        }
        if(placeholderIcon) placeholderIcon.classList.add('hidden');
        if(clearButton) clearButton.classList.remove('hidden');
        updateControlsBasedOnState(); // Re-run to ensure strength slider and generate button state are visible/correct
        updateCostDisplay(); // Re-run to ensure cost is correct for I2I
    } else {
        // If no image URL is provided, ensure a clean initial state (Txt2Img mode)
        uploadedFileObject = null;
        loadedImageUrl = null;
        if(thumbnail) { thumbnail.src = '#'; thumbnail.classList.add('hidden');}
        if(placeholderIcon) placeholderIcon.classList.remove('hidden');
        if(clearButton) clearButton.classList.add('hidden');
        // Reset prompt for Txt2Img
        if(imagePrompt) imagePrompt.value = '';
        autoResizeTextarea(imagePrompt);
        updateControlsBasedOnState();
        updateCostDisplay();
    }
}

// --- Event Handler for Model Change ---
function handleModelChange() { 
    debugLog('[Create Tab] handleModelChange triggered');
    updateControlsBasedOnState(); 
    updateCostDisplay(); 
    updateStyleDropdown(); // This will also call updateHiddenStyleInputs
    // updateHiddenStyleInputs(); is called by updateStyleDropdown
}

// --- Main Setup Function (called by core.js) ---
window.setupCreateTab = () => {
    debugLog('[Create Tab] setupCreateTab called');
    initializeCreateTabControls(); 
    
    imageSubmit = document.getElementById('image-generate-button'); 
    if (!imageSubmit) {
        console.error('[Create Tab] setupCreateTab: imageSubmit button not found. Cannot attach listener.');
        return;
    }

    // Clone and replace to ensure fresh listener, removing any old ones.
    // This is crucial if setupCreateTab can be called multiple times (e.g., tab switching)
    if (imageSubmit.parentNode) {
        const newImageSubmit = imageSubmit.cloneNode(true);
        imageSubmit.parentNode.replaceChild(newImageSubmit, imageSubmit);
        imageSubmit = newImageSubmit; 
    }

    imageSubmit.addEventListener('click', imageGenerationClickHandler);
    debugLog('[Create Tab] setupCreateTab: Attached new click listener to imageSubmit.');

    // modelSelect listener is already handled within initializeCreateTabControls via cloning.
    // No need to explicitly re-attach here.

    // Initial cost update (redundant if called in initializeCreateTabControls, but safe)
    updateCostDisplay();
};

// --- Image Generation Click Handler ---
async function imageGenerationClickHandler(event) {
    debugLog('[Create Image Tab] Generate button clicked at', new Date().toISOString());
    
    // Re-fetch critical elements within the handler to ensure they are current if DOM was manipulated
    imagePrompt = document.getElementById('image-prompt-input');
    modelSelect = document.getElementById('image-model-select');
    aspectRatioButton = document.getElementById('aspect-ratio-dropdown');
    styleSelectElement = document.getElementById('style-select');
    imageSubmit = document.getElementById('image-generate-button'); 
    imageStrengthSlider = document.getElementById('image-strength-slider'); 
    imageUploadInput = document.getElementById('image-upload-input'); 
    const imageForEditUrlInput = document.getElementById('image-for-edit-url'); // VERY IMPORTANT: Get fresh reference

    if (!window.isLoggedIn) {
        window.showToast('Please log in to create images.', 'error'); return;
    }

    // Determine the image source for generation (prioritize uploaded file, then loaded URL)
    let imageSource = null;
    let imageType = null; // 'file' or 'url'

    if (uploadedFileObject) { // From direct file upload
        imageSource = uploadedFileObject;
        imageType = 'file';
    } else if (imageForEditUrlInput && imageForEditUrlInput.value) { // From gallery/modal edit
        imageSource = imageForEditUrlInput.value;
        imageType = 'url';
        loadedImageUrl = imageForEditUrlInput.value; // Keep loadedImageUrl state consistent
    } else {
        loadedImageUrl = null; // Ensure loadedImageUrl is cleared if no source
    }

    const selectedModelValue = modelSelect ? modelSelect.value : '';
    const isPhotoMakerSelected = selectedModelValue === 'civitai:133005@782002';

    // Conditional prompt checks
    if (!imagePrompt || !imagePrompt.value.trim()) {
        if (!imageSource) { // If no image is provided at all
            window.showToast('Please enter a prompt to generate an image.', 'info');
            return;
        } else if (isPhotoMakerSelected) { // PhotoMaker requires both prompt and image
            window.showToast('Please enter a prompt and upload a face image for the Face / Character model.', 'error');
            return;
        } else { // Image provided, but no prompt - allow but warn
             window.showToast('A prompt is highly recommended when editing an image, even with an input image.', 'info');
        }
    } else if (isPhotoMakerSelected && !imageSource) { // Prompt provided, but no image for PhotoMaker
        window.showToast('Please upload a face image to use the Face / Character model (even with a prompt).', 'error');
        return;
    }


    const mainContentArea = document.getElementById('content-area');
    let chatMessagesArea = document.getElementById('chat-messages'); 

    if (!mainContentArea) {
        console.error('[Create Tab] CRITICAL: Main #content-area NOT FOUND.');
        window.showToast('Display area error. Please refresh.', 'error'); return;
    }

    // --- CORRECTED AND SINGLE CONDITIONAL CLEARING LOGIC ---
    if (window.hasAccessedSideMenu || !window.isContentAreaDisplayingNewSession) {
        debugLog('[Create Tab] imageGenerationClickHandler: Clearing #chat-messages for new image generation session.');
        if (!chatMessagesArea || !mainContentArea.contains(chatMessagesArea)) {
            // If chatMessagesArea doesn't exist or is not inside mainContentArea, create it
            mainContentArea.innerHTML = ''; 
            chatMessagesArea = document.createElement('div'); 
            chatMessagesArea.id = 'chat-messages';
            chatMessagesArea.classList.add('flex-1', 'overflow-y-auto', 'pb-32');
            mainContentArea.appendChild(chatMessagesArea);
            debugLog('[Create Tab] imageGenerationClickHandler: Created #chat-messages inside #content-area.');
        } else {
            // If it exists and is in the content area, just clear its inner HTML
            chatMessagesArea.innerHTML = '';
        }
        chatMessagesArea.innerHTML = '<h3 class="image-area-title text-lg font-semibold text-center py-4">New Image Generations</h3>';
        window.isContentAreaDisplayingNewSession = true;
        window.hasAccessedSideMenu = false; 
        debugLog('[Create Tab] imageGenerationClickHandler: #chat-messages cleared and titled. Flags updated.');
    } else if (!chatMessagesArea) {
        // Fallback if somehow chatMessagesArea is null despite flags (shouldn't happen with above logic)
        console.warn('[Create Tab] imageGenerationClickHandler: #chat-messages not found. Recreating #chat-messages as fallback.');
        mainContentArea.innerHTML = ''; 
        chatMessagesArea = document.createElement('div');
        chatMessagesArea.id = 'chat-messages';
        chatMessagesArea.classList.add('flex-1', 'overflow-y-auto', 'pb-32');
        mainContentArea.appendChild(chatMessagesArea);
        chatMessagesArea.innerHTML = '<h3 class="image-area-title text-lg font-semibold text-center py-4">New Image Generations</h3>';
        window.isContentAreaDisplayingNewSession = true; 
        debugLog('[Create Tab] imageGenerationClickHandler: Fallback - Recreated #chat-messages and set title.');
    }
    // --- END OF CORRECTED CONDITIONAL CLEARING LOGIC ---

    
    const originalButtonText = imageSubmit.textContent;
    imageSubmit.disabled = true;
    imageSubmit.textContent = 'Generating...';
    if(imagePrompt) imagePrompt.disabled = true;

    const placeholderUniqueId = `img-placeholder-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    const placeholderDiv = document.createElement('div');
    placeholderDiv.id = placeholderUniqueId;
    placeholderDiv.classList.add('image-loading-placeholder', 'p-4', 'my-2', 'border', 'border-gray-700', 'rounded', 'flex', 'flex-col', 'items-center', 'justify-center', 'bg-gray-800', 'w-full', 'md:w-[400px]', 'mx-auto', 'min-h-64'); 
    
    const loadingIndicator = createLoadingIndicator(`loading-${placeholderUniqueId}`);
    placeholderDiv.appendChild(loadingIndicator);
    const promptTextForPlaceholder = document.createElement('p');
    promptTextForPlaceholder.textContent = `Generating: "${imagePrompt.value.trim().substring(0, 50)}${imagePrompt.value.trim().length > 50 ? '...' : ''}"`;
    promptTextForPlaceholder.classList.add('text-xs', 'text-gray-400', 'mt-2');
    placeholderDiv.appendChild(promptTextForPlaceholder);

    if (chatMessagesArea) { 
        // Insert placeholder at the beginning of the messages area (after the title)
        const titleH3 = chatMessagesArea.querySelector('h3.image-area-title'); 
        if (titleH3) {
            titleH3.insertAdjacentElement('afterend', placeholderDiv);
        } else {
            chatMessagesArea.prepend(placeholderDiv); 
        }
        chatMessagesArea.scrollTop = 0; // Scroll to top to see new generation
    } else {
        console.error("[Create Tab] chatMessagesArea is unexpectedly null after clearing logic. Appending placeholder to mainContentArea as fallback.");
        mainContentArea.appendChild(placeholderDiv); 
    }

    let apiUrl;
    const csrfToken = document.querySelector('meta[name="csrf-token"]').getAttribute('content');
    
    // Always start with FormData for /image-to-image, revert to JSON for /text-to-image
    let formData = new FormData();
    let fetchOptions = { method: 'POST', headers: { 'Accept': 'application/json', 'X-CSRF-Token': csrfToken }}; // Keep Accept and CSRF

    // Base payload for common fields
    const basePayload = {
        prompt: imagePrompt.value.trim(),
        modelId: modelSelect ? modelSelect.value : '',
        aspectRatio: aspectRatioButton.dataset.value,
        style: styleSelectElement ? styleSelectElement.value : '', // This sends the value (e.g., civitai:ID or 'cinematic')
        styleLabel: document.getElementById('style-label-input').value, // This sends the cleaned label (e.g., 'Classic Oil Painting')
        negativePrompt: document.getElementById('negative-prompt-input').value || '' // Use the hidden negative prompt value
    };

    // Determine API endpoint and specific payload based on image presence
    if (imageType === 'file') {
        apiUrl = '/generate/image-to-image';
        // Append all basePayload fields to FormData
        for (const key in basePayload) {
            formData.append(key, basePayload[key]);
        }
        formData.append('image', imageSource, imageSource.name); // imageSource is the File object here
        formData.append('strength', imageStrengthSlider ? imageStrengthSlider.value : '0.75');
        fetchOptions.body = formData; // Send FormData
        // No 'Content-Type' header needed for FormData
    } else if (imageType === 'url') {
        apiUrl = '/generate/image-to-image'; // Still image-to-image API
        // Append all basePayload fields to FormData
        for (const key in basePayload) {
            formData.append(key, basePayload[key]);
        }
        // Append the image URL to FormData as a regular field
        formData.append('imageForEditUrl', imageSource); // imageSource is the URL string here
        formData.append('strength', imageStrengthSlider ? imageStrengthSlider.value : '0.75');
        fetchOptions.body = formData; // Send FormData
        // No 'Content-Type' header needed for FormData, browser sets it correctly for multipart/form-data
    } else { // Text-to-image
        apiUrl = '/generate/text-to-image';
        // For text-to-image, we want to send JSON directly.
        fetchOptions.headers['Content-Type'] = 'application/json';
        fetchOptions.body = JSON.stringify(basePayload);
    }

    try {
        const response = await fetch(apiUrl, fetchOptions);
        const placeholderToUpdate = document.getElementById(placeholderUniqueId);

        if (!response.ok) {
            let errorMsg = `HTTP error! Status: ${response.status}`;
            try { const errorData = await response.json(); errorMsg = errorData.message || errorData.error || errorMsg; }
            catch (e) { console.warn('[Create Tab] Could not parse error response as JSON for !response.ok.'); }
            console.error('[Create Tab] API error:', errorMsg);
            if (placeholderToUpdate) placeholderToUpdate.innerHTML = `<p class="text-red-500 p-2">Error: ${errorMsg}</p>`;
            else window.showToast(`Error: ${errorMsg}`, 'error');
        } else {
            const data = await response.json();
            debugLog("[Create Tab] API success response data:", JSON.stringify(data, null, 2));

            if (data.success && data.imageUrl) {
                const imageCard = document.createElement('div');
                imageCard.classList.add('generated-image-card', 'my-2', 'p-2', 'border', 'border-gray-700', 'rounded', 'bg-gray-800', 'relative', 'w-full', 'md:w-[400px]', 'mx-auto');
                imageCard.dataset.contentId = data.imageId || placeholderUniqueId;
                
                const imgElement = document.createElement('img');
                imgElement.src = data.imageUrl;
                imgElement.alt = data.prompt || 'Generated Image';
                imgElement.classList.add('generated-image', 'rounded', 'w-full', 'h-auto', 'object-contain', 'cursor-pointer');
                imgElement.addEventListener('click', () => {
                    if (window.openCommentsModal) window.openCommentsModal(data.imageId, data.imageUrl, data.prompt);
                    else console.warn('openCommentsModal function not defined');
                });
                
                const promptTextElement = document.createElement('p');
                promptTextElement.textContent = data.prompt || 'Generated Image';
                promptTextElement.classList.add('text-xs', 'text-gray-300', 'mt-1', 'truncate');
                
                // Add "Edit Image" button to the card
                const editButton = document.createElement('button');
                editButton.classList.add('edit-image-button', 'absolute', 'bottom-2', 'right-2', 'bg-blue-600', 'hover:bg-blue-700', 'text-white', 'text-xs', 'px-2', 'py-1', 'rounded');
                editButton.textContent = 'Edit Image';
                editButton.title = 'Edit this image';
                editButton.addEventListener('click', () => {
                    // This re-uses the handleEditImageAction from core.js
                    if (window.handleEditImageAction) {
                        window.handleEditImageAction(data.imageUrl);
                    } else {
                        console.warn('window.handleEditImageAction is not defined.');
                        window.showToast('Edit functionality not available. Please refresh.', 'error');
                    }
                });

                imageCard.appendChild(imgElement);
                imageCard.appendChild(promptTextElement);
                imageCard.appendChild(editButton); // Add the edit button

                if (placeholderToUpdate) placeholderToUpdate.replaceWith(imageCard);
                else if (chatMessagesArea) { 
                    const titleH3 = chatMessagesArea.querySelector('h3.image-area-title');
                    if (titleH3) {
                        titleH3.insertAdjacentElement('afterend', imageCard);
                    } else {
                        chatMessagesArea.prepend(imageCard);
                    }
                }
                
                window.showToast(data.message || 'Image generated successfully!', 'success');
                // You likely have a function in core.js to update user credits
                if (typeof window.updateUserCreditsDisplay === 'function') {
                    window.updateUserCreditsDisplay(); // This typically fetches current credits
                }
            } else {
                let specificErrorMessage = 'Image URL missing or generation failed.'; 
                if (!data.success && data.message) { 
                    specificErrorMessage = data.message;
                } else if (data.success && !data.imageUrl && data.message) { 
                     specificErrorMessage = `Info: ${data.message}`; 
                } else if (data.message) { 
                    specificErrorMessage = data.message;
                } else if (!data.success) { 
                    specificErrorMessage = 'Generation reported as not successful by API.';
                }
                
                console.error('[Create Tab] Image generation failed or data incomplete:', specificErrorMessage, 'Full data:', data);
                if (placeholderToUpdate) {
                    placeholderToUpdate.innerHTML = `<p class="text-red-500 p-2">Failed: ${specificErrorMessage}</p>`;
                } else {
                    window.showToast(`Generation Error: ${specificErrorMessage}`, 'error');
                }
            }
        }
    } catch (error) {
        console.error('[Create Tab] Fetch operation or JSON parsing error:', error);
        const placeholderToUpdateOnError = document.getElementById(placeholderUniqueId);
        if (placeholderToUpdateOnError) placeholderToUpdateOnError.innerHTML = `<p class="text-red-500 p-4">Request Error: ${error.message}</p>`;
        else window.showToast(`Request Error: ${error.message}`, 'error');
    } finally {
        // Clear thumbnail, inputs, and reset UI state after generation attempts
        if(thumbnail) thumbnail.src = '#';
        if(imageUploadInput) imageUploadInput.value = '';
        const imageForEditUrlInput = document.getElementById('image-for-edit-url'); // Fresh reference
        if(imageForEditUrlInput) imageForEditUrlInput.value = '';
        if(placeholderIcon) {
            thumbnail.classList.add('hidden');
            placeholderIcon.classList.remove('hidden');
        }
        if(clearButton) clearButton.classList.add('hidden');
        uploadedFileObject = null;
        loadedImageUrl = null;
        window.toggleImageStrengthControl(false); // Hide strength slider

        if(imageSubmit) {
             imageSubmit.disabled = false;
             imageSubmit.textContent = originalButtonText;
        }
       if(imagePrompt) {
           imagePrompt.disabled = false;
           // If it was a Txt2Img generation, clear the prompt
           if (imageType === 'text-to-image') {
               imagePrompt.value = '';
               autoResizeTextarea(imagePrompt);
           }
       }
       updateControlsBasedOnState(); // Ensure button state is correct post-generation
    }
}

// --- Initial DOM Ready Setup ---
// Ensure setupCreateTab is called when the DOM is ready for the create-images-content
// and when the element is actually present.
document.addEventListener('DOMContentLoaded', () => {
    const createImagesContent = document.getElementById('create-images-content');
    if (createImagesContent) {
        // If the 'create-images' tab is the initially active tab on page load
        const activeTabElement = document.querySelector('.chat-tab.active');
        if (activeTabElement && activeTabElement.dataset.tab === 'create-images') {
            window.setupCreateTab();
        }
    } else {
        // If create-images-content is not immediately available, rely on core.js's loadChatTab
        // or a similar mechanism to call window.setupCreateTab when the partial is loaded.
        debugLog('[Create Tab] create-images-content not found on DOMContentLoaded. Will rely on dynamic loading.');
    }
});
