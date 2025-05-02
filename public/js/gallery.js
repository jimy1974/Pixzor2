let page = 1;
let isLoading = false;
let hasMoreImages = true;
let currentContentId = null; // For the modal

// --- Toast Function (Ensure core.js provides showToast or define it here) ---
// Assuming showToast is globally available from core.js
// function showToast(message, type = 'success') { ... }

// --- Fullscreen Modal Functions ---
function openFullscreenModal(imageUrl) {
    console.log('[gallery.js] openFullscreenModal called');
    const modal = document.getElementById('fullscreen-modal');
    const img = document.getElementById('fullscreen-image');
    if (modal && img) {
        img.src = imageUrl;
        modal.classList.remove('hidden');
    } else {
        console.error('[gallery.js] openFullscreenModal: Could not find modal or img element!');
    }
}

// Close function might need adjustment based on final modal structure
function closeFullscreenModal() {
    console.log('[gallery.js] closeFullscreenModal called.');
    const modal = document.getElementById('fullscreen-modal');
    if (modal) {
        modal.classList.add('hidden');
        const img = document.getElementById('fullscreen-image');
        if (img) img.src = ''; // Clear image src on close
    } else {
        console.error('[gallery.js] closeFullscreenModal: Could not find modal element!');
    }
}

// Add DOMContentLoaded listener for the MAIN fullscreen close button
document.addEventListener('DOMContentLoaded', () => {
    // Find the close button defined in layout.ejs or modals.ejs for the main fullscreen view
    const closeButton = document.getElementById('close-fullscreen-modal'); // Use the ID from layout/modals
    if (closeButton) {
        console.log('[gallery.js] Attaching DOMContentLoaded listener to main close button:', closeButton);
        closeButton.addEventListener('click', (event) => {
            event.stopPropagation(); // Prevent background click if needed
            console.log('[gallery.js] Main close button clicked (DOMContentLoaded listener).');
            closeFullscreenModal();
        });
    } else {
        // This might log if the fullscreen modal ID in layout/modals differs
        console.warn("[gallery.js] Main fullscreen modal close button (#close-fullscreen-modal) not found on DOMContentLoaded!");
    }
});

// --- Share Link Function ---
function updateShareLinks(contentId) {
    const baseUrl = window.location.origin;
    // Point share URL to gallery page with a query param to potentially auto-open modal (optional)
    const shareUrl = `${baseUrl}/gallery?content=${contentId}`;
    const shareText = 'Check out this cool AI content from Pixzor!';
    const modalImageElement = document.getElementById('modal-image');
    const imageUrl = modalImageElement ? modalImageElement.src : '';

    const fb = document.getElementById('share-facebook');
    const tw = document.getElementById('share-twitter');
    const pin = document.getElementById('share-pinterest');

    if (fb) fb.href = `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(shareUrl)}`;
    if (tw) tw.href = `https://twitter.com/intent/tweet?url=${encodeURIComponent(shareUrl)}&text=${encodeURIComponent(shareText)}`;
    // Pinterest requires an image URL for the 'media' parameter
    if (pin && imageUrl) pin.href = `https://pinterest.com/pin/create/button/?url=${encodeURIComponent(shareUrl)}&media=${encodeURIComponent(imageUrl)}&description=${encodeURIComponent(shareText)}`;
    else if (pin) pin.href = '#'; // Disable if no image URL
}

// --- Load Comments Function ---
async function loadComments(contentId) {
    const commentsList = document.getElementById('comments-list');
    if (!commentsList) {
        console.error('[gallery.js] Comments list container not found.');
        return;
    }
    commentsList.innerHTML = '<li>Loading comments...</li>';
    try {
        const response = await fetch(`/api/content/${contentId}/comments`);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const comments = await response.json();
        console.log('[loadComments] Raw comments received from API:', comments); // Log raw data
        if (comments.length === 0) {
            commentsList.innerHTML = '<li class="text-gray-400 italic">No comments yet.</li>';
        } else {
            commentsList.innerHTML = comments.map(comment => `
                <li class="comment-item border-b border-gray-700 pb-2 mb-2" data-comment-id="${comment.id}">
                    <div class="flex items-center mb-1">
                        <img src="${comment.user.photo || '/images/default-avatar.png'}" alt="${comment.user.username}" class="w-6 h-6 rounded-full mr-2">
                        <span class="font-semibold text-sm mr-2">${comment.user.username}</span>
                        <span class="text-gray-400 text-xs">${new Date(comment.createdAt).toLocaleString()}</span>
                    </div>
                    <p class="text-gray-300 text-sm break-words">${escapeHTML(comment.commentText)}</p>
                </li>
            `).join('');
        }
    } catch (error) {
        console.error('Error loading comments:', error);
        commentsList.innerHTML = '<li class="text-red-500">Error loading comments.</li>';
        showToast('Failed to load comments.', 'error');
    }
}

