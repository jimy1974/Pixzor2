let page = 1;
let isLoading = false;
let hasMoreImages = true;
let currentContentId = null; // For the modal
let masonryInstance = null; // Hold masonry instance globally for this module
let imageListObserver = null; // Hold observer instance
let galleryGridObserver = null; // Hold observer instance

// --- Toast Function (Ensure core.js provides showToast or define it here) ---
// Assuming showToast is globally available from core.js

// --- Fullscreen Modal Functions ---
function openFullscreenModal(imageUrl) {
    debugLog('[gallery.js] openFullscreenModal called');
    const modal = document.getElementById('fullscreen-modal');
    const img = document.getElementById('fullscreen-image');
    if (modal && img) {
        img.src = imageUrl;
        modal.classList.remove('hidden');
    } else {
        console.error('[gallery.js] openFullscreenModal: Could not find modal or img element!');
    }
}

function closeFullscreenModal() {
    debugLog('[gallery.js] closeFullscreenModal called.');
    const modal = document.getElementById('fullscreen-modal');
    if (modal) {
        modal.classList.add('hidden');
        const img = document.getElementById('fullscreen-image');
        if (img) img.src = ''; 
    } else {
        console.error('[gallery.js] closeFullscreenModal: Could not find modal element!');
    }
}

document.addEventListener('DOMContentLoaded', () => {
    const closeButton = document.getElementById('close-fullscreen-modal'); 
    if (closeButton) {
        debugLog('[gallery.js] Attaching DOMContentLoaded listener to main close button:', closeButton);
        closeButton.addEventListener('click', (event) => {
            event.stopPropagation(); 
            debugLog('[gallery.js] Main close button clicked (DOMContentLoaded listener).');
            closeFullscreenModal();
        });
    } else {
        console.warn("[gallery.js] Main fullscreen modal close button (#close-fullscreen-modal) not found on DOMContentLoaded!");
    }
});

// --- Share Link Function ---
function updateShareLinks(contentId) {
    const baseUrl = window.location.origin;
    const shareUrl = `${baseUrl}/image/${contentId}`; 
    const shareText = 'Check out this cool AI content from Pixzor!';
    const modalImageElement = document.getElementById('modal-image');
    const imageUrl = modalImageElement ? modalImageElement.src : '';

    const fb = document.getElementById('share-facebook');
    const tw = document.getElementById('share-twitter');
    const pin = document.getElementById('share-pinterest');

    if (fb) fb.href = `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(shareUrl)}`;
    if (tw) tw.href = `https://twitter.com/intent/tweet?url=${encodeURIComponent(shareUrl)}&text=${encodeURIComponent(shareText)}`;
    if (pin && imageUrl) pin.href = `https://pinterest.com/pin/create/button/?url=${encodeURIComponent(shareUrl)}&media=${encodeURIComponent(imageUrl)}&description=${encodeURIComponent(shareText)}`;
    else if (pin) pin.href = '#';
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
        if(typeof window.showToast === 'function') window.showToast('Failed to load comments.', 'error');
    }
}

// --- Post Comment Function ---
async function postComment(contentId) {
    const commentInput = document.getElementById('comment-input');
    const postCommentButton = document.getElementById('post-comment');
    if (!commentInput || !postCommentButton) return;
    const commentText = commentInput.value.trim();
    if (!commentText) {
        if(typeof window.showToast === 'function') window.showToast('Comment cannot be empty.', 'error');
        return;
    }
    postCommentButton.disabled = true;
    postCommentButton.textContent = 'Posting...';
    try {
        const csrfToken = document.querySelector('meta[name="csrf-token"]')?.getAttribute('content');
        const response = await fetch(`/api/content/${contentId}/comments`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
            body: JSON.stringify({ text: commentText })
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || `HTTP error! status: ${response.status}`);
        commentInput.value = '';
        if(typeof window.showToast === 'function') window.showToast('Comment posted!', 'success');
        await loadComments(contentId);
    } catch (error) {
        console.error('Error posting comment:', error);
        if(typeof window.showToast === 'function') window.showToast(`Failed to post comment: ${error.message}`, 'error');
    } finally {
        postCommentButton.disabled = false;
        postCommentButton.textContent = 'Post';
    }
}

