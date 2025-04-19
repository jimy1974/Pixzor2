console.log('create-tab.js script tag executed');

console.log('create-tab.js: Setting up listeners...');
const chatMessages = document.getElementById('chat-messages');
let isFirstAction = true;

// Create Images tab
const imageSubmit = document.querySelector('#image-submit[data-mode="create-images"]');
const imageInput = document.querySelector('#image-input');
const aspectRatioDropdown = document.getElementById('aspect-ratio-dropdown'); // NEW: Get the dropdown div
const styleSelect = document.getElementById('style-select'); // Get Style select
const modelSelect = document.getElementById('model-select'); // Get Model select
const mainContentArea = document.getElementById('chat-messages'); // Target the main content area

// --- NEW: Img2Img Elements & State ---
const imageUploadInput = document.getElementById('image-upload-input');
const thumbnailContainer = document.getElementById('thumbnail-container'); // Get the container
const thumbnail = document.getElementById('image-upload-thumbnail');
const clearButton = document.getElementById('clear-image-upload');
const placeholderIcon = document.getElementById('thumbnail-placeholder-icon');
const strengthControl = document.getElementById('strength-control'); // Get the strength control container
const strengthSlider = document.getElementById('image-strength-slider');
const strengthValueDisplay = document.getElementById('strength-value-display');

let uploadedImageData = null; // To store { url, width, height } after successful upload
// --- END NEW ---

// --- NEW: Auto-resize textarea logic --
function autoResizeTextarea(textarea) {
    textarea.style.height = 'auto'; // Reset height to recalculate
    textarea.style.height = (textarea.scrollHeight) + 'px'; // Set height based on content
}

if (imageInput) {
    imageInput.addEventListener('input', () => {
        autoResizeTextarea(imageInput);
    });
    // Initial resize on load if needed
    autoResizeTextarea(imageInput);
}
// -- END NEW --

// --- NEW: Strength Slider Update ---
if (strengthSlider && strengthValueDisplay) {
    strengthSlider.addEventListener('input', () => {
        strengthValueDisplay.textContent = parseFloat(strengthSlider.value).toFixed(2);
    });
    // Initial display update
    strengthValueDisplay.textContent = parseFloat(strengthSlider.value).toFixed(2);
}
// --- END NEW ---

console.log('create-tab.js: Found image elements:', { imageSubmit, imageInput, aspectRatioDropdown, styleSelect, modelSelect, mainContentArea, imageUploadInput, thumbnail, clearButton, placeholderIcon }); // Updated log

// --- NEW: Debugging Button and Listener Attachment ---
console.log('[DEBUG] imageSubmit element:', imageSubmit); 
// --- END NEW ---

// --- NEW: Flag for clearing ---
let isFirstImageGenerated = true; 
// --- END NEW ---