// --- Post Comment Function ---
async function postComment(contentId) {
    const commentInput = document.getElementById('comment-input');
    const postCommentButton = document.getElementById('post-comment');
    if (!commentInput || !postCommentButton) {
        console.error('[gallery.js] Comment input or post button not found.');
        return;
    }
    const commentText = commentInput.value.trim();
    if (!commentText) {
        showToast('Comment cannot be empty.', 'error');
        return;
    }
    postCommentButton.disabled = true;
    postCommentButton.textContent = 'Posting...';
    try {
        const response = await fetch(`/api/content/${contentId}/comments`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                // Add CSRF token header if needed by your backend setup
            },
            body: JSON.stringify({ text: commentText }) // Changed 'commentText' to 'text'
        });
        const result = await response.json();
        if (!response.ok) {
            throw new Error(result.error || `HTTP error! status: ${response.status}`);
        }
        commentInput.value = '';
        showToast('Comment posted!', 'success');
        await loadComments(contentId); // Reload comments to show the new one
    } catch (error) {
        console.error('Error posting comment:', error);
        showToast(`Failed to post comment: ${error.message}`, 'error');
    } finally {
        postCommentButton.disabled = false;
        postCommentButton.textContent = 'Post';
    }
}

// --- Comments Modal Function (Handles opening, details fetching, and listener setup) ---
function openCommentsModal(contentId, imageUrl) {
    console.log(`[gallery.js] openCommentsModal called. ID: ${contentId}`);
    currentContentId = contentId;
    const modal = document.getElementById('comments-modal');
    
    // Get all required elements within this specific modal instance
    const elements = {
        modalImage: modal.querySelector('#modal-image'),
        modalPrompt: modal.querySelector('#modal-prompt'),
        modalUsername: modal.querySelector('#modal-username'),
        downloadButton: modal.querySelector('#download-button'),
        commentsList: modal.querySelector('#comments-list'),
        commentInput: modal.querySelector('#comment-input'),
        postCommentButton: modal.querySelector('#post-comment'),
        modalModelElement: modal.querySelector('#modal-model'),
        modelContainer: modal.querySelector('#model-container'),
        deleteBtnContainer: modal.querySelector('#delete-button-container'),
        deleteBtn: modal.querySelector('#delete-button-modal'),
        shareBtnContainer: modal.querySelector('#share-button-container'),
        shareBtn: modal.querySelector('#share-button-modal'),
        closeCommentsBtn: modal.querySelector('#close-comments-modal'),
        copyPromptButton: modal.querySelector('#copy-prompt'),
        fullscreenIconButton: modal.querySelector('#fullscreen-icon') // Icon inside the modal
    };

    // Validate all elements were found
    for (const key in elements) {
        if (!elements[key]) {
            // Construct a likely ID for the error message
            const likelyId = key.replace(/([A-Z])/g, '-$1').toLowerCase();
            console.error(`[gallery.js] Comments modal element not found: #${likelyId} (or similar)`);
            showToast("Error opening image details.", "error");
            return;
        }
    }

    // --- Reset modal state --- 
    elements.commentsList.innerHTML = '<li>Loading comments...</li>';
    elements.commentInput.value = '';
    elements.deleteBtnContainer.classList.add('hidden');
    elements.shareBtnContainer.classList.add('hidden');
    elements.modelContainer.classList.add('hidden'); 
    elements.modalPrompt.textContent = 'Loading...';
    elements.modalUsername.textContent = 'Loading...';
    elements.modalModelElement.textContent = '';
    elements.modalImage.src = imageUrl || ''; 
    
    // Point download button to the proxy route
    if (elements.downloadButton) {
        elements.downloadButton.href = `/api/download-image/${contentId}`; 
        // Keep the download attribute as a fallback/suggestion, though Content-Disposition should take precedence
        elements.downloadButton.download = `pixzor_content_${contentId}.jpg`; 
    } else {
        console.error('[gallery.js] Download button element not found in modal.');
    }

    // Enable/disable comment input based on login status
    if (window.isLoggedIn) {
        elements.commentInput.disabled = false;
        elements.postCommentButton.disabled = false;
        elements.commentInput.placeholder = "Write a comment...";
    } else {
        elements.commentInput.disabled = true;
        elements.postCommentButton.disabled = true;
        elements.commentInput.placeholder = "Login to comment";
    }
    // --- End Reset modal state ---

    // --- Attach Listeners Specific to this Modal Instance ---
    elements.closeCommentsBtn.onclick = () => {
        modal.classList.add('hidden');
        currentContentId = null;
    };

    elements.copyPromptButton.onclick = () => {
        const promptText = elements.modalPrompt.textContent.trim();
        if (promptText && promptText !== 'Loading...' && promptText !== 'No prompt available.') {
            navigator.clipboard.writeText(promptText)
                .then(() => showToast('Prompt copied!', 'success'))
                .catch(err => {
                    console.error('Failed to copy prompt:', err);
                    showToast('Failed to copy prompt.', 'error');
                });
        } else {
             showToast('No prompt to copy.', 'info');
        }
    };

    elements.fullscreenIconButton.onclick = (e) => {
        e.stopPropagation(); 
        if (elements.modalImage.src) {
            openFullscreenModal(elements.modalImage.src);
        }
    };

    elements.postCommentButton.onclick = () => {
        // If the button is disabled (because user is not logged in), show the toast
        if (elements.postCommentButton.disabled) {
             showToast("Please Login to comment", "info");
        } else if (currentContentId) {
             // Otherwise (if enabled and logged in), proceed with posting
            postComment(currentContentId);
        }
    };

    elements.deleteBtn.onclick = async () => {
        const contentIdToDelete = currentContentId; 
        if (!contentIdToDelete) {
            showToast('Cannot delete: Content ID missing.', 'error');
            return;
        }
        if (confirm('Are you sure you want to delete this image permanently?')) {
            try {
                const response = await fetch(`/api/content/${contentIdToDelete}`, { method: 'DELETE' }); 
                const result = await response.json();
                if (response.ok) {
                    showToast(result.message || 'Image deleted successfully.', 'success');
                    document.getElementById(`image-card-${contentIdToDelete}`)?.remove(); 
                    modal.classList.add('hidden'); 
                    if (window.masonryInstance) {
                        console.log('[gallery.js] Re-laying out Masonry after delete.');
                        window.masonryInstance.layout(); 
                    } 
                } else {
                    throw new Error(result.error || 'Failed to delete image.');
                }
            } catch (error) {
                console.error('Error deleting content:', error);
                showToast(`Deletion failed: ${error.message}`, 'error');
            }
        }
    };

    elements.shareBtn.onclick = () => {
        const shareUrl = `${window.location.origin}/image/${currentContentId}`;
        navigator.clipboard.writeText(shareUrl)
            .then(() => {
                showToast('Link copied to clipboard!', 'success');
            })
            .catch(err => {
                console.error('Failed to copy share link:', err);
                showToast('Could not copy link.', 'error');
            });
    };
    // --- End Attach Listeners ---

    // --- Fetch content details --- 
    fetch(`/api/content-details/${contentId}`)
        .then(response => response.ok ? response.json() : Promise.reject('Failed to load details'))
        .then(data => {
            elements.modalPrompt.textContent = data.prompt || 'No prompt available.';
            elements.modalUsername.textContent = data.user?.username || 'Unknown'; 
            if (data.model) {
                elements.modalModelElement.textContent = data.model;
                elements.modelContainer.classList.remove('hidden');
            }
            if (data.isOwner) {
                elements.deleteBtnContainer.classList.remove('hidden');
            }
            if (data.isPublic || data.isOwner) {
                elements.shareBtnContainer.classList.remove('hidden');
            }
            loadComments(contentId);
            modal.classList.remove('hidden'); // Show modal AFTER details start loading
        })
        .catch(error => {
            console.error("Error fetching content details:", error);
            showToast('Could not load content details.', 'error');
            elements.commentsList.innerHTML = '<li>Error loading comments.</li>';
            modal.classList.remove('hidden');
            elements.modalPrompt.textContent = 'Error loading details.';
            elements.modalUsername.textContent = 'Error';
        });
}

