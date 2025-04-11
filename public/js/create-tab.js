console.log('create-tab.js script tag executed');

console.log('create-tab.js: Setting up listeners...');
const chatMessages = document.getElementById('chat-messages');
let isFirstAction = true;

// Create Images tab
const imageSubmit = document.querySelector('#image-submit[data-mode="create-images"]');
const imageInput = document.querySelector('#image-input');
const aspectRatioSelect = document.querySelector('#aspect-ratio'); // Get the dropdown
const mainContentArea = document.getElementById('chat-messages'); // Target the main content area

// -- NEW: Auto-resize textarea logic --
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

console.log('create-tab.js: Found image elements:', { imageSubmit, imageInput, aspectRatioSelect, mainContentArea }); // Added aspectRatioSelect

if (imageSubmit && imageInput && mainContentArea && aspectRatioSelect) { // Added aspectRatioSelect check
    console.log('create-tab.js: Adding NEW listener to Image submit button');
    imageSubmit.addEventListener('click', async () => {
        console.log('[Create Image Tab] Generate button clicked!'); // Log: Button clicked
        const prompt = imageInput.value.trim();
        const aspectRatio = aspectRatioSelect.value; // Get selected aspect ratio
        console.log(`[Create Image Tab] Prompt: "${prompt}", Aspect Ratio: "${aspectRatio}"`); // Log: Values read

        if (!prompt) {
            window.showToast('Please enter a prompt.', 'error');
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

        console.log('[Create Image Tab] Adding loading indicator...'); // Log: Adding loading indicator
        const loadingIndicator = document.createElement('div');
        loadingIndicator.classList.add('text-center', 'p-4', 'temporary-loading'); // Added a class for potential removal
        loadingIndicator.innerHTML = '<div class="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-white"></div><span class="ml-2">Generating image...</span>';
        mainContentArea.prepend(loadingIndicator); // Prepend loading to main area

        try {
            console.log(`[Create Image Tab] Sending API request...`); // Log: Starting fetch
            const response = await fetch('/api/generate-image', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ prompt, aspectRatio }) // Send aspectRatio
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
            imgElement.classList.add('w-full', 'h-auto', 'rounded-lg');
            imgContainer.appendChild(imgElement);
            
            const promptElement = document.createElement('p');
            promptElement.textContent = `Prompt: ${result.prompt || prompt}`;
            promptElement.classList.add('text-xs', 'text-gray-400', 'mt-1');
            imgContainer.appendChild(promptElement);

            mainContentArea.prepend(imgContainer); // Prepend image to the MAIN content area
            console.log('[Create Image Tab] Image prepended to content area.'); // Log: Image added
            imageInput.value = ''; // Clear input on success
            autoResizeTextarea(imageInput); // Reset textarea height after clearing

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
} else {
    console.error('create-tab.js: Image submit button, input, aspect ratio select, or MAIN content area (#chat-messages) not found!');
}