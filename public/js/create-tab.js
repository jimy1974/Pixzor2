console.log('create-tab.js script tag executed');

// --- Global State Variables ---
let uploadedFileObject = null; // Stores the actual File object globally

// --- DOM Element Variables (initialized globally) ---
let imageUploadInput = document.getElementById('image-upload-input');
let thumbnail = document.getElementById('image-thumbnail-preview'); // Renamed from imagePreview for clarity
let placeholderIcon = document.getElementById('thumbnail-placeholder-icon'); // CORRECT ID
let clearButton = document.getElementById('clear-image-upload');
let strengthControl = document.getElementById('image-strength-control');
let imageStrengthSlider = document.getElementById('image-strength-slider'); // Renamed variable
let imageStrengthValueDisplay = document.getElementById('image-strength-value-display'); // CORRECT ID
let aspectRatioButton = document.getElementById('aspect-ratio-dropdown');
let modelSelect = document.getElementById('image-model-select'); // CORRECT ID
let thumbnailContainer = document.getElementById('thumbnail-container'); // Added global declaration
let styleSelectElement = document.getElementById('style-select'); // Added
let styleSelectContainer = document.getElementById('style-select-container'); // Added
let imagePrompt = document.getElementById('image-prompt-input');
let imageSubmit = document.getElementById('image-generate-button'); 
const imageCostDisplay = document.getElementById('image-token-cost-display'); // Corrected ID to match HTML in chat-tab.ejs

// --- Log values immediately after assignment ---
console.log('[Create Tab - Global Scope] Values after immediate assignment:');
console.log('  modelSelect:', modelSelect);
console.log('  styleSelectElement:', styleSelectElement);
console.log('  imageUploadInput:', imageUploadInput);
console.log('  imageSubmit:', imageSubmit);
console.log('  styleSelectContainer:', styleSelectContainer);

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
    // Model ID from Pixzor's dropdown : Array of styles from demo
    'runware:100@1': [ // Flux Schnell
      { value: '', label: 'None' } 
    ],
    'runware:101@1': [ // Flux Dev
      { value: '', label: 'None' },
      { value: 'civitai:180891@838667', label: 'Anime' },
      { value: 'civitai:128568@747534', label: 'Cyberpunk Anime Style', negativePrompt: 'deformed, blurry' },
      { value: 'civitai:748468@837016', label: 'Retro Collage Art' },
      { value: 'civitai:788990@882302', label: 'Creepycute' },
      { value: 'civitai:720587@805786', label: 'DecoPulse FLUX' },
      { value: 'civitai:15452@935477', label: 'Deep Sea Particle Enhancer' },
      { value: 'khialmaster:643886@720252', label: 'Faetastic Details' },
      { value: 'civitai:269592@806653', label: 'Fractal Geometry' },
      { value: 'civitai:747833@843992', label: 'Galactixy Illustrations Style' },
      { value: 'civitai:103528@743778', label: 'Geometric Woman' },
      { value: 'civitai:170039@813900', label: 'Graphic Portrait' },
      { value: 'civitai:894974@1001494', label: 'Mat Miller Art' },
      { value: 'civitai:682651@764057', label: 'Moebius Style' },
      { value: 'civitai:555323@832559', label: 'OB3D Isometric 3D Room' },
      { value: 'civitai:860403@1138383', label: 'Paper Quilling and Layering Style' },
      { value: 'civitai:1000081@1147021', label: 'Classic Oil Painting', negativePrompt: 'deformed, blurry, bad anatomy, worst quality, low quality' }, // Updated based on successful test
      { value: 'civitai:44638@755521', label: 'Disney' }, 
      { value: 'civitai:310964@778472', label: 'Furry Enhancer' }, 
      { value: 'civitai:650743@728041', label: 'MidJourney-style' }, 
      { value: 'civitai:970862@1434002', label: 'Hyper Realism' }, 
      { value: 'civitai:970862@1434002', label: 'Amateur Snapshot' }, 
      { value: 'civitai:784568@974292', label: 'Amazing scenery' } 
    ],
    'rundiffusion:130@100': [ // Juggernaut Pro Flux
      { value: '', label: 'None' } 
    ],
    'civitai:133005@782002': [ // PhotoMaker (Face / Character)
      { value: '', label: 'None' },
      { value: 'cinematic', label: 'Cinematic' },        
      { value: 'disney_character', label: 'Disney Character' },
      { value: 'Digital Art', label: 'Digital Art' },
      { value: 'Fantasy art', label: 'Fantasy Art' },        
      { value: 'photographic', label: 'Photographic' },
      { value: 'neonpunk', label: 'Neonpunk' },
      { value: 'enhance', label: 'Enhance' },
      { value: 'Comic Book', label: 'Comic Book' },
      { value: 'lowpoly', label: 'Lowpoly' },
      { value: 'line-art', label: 'Line Art' }
    ]
};