// --- Helper: Escape HTML --- 
function escapeHTML(str) {
    // Add null/undefined check and logging
    if (str === null || typeof str === 'undefined') {
        console.warn('[escapeHTML] Received null or undefined input.');
        return ''; 
    }
    console.log('[escapeHTML] Input string:', str); // Log input
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

// --- Image Card Creation ---
function createImageCard(image) {
    const imageCard = document.createElement('div');
    imageCard.classList.add('image-card');
    imageCard.dataset.id = image.id;
    imageCard.id = `image-card-${image.id}`;

    // Using thumbnailUrl for the card display, fallback to contentUrl
    imageCard.innerHTML = `
        <div class="relative group">
            <img src="${image.thumbnailUrl ?? image.contentUrl}" 
                  alt="${image.prompt?.substring(0, 50) || 'AI Content'}..." 
                  class="w-full rounded-lg cursor-pointer block object-cover" 
                  loading="lazy" />
        </div>
    `;
    return imageCard;
}

// --- Load Images Function ---
async function loadImages() {
    if (isLoading || !hasMoreImages) return;
    isLoading = true;
    const loadingIndicator = document.getElementById('loading-indicator'); 
    if(loadingIndicator) loadingIndicator.style.display = 'block';

    try {
        const response = await fetch(`/api/gallery-content?page=${page}`);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const data = await response.json();
        const images = data.items; // API returns 'items' array
        const imageList = document.getElementById('image-list');

        if (!imageList || !window.masonryInstance) {
             console.error('[gallery.js] loadImages: Image list or Masonry instance not found.');
             if(loadingIndicator) loadingIndicator.style.display = 'none';
             isLoading = false;
             return; 
        }

        if (images.length === 0) {
             if (page === 1) {
                imageList.innerHTML = '<p class="text-white text-center col-span-full">No images found.</p>';
             } else {
                 if(loadingIndicator) loadingIndicator.textContent = 'No more images.';
             }
            hasMoreImages = false;
            if(loadingIndicator && page > 1) { /* Keep visible */ } else if (loadingIndicator) { loadingIndicator.style.display = 'none'; }
            return;
        }

        const fragment = document.createDocumentFragment();
        const newItems = [];
        images.forEach((image) => {
            const imageCard = createImageCard(image);
            fragment.appendChild(imageCard);
            newItems.push(imageCard);
        });

        imageList.appendChild(fragment);

        imagesLoaded(imageList).on('always', function() {
             console.log('[gallery.js] imagesLoaded complete, appending/layout Masonry.');
            window.masonryInstance.appended(newItems);
            window.masonryInstance.layout();
        });

        hasMoreImages = data.hasMore;
        if (hasMoreImages) {
            page++;
        } else {
             if(loadingIndicator) loadingIndicator.textContent = 'No more images.';
        }

    } catch (error) {
        console.error(`Error loading images:`, error);
        showToast('An error occurred while loading images.', 'error');
        if(loadingIndicator) loadingIndicator.textContent = 'Error loading images.';
        hasMoreImages = false; 
    } finally {
        isLoading = false;
        if(loadingIndicator && (loadingIndicator.textContent === 'No more images.' || loadingIndicator.textContent === 'Error loading images.')) {
            // Keep visible
        } else if (loadingIndicator) {
            loadingIndicator.style.display = 'none';
        }
    }
}

// --- Initialization Function ---
function initializeGallery() {
    console.log("[gallery.js] initializeGallery() called.");
    const imageList = document.getElementById('image-list');
    const loadingIndicator = document.getElementById('loading-indicator'); 

    if (loadingIndicator) loadingIndicator.style.display = 'block';

    if (imageList) {
        console.log("[gallery.js] Found #image-list container.");
        page = 1;
        hasMoreImages = true;
        isLoading = false;

        imageList.innerHTML = '<div class="grid-sizer"></div>';
        if (window.masonryInstance) {
            try {
                window.masonryInstance.destroy();
                window.masonryInstance = null;
            } catch (e) {
                console.error("[gallery.js] Error destroying Masonry instance:", e);
            }
        }

        try {
            window.masonryInstance = new Masonry(imageList, {
                itemSelector: '.image-card',
                columnWidth: '.grid-sizer',
                percentPosition: true,
                gutter: 10 
            });
            console.log("[gallery.js] Masonry initialized.");
        } catch (e) {
             console.error("[gallery.js] Failed to initialize Masonry:", e);
             imageList.innerHTML = '<p class="text-red-500 text-center col-span-full">Error initializing gallery layout.</p>';
             if (loadingIndicator) loadingIndicator.style.display = 'none';
             return;
        }
       
        // Add click listener using named handler
        imageList.removeEventListener('click', handleImageCardClick);
        imageList.addEventListener('click', handleImageCardClick);

        // Load Initial Images
        loadImages('/api/gallery-content');
       
        // Infinite Scroll (Consider adding cleanup if needed)
        let scrollTimeout;
        const handleScroll = () => {
            clearTimeout(scrollTimeout);
            scrollTimeout = setTimeout(() => {
                if ((window.innerHeight + window.scrollY) >= document.documentElement.scrollHeight - 500) { 
                    if (hasMoreImages && !isLoading) {
                        loadImages('/api/gallery-content');
                    }
                }
            }, 100);
        };
        window.addEventListener('scroll', handleScroll);

    } else {
        console.error("[gallery.js] initializeGallery: #image-list not found!");
        if (loadingIndicator) loadingIndicator.style.display = 'none';
    }
}

// Named handler for image card clicks
function handleImageCardClick(event) {
    const imageCard = event.target.closest('.image-card');
    if (imageCard) {
        const contentId = imageCard.dataset.id;
        const imgElement = imageCard.querySelector('img');
        const imageUrl = imgElement?.src; // Get the actual displayed image URL
        
        if (contentId && imageUrl) {
            openCommentsModal(contentId, imageUrl);
        } else {
            console.error('[gallery.js] Clicked image card missing content ID or image URL.', { contentId, imageUrl });
            showToast('Could not open image details.', 'error');
        }
    }
}

// --- END Initialization Function ---