// --- Comments Modal Function ---
window.openCommentsModal = function(contentId, imageUrl, promptText = 'Loading...') { 
    debugLog(`[gallery.js] openCommentsModal called. ID: ${contentId}`);
    currentContentId = contentId; 
    const modal = document.getElementById('comments-modal');
    if (!modal) {
        console.error('[gallery.js] Comments modal not found');
        if(typeof window.showToast === 'function') window.showToast('Could not open image details.', 'error');
        return;
    }

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
        fullscreenIconButton: modal.querySelector('#fullscreen-icon')
    };

    for (const key in elements) {
        if (!elements[key] && key !== 'deleteBtn' && key !== 'deleteBtnContainer' && key !== 'shareBtn' && key !== 'shareBtnContainer') { 
            console.error(`[gallery.js] Comments modal element not found: #${key.replace(/([A-Z])/g, '-$1').toLowerCase()}`);
        }
    }
    
    if(elements.modalPrompt) elements.modalPrompt.textContent = promptText;
    if(elements.modalImage) elements.modalImage.src = imageUrl || '/images/placeholder.png';
    if(elements.commentsList) elements.commentsList.innerHTML = '<li>Loading comments...</li>';
    if(elements.commentInput) elements.commentInput.value = '';
    if(elements.deleteBtnContainer) elements.deleteBtnContainer.classList.add('hidden');
    if(elements.shareBtnContainer) elements.shareBtnContainer.classList.add('hidden');
    if(elements.modelContainer) elements.modelContainer.classList.add('hidden');
    if(elements.modalUsername) elements.modalUsername.textContent = 'Loading...';
    if(elements.modalModelElement) elements.modalModelElement.textContent = '';
    
    if(elements.downloadButton) {
        elements.downloadButton.href = `/api/download-image/${contentId}`; 
        elements.downloadButton.download = `pixzor_content_${contentId}.jpg`;
    }

    if (window.isLoggedIn) {
        if(elements.commentInput) elements.commentInput.disabled = false;
        if(elements.postCommentButton) elements.postCommentButton.disabled = false;
        if(elements.commentInput) elements.commentInput.placeholder = "Write a comment...";
    } else {
        if(elements.commentInput) elements.commentInput.disabled = true;
        if(elements.postCommentButton) elements.postCommentButton.disabled = true;
        if(elements.commentInput) elements.commentInput.placeholder = "Login to comment";
    }

    if(elements.closeCommentsBtn) {
        const newCloseBtn = elements.closeCommentsBtn.cloneNode(true);
        elements.closeCommentsBtn.parentNode.replaceChild(newCloseBtn, elements.closeCommentsBtn);
        elements.closeCommentsBtn = newCloseBtn;
        elements.closeCommentsBtn.onclick = () => {
            modal.classList.add('hidden');
            if (history.state && history.state.modal) history.back(); else history.replaceState(null, '', '/');
            document.title = 'Pixzor'; 
        };
    }

    if(elements.copyPromptButton && elements.modalPrompt) {
         elements.copyPromptButton.onclick = () => {
            const textToCopy = elements.modalPrompt.textContent.trim();
            if (textToCopy && textToCopy !== 'Loading...' && textToCopy !== 'No prompt available.') {
                navigator.clipboard.writeText(textToCopy)
                    .then(() => {if(typeof window.showToast === 'function') window.showToast('Prompt copied!', 'success');})
                    .catch(err => { console.error('Failed to copy prompt:', err); if(typeof window.showToast === 'function') window.showToast('Failed to copy prompt.', 'error'); });
            } else { if(typeof window.showToast === 'function') window.showToast('No prompt to copy.', 'info'); }
        };
    }

    if(elements.fullscreenIconButton && elements.modalImage) {
        elements.fullscreenIconButton.onclick = (e) => {
            e.stopPropagation(); 
            if (elements.modalImage.src) openFullscreenModal(elements.modalImage.src);
        };
    }
    
    if(elements.postCommentButton) {
        elements.postCommentButton.onclick = () => {
            if (elements.postCommentButton.disabled) { if(typeof window.showToast === 'function') window.showToast("Please Login to comment", "info"); }
            else if (currentContentId) postComment(currentContentId);
        };
    }

    if(elements.deleteBtn && elements.deleteBtnContainer) {
        elements.deleteBtn.onclick = async () => {
            const contentIdToDelete = currentContentId; 
            if (!contentIdToDelete) { if(typeof window.showToast === 'function') window.showToast('Cannot delete: Content ID missing.', 'error'); return; }
            if (confirm('Are you sure you want to delete this image permanently?')) {
                try {
                    const csrfToken = document.querySelector('meta[name="csrf-token"]').getAttribute('content');
                    const response = await fetch(`/api/content/${contentIdToDelete}`, {
                        method: 'DELETE', headers: { 'X-CSRF-Token': csrfToken }
                    });
                    const result = await response.json();
                    if (response.ok) {
                        if(typeof window.showToast === 'function') window.showToast(result.message || 'Image deleted successfully.', 'success');
                        const elementToRemove = document.getElementById(`image-card-${contentIdToDelete}`) || document.querySelector(`.file-card[data-id="${contentIdToDelete}"]`);
                        if (elementToRemove) {
                            if (window.masonryInstance && typeof window.masonryInstance.remove === 'function') {
                                window.masonryInstance.remove(elementToRemove);
                                window.masonryInstance.layout();
                            }
                            elementToRemove.remove();
                        }
                        modal.classList.add('hidden');
                        if (history.state && history.state.modal) history.back(); else history.replaceState(null, '', '/');
                    } else { throw new Error(result.error || 'Failed to delete image.'); }
                } catch (error) {
                    console.error('Error deleting content:', error);
                    if(typeof window.showToast === 'function') window.showToast(`Deletion failed: ${error.message}`, 'error');
                }
            }
        };
    }

    if(elements.shareBtn && elements.shareBtnContainer) {
        elements.shareBtn.onclick = () => {
            const shareUrl = `${window.location.origin}/image/${currentContentId}`;
            navigator.clipboard.writeText(shareUrl)
                .then(() => { if(typeof window.showToast === 'function') window.showToast('Link copied to clipboard!', 'success'); })
                .catch(err => { console.error('Failed to copy share link:', err); if(typeof window.showToast === 'function') window.showToast('Could not copy link.', 'error'); });
        };
    }
    
    history.pushState({ contentId, section: 'gallery', modal: true }, '', `/image/${contentId}`);
    document.title = (promptText ? promptText.substring(0,30) : 'Image') + '... | Pixzor';

    fetch(`/api/content-details/${contentId}`)
        .then(response => response.ok ? response.json() : Promise.reject(new Error('Failed to load details. Status: ' + response.status )))
        .then(data => {
            if(elements.modalPrompt) elements.modalPrompt.textContent = data.prompt || 'No prompt available.';
            if(elements.modalUsername) elements.modalUsername.textContent = data.user?.username || 'Unknown'; 
            if (data.model && elements.modalModelElement && elements.modelContainer) {
                elements.modalModelElement.textContent = data.model;
                elements.modelContainer.classList.remove('hidden');
            }
            if (data.isOwner && elements.deleteBtnContainer) elements.deleteBtnContainer.classList.remove('hidden');
            if ((data.isPublic || data.isOwner) && elements.shareBtnContainer) elements.shareBtnContainer.classList.remove('hidden');
            
            loadComments(contentId); 
            modal.classList.remove('hidden');
            updateShareLinks(contentId); 
        })
        .catch(error => {
            console.error("Error fetching content details:", error);
            if(typeof window.showToast === 'function') window.showToast(error.message || 'Could not load content details.', 'error');
            if(elements.commentsList) elements.commentsList.innerHTML = '<li>Error loading comments.</li>';
            if(elements.modalPrompt) elements.modalPrompt.textContent = 'Error loading details.';
            if(elements.modalUsername) elements.modalUsername.textContent = 'Error';
        });
};

