// public/js/create-tab.js
debugLog('create-tab.js script tag executed');

// --- Global State Variables ---
let uploadedFileObject = null;

// --- DOM Element Variables (globally available, initialized in setup) ---
let imageUploadInput, thumbnail, placeholderIcon, clearButton, strengthControl,
    imageStrengthSlider, imageStrengthValueDisplay, aspectRatioButton,
    modelSelect, styleSelectElement, imagePrompt, imageSubmit;
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

// --- Model Style Definitions ---
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
    const modelSelect = document.getElementById('image-model-select');
    const imageCostDisplay = document.getElementById('image-token-cost-display');
    
    if (!modelSelect || !imageCostDisplay) {
        console.warn('[Create Tab] updateCostDisplay: modelSelect or imageCostDisplay not found.');
        return;
    }

    const selectedOption = modelSelect.options[modelSelect.selectedIndex];
    let cost = parseFloat(selectedOption.dataset.cost) || 0;
    
    debugLog(`[Cost Update] Model: ${selectedOption.value}, Cost: ${cost}`);
    imageCostDisplay.textContent = `($${cost.toFixed(4)})`;
}

// --- Helper function to update control states (e.g., disabled/enabled) ---
function updateControlsBasedOnState() {
    const currentImageSubmit = document.getElementById('image-generate-button'); 
    if (!modelSelect || !imagePrompt || !strengthControl || !currentImageSubmit || !aspectRatioButton) {
        if(currentImageSubmit) currentImageSubmit.disabled = true; 
        return;
    }
    const modelValue = modelSelect.value;
    const models = window.RUNWARE_MODELS || {};
    const selectedModelConfig = models[modelValue] || null;
    const isImg2ImgCapable = selectedModelConfig ? selectedModelConfig.type !== 'text-to-image' : false;
    const hasUploadedImage = uploadedFileObject !== null;
    const hasPromptValue = imagePrompt.value.trim().length > 0;

    strengthControl.classList.toggle('hidden', !(hasUploadedImage && isImg2ImgCapable));
    let disableGenerate = false;
    if (!isImg2ImgCapable) disableGenerate = !hasPromptValue;
    else disableGenerate = !hasPromptValue || !hasUploadedImage;
    currentImageSubmit.disabled = disableGenerate;

    const photoMakerModelId = 'civitai:133005@782002';
    const disableAspectRatio = hasUploadedImage && modelValue !== photoMakerModelId;
    if(aspectRatioButton) { 
        aspectRatioButton.disabled = disableAspectRatio;
        aspectRatioButton.classList.toggle('opacity-50', disableAspectRatio);
        aspectRatioButton.classList.toggle('cursor-not-allowed', disableAspectRatio);
        if (disableAspectRatio) aspectRatioButton.title = "Aspect ratio is determined by the uploaded image";
        else if (hasUploadedImage && modelValue === photoMakerModelId) aspectRatioButton.title = "Select Aspect Ratio (May be overridden by Face model)";
        else aspectRatioButton.title = "Select Aspect Ratio";
    }
}

// --- Helper function to update style dropdown based on selected model ---
function updateStyleDropdown() {
    if (!styleSelectElement || !modelSelect) return;
    const modelId = modelSelect.value; styleSelectElement.innerHTML = '';
    const modelConfig = window.RUNWARE_MODELS ? window.RUNWARE_MODELS[modelId] : null;
    
    const noneOption = document.createElement('option');
    noneOption.value = '';
    noneOption.textContent = 'Style: None'; // Clearer "None" option
    styleSelectElement.appendChild(noneOption);

    if (modelConfig && modelConfig.usesPromptBasedStyling && window.PROMPT_BASED_STYLES && window.PROMPT_BASED_STYLES.length > 0) {
        window.PROMPT_BASED_STYLES.forEach(style => {
            const option = document.createElement('option'); option.value = style.value; option.textContent = style.name; styleSelectElement.appendChild(option);
        });
    } else if (modelStyles[modelId]) {
        modelStyles[modelId].forEach(style => {
            if(style.value !== '') { 
                const option = document.createElement('option'); option.value = style.value; option.textContent = style.label; 
                if(style.negativePrompt) option.dataset.negativePrompt = style.negativePrompt; // Add negative prompt to option
                styleSelectElement.appendChild(option);
            }
        });
    }
    styleSelectElement.value = ''; // Default to "None"
}