if (imageSubmit && imageInput && mainContentArea && aspectRatioDropdown && styleSelect && modelSelect) { // Updated check for dropdowns
    console.log('create-tab.js: Adding listener to Image submit button');
    // --- NEW: Debugging Listener Attachment ---
    console.log('[DEBUG] Attempting to add click listener to:', imageSubmit);
    // --- END NEW ---
    imageSubmit.addEventListener('click', async () => {
        console.log('[Create Image Tab] Generate button clicked!'); // Log: Button clicked

        // --- Login Check --- 
        if (!window.isLoggedIn) {
             console.log('[Create Image Tab] User not logged in. Showing toast.'); // DEBUG LOG
             window.showToast('Please log in to create images.', 'error');
             return;
        } else {
            console.log('[Create Image Tab] User is logged in.'); // Log: Login check passed
        }
        // --- End Login Check ---

        // --- Get data from inputs ---
        let prompt = imageInput.value.trim(); // Use let to allow modification
        const aspectRatio = aspectRatioDropdown ? aspectRatioDropdown.dataset.value : '1:1'; // NEW: Read from dropdown data
        const style = styleSelect ? styleSelect.value : ''; // Get selected style
        const model = modelSelect ? modelSelect.value : 'stable_diffusion_xl_1024_v1_0'; // Get selected model, provide a default

        // Prepend style if selected and not empty
        if (style && style !== 'none') { // Ensure 'none' isn't prepended
            prompt = `${style}, ${prompt}`; // Prepend style
            console.log(`[Create Image Tab] Style prepended, new prompt: "${prompt}"`);
        }

        // --- NEW: Prepare payload for /api/generate-image ---
        const payload = {
            prompt: prompt,
            aspectRatio: aspectRatio,
            model: model,
        };

        // Add image data if available
        if (uploadedImageData) {
            payload.imageUrl = uploadedImageData.url;
            payload.strength = parseFloat(strengthSlider.value);
            // Add imageWidth and imageHeight for img2img models
            if (uploadedImageData.width && uploadedImageData.height) {
                payload.imageWidth = uploadedImageData.width;
                payload.imageHeight = uploadedImageData.height;
                console.log('[Create Image Tab] Including imageWidth and imageHeight in payload:', uploadedImageData.width, uploadedImageData.height);
            }
            console.log('[Create Image Tab] Image data added to payload:', { imageUrl: payload.imageUrl, strength: payload.strength });
        } else {
            console.log('[Create Image Tab] No uploaded image data to send.');
        }
        // --- END NEW ---

        // --- DEBUG LOG: Data before API call ---
        console.log('[Create Image Tab] Data Prepared for API:', payload); // Log the final payload
        // --- END DEBUG LOG ---

        // Validation: Need a prompt OR an image (depending on model, technically)
        if (!payload.prompt && !payload.imageUrl) {
            window.showToast('Please enter a prompt or upload an image.', 'error');
            return;
        }
        // Basic check: if using an image, ensure strength is valid (it should be by default)
        if (payload.imageUrl && (payload.strength === undefined || payload.strength < 0 || payload.strength > 1)) {
             window.showToast('Invalid image strength value.', 'error');
             return;
        }

        // Check login status (uses global var set by core.js)
        if (!window.isLoggedIn) {
             console.log('[Create Image Tab] User not logged in.'); // Log: Login check failed
             window.showToast('Please log in to create images.', 'error');
             return;
        }
        console.log('[Create Image Tab] User is logged in.'); // Log: Login check passed

        const originalButtonText = imageSubmit.textContent;
        imageSubmit.disabled = true;
        imageSubmit.textContent = 'Generating...';
        imageInput.disabled = true;

        // Check if mainContentArea exists right before using it
        if (!document.getElementById('chat-messages')) {
            console.error('[Create Image Tab] CRITICAL: #chat-messages area not found before adding loading indicator!');
            // Restore button state if the target area is missing
            imageSubmit.disabled = false;
            imageSubmit.textContent = originalButtonText;
            imageInput.disabled = false;
            return; 
        }

        // --- NEW: Clear content area only on first generation --- 
        if (isFirstImageGenerated) {
            console.log('[Create Image Tab] First generation, clearing chat messages area.');
            mainContentArea.innerHTML = ''; // Clear previous content
            isFirstImageGenerated = false; // Set flag so it doesn't clear next time
        }
        // --- END NEW ---

        console.log('[Create Image Tab] Adding loading indicator...'); // Log: Adding loading indicator
        const loadingIndicator = document.createElement('div');
        loadingIndicator.classList.add('text-center', 'p-4', 'temporary-loading'); // Added a class for potential removal
        loadingIndicator.innerHTML = '<div class="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-white"></div><span class="ml-2">Generating image...</span>';
        mainContentArea.prepend(loadingIndicator); // Prepend loading to main area

        try {
            console.log(`[Create Image Tab] Sending API request to /api/generate-image...`); // Log: Starting fetch
            const response = await fetch('/api/generate-image', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload) // Send the new payload
            });
            console.log(`[Create Image Tab] API response status: ${response.status}`); // Log: Response status

            // Remove loading indicator regardless of success/failure
            console.log('[Create Image Tab] Removing loading indicator.'); // Log: Removing indicator
            loadingIndicator.remove(); 

            if (!response.ok) {
                let errorMsg = `HTTP error! status: ${response.status}`;
                try {
                    const errorData = await response.json();
                    errorMsg = errorData.error || errorMsg;
                    console.log('[Create Image Tab] API error response body:', errorData); // Log: API Error Body
                } catch (e) { console.log('[Create Image Tab] Could not parse error response as JSON.'); }
                throw new Error(errorMsg);
            }

            const result = await response.json();
            console.log("[Create Image Tab] API success response:", result); // Log: Success response

            // Check if mainContentArea still exists before adding image
             if (!document.getElementById('chat-messages')) {
                console.error('[Create Image Tab] CRITICAL: #chat-messages area not found before adding image!');
                 throw new Error('Display area disappeared.'); // Throw error to prevent further processing and enter finally block
             }

            // Create and display the image in the MAIN content area
            console.log('[Create Image Tab] Creating image element...'); // Log: Creating image element
            const imgContainer = document.createElement('div');
            imgContainer.classList.add('mb-4', 'p-2', 'bg-gray-800', 'rounded', 'generated-image-item'); // Added a class
            
            const imgElement = document.createElement('img');
            imgElement.src = result.imageUrl;
            imgElement.alt = result.prompt || prompt;
            // Prevent stretching: set width/height attributes and pixelated rendering
            if (result.width && result.height) {
                imgElement.width = result.width;
                imgElement.height = result.height;
            }
            imgElement.style.maxWidth = '100%';
            imgElement.style.height = 'auto';
            imgElement.style.imageRendering = 'pixelated';
            imgElement.classList.add('rounded-lg');
            imgContainer.appendChild(imgElement);
            
            const promptElement = document.createElement('p');
            promptElement.textContent = `Prompt: ${result.prompt || prompt}`;
            promptElement.classList.add('text-xs', 'text-gray-400', 'mt-1');
            imgContainer.appendChild(promptElement);

            mainContentArea.prepend(imgContainer); // Prepend image to the MAIN content area
            console.log('[Create Image Tab] Image prepended to content area.'); // Log: Image added
            
             // --- MODIFIED: Don't clear prompt if using img2img ---
             // Keep the prompt field populated if an image was used,
             // allowing for easier prompt variations with the same image.
             if (!payload.imageUrl) {
                  imageInput.value = ''; // Clear prompt only for text-to-image
                  autoResizeTextarea(imageInput); // Reset textarea height after clearing
             }
             // --- END MODIFIED ---

        } catch (error) {
            console.error("[Create Image Tab] Image generation failed:", error); // Log: Catch block error
            window.showToast(`Error: ${error.message}`, 'error');
             // Ensure loading indicator is removed even on error
             if (document.body.contains(loadingIndicator)) {
                console.log('[Create Image Tab] Removing loading indicator in catch block.'); // Log: Removing indicator (error case)
                loadingIndicator.remove();
            }
        } finally {
            console.log('[Create Image Tab] Executing finally block.'); // Log: Finally block
            imageSubmit.disabled = false;
            imageSubmit.textContent = originalButtonText;
            imageInput.disabled = false;
        }
    });
    // --- NEW: Debugging Listener Attachment ---
    console.log('[DEBUG] Successfully added click listener.');
    // --- END NEW ---

} else {
    console.error('create-tab.js: One or more required elements not found: Image submit button, input, aspect ratio dropdown, style select, model select, or MAIN content area (#chat-messages)'); // Updated error message
}