// --- Helper: Escape HTML --- 
function escapeHTML(str) {
    if (str === null || typeof str === 'undefined') return ''; 
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

// --- Image Card Creation ---
function createImageCard(image) {
    const imageCard = document.createElement('div');
    imageCard.classList.add('image-card', 'relative', 'group', 'cursor-pointer');
    imageCard.dataset.id = image.id;
    imageCard.id = `image-card-${image.id}`;

    imageCard.innerHTML = `
        <img src="${image.thumbnailUrl ?? image.contentUrl}" 
             alt="${image.prompt?.substring(0, 50) || 'AI Content'}..." 
             class="w-full rounded-lg cursor-pointer block object-cover transition-transform duration-200 ease-in-out group-hover:scale-105" 
             loading="lazy" />
        <div class="absolute inset-0 bg-black bg-opacity-0 group-hover:bg-opacity-40 transition-opacity duration-200 ease-in-out rounded-lg"></div>
        ${window.isLoggedIn && image.isOwner ? `
            <button class="toggle-public-btn absolute top-2 left-2 bg-gray-800 text-white p-1.5 rounded-full hover:bg-gray-700 text-xs"
                    data-id="${image.id}" data-public="${image.isPublic ? '1' : '0'}"
                    title="${image.isPublic ? 'Make Private' : 'Make Public'}">
                <i class="fas ${image.isPublic ? 'fa-lock' : 'fa-globe'}"></i>
            </button>
        ` : ''}
        <div class="like-container absolute top-2 right-2 flex flex-col items-center space-y-0">
            <button class="like-btn ${image.isLikedByUser ? 'text-red-500' : 'text-gray-400'} hover:text-red-500"
                    data-id="${image.id}" title="${image.isLikedByUser ? 'Unlike' : 'Like'}"
                    ${window.isLoggedIn ? '' : 'disabled'}>
                <i class="fas fa-heart text-xl"></i>
            </button>
            <span class="like-count text-xs ${image.isLikedByUser ? 'text-red-500' : 'text-gray-200'}" data-id="${image.id}">${image.likeCount || 0}</span>
        </div>
    `;
    imageCard.addEventListener('click', (event) => {
        if (event.target.closest('button')) return;
        openCommentsModal(image.id, image.contentUrl, image.prompt);
    });
    return imageCard;
}

// --- Load Images Function (for infinite scroll) ---
async function loadImages() {
    if (isLoading || !hasMoreImages) return;
    isLoading = true;
    const loadingIndicator = document.getElementById('loading-indicator'); 
    if(loadingIndicator) loadingIndicator.style.display = 'block';

    try {
        const response = await fetch(`/api/gallery-content?page=${page}`);
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        const data = await response.json();
        const images = data.items;
        const imageList = document.getElementById('image-list');

        if (!imageList || !masonryInstance) { 
             console.error('[gallery.js] loadImages: Image list or Masonry instance not found.');
             if(loadingIndicator) loadingIndicator.style.display = 'none';
             isLoading = false;
             return; 
        }

        if (images.length === 0) {
             if (page === 1) imageList.innerHTML = '<p class="text-white text-center col-span-full">No images found.</p>';
             else if(loadingIndicator) loadingIndicator.textContent = 'No more images.';
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
            if (masonryInstance) { 
                masonryInstance.appended(newItems);
                masonryInstance.layout();
            }
        });

        hasMoreImages = data.hasMore;
        if (hasMoreImages) page++;
        else if(loadingIndicator) loadingIndicator.textContent = 'No more images.';

    } catch (error) {
        console.error(`Error loading images:`, error);
        if(typeof window.showToast === 'function') window.showToast('An error occurred while loading images.', 'error');
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

// --- Main Initialization Function for Gallery View ---
window.initializeGallery = async function() {
    debugLog('[gallery.js] initializeGallery called.');
    const contentArea = document.getElementById('content-area');
    if (!contentArea) {
        console.error('[gallery.js] initializeGallery: Content area not found');
        return;
    }
    
    contentArea.innerHTML = `
        <div id="gallery-controls" class="mb-4"></div>
        <div id="image-list" class="gallery-grid" style="position: relative;">
            <div class="grid-sizer"></div>
        </div>
        <div id="loading-indicator" class="text-center py-4" style="display: none;">Loading more images...</div>
    `;
    
    page = 1; 
    isLoading = false;
    hasMoreImages = true;
    masonryInstance = null; // Reset masonry instance

    const imageList = document.getElementById('image-list');
    if (imageList && typeof Masonry !== 'undefined') {
        masonryInstance = new Masonry(imageList, {
            itemSelector: '.image-card',
            columnWidth: '.grid-sizer',
            gutter: 12, 
            percentPosition: true,
            initLayout: true 
        });
        debugLog('[gallery.js] Masonry initialized.');
    } else {
        console.error('[gallery.js] Masonry could not be initialized. image-list or Masonry library missing.');
    }

    await loadImages(); 

    activateGalleryFeatures(); // Call this AFTER initial images are loaded and masonry is set up.
};

// --- Function to set up observers and dynamic features ---
function activateGalleryFeatures() {
    debugLog('[Gallery.js] activateGalleryFeatures called.');

    const imageListElement = document.getElementById('image-list');
    // Assuming gallery-grid is the same as image-list for observer purposes or not used for likes.
    // If #gallery-grid is a distinct parent that also gets new likeable items, it would need its own observer.

    if (imageListObserver) imageListObserver.disconnect(); // Disconnect previous if any

    if (imageListElement) {
        debugLog('[Gallery.js] #image-list found, initializing like buttons and setting up MutationObserver.');
        if (typeof initializeLikeButtons === 'function') initializeLikeButtons();
        
        imageListObserver = new MutationObserver(() => {
            debugLog('[Gallery.js] #image-list mutated, re-initializing like buttons.');
            if (typeof initializeLikeButtons === 'function') initializeLikeButtons();
            if (masonryInstance) masonryInstance.layout(); 
        });
        imageListObserver.observe(imageListElement, { childList: true, subtree: true });
    } else {
        console.warn('[Gallery.js] #image-list not found for observer setup in activateGalleryFeatures.');
    }
    
    const scrollContainer = document.getElementById('content-area'); 
    if (scrollContainer) {
        // To prevent multiple scroll listeners, remove before adding.
        scrollContainer.removeEventListener('scroll', galleryScrollHandler); 
        scrollContainer.addEventListener('scroll', galleryScrollHandler);
        debugLog('[gallery.js] Scroll listener attached to #content-area for infinite scroll.');
    } else {
        console.warn('[gallery.js] Scroll container #content-area not found for infinite scroll.');
    }
}
window.activateGalleryFeatures = activateGalleryFeatures;

function galleryScrollHandler() {
    const scrollContainer = document.getElementById('content-area');
    if (!scrollContainer) return;
    if (scrollContainer.scrollTop + scrollContainer.clientHeight >= scrollContainer.scrollHeight - 300) {
        if (!isLoading && hasMoreImages) {
            debugLog('[gallery.js] Near bottom, loading more images...');
            loadImages();
        }
    }
}

// --- Like Button Initialization ---
function initializeLikeButtons() {
    debugLog('[gallery.js] Initializing like buttons...');
    const likeButtons = document.querySelectorAll('.like-btn');
    debugLog(`[gallery.js] Found ${likeButtons.length} like buttons.`);

    likeButtons.forEach(button => {
        // Check if listener already attached to prevent duplicates if cloning isn't perfect
        if (button.dataset.listenerAttached === 'true') return;

        button.addEventListener('click', async (event) => {
            event.stopPropagation(); 
            if (!window.isLoggedIn) {
                if(typeof window.showToast === 'function') window.showToast('Please log in to like content.', 'info');
                return;
            }
            const contentId = button.dataset.id;
            const icon = button.querySelector('i');
            const likeCountSpan = document.querySelector(`.like-count[data-id="${contentId}"]`);
            
            if (!icon || !likeCountSpan) {
                console.error('[gallery.js] Like icon or count span not found for button:', button);
                return;
            }

            const isCurrentlyLiked = icon.classList.contains('text-red-500');
            // Optimistic update
            button.disabled = true;
            icon.classList.toggle('text-red-500', !isCurrentlyLiked);
            icon.classList.toggle('text-gray-400', isCurrentlyLiked); 
            likeCountSpan.textContent = parseInt(likeCountSpan.textContent) + (isCurrentlyLiked ? -1 : 1);
            if (!isCurrentlyLiked) likeCountSpan.classList.add('text-red-500'); else likeCountSpan.classList.remove('text-red-500');
            button.title = !isCurrentlyLiked ? 'Unlike' : 'Like';


            try {
                const csrfToken = document.querySelector('meta[name="csrf-token"]').getAttribute('content');
                const response = await fetch(`/api/content/${contentId}/like`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
                    body: JSON.stringify({ like: !isCurrentlyLiked })
                });
                const data = await response.json();
                if (!response.ok) throw new Error(data.error || 'Failed to update like status');
                
                // Update with server response
                icon.classList.toggle('text-red-500', data.liked);
                icon.classList.toggle('text-gray-400', !data.liked);
                likeCountSpan.textContent = data.likeCount;
                button.title = data.liked ? 'Unlike' : 'Like';
                if (data.liked) likeCountSpan.classList.add('text-red-500'); else likeCountSpan.classList.remove('text-red-500');

            } catch (error) {
                console.error('Error liking content:', error);
                if(typeof window.showToast === 'function') window.showToast(error.message || 'Could not update like.', 'error');
                // Revert optimistic update
                icon.classList.toggle('text-red-500', isCurrentlyLiked);
                icon.classList.toggle('text-gray-400', !isCurrentlyLiked);
                likeCountSpan.textContent = parseInt(likeCountSpan.textContent) + (isCurrentlyLiked ? 1 : -1); // Revert count
                if (isCurrentlyLiked) likeCountSpan.classList.add('text-red-500'); else likeCountSpan.classList.remove('text-red-500');
                button.title = isCurrentlyLiked ? 'Unlike' : 'Like';
            } finally {
                button.disabled = false;
            }
        });
        button.dataset.listenerAttached = 'true'; // Mark as attached
    });
}
window.initializeLikeButtons = initializeLikeButtons;

// No top-level or DOMContentLoaded observer setup here.
// It's handled by activateGalleryFeatures, called by initializeGallery.