// --- Helper function to update hidden inputs for style ---
function updateHiddenStyleInputs() {
    if (!styleSelectElement) return;
    const selectedOption = styleSelectElement.options[styleSelectElement.selectedIndex];
    const label = selectedOption ? selectedOption.textContent : '';
    // Get negative prompt from dataset if it exists on the selected style option
    const negativePromptValue = selectedOption ? (selectedOption.dataset.negativePrompt || '') : '';
    
    const labelInput = document.getElementById('style-label-input');
    const negPromptInput = document.getElementById('negative-prompt-input');
    if (labelInput) labelInput.value = label;
    if (negPromptInput) negPromptInput.value = negativePromptValue;
}

// --- Helper function to toggle generate button based on prompt ---
function toggleGenerateButtonState() {
    const currentImageSubmit = document.getElementById('image-generate-button');
    if (imagePrompt && currentImageSubmit) {
       currentImageSubmit.disabled = imagePrompt.value.trim() === '';
    }
}

// --- Helper function to update strength slider UI ---
function updateStrengthSliderUI() {
    if (imageStrengthSlider && imageStrengthValueDisplay) {
       imageStrengthValueDisplay.textContent = parseFloat(imageStrengthSlider.value).toFixed(2);
    }
}

// --- Control Initialization and Event Listeners ---
function initializeCreateTabControls() {
    debugLog('[Create Tab] initializeCreateTabControls called');
    // Query for all elements needed by this tab's controls
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
    // imageSubmit is handled by setupCreateTab for its main click listener

    if (!modelSelect || !styleSelectElement || !imageUploadInput || !imagePrompt || !aspectRatioButton || !strengthControl) {
        console.warn('[Create Tab] initializeCreateTabControls: One or more essential control elements not found. Some controls may not initialize/update correctly.');
    }
    
    // --- Attach Listeners (using cloning for elements that might get stale) ---
    if (imagePrompt) {
        const newImagePrompt = imagePrompt.cloneNode(true);
        if(imagePrompt.parentNode) imagePrompt.parentNode.replaceChild(newImagePrompt, imagePrompt);
        imagePrompt = newImagePrompt;
        imagePrompt.addEventListener('input', () => autoResizeTextarea(imagePrompt));
        imagePrompt.addEventListener('input', toggleGenerateButtonState);
        autoResizeTextarea(imagePrompt); toggleGenerateButtonState(); // Initial calls
    }

    if(imageStrengthSlider) {
        const newImageStrengthSlider = imageStrengthSlider.cloneNode(true);
        if(imageStrengthSlider.parentNode) imageStrengthSlider.parentNode.replaceChild(newImageStrengthSlider, imageStrengthSlider);
        imageStrengthSlider = newImageStrengthSlider;
        imageStrengthSlider.addEventListener('input', updateStrengthSliderUI);
        updateStrengthSliderUI(); // Initial call
    }

    if (imageUploadInput && thumbnail && placeholderIcon && clearButton) {
        const newImageUploadInput = imageUploadInput.cloneNode(true);
        if (imageUploadInput.parentNode) imageUploadInput.parentNode.replaceChild(newImageUploadInput, imageUploadInput);
        imageUploadInput = newImageUploadInput;

        imageUploadInput.addEventListener('change', function(event) {
            const file = event.target.files[0];
            if (file) {
                if (!file.type.startsWith('image/')) { window.showToast('Please select an image file.', 'error'); return; }
                if (file.size > 5 * 1024 * 1024) { window.showToast('File size exceeds 5MB limit.', 'error'); return; }
                uploadedFileObject = file;
                const reader = new FileReader();
                reader.onload = function(e) {
                    if(thumbnail) { thumbnail.src = e.target.result; thumbnail.classList.remove('hidden');}
                    if(placeholderIcon) placeholderIcon.classList.add('hidden'); 
                    if(clearButton) clearButton.classList.remove('hidden');
                    updateControlsBasedOnState(); updateCostDisplay();
                }
                reader.readAsDataURL(file);
            } else {
                uploadedFileObject = null; 
                if(thumbnail) { thumbnail.src = '#'; thumbnail.classList.add('hidden');}
                if(placeholderIcon) placeholderIcon.classList.remove('hidden'); 
                if(clearButton) clearButton.classList.add('hidden');
                updateControlsBasedOnState(); updateCostDisplay();
            }
        });
        
        const newClearButton = clearButton.cloneNode(true);
        if(clearButton.parentNode) clearButton.parentNode.replaceChild(newClearButton, clearButton);
        clearButton = newClearButton;
        clearButton.addEventListener('click', () => {
            uploadedFileObject = null; if(imageUploadInput) imageUploadInput.value = ''; 
            if(thumbnail) { thumbnail.src = '#'; thumbnail.classList.add('hidden');}
            if(placeholderIcon) placeholderIcon.classList.remove('hidden'); 
            if(clearButton) clearButton.classList.add('hidden');
            updateControlsBasedOnState(); updateCostDisplay();
        });
    }
    
    const aspectRatioDropdownBtn = document.getElementById('aspect-ratio-dropdown'); // Re-fetch for listener
    const aspectRatioOptionsDiv = document.getElementById('aspect-ratio-options');
    if(aspectRatioDropdownBtn && aspectRatioOptionsDiv) {
        // No need to clone aspectRatioButton if its listener is simple and doesn't change context
        aspectRatioDropdownBtn.addEventListener('click', () => { 
            if(aspectRatioButton.disabled) return; // Use the global aspectRatioButton here
            aspectRatioOptionsDiv.classList.toggle('hidden');
        });
        
        // For options, ensure listeners are fresh if options are dynamically loaded (not the case here)
        // or if parent (aspectRatioOptionsDiv) is cloned. Here, we assume options are static.
        aspectRatioOptionsDiv.querySelectorAll('.aspect-ratio-option').forEach(option => {
            const newOption = option.cloneNode(true); // Clone to be safe with listeners
            option.parentNode.replaceChild(newOption, option);
            newOption.addEventListener('click', (e) => { 
                e.preventDefault();
                const selectedValue = newOption.dataset.value;
                if(aspectRatioButton) aspectRatioButton.dataset.value = selectedValue; 
                const textSpan = aspectRatioButton ? aspectRatioButton.querySelector('#selected-ratio-text') : null;
                const iconSpan = aspectRatioButton ? aspectRatioButton.querySelector('#selected-ratio-icon') : null;
                if(textSpan) textSpan.textContent = newOption.textContent.trim().split(' ')[1] || selectedValue;
                if(iconSpan && newOption.querySelector('i')) iconSpan.innerHTML = newOption.querySelector('i').outerHTML;
                aspectRatioOptionsDiv.classList.add('hidden');
            });
        });
        document.addEventListener('click', (event) => { 
            if (aspectRatioButton && !aspectRatioButton.contains(event.target) && 
                aspectRatioOptionsDiv && !aspectRatioOptionsDiv.contains(event.target)) {
                aspectRatioOptionsDiv.classList.add('hidden');
            }
        });
    }

    if (modelSelect) {
        // Avoid cloning here, as setupCreateTab handles modelSelect listener
        modelSelect.addEventListener('change', handleModelChange);
    }
    if (styleSelectElement) { 
        const newStyleSelectElement = styleSelectElement.cloneNode(true);
        if(styleSelectElement.parentNode) styleSelectElement.parentNode.replaceChild(newStyleSelectElement, styleSelectElement);
        styleSelectElement = newStyleSelectElement;
        styleSelectElement.addEventListener('change', updateHiddenStyleInputs);
    }

    // Initial state updates
    updateControlsBasedOnState(); 
    updateCostDisplay(); 
    updateStyleDropdown(); 
    updateHiddenStyleInputs();
}