// --- NEW: Image Upload Handling ---
if (imageUploadInput && thumbnail && clearButton && placeholderIcon && thumbnailContainer && strengthControl) {
    console.log('[Img2Img] Setting up image upload listeners.');

    imageUploadInput.addEventListener('change', async (event) => {
        const file = event.target.files[0];
        if (!file) {
            console.log('[Img2Img] No file selected.');
            return; // No file selected
        }

        console.log(`[Img2Img] File selected: ${file.name}, Size: ${file.size}, Type: ${file.type}`);

        // Basic client-side type check
        if (!['image/jpeg', 'image/png'].includes(file.type)) {
            window.showToast('Invalid file type. Please upload a JPG or PNG image.', 'error');
            imageUploadInput.value = null; // Clear the input
            return;
        }

        // Show immediate visual feedback (optional - using a spinner on thumbnail?)
        placeholderIcon.classList.add('hidden'); // Hide placeholder
        thumbnail.classList.add('opacity-50'); // Indicate loading
        // Consider adding a small spinner overlay here

        const formData = new FormData();
        formData.append('image', file);

        try {
            console.log('[Img2Img] Sending upload request to /api/upload-image');
            const response = await fetch('/api/upload-image', {
                method: 'POST',
                body: formData,
                // No 'Content-Type' header needed for FormData, browser sets it
            });

            thumbnail.classList.remove('opacity-50'); // Remove loading indicator

            if (!response.ok) {
                let errorMsg = `Upload failed: ${response.status}`;
                 try {
                     const errorData = await response.json();
                     errorMsg = errorData.error || errorMsg;
                 } catch (e) { /* Ignore if error response is not JSON */ }
                console.error('[Img2Img] Upload failed:', errorMsg);
                window.showToast(errorMsg, 'error');
                // Reset UI on failure
                placeholderIcon.classList.remove('hidden');
                thumbnail.src = '#'; // Clear src
                thumbnail.classList.add('hidden');
                clearButton.classList.add('hidden');
                strengthControl.classList.add('hidden');
                uploadedImageData = null;
                imageUploadInput.value = null; // Clear the input
                return;
            }

            const result = await response.json();
            console.log('[Img2Img] Upload successful:', result);

            uploadedImageData = { url: result.url, width: result.width, height: result.height };

            // Update UI
            thumbnail.src = result.url; // Display the uploaded image temp URL
            thumbnail.classList.remove('hidden');
            clearButton.classList.remove('hidden');
            placeholderIcon.classList.add('hidden');
            strengthControl.classList.remove('hidden'); // Show strength slider


        } catch (error) {
            thumbnail.classList.remove('opacity-50'); // Remove loading indicator
            console.error('[Img2Img] Error during fetch for image upload:', error);
            window.showToast(`Upload error: ${error.message}`, 'error');
            // Reset UI on fetch error
            placeholderIcon.classList.remove('hidden');
            thumbnail.src = '#';
            thumbnail.classList.add('hidden');
            clearButton.classList.add('hidden');
            strengthControl.classList.add('hidden');
            uploadedImageData = null;
            imageUploadInput.value = null; // Clear the input
        }
    });

    clearButton.addEventListener('click', () => {
        console.log('[Img2Img] Clear button clicked.');
        uploadedImageData = null;
        thumbnail.src = '#'; // Clear/reset image source
        thumbnail.classList.add('hidden');
        clearButton.classList.add('hidden');
        placeholderIcon.classList.remove('hidden'); // Show placeholder icon again
        strengthControl.classList.add('hidden'); // Hide strength slider
        imageUploadInput.value = null; // Reset the file input
        imageUploadInput.disabled = false;
        imageUploadInput.classList.remove('hidden');
        // Ensure the input is clickable again
        setTimeout(() => { imageUploadInput.click(); }, 0);
    });

} else {
    console.error('[Img2Img] One or more elements for image upload/clear are missing.');
}
// --- END NEW ---