// --- Auto-resize textarea logic --- 
function autoResizeTextarea(textarea) {
    textarea.style.height = 'auto'; 
    textarea.style.height = (textarea.scrollHeight) + 'px'; 
}

// --- NEW: Function to restore content area ---
function restoreContentArea() {
    const contentArea = document.querySelector('#chat-messages');
    if (contentArea) {
        contentArea.innerHTML = originalContent; // Restore the content
    } else {
        console.error(`[Create Tab] CRITICAL: Content area '#chat-messages' not found during restoration!`);
    }
}

// --- Function to Update Cost Display --- (Define outside DOMContentLoaded if needed elsewhere, or inside if only used there)
function updateCostDisplay() {
    console.log('[Create Tab] updateCostDisplay called');
    if (!modelSelect || !imageCostDisplay) {
        console.warn('[Create Tab] updateCostDisplay: modelSelect or imageCostDisplay not ready. Cannot update cost display.');
        return;
    }

    const modelId = modelSelect.value;
    console.log('[Cost Update] Selected Model ID:', modelId);
    const models = window.RUNWARE_MODELS || {};
    console.log('[Cost Update] RUNWARE_MODELS:', models);
    const modelConfig = models[modelId];
    console.log('[Cost Update] Selected Model Config:', modelConfig);

    let cost = 0;
    const hasUploadedImage = uploadedFileObject !== null;
    console.log('[Cost Update] Has Uploaded Image:', hasUploadedImage);

    if (modelConfig) {
        if (hasUploadedImage && modelConfig.userPriceI2I) {
            cost = modelConfig.userPriceI2I;
            console.log('[Cost Update] Using userPriceI2I:', cost);
        } else if (!hasUploadedImage && modelConfig.userPriceT2I) {
            cost = modelConfig.userPriceT2I;
            console.log('[Cost Update] Using userPriceT2I:', cost);
        } else if (modelConfig.userPrice) {
            cost = modelConfig.userPrice;
            console.log('[Cost Update] Using general userPrice:', cost);
        } else {
            console.warn('[Cost Update] No userPrice defined for this mode. Defaulting to 0.');
        }
    } else {
        console.warn('[Cost Update] Model config not found for ID:', modelId);
        // Fallback to data-cost attribute if available
        const selectedOption = modelSelect.options[modelSelect.selectedIndex];
        if (selectedOption && selectedOption.dataset.cost) {
            cost = parseFloat(selectedOption.dataset.cost) || 0;
            console.log('[Cost Update] Fallback to data-cost attribute:', cost);
        }
    }

    // Display exact cost without rounding
    console.log('[Cost Update] Final exact cost:', cost);
    imageCostDisplay.textContent = `($${cost.toFixed(4)})`;
}

