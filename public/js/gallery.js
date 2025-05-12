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
    const shareUrl = `${baseUrl}/image/${contentId}`; // Changed to /image/:id
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
// --- Comments Modal Function ---
function openCommentsModal(contentId, imageUrl) {
    console.log(`[gallery.js] openCommentsModal called. ID: ${contentId}`);
    currentContentId = contentId;
    const modal = document.getElementById('comments-modal');
    
    if (!modal) {
        console.error('[gallery.js] Comments modal not found');
        showToast('Could not open image details.', 'error');
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
        if (!elements[key]) {
            const likelyId = key.replace(/([A-Z])/g, '-$1').toLowerCase();
            console.error(`[gallery.js] Comments modal element not found: #${likelyId}`);
            showToast("Error opening image details.", "error");
            return;
        }
    }

    history.pushState({ contentId, section: 'gallery', modal: true }, '', `/image/${contentId}`);
    document.title = elements.modalPrompt.textContent?.substring(0, 50) + '... | Pixzor' || 'Image Details | Pixzor';

    elements.commentsList.innerHTML = '<li>Loading comments...</li>';
    elements.commentInput.value = '';
    elements.deleteBtnContainer.classList.add('hidden');
    elements.shareBtnContainer.classList.add('hidden');
    elements.modelContainer.classList.add('hidden'); 
    elements.modalPrompt.textContent = 'Loading...';
    elements.modalUsername.textContent = 'Loading...';
    elements.modalModelElement.textContent = '';
    elements.modalImage.src = imageUrl || ''; 
    
    elements.downloadButton.href = `/api/download-image/${contentId}`; 
    elements.downloadButton.download = `pixzor_content_${contentId}.jpg`;

    if (window.isLoggedIn) {
        elements.commentInput.disabled = false;
        elements.postCommentButton.disabled = false;
        elements.commentInput.placeholder = "Write a comment...";
    } else {
        elements.commentInput.disabled = true;
        elements.postCommentButton.disabled = true;
        elements.commentInput.placeholder = "Login to comment";
    }

    elements.closeCommentsBtn.onclick = () => {
        console.log('[gallery.js] Close button clicked');
        modal.classList.add('hidden');
        currentContentId = null;
        history.back();
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
        if (elements.postCommentButton.disabled) {
            showToast("Please Login to comment", "info");
        } else if (currentContentId) {
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
                    history.back();
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
            modal.classList.remove('hidden');
            updateShareLinks(contentId);
        })
        .catch(error => {
            console.error("Error fetching content details:", error);
            showToast('Could not load content details.', 'error');
            elements.commentsList.innerHTML = '<li>Error loading comments.</li>';
            modal.classList.add('hidden');
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
    imageCard.classList.add('image-card', 'relative', 'group', 'cursor-pointer');
    imageCard.dataset.id = image.id;
    imageCard.id = `image-card-${image.id}`;

    imageCard.innerHTML = `
        <img src="${image.thumbnailUrl ?? image.contentUrl}" 
             alt="${image.prompt?.substring(0, 50) || 'AI Content'}..." 
             class="w-full rounded-lg cursor-pointer block object-cover transition-transform duration-200 ease-in-out group-hover:scale-105" 
             loading="lazy" />
        <div class="absolute inset-0 bg-black bg-opacity-0 group-hover:bg-opacity-40 transition-opacity duration-200 ease-in-out rounded-lg"></div>
        <p class="text-sm text-gray-600 mt-2">${image.prompt ? image.prompt.substring(0, 50) + '...' : 'No description'}</p>
        ${window.isLoggedIn && image.isOwner ? `
            <button class="toggle-public-btn absolute top-2 left-2 bg-gray-800 text-white p-2 rounded-full hover:bg-gray-700"
                    data-id="${image.id}" data-public="${image.isPublic ? '1' : '0'}"
                    title="${image.isPublic ? 'Make Private' : 'Make Public'}">
                <i class="fas ${image.isPublic ? 'fa-lock' : 'fa-globe'}"></i>
            </button>
        ` : ''}
        <div class="like-container absolute top-2 right-2 flex flex-col items-center space-y-0"> {/* Changed to flex-col, removed bg and padding */}
            <button class="like-btn ${image.isLikedByUser ? 'text-red-500' : 'text-gray-700'} hover:text-red-500" {/* Simplified: red if liked, dark gray if not. Hover always makes it red. */}
                    data-id="${image.id}" title="${image.isLikedByUser ? 'Unlike' : 'Like'}"
                    ${window.isLoggedIn ? '' : 'disabled'}>
                <i class="fas fa-heart text-2xl"></i>
            </button>
            <span class="like-count text-xs text-gray-200" data-id="${image.id}">${image.likeCount || 0}</span> {/* Adjusted text size/color for visibility */}
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

    const contentArea = document.getElementById('content-area') || document.getElementById('chat-messages');
    if (!contentArea) {
        console.error('[gallery.js] Content area not found');
        return;
    }
    
    contentArea.innerHTML = '<p class="text-center text-gray-400 p-4">Loading gallery...</p>';
    
    fetch('/api/gallery-content')
        .then(response => {
            console.log(`[Gallery Load] Response status: ${response.status}`);
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            return response.json();
        })
        .then(data => {
            console.log('[Gallery Load] Data received:', data);
            let html;
            if (data.items && data.items.length > 0) {
                const gridItems = data.items.map(item => `
                    <div id="image-card-${item.id}" class="image-card relative group cursor-pointer" data-id="${item.id}">
                        <img src="${item.thumbnailUrl || item.contentUrl}" 
                             alt="${item.prompt?.substring(0, 50) || 'Gallery image'}..." 
                             class="w-full h-full object-cover rounded-lg transition-transform duration-200 ease-in-out group-hover:scale-105"
                             loading="lazy">
                        <div class="absolute inset-0 bg-black bg-opacity-0 group-hover:bg-opacity-40 transition-opacity duration-200 ease-in-out rounded-lg"></div>
                        <p class="text-sm text-gray-600 mt-2">${item.prompt ? item.prompt.substring(0, 50) + '...' : 'No description'}</p>
                        ${window.isLoggedIn && item.isOwner ? `
                            <button class="toggle-public-btn absolute top-2 left-2 bg-gray-800 text-white p-2 rounded-full hover:bg-gray-700"
                                    data-id="${item.id}" data-public="${item.isPublic ? '1' : '0'}"
                                    title="${item.isPublic ? 'Make Private' : 'Make Public'}">
                                <i class="fas ${item.isPublic ? 'fa-lock' : 'fa-globe'}"></i>
                            </button>
                        ` : ''}
                        <div class="like-container absolute top-2 right-2 flex items-center space-x-1 bg-white bg-opacity-75 rounded px-1 py-1">
                            <button class="like-btn text-gray-500 hover:text-red-500 ${item.isLikedByUser ? 'text-red-500' : ''}" 
                                    data-id="${item.id}" title="${item.isLikedByUser ? 'Unlike' : 'Like'}" 
                                    ${window.isLoggedIn ? '' : 'disabled'}>
                                <i class="fas fa-heart"></i>
                            </button>
                            <span class="like-count text-sm text-gray-500" data-id="${item.id}">${item.likeCount || 0}</span>
                        </div>
                    </div>
                `).join('');
                html = `<div id="gallery-grid" class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3 p-4">
                          ${gridItems}
                        </div>`;
            } else {
                html = '<p class="text-center text-gray-400 p-4">No images in the gallery yet.</p>';
            }
            contentArea.innerHTML = html;

            // Initialize Masonry (if used)
            if (typeof Masonry !== 'undefined' && document.getElementById('gallery-grid')) { // Ensure grid exists
                window.masonryInstance = new Masonry('#gallery-grid', {
                    itemSelector: '.image-card',
                    columnWidth: '.image-card',
                    percentPosition: true,
                    gutter: 12
                });
            }
            
            // Explicitly initialize like buttons after HTML is set
            console.log('[gallery.js] Gallery HTML injected. Calling initializeLikeButtons().');
            initializeLikeButtons();

            // Add click handler for image cards (delegated from contentArea)
            // This existing handler should be fine, as it delegates.
            // We just need to make sure initializeLikeButtons is called for direct listeners.
            contentArea.addEventListener('click', (event) => {
                const imageCard = event.target.closest('.image-card');
                const toggleBtn = event.target.closest('.toggle-public-btn');
                
                const likeBtn = event.target.closest('.like-btn');
                if (toggleBtn || likeBtn) {
                    // Skip if clicking toggle or like button
                    return;
                }
                
                if (toggleBtn) {
                    const contentId = toggleBtn.dataset.id;
                    const isPublic = toggleBtn.dataset.public === '1';
                    console.log(`[Gallery Click] Toggling public status for ID: ${contentId}, Current isPublic: ${isPublic}`);
                    
                    fetch(`/api/content/${contentId}`, {
                        method: 'PATCH',
                        headers: {
                            'Content-Type': 'application/json',
                            'X-CSRF-Token': document.querySelector('meta[name="csrf-token"]')?.content || ''
                        },
                        body: JSON.stringify({ isPublic: !isPublic })
                    })
                        .then(response => response.json())
                        .then(result => {
                            if (result.success) {
                                toggleBtn.dataset.public = isPublic ? '0' : '1';
                                toggleBtn.title = isPublic ? 'Make Public' : 'Make Private';
                                toggleBtn.querySelector('i').className = `fas ${isPublic ? 'fa-globe' : 'fa-lock'}`;
                                showToast(`Image is now ${isPublic ? 'private' : 'public'}.`, 'success');
                                if (isPublic) {
                                    document.getElementById(`image-card-${contentId}`)?.remove();
                                    if (window.masonryInstance) {
                                        window.masonryInstance.layout();
                                    }
                                }
                            } else {
                                throw new Error(result.error || 'Failed to update visibility');
                            }
                        })
                        .catch(error => {
                            console.error('[Gallery Toggle] Error:', error);
                            showToast(`Failed to update visibility: ${error.message}`, 'error');
                        });
                    return;
                }

                if (imageCard) {
                    const contentId = imageCard.dataset.id;
                    const imgElement = imageCard.querySelector('img');
                    const imageUrl = imgElement?.src;
                    console.log(`[Gallery Click] Clicked image card. ID: ${contentId}, URL: ${imageUrl}`);
                    if (window.openCommentsModal) {
                        openCommentsModal(contentId, imageUrl);
                    }
                }
            });
        })
        .catch(error => {
            console.error('[Gallery Load] Error:', error);
            contentArea.innerHTML = `<p class="text-center text-red-500 p-4">Error loading gallery: ${error.message}</p>`;
        });
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
        
// Like/Unlike functionality
function initializeLikeButtons() {
    console.log('[gallery.js] Attempting to initialize like buttons...');
    const likeButtons = document.querySelectorAll('#gallery-grid .like-btn'); // Make selector more specific
    console.log(`[gallery.js] Found ${likeButtons.length} like buttons within #gallery-grid.`);

    if (likeButtons.length === 0) {
        const allLikeButtons = document.querySelectorAll('.like-btn');
        console.log(`[gallery.js] For broader check, found ${allLikeButtons.length} .like-btn elements on the entire page.`);
    }

    likeButtons.forEach((button, index) => {
        console.log(`[gallery.js] Processing button ${index + 1} with ID: ${button.dataset.id}`);
        if (button.dataset.listenerAttached === 'true') {
            console.log(`[gallery.js] Listener already attached to button ${button.dataset.id}. Skipping.`);
            return;
        }
        button.dataset.listenerAttached = 'true'; // Use a more descriptive dataset property
        console.log(`[gallery.js] Attaching click listener to like button with ID: ${button.dataset.id}`);
        
        button.addEventListener('click', async (event) => {
            console.log(`[Like Button] Click event fired for button ID: ${button.dataset.id}`);
            event.preventDefault();
            event.stopPropagation();
            if (button.disabled) {
                showToast('Please log in to like images.', 'error');
                return;
            }
            const contentId = button.dataset.id;
            const likeContainer = button.closest('.like-container');
            if (!likeContainer) {
                console.error(`[Like Button] Like container not found for button with ID: ${contentId}`);
                showToast('Error interacting with like button.', 'error');
                return;
            }
            const likeCountSpan = likeContainer.querySelector(`.like-count[data-id="${contentId}"]`);

            if (!likeCountSpan) {
                console.error(`[Like Button] Like count span not found for ID: ${contentId}`);
                showToast('Error updating like count. Span not found.', 'error');
                return;
            }

            button.disabled = true; // Disable button during operation

            let isLiked = button.classList.contains('text-red-500');
            let currentCount = parseInt(likeCountSpan.textContent) || 0;

            const originallyLiked = isLiked;
            const originalCount = currentCount;
            const originalTitle = button.title;

            // Optimistic UI Update
            if (originallyLiked) { // User wants to unlike
                button.classList.remove('text-red-500');
                button.classList.add('text-gray-500');
                button.title = 'Like';
                likeCountSpan.textContent = Math.max(0, originalCount - 1);
            } else { // User wants to like
                button.classList.add('text-red-500');
                button.classList.remove('text-gray-500');
                button.title = 'Unlike';
                likeCountSpan.textContent = originalCount + 1;
            }

            try {
                const csrfToken = document.querySelector('meta[name="csrf-token"]')?.content || '';
                const response = await fetch(`/api/content/${contentId}/like`, {
                    method: originallyLiked ? 'DELETE' : 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-CSRF-Token': csrfToken
                    },
                    credentials: 'include'
                });

                if (!response.ok) {
                    let errorMsg = `Failed to ${originallyLiked ? 'unlike' : 'like'}. Status: ${response.status}`;
                    try {
                        const errorData = await response.json();
                        errorMsg = errorData.error || errorData.message || errorMsg;
                    } catch (e) {
                        try {
                            const textError = await response.text();
                            if (textError) errorMsg += `: ${textError.substring(0, 100)}`;
                        } catch (e2) { /* ignore */ }
                    }
                    throw new Error(errorMsg);
                }

                const newLikeStatus = await response.json();
                console.log('[Like API Response]', newLikeStatus); // Log server response for debugging

                // Update UI with server's truth, defensively
                if (typeof newLikeStatus.likeCount === 'number') {
                    likeCountSpan.textContent = newLikeStatus.likeCount;
                } else {
                    console.warn('[Like API] likeCount is missing or not a number:', newLikeStatus.likeCount);
                }

                if (typeof newLikeStatus.isLiked === 'boolean') {
                    if (newLikeStatus.isLiked) {
                        button.classList.add('text-red-500');
                        button.classList.remove('text-gray-500');
                        button.title = 'Unlike';
                    } else {
                        button.classList.remove('text-red-500');
                        button.classList.add('text-gray-500');
                        button.title = 'Like';
                    }
                } else {
                    console.warn('[Like API] isLiked is missing or not a boolean:', newLikeStatus.isLiked);
                }
                showToast(originallyLiked ? 'Image unliked.' : 'Image liked!', 'success');

            } catch (error) {
                console.error('[Like] Error:', error);
                showToast(`${error.message}`, 'error');

                // Revert UI on API error
                if (originallyLiked) {
                    button.classList.add('text-red-500');
                    button.classList.remove('text-gray-500');
                } else {
                    button.classList.remove('text-red-500');
                    button.classList.add('text-gray-500');
                }
                button.title = originalTitle;
                likeCountSpan.textContent = originalCount;
            } finally {
                button.disabled = false; // Re-enable button
            }
        });
    });
}



const observer = new MutationObserver(() => initializeLikeButtons());
observer.observe(document.querySelector('#gallery-grid') || document.querySelector('#image-list'), { childList: true });

observer.observe(document.querySelector('#image-list'), { childList: true });

// Attach like button listeners on gallery load and updates
document.addEventListener('DOMContentLoaded', () => {
    if (document.querySelector('#image-list')) {
        initializeLikeButtons();
    }
});


// --- END Initialization Function ---