// --- NEW: Model Change Handling ---
function updateImageControlsVisibility() {
    if (!modelSelect || !thumbnailContainer || !strengthControl || !clearButton || !placeholderIcon || !thumbnail || !imageUploadInput) {
        console.warn('[Model Change] Required elements for visibility update not found.');
        return;
    }

    const selectedModel = modelSelect.value;
    // *** IMPORTANT: Adjust this check based on the actual model value used for img2img in chat-tab.ejs ***
    const isImg2ImgModel = selectedModel === 'stable-diffusion-xl-1024-v1_0'; // Example check

    console.log(`[Model Change] Selected model: ${selectedModel}, Is Img2Img capable: ${isImg2ImgModel}`);

    if (isImg2ImgModel) {
        // Show the main upload area (container includes placeholder/button)
        thumbnailContainer.classList.remove('hidden');
        // Show strength slider ONLY if an image is *already* uploaded
        if (uploadedImageData) {
            strengthControl.classList.remove('hidden');
            console.log('[Model Change] Img2Img model selected, image uploaded, showing strength slider.');
        } else {
            strengthControl.classList.add('hidden');
             console.log('[Model Change] Img2Img model selected, no image uploaded, hiding strength slider.');
        }
    } else {
        // Hide both upload area and strength slider for non-img2img models
        thumbnailContainer.classList.add('hidden');
        strengthControl.classList.add('hidden');
        console.log('[Model Change] Text2Img model selected, hiding upload area and strength slider.');

        // If an image was previously uploaded, clear it since the model doesn't support it
        if (uploadedImageData) {
            console.log('[Model Change] Clearing previously uploaded image data due to model change.');
            // Simulate a click on the clear button to reset state and UI consistently
             if (clearButton) {
                 // Need to ensure clearButton is not hidden itself before clicking
                 const wasClearHidden = clearButton.classList.contains('hidden');
                 if (wasClearHidden) clearButton.classList.remove('hidden'); // Temporarily show to allow click simulation if needed
                 clearButton.click(); // Programmatically click clear button resets state/UI
                  if (wasClearHidden) clearButton.classList.add('hidden'); // Re-hide if it was originally
             } else { // Manual reset as fallback (shouldn't be needed)
                 console.warn('[Model Change] Clear button not found for programmatic click, resetting manually.');
                 uploadedImageData = null;
                 thumbnail.src = '#';
                 thumbnail.classList.add('hidden');
                 // clearButton.classList.add('hidden'); // Already hidden by model change logic
                 placeholderIcon.classList.remove('hidden');
                 imageUploadInput.value = null;
             }
        }
    }
}

if (modelSelect) {
    console.log('[Model Change] Adding change listener to model select.');
    modelSelect.addEventListener('change', updateImageControlsVisibility);

    // Initial check on load to set visibility based on default model
    console.log('[Model Change] Performing initial visibility check.');
    updateImageControlsVisibility();
} else {
    console.error('[Model Change] Model select dropdown (#model-select) not found.');
}
// --- END NEW ---

if (imageSubmit && imageInput && mainContentArea && aspectRatioDropdown && styleSelect && modelSelect) { // Updated check for dropdowns
    console.log('create-tab.js: Adding listener to Image submit button');
    // ... rest of the code remains the same ...
}