// --- Event Handler for Model Change ---
function handleModelChange() { 
    debugLog('[Create Tab] handleModelChange triggered');
    updateControlsBasedOnState(); 
    updateCostDisplay(); 
    updateStyleDropdown();
    updateHiddenStyleInputs(); // Ensure hidden inputs (like negative prompt) are updated
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
    if (imageSubmit.parentNode) {
        const newImageSubmit = imageSubmit.cloneNode(true);
        imageSubmit.parentNode.replaceChild(newImageSubmit, imageSubmit);
        imageSubmit = newImageSubmit; 
    }

    imageSubmit.addEventListener('click', imageGenerationClickHandler);
    debugLog('[Create Tab] setupCreateTab: Attached new click listener to imageSubmit.');

    // Ensure modelSelect listener is attached (in case core.js refreshes DOM)
    modelSelect = document.getElementById('image-model-select');
    if (modelSelect) {
        modelSelect.removeEventListener('change', handleModelChange); // Prevent duplicates
        modelSelect.addEventListener('change', handleModelChange);
        debugLog('[Create Tab] setupCreateTab: Attached change listener to image-model-select');
    } else {
        console.warn('[Create Tab] setupCreateTab: image-model-select not found');
    }

    // Initial cost update
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

    if (!window.isLoggedIn) {
        window.showToast('Please log in to create images.', 'error'); return;
    }
    if (!imagePrompt || !imagePrompt.value.trim()) {
        window.showToast('Please enter a prompt.', 'info'); return;
    }

    const mainContentArea = document.getElementById('content-area');
    let chatMessagesArea = document.getElementById('chat-messages'); // Get current #chat-messages

    if (!mainContentArea) {
        console.error('[Create Tab] CRITICAL: Main #content-area NOT FOUND.');
        window.showToast('Display area error. Please refresh.', 'error'); return;
    }

    // --- CORRECTED AND SINGLE CONDITIONAL CLEARING LOGIC ---
    if (window.hasAccessedSideMenu || !window.isContentAreaDisplayingNewSession) {
        debugLog('[Create Tab] imageGenerationClickHandler: Clearing #chat-messages for new image generation session.');
        if (!chatMessagesArea || !mainContentArea.contains(chatMessagesArea)) {
            mainContentArea.innerHTML = ''; 
            chatMessagesArea = document.createElement('div'); 
            chatMessagesArea.id = 'chat-messages';
            chatMessagesArea.classList.add('flex-1', 'overflow-y-auto', 'pb-32');
            mainContentArea.appendChild(chatMessagesArea);
            debugLog('[Create Tab] imageGenerationClickHandler: Created #chat-messages inside #content-area.');
        } else {
            chatMessagesArea.innerHTML = '';
        }
        chatMessagesArea.innerHTML = '<h3 class="image-area-title text-lg font-semibold text-center py-4">New Image Generations</h3>';
        window.isContentAreaDisplayingNewSession = true;
        window.hasAccessedSideMenu = false; 
        debugLog('[Create Tab] imageGenerationClickHandler: #chat-messages cleared and titled. Flags updated.');
    } else if (!chatMessagesArea) {
        console.warn('[Create Tab] imageGenerationClickHandler: #chat-messages not found. Recreating #chat-messages.');
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

    const selectedModelValue = modelSelect ? modelSelect.value : null;
    const isPhotoMakerSelected = selectedModelValue === 'civitai:133005@782002';
    if (isPhotoMakerSelected && !uploadedFileObject) {
        window.showToast('Please upload a face image to use the Face / Character model.', 'error'); return;
    }

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

    if (chatMessagesArea) { // Ensure chatMessagesArea is valid before appending
        const titleH3 = chatMessagesArea.querySelector('h3.image-area-title'); // Be more specific
        if (titleH3 && titleH3.nextSibling) chatMessagesArea.insertBefore(placeholderDiv, titleH3.nextSibling);
        else if (titleH3) chatMessagesArea.appendChild(placeholderDiv); // Append if title is last
        else chatMessagesArea.prepend(placeholderDiv); // Prepend if no title (should have one from clearing logic)
        chatMessagesArea.scrollTop = 0; 
    } else {
        console.error("[Create Tab] chatMessagesArea is unexpectedly null after clearing logic. Appending placeholder to mainContentArea as fallback.");
        mainContentArea.appendChild(placeholderDiv); // Fallback, though ideally chatMessagesArea should exist
    }

    let apiUrl;
    const csrfToken = document.querySelector('meta[name="csrf-token"]').getAttribute('content');
    let fetchOptions = { method: 'POST', headers: { 'Accept': 'application/json', 'X-CSRF-Token': csrfToken }};
    const formData = new FormData();
    formData.append('prompt', imagePrompt.value.trim());
    formData.append('modelId', modelSelect ? modelSelect.value : '');
    formData.append('style', styleSelectElement ? styleSelectElement.value : '');
    const styleLabelInput = document.getElementById('style-label-input');
    const negativePromptInput = document.getElementById('negative-prompt-input');
    if (styleLabelInput) formData.append('styleLabel', styleLabelInput.value);
    if (negativePromptInput) formData.append('negativePromptOverride', negativePromptInput.value);

    if (uploadedFileObject) {
        apiUrl = '/generate/image-to-image';
        formData.append('aspectRatio', aspectRatioButton.dataset.value);
        formData.append('image', uploadedFileObject, uploadedFileObject.name);
        formData.append('strength', imageStrengthSlider.value || '0.75');
        fetchOptions.body = formData;
    } else {
        apiUrl = '/generate/text-to-image';
        const selectedStyleOption = styleSelectElement ? styleSelectElement.options[styleSelectElement.selectedIndex] : null;
        const styleName = selectedStyleOption ? selectedStyleOption.text : '';
        fetchOptions.headers['Content-Type'] = 'application/json';
        const payload = {
            prompt: imagePrompt.value.trim(), modelId: modelSelect ? modelSelect.value : '',
            aspectRatio: aspectRatioButton.dataset.value, style: styleSelectElement ? styleSelectElement.value : '',
            styleName: styleName, negativePromptOverride: negativePromptInput ? negativePromptInput.value : ''
        };
        fetchOptions.body = JSON.stringify(payload);
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
                
                imageCard.appendChild(imgElement);
                imageCard.appendChild(promptTextElement);

                if (placeholderToUpdate) placeholderToUpdate.replaceWith(imageCard);
                else if (chatMessagesArea) { 
                    const titleH3 = chatMessagesArea.querySelector('h3.image-area-title');
                    if (titleH3 && titleH3.nextSibling) chatMessagesArea.insertBefore(imageCard, titleH3.nextSibling);
                    else if (titleH3) chatMessagesArea.appendChild(imageCard);
                    else chatMessagesArea.prepend(imageCard);
                }
                
                window.showToast(data.message || 'Image generated successfully!', 'success');
                if (typeof window.updateUserCredits === 'function') {
                    if (data.newCredits !== undefined) window.updateUserCredits(data.newCredits);
                    else console.warn("[Create Tab] data.newCredits not available from API.");
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
        if(imageSubmit) {
             imageSubmit.disabled = false;
             imageSubmit.textContent = originalButtonText;
        }
       if(imagePrompt) imagePrompt.disabled = false;
    }
}

// --- Initial DOM Ready Setup ---
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeCreateTabControls);
} else {
    initializeCreateTabControls();
}