// --- DOMContentLoaded Listener --- 
document.addEventListener('DOMContentLoaded', () => {
    console.log('[DOMContentLoaded] Event Fired. Accessing pre-assigned elements...');
    console.log('create-tab.js: DOMContentLoaded - Initializing elements and controls');

    // --- Log values again inside DOMContentLoaded ---
    console.log('[Create Tab - DOMContentLoaded] Values just before check:');
    console.log('  modelSelect:', modelSelect);
    console.log('  styleSelectElement:', styleSelectElement);
    console.log('  imageUploadInput:', imageUploadInput);
    console.log('  imageSubmit:', imageSubmit);
    console.log('  styleSelectContainer:', styleSelectContainer);

    // --- Check for essential elements right before attaching listeners --- 
    if (!modelSelect || !styleSelectElement || !imageUploadInput || !imageSubmit) {
        console.error('[Create Tab] CRITICAL: Could not find essential elements right before setting listeners. Aborting setup.');
        // Log exactly which one is null
        if (!modelSelect) console.error('modelSelect is null');
        if (!styleSelectElement) console.error('styleSelectElement is null');
        if (!imageUploadInput) console.error('imageUploadInput is null');
        if (!imageSubmit) console.error('imageSubmit is null');
        return; // Stop execution
    }

    // --- Update Controls Based On State (Define early to avoid ReferenceError) ---
    function updateControlsBasedOnState() {
        console.log('[Create Tab] updateControlsBasedOnState called');
        // Ensure elements are checked *within* this function if potentially null
        if (!modelSelect || !imagePrompt || !strengthControl || !imageSubmit || typeof uploadedFileObject === 'undefined' /* Check type, not value */ || !aspectRatioButton) { 
            console.warn('[Create Tab] updateControlsBasedOnState: One or more essential elements/variables not ready. Cannot update controls.');
            if (imageSubmit) imageSubmit.disabled = true; // Default to disabled if elements missing
            return;
        }
    
        const modelValue = modelSelect.value;
        // Access global RUNWARE_MODELS via window object, check for existence
        const models = window.RUNWARE_MODELS || {}; // Default to empty OBJECT if undefined
        const selectedModelConfig = models[modelValue] || null; // Access by key
        // Determine img2img capability based on type (assume non-text-to-image can handle images)
        const isImg2ImgCapable = selectedModelConfig ? selectedModelConfig.type !== 'text-to-image' : false;
        const hasUploadedImage = uploadedFileObject !== null; // Check if the file object exists
        const hasPromptValue = imagePrompt.value.trim().length > 0;
    
        // Show strength slider only if an image is uploaded AND model supports img2img
        strengthControl.classList.toggle('hidden', !(hasUploadedImage && isImg2ImgCapable));
    
        // Generate button disabled logic:
        let disableGenerate = false;
        if (!isImg2ImgCapable) {
            // For text-to-image models: Disable if no prompt
            disableGenerate = !hasPromptValue;
        } else {
            // For image-to-image models: Disable if no prompt OR no image
            disableGenerate = !hasPromptValue || !hasUploadedImage;
        }
        imageSubmit.disabled = disableGenerate;
        console.log(`[UpdateControls] Model: ${modelValue}, Img2ImgCapable: ${isImg2ImgCapable}, HasImage: ${hasUploadedImage}, HasPrompt: ${hasPromptValue}, Generate Disabled: ${imageSubmit.disabled}`);
    
        // Enable/Disable Aspect Ratio Dropdown
        const photoMakerModelId = 'civitai:133005@782002'; // Corrected ID for Face/Character model
        // Disable ONLY if image is uploaded AND the model is NOT PhotoMaker
        const disableAspectRatio = hasUploadedImage && modelValue !== photoMakerModelId;

        aspectRatioButton.disabled = disableAspectRatio;
        aspectRatioButton.classList.toggle('opacity-50', disableAspectRatio);
        aspectRatioButton.classList.toggle('cursor-not-allowed', disableAspectRatio);

        // Set appropriate title
        if (disableAspectRatio) {
            aspectRatioButton.title = "Aspect ratio is determined by the uploaded image for this model";
        } else if (hasUploadedImage && modelValue === photoMakerModelId) {
            aspectRatioButton.title = "Select Aspect Ratio (Note: May be overridden by Face model)";
        } else { // No image uploaded OR (image uploaded AND model is PhotoMaker)
            aspectRatioButton.title = "Select Aspect Ratio";
        }
    }

    console.log('[DOMContentLoaded] Performing initial control and style setup...');
    updateControlsBasedOnState();
    updateCostDisplay(); // Update cost for the default selected model
    if (modelSelect) {
        updateStyleDropdown(); // Populate styles for initially selected model
    } else {
        console.warn('[DOMContentLoaded] modelSelect not found, cannot set initial style options.');
    }

    console.log('create-tab.js: Setting up listeners...');

    // --- Update Style Dropdown & Hidden Inputs (Moved Inside) ---
    function updateStyleDropdown() {
        console.log('[Create Tab] updateStyleDropdown called');
        if (!styleSelectElement || !modelSelect) {
            console.warn('[Create Tab] updateStyleDropdown: styleSelectElement or modelSelect not ready.');
            return;
        }
        const modelId = modelSelect.value;
        styleSelectElement.innerHTML = ''; // Clear existing options
        
        // Check if the model uses prompt-based styling
        const modelConfig = window.RUNWARE_MODELS[modelId];
        if (modelConfig && modelConfig.usesPromptBasedStyling && window.PROMPT_BASED_STYLES && window.PROMPT_BASED_STYLES.length > 0) {
            console.log(`[Create Tab] Model ${modelId} uses prompt-based styling. Populating styles from PROMPT_BASED_STYLES.`);
            window.PROMPT_BASED_STYLES.forEach(style => {
                const option = document.createElement('option');
                option.value = style.value;
                option.textContent = style.name;
                styleSelectElement.appendChild(option);
            });
        } else if (modelStyles[modelId]) {
            console.log(`[Create Tab] Populating styles for modelId: ${modelId}`);
            modelStyles[modelId].forEach(style => {
                const option = document.createElement('option');
                option.value = style.value;
                option.textContent = style.label;
                styleSelectElement.appendChild(option);
            });
        } else {
            console.log(`[Create Tab] No styles found for modelId: ${modelId}`);
            const option = document.createElement('option');
            option.value = '';
            option.textContent = 'None';
            styleSelectElement.appendChild(option);
        }
    }

    // --- Update Hidden Style Inputs (Helper, Moved Inside) ---
    function updateHiddenStyleInputs() {
        if (!styleSelectElement) { 
            console.warn('[Style Update] Style select element not found for hidden inputs.');
            return; 
        }
        const selectedOption = styleSelectElement.options[styleSelectElement.selectedIndex];
        const label = selectedOption ? selectedOption.textContent : '';
        const negativePromptValue = selectedOption ? selectedOption.dataset.negativePrompt : '';
        // Set hidden inputs
        const labelInput = document.getElementById('style-label-input');
        const negPromptInput = document.getElementById('negative-prompt-input');
        if (labelInput) labelInput.value = label;
        if (negPromptInput) negPromptInput.value = negativePromptValue;
        console.log('[Style Update] Set hidden inputs -> Label:', label, '|| Negative Prompt:', negativePromptValue);
    }

    function toggleGenerateButtonState() {
        // This function now runs within the DOMContentLoaded scope
        // where imagePrompt and imageSubmit are guaranteed to be assigned (if found)
        if (imagePrompt && imageSubmit) {
           const promptIsEmpty = imagePrompt.value.trim() === '';
           imageSubmit.disabled = promptIsEmpty;
        } else {
           console.warn('[toggleGenerateButtonState] imagePrompt or imageSubmit not found/assigned.');
        }
    }

    function updateStrengthSlider() {
        // Moved inside DOMContentLoaded to access assigned elements
        if (imageStrengthSlider && imageStrengthValueDisplay) {
           imageStrengthValueDisplay.textContent = parseFloat(imageStrengthSlider.value).toFixed(2);
        } else {
           console.warn('[updateStrengthSlider] strengthSlider or strengthValueDisplay not found/assigned.');
           if (!imageStrengthSlider) console.warn('  Missing: imageStrengthSlider');
           if (!imageStrengthValueDisplay) console.warn('  Missing: imageStrengthValueDisplay');
        }
    }

    if (imagePrompt) {
        imagePrompt.addEventListener('input', () => {
            autoResizeTextarea(imagePrompt);
        });
        imagePrompt.addEventListener('input', toggleGenerateButtonState);
        toggleGenerateButtonState(); // Initial check
        autoResizeTextarea(imagePrompt);
    }
    updateStrengthSlider();

    // --- Event Listener for Image Upload Input (Moved Inside DOMContentLoaded) ---
    function handleImageUploadInput() {
        if (imageUploadInput && thumbnail && clearButton && placeholderIcon) {
            imageUploadInput.addEventListener('change', function(event) {
                const file = event.target.files[0];
                if (file) {
                    // Basic validation (optional, can be enhanced)
                    if (!file.type.startsWith('image/')) {
                        window.showToast('Please select an image file.', 'error');
                        return;
                    }
                    if (file.size > 5 * 1024 * 1024) { // Example: 5MB limit
                        window.showToast('File size exceeds 5MB limit.', 'error');
                        return;
                    }

                    // *** Assign the file to the global variable ***
                    uploadedFileObject = file; // Store the actual File object
                    console.log('[Handle Upload Input] Stored file object:', uploadedFileObject);

                    const reader = new FileReader();
                    reader.onload = function(e) {
                        thumbnail.src = e.target.result;
                        thumbnail.classList.remove('hidden');
                        placeholderIcon.classList.add('hidden');
                        clearButton.classList.remove('hidden');
                        updateControlsBasedOnState(); // Call update function (now in scope)
                        updateCostDisplay(); // Update cost for I2I mode
                    }
                    reader.readAsDataURL(file);
                } else {
                    clearUploadedImage(); // Clear if no file selected (now in scope)
                }
            });
        } else {
            console.error('[Handle Upload Input] One or more required elements not found.');
        }
    }

    handleImageUploadInput();

    // Flag to track if we should clear the content area for the first generation
    let isFirstGenerationInSession = true;

    if (imageSubmit && imagePrompt && modelSelect && aspectRatioButton && styleSelectElement) { 
        console.log('create-tab.js: Adding listener to Image submit button');
        console.log('[DEBUG] Attempting to add click listener to:', imageSubmit);
        imageSubmit.addEventListener('click', async (event) => {
            console.log('[Create Image Tab] Generate button clicked!'); 

            let placeholderId = null; // To store the unique ID for the placeholder
            let timerIntervalId = null; // To store the timer interval ID
            let secondsElapsed = 0;

            if (!window.isLoggedIn) {
                 console.log('[Create Image Tab] User not logged in. Showing toast.'); 
                 window.showToast('Please log in to create images.', 'error');
                 return;
            } else {
                console.log('[Create Image Tab] User is logged in.'); 
            }

            const selectedModelValue = modelSelect ? modelSelect.value : null;
            const isPhotoMakerSelected = selectedModelValue === 'civitai:133005@782002';

            if (isPhotoMakerSelected && !uploadedFileObject) {
                console.log('[Create Image Tab] PhotoMaker selected without an image.');
                window.showToast('Please upload a face image to use the Face / Character model.', 'error');
                // Re-enable button immediately as no server request was made
                imageSubmit.disabled = false;
                imageSubmit.textContent = 'Generate'; // Restore original text
                imagePrompt.disabled = false;
                return; // Stop execution
            }

            const originalButtonText = imageSubmit.textContent;

            imageSubmit.disabled = true;
            imageSubmit.textContent = 'Generating...';
            imagePrompt.disabled = true;

            let apiUrl;
            let fetchOptions = {
                method: 'POST',
                headers: {
                    'Accept': 'application/json' 
                },
            };
            const formData = new FormData();

            formData.append('prompt', imagePrompt.value.trim()); 
            formData.append('modelId', modelSelect ? modelSelect.value : ''); 
            formData.append('style', styleSelectElement ? styleSelectElement.value : ''); 

            // Append style label and negative prompt regardless of route
            const styleLabelInput = document.getElementById('style-label-input'); 
            const negativePromptInput = document.getElementById('negative-prompt-input');
            if (styleLabelInput) {
                formData.append('styleLabel', styleLabelInput.value);
            }
            if (negativePromptInput) {
                formData.append('negativePromptOverride', negativePromptInput.value);
            }

            // Check if we have the actual file object for img2img
            if (uploadedFileObject) { 
                 console.log('[Create Image Tab] Image uploaded, using /image-to-image');
                 apiUrl = '/generate/image-to-image';
                 console.log('[Create Tab] Sending aspectRatio:', aspectRatioButton.dataset.value); // Log selected ratio from data-value
                 formData.append('aspectRatio', aspectRatioButton.dataset.value); // Send selected aspect ratio from data-value
                 formData.append('image', uploadedFileObject, uploadedFileObject.name); // Send the actual File object
                 formData.append('strength', imageStrengthSlider.value || '0.75'); 

                 // Include styleLabel along with style value
                 const selectedStyleOption = styleSelectElement ? styleSelectElement.options[styleSelectElement.selectedIndex] : null;
                 const styleLabel = selectedStyleOption ? selectedStyleOption.textContent : '';
                 console.log('[Create Image Tab] Sending styleLabel:', styleLabel);
                 formData.append('styleLabel', styleLabel);

                 fetchOptions.body = formData; // FormData for multipart/form-data
              } else {
                 apiUrl = '/generate/text-to-image'; // Update the fetch request URL for text-to-image generation to include the correct '/generate' prefix
                 const selectedOption = modelSelect ? modelSelect.options[modelSelect.selectedIndex] : null;
                 const selectedStyleOption = styleSelectElement ? styleSelectElement.options[styleSelectElement.selectedIndex] : null;
                 const styleId = selectedStyleOption ? selectedStyleOption.value : '';
                 const styleName = selectedStyleOption ? selectedStyleOption.text : ''; // Get the display text

                 fetchOptions.headers['Content-Type'] = 'application/json';
                 // Construct JSON payload for text-to-image
                 const payload = {
                     prompt: imagePrompt.value.trim(),
                     modelId: modelSelect ? modelSelect.value : '', 
                     aspectRatio: aspectRatioButton.dataset.value, // Send ratio for T2I too
                     style: styleId, // Send style ID (value)
                     styleName: styleName, // Send style Name (text)
                     // Add style label and negative prompt to JSON payload too
                     styleLabel: styleLabelInput ? styleLabelInput.value : '',
                     negativePromptOverride: negativePromptInput ? negativePromptInput.value : ''
                 };
                 fetchOptions.body = JSON.stringify(payload);
             }

            console.log('[Create Image Tab] Sending API request to', apiUrl, 'with options:', fetchOptions);

            // --- Placeholder Logic --- 
            const contentArea = document.querySelector('#chat-messages');

            // Clear content area only for the first generation in this 'session'
            if (isFirstGenerationInSession && contentArea) {
                console.log('[Create Tab] First generation in session, clearing content area.');
                contentArea.innerHTML = ''; // Clear previous content
                isFirstGenerationInSession = false; // Don't clear for subsequent generations
            }

            placeholderId = `placeholder-${Date.now()}`;
            const placeholderHtml = `
                <div id="${placeholderId}" class="image-placeholder bg-gray-800 p-4 rounded text-center text-gray-400 my-2">
                    <i class="fas fa-spinner fa-spin mr-2"></i>
                    Generating image... 
                    <span class="timer text-xs">(<span class="seconds">0</span>s)</span>
                </div>
            `;

            // Insert placeholder at the top
            contentArea.insertAdjacentHTML('afterbegin', placeholderHtml); 

            // Start timer
            const timerSpan = document.querySelector(`#${placeholderId} .seconds`);
            if (timerSpan) {
                timerIntervalId = setInterval(() => {
                    secondsElapsed++;
                    timerSpan.textContent = secondsElapsed;
                }, 1000);
            }
            // --- End Placeholder Logic --- 

            try {
                console.log(`[Create Image Tab] Sending API request to ${apiUrl}...`); 

                const response = await fetch(apiUrl, fetchOptions);
                console.log(`[Create Image Tab] API response status: ${response.status}`); 

                // Clear timer as soon as response is received
                if (timerIntervalId) {
                    clearInterval(timerIntervalId);
                    timerIntervalId = null;
                    console.log('[Create Tab] Timer cleared on response received.');
                }

                if (!response.ok) {
                    let errorMsg = `HTTP error! status: ${response.status}`;
                     try {
                         const errorData = await response.json();
                         errorMsg = errorData.error || errorMsg;
                     } catch (e) { console.log('[Create Image Tab] Could not parse error response as JSON.'); }
                    console.error('[Create Image Tab] API error:', errorMsg);
                    window.showToast(errorMsg, 'error');
                    // Update placeholder with error
                    const placeholderDiv = document.getElementById(placeholderId);
                    if (placeholderDiv) {
                        placeholderDiv.innerHTML = `<i class="fas fa-exclamation-triangle mr-2 text-red-500"></i> Error: ${errorMsg}`;
                        placeholderDiv.classList.add('text-red-400');
                        // Optionally remove the placeholder after a delay or leave it
                    }
                } else {
                    const result = await response.json();
                    console.log("[Create Image Tab] API success response:", result); 

                    const imgContainer = document.createElement('div');
                    imgContainer.classList.add('mb-4', 'p-2', 'bg-gray-800', 'rounded', 'generated-image-item'); 
            
                    const imgElement = document.createElement('img');
                    imgElement.src = result.imageUrl; 
                    imgElement.alt = result.prompt || imagePrompt.value.trim();
                    if (result.width && result.height) {
                        imgElement.width = result.width;
                        imgElement.height = result.height;
                    }
                    imgElement.style.maxWidth = '100%';
                    imgElement.style.height = 'auto';
                    imgElement.style.imageRendering = 'pixelated'; // Consider 'auto' or removing if pixelation isn't desired
                    imgElement.classList.add('rounded-lg');
                    imgContainer.appendChild(imgElement);
            
                    const promptElement = document.createElement('p');
                    promptElement.textContent = `Prompt: ${result.prompt || imagePrompt.value.trim()}`;
                    promptElement.classList.add('text-xs', 'text-gray-400', 'mt-1');
                    imgContainer.appendChild(promptElement);

                    // --- Replace Placeholder --- 
                    const placeholderDiv = document.getElementById(placeholderId);
                    if (placeholderDiv) {
                        console.log('[Create Tab] Replacing placeholder with generated image.');
                        placeholderDiv.replaceWith(imgContainer);
                    } else {
                        console.warn('[Create Tab] Placeholder not found, prepending image.');
                        const contentArea = document.querySelector('#chat-messages');
                        contentArea.prepend(imgContainer); // Fallback
                    }
                    // --- End Replace Placeholder --- 

                    // Update user credits display
                    if (typeof window.updateUserCreditsDisplay === 'function') {
                        window.updateUserCreditsDisplay();
                    } else {
                        console.warn('[Create Tab] updateUserCreditsDisplay function not found on window object.');
                    }
                }
            } catch (error) {
                console.error("[Create Image Tab] Image generation failed:", error); 
                window.showToast(`Error: ${error.message || 'Unknown error'}`, 'error');
                // Update placeholder with error
                const placeholderDiv = document.getElementById(placeholderId);
                if (placeholderDiv) {
                    placeholderDiv.innerHTML = `<i class="fas fa-exclamation-triangle mr-2 text-red-500"></i> Error: ${error.message || 'Unknown error'}`;
                    placeholderDiv.classList.add('text-red-400');
                }
                 // Clear timer in case of fetch error
                 if (timerIntervalId) {
                    clearInterval(timerIntervalId);
                    timerIntervalId = null;
                    console.log('[Create Tab] Timer cleared on catch error.');
                }
            } finally {
                console.log('[Create Image Tab] Executing finally block.');
                // Ensure timer is always cleared
                if (timerIntervalId) {
                    clearInterval(timerIntervalId);
                    timerIntervalId = null;
                }

                imageSubmit.disabled = false;
                imageSubmit.textContent = originalButtonText; 
                imagePrompt.disabled = false;

                toggleGenerateButtonState(); // Re-evaluate button state
            }
        });
        console.log('[DEBUG] Successfully added click listener.');
    }

    // Listener for model change to update styles and controls
    if (modelSelect) {
       modelSelect.addEventListener('change', () => {
           console.log('[Model Change] Detected. Updating controls.');
           updateControlsBasedOnState();
           updateCostDisplay(); // Call on change
           updateStyleDropdown(); // Update styles when model changes
       });
    }

    // Update hidden style inputs when style selection changes
    if (styleSelectElement) { 
        styleSelectElement.addEventListener('change', updateHiddenStyleInputs);
    } else {
        console.warn('[DOMContentLoaded] styleSelectElement element not found, cannot add change listener.');
    }

    // Add listener for image prompt input to enable/disable button
    if (imagePrompt) {
        imagePrompt.addEventListener('input', () => {
            autoResizeTextarea(imagePrompt);
        });
        imagePrompt.addEventListener('input', toggleGenerateButtonState);
    }

    // Function to get the selected style's label and negative prompt (if any)
    // NOTE: This needs adjustment if we load complex style objects later
    function updateHiddenStyleInputs() {
        // No need for hidden inputs if we only send the style name
        // const styleLabelInput = document.getElementById('style-label-input');
        // const negativePromptInput = document.getElementById('negative-prompt-input');
        // if (!styleSelectElement || !styleLabelInput || !negativePromptInput) return;

        // const selectedOption = styleSelectElement.options[styleSelectElement.selectedIndex];
        // const styleLabel = selectedOption ? selectedOption.text : ''; // We send this now as 'styleName'
        // const negativePromptOverride = selectedOption ? selectedOption.dataset.negativePrompt : ''; // Assuming data-negative-prompt might exist

        // If using prompt-based styling, the 'value' and 'text' are the same (the style name)
        // If using LoRAs, the 'value' is the ID, and 'text' is the name.
        // The backend currently uses req.body.styleName, which we added earlier.

        console.log(`Style changed. Selected value: ${styleSelectElement.value}, Selected text: ${styleSelectElement.options[styleSelectElement.selectedIndex]?.text}`);
    }

    // --- Setup Event Listeners ---
    if (imageUploadInput) {
        imageUploadInput.addEventListener('change', (e) => {
            console.log('[Create Tab] Image upload input change event fired');
            const file = e.target.files[0];
            if (file) {
                // Read file:
                const reader = new FileReader();
                reader.onload = (event) => {
                    console.log('[Create Tab] FileReader onload event fired - image loaded');
                    uploadedFileObject = file; // Store the File object itself, not the data URL
                    console.log('[Create Tab] File object stored in uploadedFileObject:', file.name);
                    // Update preview if available
                    if (thumbnail) {
                        thumbnail.src = event.target.result; // Data URL for preview
                        thumbnail.classList.remove('hidden');
                        console.log('[Create Tab] Preview image updated and shown');
                    } else {
                        console.warn('[Create Tab] thumbnail not found, cannot update preview');
                    }
                    if (placeholderIcon) {
                        placeholderIcon.classList.add('hidden');
                        console.log('[Create Tab] Placeholder hidden');
                    }
                    if (clearButton) {
                        clearButton.classList.remove('hidden');
                        console.log('[Create Tab] Clear button shown');
                    }
                    // Update controls based on new state
                    updateControlsBasedOnState();
                    updateCostDisplay(); // Update cost display after image upload
                    console.log('[Create Tab] Controls and cost updated after image upload');
                };
                reader.readAsDataURL(file); // Read as Data URL for preview image
                console.log('[Create Tab] Reading file as DataURL for preview...');
            } else {
                console.log('[Create Tab] No file selected in change event');
                // No file selected (possibly due to cancel)
                uploadedFileObject = null;
                if (thumbnail) {
                    thumbnail.classList.add('hidden');
                    console.log('[Create Tab] Preview image hidden (no file)');
                }
                if (placeholderIcon) {
                    placeholderIcon.classList.remove('hidden');
                    console.log('[Create Tab] Placeholder shown (no file)');
                }
                if (clearButton) {
                    clearButton.classList.add('hidden');
                    console.log('[Create Tab] Clear button hidden (no file)');
                }
                // Update controls based on new state
                updateControlsBasedOnState();
                updateCostDisplay(); // Update cost display after clearing image
                console.log('[Create Tab] Controls and cost updated after clearing image (no file selected)');
            }
        });
        console.log('[Create Tab] Image upload input listener attached');
    } else {
        console.warn('[Create Tab] imageUploadInput not found, cannot attach change listener');
    }

    if (clearButton) {
        clearButton.addEventListener('click', (e) => {
            console.log('[Create Tab] Clear upload button clicked');
            e.preventDefault();
            // Reset the input
            if (imageUploadInput) {
                imageUploadInput.value = '';
                console.log('[Create Tab] Image upload input value cleared');
            }
            uploadedFileObject = null;
            if (thumbnail) {
                thumbnail.classList.add('hidden');
                console.log('[Create Tab] Preview image hidden');
            }
            if (placeholderIcon) {
                placeholderIcon.classList.remove('hidden');
                console.log('[Create Tab] Placeholder shown');
            }
            clearButton.classList.add('hidden');
            console.log('[Create Tab] Clear button hidden');
            // Update controls based on new state
            updateControlsBasedOnState();
            updateCostDisplay(); // Update cost display after clearing image
            console.log('[Create Tab] Controls and cost updated after clearing image');
        });
        console.log('[Create Tab] Clear upload button listener attached');
    } else {
        console.warn('[Create Tab] clearButton not found, cannot attach click listener');
    }
});