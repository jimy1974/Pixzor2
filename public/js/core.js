// public/js/core.js
window.DEBUG_ENABLED = false;

// Utility function for conditional logging
window.debugLog = (...args) => {
  if (window.DEBUG_ENABLED) {
    console.log(...args);
  }
};

window.filesPage = 1;
window.filesIsLoading = false;
window.filesHasMoreImages = true;
window.FILES_LOAD_LIMIT = 6;
window.GALLERY_LOAD_LIMIT = 6; 
window.filesMasonryInstance = null; // Separate Masonry instance for files
window.currentFilesScrollHandler = null; // To store and remove 


// Debug: Confirm script is loading
debugLog('[core.js] Script loaded at:', new Date().toISOString());

try {
    document.addEventListener('DOMContentLoaded', () => {
        debugLog('[core.js] DOMContentLoaded fired');

        
        
        //////////////////////////////////        
        // --- Feedback Modal Logic ---
        
        const feedbackModal = document.getElementById('feedbackModal');
        const closeFeedbackModalBtn = document.getElementById('close-feedback-modal'); // The 'x' button in the modal
        const cancelFeedbackModalBtn = document.getElementById('cancel-feedback-modal'); // The 'Cancel' button in the modal

        // Function to hide the feedback modal
        const hideFeedbackModal = () => {
            if (feedbackModal) {
                feedbackModal.classList.add('hidden'); // Add 'hidden' class to hide
                feedbackModal.style.display = 'none'; // Ensure display is none for full hiding
            }
        };

        // Event listeners for closing the feedback modal
        if (closeFeedbackModalBtn) {
            closeFeedbackModalBtn.addEventListener('click', hideFeedbackModal);
        }
        if (cancelFeedbackModalBtn) {
            cancelFeedbackModalBtn.addEventListener('click', hideFeedbackModal);
        }

        // Close the modal if user clicks on the backdrop (outside the modal content)
        window.addEventListener('click', (event) => {
            if (event.target === feedbackModal) { // Check if the clicked element is the modal backdrop itself
                hideFeedbackModal();
            }
        });

        // Handle Feedback Form Submission
        const feedbackForm = document.getElementById('feedbackForm');
        if (feedbackForm) {
            feedbackForm.addEventListener('submit', async (e) => {
                e.preventDefault(); // Prevent default form submission

                // Collect form data
                const formData = new FormData(feedbackForm);
                const payload = Object.fromEntries(formData); // Convert to a plain object

                try {
                    const response = await fetch(feedbackForm.action, {
                        method: feedbackForm.method,
                        headers: {
                            'Content-Type': 'application/json',
                            // Include CSRF token if you have one set in a meta tag
                            'CSRF-Token': document.querySelector('meta[name="csrf-token"]') ? document.querySelector('meta[name="csrf-token"]').content : ''
                        },
                        body: JSON.stringify(payload)
                    });

                    if (response.ok) {
                        const result = await response.json();
                        // Replace with your global showToast function if you have one
                        window.showToast('Feedback submitted successfully! Thank you for your input.', 'success'); 
                        hideFeedbackModal(); // Hide the modal on success
                        feedbackForm.reset(); // Clear the form fields
                    } else {
                        const errorData = await response.json();
                        window.showToast(`Error submitting feedback: ${errorData.message || response.statusText}`, 'error');
                    }
                } catch (error) {
                    console.error('Network error or unexpected issue:', error);
                    window.showToast('Could not connect to the server to submit feedback. Please check your internet connection.', 'error');
                }
            });
        }
        
        
        ////////////////////////////////
        
        
        
        // Popstate handler
        try {
            window.addEventListener('popstate', (event) => {
                debugLog('[Popstate] Handling popstate event:', event.state, 'URL:', window.location.pathname);

                const modal = document.getElementById('comments-modal');
                if (event.state && event.state.modal && modal && !modal.classList.contains('hidden')) {
                    debugLog('[Popstate] Closing modal without reload');
                    modal.classList.add('hidden');
                    window.currentContentId = null; // Reset global from gallery.js
                    history.replaceState({}, '', '/');
                    document.title = 'Pixzor';
                    return;
                }

                const path = window.location.pathname;
                const contentArea = document.getElementById('chat-messages') || document.getElementById('content-area');
                if (!contentArea) {
                    console.error('[Popstate] Content area not found');
                    return;
                }

                if (path === '/gallery') {
                    debugLog('[Popstate] Triggering Gallery initialization');
                    if (window.initializeGallery) {
                        initializeGallery();
                    } else {
                        console.error('[Popstate] initializeGallery not available');
                        contentArea.innerHTML = '<p class="text-center text-red-500 p-4">Error loading gallery.</p>';
                    }
                } else if (path.match(/^\/image\/\d+$/)) {
                    debugLog('[Popstate] Image route detected, checking modal state');
                    if (!event.state || !event.state.modal) {
                        debugLog('[Popstate] Reloading for direct image access');
                        window.location.reload();
                    }
                } else { // Handles root path '/' or other unhandled paths
                    if (path === '/' && window.isContentAreaDisplayingNewSession === true) {
                        // If on root path AND we were just displaying a new session (chat/images),
                        // do NOT clear it. The user likely just closed a modal.
                        debugLog('[Popstate] On root path, but preserving active new session content.');
                        // Ensure the title is appropriate for the root, or keep the session title
                        document.title = 'Pixzor'; // Or keep the session title if preferred
                        // history.replaceState might not be needed if already at '/'
                    } else if (path === '/') {
                        // On root path, and no active new session was displayed (e.g., coming from gallery)
                        // Show the default splash screen by redirecting or loading home content.
                        // For now, to prevent clearing a potentially valid state from server, let's do nothing by default
                        // or explicitly load home_content if that's desired.
                        // The safest immediate action is to prevent clearing if contentArea has children
                        // and it's not the "Please refresh" message.
                        if (contentArea && contentArea.firstChild && !contentArea.textContent.includes("Please refresh or click Home")) {
                             debugLog('[Popstate] On root path, existing content found, not clearing to "Please refresh".');
                             document.title = 'Pixzor';
                        } else if (contentArea) {
                             debugLog('[Popstate] Defaulting to root content - showing "Please refresh" message.');
                             contentArea.innerHTML = '<p class="text-center text-gray-400 p-4">Please refresh or click Home to load chat UI.</p>';
                             history.replaceState({}, '', '/'); // Ensure URL is clean
                             document.title = 'Pixzor';
                        }
                    } else {
                        // For any other unhandled paths, show the "Please refresh" message.
                        if (contentArea) {
                            debugLog(`[Popstate] Unhandled path '${path}', defaulting to "Please refresh" message.`);
                            contentArea.innerHTML = '<p class="text-center text-gray-400 p-4">Please refresh or click Home to load chat UI.</p>';
                            document.title = 'Pixzor';
                        }
                    }
                }
            });
        } catch (error) {
            console.error('[core.js] Popstate handler error:', error);
        }

        debugLog('[core.js] Page loaded, checking modals...');
        try {
            const modals = document.querySelectorAll('.modal');
            modals.forEach(modal => {
                debugLog(`[core.js] Modal ${modal.id}: display=${getComputedStyle(modal).display}, hidden=${modal.classList.contains('hidden')}`);
                const observer = new MutationObserver(mutations => {
                    mutations.forEach(mutation => {
                        if (mutation.attributeName === 'class') {
                            debugLog(`[core.js] Modal ${modal.id} hidden class changed: ${modal.classList.contains('hidden')}`);
                        }
                    });
                });
                observer.observe(modal, { attributes: true });
            });
        } catch (error) {
            console.error('[core.js] Modal observer error:', error);
        }
    });

    // Log modal display changes
    window.addEventListener('load', () => {
        debugLog('[core.js] Window loaded, final modal states:');
        try {
            document.querySelectorAll('.modal').forEach(modal => {
                debugLog(`[core.js] Modal ${modal.id}: display=${getComputedStyle(modal).display}, hidden=${modal.classList.contains('hidden')}`);
            });
        } catch (error) {
            console.error('[core.js] Modal load error:', error);
        }
    });

    // WebSocket
    try {
        const protocol = window.location.protocol === 'http:' ? 'ws://' : 'wss://';
        const ws = new WebSocket(`${protocol}${window.location.host}`);

        ws.onopen = () => debugLog('[core.js] WebSocket connected');
        ws.onerror = (error) => console.error('[core.js] WebSocket error:', error);
        ws.onclose = (event) => debugLog('[core.js] WebSocket disconnected:', event.code, event.reason);

        window.sendChatMsg = function(messageObject) {
            if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify(messageObject));
                debugLog('[core.js] WebSocket sent:', messageObject);
            } else {
                console.error('[core.js] WebSocket is not open. ReadyState:', ws.readyState);
                window.showToast('Connection lost. Please refresh.', 'error');
            }
        };

         ws.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                debugLog('[core.js] WebSocket Received:', JSON.stringify(data, null, 2));

                let chatMessages = document.getElementById('chat-messages');
                if (!chatMessages) {
                    debugLog('[core.js] #chat-messages not found, attempting to recreate');
                    const contentArea = document.getElementById('content-area');
                    if (contentArea) {
                        chatMessages = document.createElement('div');
                        chatMessages.id = 'chat-messages';
                        chatMessages.classList.add('flex-1', 'overflow-y-auto', 'pb-32');
                        contentArea.appendChild(chatMessages);
                        debugLog('[core.js] Created #chat-messages in #content-area');
                    } else {
                        console.error('[core.js] #content-area not found, cannot process WebSocket message');
                        window.showToast('Chat area not found. Please refresh.', 'error');
                        return;
                    }
                }

                if (data.type === 'error') {
                    window.showToast(data.message, 'error');
                    const statusMsg = chatMessages.querySelector('.chat-message.status');
                    if (statusMsg) statusMsg.remove();
                } else if (data.type === 'messageChunk' && data.sender === 'bot') {
                    let lastBotMessage = chatMessages.querySelector('.chat-message.bot-message:last-child:not(.image-message)');
                    if (!lastBotMessage) {
                        lastBotMessage = document.createElement('div');
                        lastBotMessage.classList.add('chat-message', 'bot-message');
                        lastBotMessage.dataset.rawMarkdown = '';
                        chatMessages.appendChild(lastBotMessage);
                    }
                    if (lastBotMessage.dataset.rawMarkdown === undefined) {
                        lastBotMessage.dataset.rawMarkdown = '';
                    }
                    const chunkContent = data.message || '';
                    lastBotMessage.dataset.rawMarkdown += chunkContent;
                    if (typeof window.marked !== 'undefined') {
                        lastBotMessage.innerHTML = window.marked.parse(lastBotMessage.dataset.rawMarkdown, { sanitize: true, gfm: true, breaks: true });
                    } else {
                        console.warn('[core.js] marked.js not found. Displaying raw text.');
                        lastBotMessage.textContent = lastBotMessage.dataset.rawMarkdown;
                    }
                    debugLog('[core.js] Appended messageChunk to #chat-messages');
                    chatMessages.scrollTop = chatMessages.scrollHeight;
                } else if (data.type === 'chat' && data.sender === 'ai') {
                    const botDiv = document.createElement('div');
                    botDiv.classList.add('chat-message', 'bot-message');
                    if (typeof window.marked !== 'undefined') {
                        botDiv.innerHTML = window.marked.parse(data.message || '', { sanitize: true, gfm: true, breaks: true });
                    } else {
                        console.warn('[core.js] marked.js not found. Displaying raw text.');
                        botDiv.textContent = data.message || '';
                    }
                    chatMessages.appendChild(botDiv);
                    debugLog('[core.js] Appended chat message to #chat-messages');
                    chatMessages.scrollTop = chatMessages.scrollHeight;
                } else if (data.type === 'status') {
                    const existingStatus = chatMessages.querySelector('.chat-message.status');
                    if (existingStatus) existingStatus.remove();
                    const statusDiv = document.createElement('div');
                    statusDiv.classList.add('chat-message', 'status');
                    statusDiv.textContent = data.message || '...';
                    chatMessages.appendChild(statusDiv);
                    debugLog('[core.js] Appended status to #chat-messages');
                    chatMessages.scrollTop = chatMessages.scrollHeight;
                } else if (data.type === 'imageResult') {
                    const imageDiv = document.createElement('div');
                    imageDiv.classList.add('chat-message', 'bot-message', 'image-message');
                    imageDiv.innerHTML = `
                        <p>Here is the image you requested:</p>
                        <img src="${data.imageUrl}" 
                             class="generated-image" 
                             alt="Generated Image" 
                             style="max-width: 100%; height: auto; border-radius: 8px; margin-top: 8px;" 
                             ${data.contentId ? `data-content-id="${data.contentId}"` : ''}>
                        <button class="share-image-button" data-image-id="${data.contentId}">Share</button>
                    `;
                    chatMessages.appendChild(imageDiv);
                    debugLog('[core.js] Appended imageResult to #chat-messages');
                    chatMessages.scrollTop = chatMessages.scrollHeight;
                } else if (data.type === 'chatEnd' && data.image) {
                    const loadingDiv = chatMessages.querySelector('.image-loading');
                    if (loadingDiv) loadingDiv.remove();
                    const imageDiv = document.createElement('div');
                    imageDiv.classList.add('chat-message', 'bot-message');
                    imageDiv.innerHTML = `Here is your image: <img src="${data.image}" class="thumbnail" alt="Generated Image">`;
                    chatMessages.appendChild(imageDiv);
                    debugLog('[core.js] Appended chatEnd image to #chat-messages');
                    chatMessages.scrollTop = chatMessages.scrollHeight;
                } else if (data.type === 'SetTitle') {
                    document.title = `${data.newTitle} | Pixzor`;
                }
            } catch (error) {
                console.error('[core.js] WebSocket message error:', error);
                window.showToast('Error processing chat message. Please try again.', 'error');
            }
        };

        // Log WebSocket send for debugging
        window.sendChatMsg = (msg) => {
            debugLog('[core.js] WebSocket sent:', JSON.stringify(msg, null, 2));
            ws.send(JSON.stringify(msg));
        };
    } catch (error) {
        console.error('[core.js] WebSocket initialization error:', error);
    }

    // Toast function
    window.showToast = function(message, type = 'info') {
        try {
            const toastContainer = document.getElementById('toast-container');
            if (!toastContainer) {
                console.warn('[core.js] toast-container not found');
                return;
            }
            const toast = document.createElement('div');
            toast.className = `toast-${type} p-4 mb-4 rounded-lg shadow-lg text-white flex items-center justify-between max-w-sm`;
            toast.innerHTML = `
                <span>${message}</span>
                <button class="ml-4 text-white hover:text-gray-200" onclick="this.parentElement.remove()">✕</button>
            `;
            toastContainer.appendChild(toast);
            setTimeout(() => toast.remove(), 5000);
        } catch (error) {
            console.error('[core.js] showToast error:', error);
        }
    };

    // NEW: Function to handle placing image into prompt box for editing
    window.handleEditImageAction = function(imageUrl) {
        debugLog('[core.js] handleEditImageAction called with URL:', imageUrl);

        if (!imageUrl) {
            window.showToast('No image URL provided for editing.', 'error');
            return;
        }

        // Switch to the 'Create Images' tab and pass the image URL
        // The loadChatTab function will now handle populating the thumbnail AFTER the partial is loaded.
        if (typeof window.loadChatTab === 'function') {
            // Pass imageUrlToLoad as the third argument
            window.loadChatTab('create-image', 'create-images', imageUrl);
            debugLog('[core.js] Calling loadChatTab with image URL for editing.');
        } else {
            console.error('[core.js] window.loadChatTab is not defined. Cannot switch chat tab and load image.');
            window.showToast('Failed to switch to image generation tab. Please refresh.', 'error');
            return;
        }

        window.showToast('Image loaded into prompt box for editing!', 'success');

        // Scroll the chat box into view (it's fixed at the bottom)
        const chatBox = document.getElementById('chat-box');
        if (chatBox) {
            chatBox.scrollIntoView({ behavior: 'smooth', block: 'end' });
            debugLog('[core.js] Scrolled chat box into view.');
        }
    };


   // User Authentication
    try {
        
        fetch('/api/user-info', {
            credentials: 'same-origin' // Include session cookies
        })
            .then(response => {
                if (response.ok) {
                    window.isLoggedIn = true;
                    return response.json();
                } else {
                    window.isLoggedIn = false;
                    return response.json().catch(() => ({ error: 'Unknown error' }))
                        .then(errorData => {
                            debugLog('[core.js] User not authenticated:', errorData.error);
                            return null;
                        });
                }
            })
            .then(data => {
                const tokenCount = document.getElementById('token-count');
                const authButton = document.getElementById('google-auth-button');
                const authText = document.getElementById('auth-text');
                if (window.isLoggedIn && data && tokenCount && authButton && authText) {
                    const credits = parseFloat(data.credits) || 0;
                    tokenCount.textContent = `$${credits.toFixed(2)} Credits`;
                    authText.textContent = 'Logout';
                    authButton.onclick = () => window.location.href = '/logout';
                } else {
                    if (tokenCount) tokenCount.textContent = '- Credits';
                    if (authText) authText.textContent = 'Login';
                    if (authButton) authButton.onclick = () => window.location.href = '/auth/google';
                }
            })
            .catch(error => {
                console.error('[core.js] Error fetching user data:', error);
                const tokenCount = document.getElementById('token-count');
                const authButton = document.getElementById('google-auth-button');
                const authText = document.getElementById('auth-text');
                if (tokenCount) tokenCount.textContent = '- Credits';
                if (authText) authText.textContent = 'Login';
                if (authButton) authButton.onclick = () => window.location.href = '/auth/google';
                window.isLoggedIn = false;
            });
    } catch (error) {
        console.error('[core.js] User authentication error:', error);
        window.isLoggedIn = false;
    }

    
    
    
    

// Sidebar Logic
try {
    const sidebarItems = document.querySelectorAll('.sidebar-item');
    const contentArea = document.getElementById('content-area');

    debugLog('[core.js] Sidebar items found:', sidebarItems.length, 'at', new Date().toISOString());
    debugLog('[core.js] Content area exists:', !!contentArea, 'ID:', contentArea?.id);
    debugLog('[core.js] #chat-messages exists:', !!document.querySelector('#chat-messages'));

    if (!contentArea) {
        console.error('[core.js] Content area not found');
        window.showToast('Content area not found. Please refresh the page.', 'error');
    }

    // Function to load chat tab partial (no change)
    const loadChatTab = async (section, activeTab = 'create-images', imageUrlToLoad = null) => { // ADDED imageUrlToLoad PARAMETER
      debugLog(`[core.js] loadChatTab called with section=${section}, activeTab=${activeTab}, imageUrlToLoad=${imageUrlToLoad}`);

      const mainContentArea = document.getElementById('content-area');
      if (!mainContentArea) {
        console.error('[core.js] loadChatTab: #content-area not found');
        window.showToast('Main display area not found. Please refresh.', 'error');
        return;
      }

      // Create #chat-messages
      mainContentArea.innerHTML = '';
      let chatMessagesDiv = document.createElement('div');
      chatMessagesDiv.id = 'chat-messages';
      chatMessagesDiv.classList.add('flex-1', 'overflow-y-auto', 'pb-32');
      mainContentArea.appendChild(chatMessagesDiv);
      const titleText = activeTab === 'chat-talk' ? 'New Chat Conversation' : 'New Image Generations';
      chatMessagesDiv.innerHTML = `<h3 class="${activeTab === 'chat-talk' ? 'chat-area-title' : 'image-area-title'} text-lg font-semibold mb-4">${titleText}</h3>`;
      debugLog(`[core.js] Created #chat-messages with title: "${titleText}"`);

      // Update global flags
      window.isContentAreaDisplayingNewSession = true;
      window.currentChatSessionId = null;
      window.hasAccessedSideMenu = false;
      debugLog('[core.js] Flags updated: ICDNS=true, HSSM=false, currentChatSessionId=null');

      // Activate bottom bar tab
      const bottomChatTabsContainer = document.querySelector('.chat-tabs');
      if (bottomChatTabsContainer) {
        const tabs = bottomChatTabsContainer.querySelectorAll('.chat-tab');
        tabs.forEach(tab => tab.classList.remove('active'));
        const targetTab = bottomChatTabsContainer.querySelector(`.chat-tab[data-tab="${activeTab === 'chat-talk' ? 'chat' : 'create-images'}"]`);
        if (targetTab) {
          targetTab.classList.add('active');
          debugLog(`[core.js] Activated bottom bar tab: ${targetTab.dataset.tab}`);
        } else {
          console.warn('[core.js] Target tab not found in .chat-tabs');
        }
      } else {
        console.error('[core.js] .chat-tabs not found');
        window.showToast('Chat tabs not found. Please refresh.', 'error');
      }

      // Refresh chat-tab-content
      const chatTabContent = document.getElementById('chat-tab-content');
      if (chatTabContent) {
        try {
          const response = await fetch(`/chat-tab/${activeTab === 'chat-talk' ? 'chat' : 'create-images'}`);
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          chatTabContent.innerHTML = await response.text();
          debugLog('[core.js] Refreshed #chat-tab-content');

          // NEW: If an image URL was provided, populate the thumbnail after content is loaded
          if (imageUrlToLoad) {
              const imageThumbnailPreview = chatTabContent.querySelector('#image-thumbnail-preview');
              const imageForEditUrlInput = chatTabContent.querySelector('#image-for-edit-url');
              const clearImageUpload = chatTabContent.querySelector('#clear-image-upload');
              const thumbnailPlaceholderIcon = chatTabContent.querySelector('#thumbnail-placeholder-icon');
              const imageUploadInput = chatTabContent.querySelector('#image-upload-input'); // Ensure file input is cleared

              if (imageThumbnailPreview && imageForEditUrlInput && clearImageUpload && thumbnailPlaceholderIcon && imageUploadInput) {
                  imageThumbnailPreview.src = imageUrlToLoad;
                  imageThumbnailPreview.classList.remove('hidden');
                  thumbnailPlaceholderIcon.classList.add('hidden');
                  clearImageUpload.classList.remove('hidden');
                  imageForEditUrlInput.value = imageUrlToLoad; // Set the URL in the hidden input
                  imageUploadInput.value = ''; // Clear the file input if any
                  debugLog('[core.js] Image URL populated in thumbnail and hidden input after tab refresh.');
              } else {
                  console.warn('[core.js] Could not find thumbnail elements after tab refresh to populate image. Check chat-tab.ejs IDs.');
              }
          }

        } catch (error) {
          console.error('[core.js] Error fetching /chat-tab:', error);
          window.showToast('Failed to load chat panel. Please refresh.', 'error');
        }
      } else {
        console.error('[core.js] #chat-tab-content not found');
        window.showToast('Chat panel container not found. Please refresh.', 'error');
      }

      // Toggle input panels
      const createImageInputPanel = document.getElementById('create-images-content');
      const chatTalkInputPanel = document.getElementById('chat-talk');

      if (createImageInputPanel) {
        createImageInputPanel.style.display = 'none';
        createImageInputPanel.classList.remove('active');
        debugLog('[core.js] Hid #create-images-content');
      } else {
        console.warn('[core.js] #create-images-content not found');
      }

      if (chatTalkInputPanel) {
        chatTalkInputPanel.style.display = 'none';
        chatTalkInputPanel.classList.remove('active');
        debugLog('[core.js] Hid #chat-talk');
      } else {
        console.error('[core.js] #chat-talk not found - critical for chat functionality');
      }

      if (activeTab === 'create-images' && createImageInputPanel) {
        createImageInputPanel.style.display = 'flex';
        createImageInputPanel.classList.add('active');
        debugLog('[core.js] Activated #create-images-content');
        if (typeof window.setupCreateTab === 'function') {
          window.setupCreateTab();
        }
      } else if (activeTab === 'chat-talk' && chatTalkInputPanel) {
        chatTalkInputPanel.style.display = 'flex';
        chatTalkInputPanel.classList.add('active');
        debugLog('[core.js] Activated #chat-talk');
        if (typeof window.setupChat === 'function') {
          window.setupChat();
        }
      } else {
        console.error(`[core.js] Failed to activate input panel for activeTab=${activeTab}`);
        window.showToast('Input panel not found. Please refresh.', 'error');
      }

      debugLog('[core.js] loadChatTab finished');
    };
    window.loadChatTab = loadChatTab;

    sidebarItems.forEach(item => {
        item.addEventListener('click', (event) => {
            try {
                event.preventDefault();
                const section = item.dataset.section;
                debugLog(`[core.js] Sidebar clicked on section: ${section} at`, new Date().toISOString());
                debugLog('[core.js] #chat-messages exists before load:', !!document.querySelector('#chat-messages'));

                // Set hasAccessedSideMenu for sections that load content into #content-area
                if (['files', 'gallery', 'chat-history'].includes(section)) {
                    window.hasAccessedSideMenu = true;
                    debugLog('[core.js] Set window.hasAccessedSideMenu to true for section:', section, 'Value:', window.hasAccessedSideMenu);
                } else {
                    debugLog('[core.js] No hasAccessedSideMenu set for section:', section);
                }
                
                // Reset chat area flag for chat-history, gallery, or files
                if ( section === 'chat-history' || section === 'gallery' || section === 'files' ) {
                    window.isContentAreaDisplayingNewSession = false;
                    debugLog('[core.js] Reset window.isContentAreaDisplayingNewSession for section:', section);
                }

                // Remove active class from all items and add to the clicked one
                sidebarItems.forEach(i => i.classList.remove('active'));
                item.classList.add('active');

                // Maintain root URL
                history.replaceState({ section }, '', '/');
                document.title = `${section.charAt(0).toUpperCase() + section.slice(1)} | Pixzor`;

                if (!contentArea) {
                    console.error('[core.js] Content area not found during sidebar click');
                    window.showToast('Content area not found. Please refresh the page.', 'error');
                    return;
                }

                // Reset new session flag when any sidebar item loads content directly (not chat/create tabs)
                window.isContentAreaDisplayingNewSession = false;

                // --- CRITICAL FIX: Remove ALL existing global scroll handlers before loading new content ---
                if (window.currentFilesScrollHandler) {
                    window.removeEventListener('scroll', window.currentFilesScrollHandler);
                    window.currentFilesScrollHandler = null;
                    debugLog('[core.js] Removed previous files scroll handler from window.');
                }
                if (window.currentGalleryScrollHandler) { // Assuming gallery.js uses window.currentGalleryScrollHandler
                    window.removeEventListener('scroll', window.currentGalleryScrollHandler);
                    window.currentGalleryScrollHandler = null;
                    debugLog('[core.js] Removed previous gallery scroll handler from window.');
                }
                // Also remove the contentArea click handler that's specific to 'files' for safety.
                if (window.currentFilesClickHandler) {
                    contentArea.removeEventListener('click', window.currentFilesClickHandler);
                    window.currentFilesClickHandler = null;
                    debugLog('[core.js] Removed previous files click handler from contentArea.');
                }
                // --- END CRITICAL FIX ---


                // Load section content
                if (section === 'home') {
                    window.location.href = '/';
                    return;
                } else if (section === 'files') {
                
                    // Reset pagination state for files when navigating to it
                    window.filesPage = 1;
                    window.filesIsLoading = false;
                    window.filesHasMoreImages = true;

                    // Clear content area and set up initial structure for files
                    contentArea.innerHTML = `
                        <h2 class="text-xl font-semibold text-white mb-4 p-2 border-b border-gray-600">Your Files</h2>
                        <p id="initial-files-loading" class="text-center text-gray-400 p-4">Loading files...</p>
                        <div id="file-list" class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3 p-4">
                            <div class="grid-sizer"></div>
                        </div>
                        <div id="files-loading-indicator" class="text-center py-4 text-gray-400" style="display: none;">Loading more files...</div>
                    `;
                    const fileListElement = document.getElementById('file-list');

                    // Initialize Masonry for files
                    if (typeof Masonry !== 'undefined' && fileListElement) {
                        if (window.filesMasonryInstance) { // Destroy previous instance if it exists
                            window.filesMasonryInstance.destroy();
                            window.filesMasonryInstance = null; // Clear reference
                            debugLog('[core.js] Masonry instance for files destroyed.');
                        }
                        window.filesMasonryInstance = new Masonry(fileListElement, {
                            itemSelector: '.file-card',
                            columnWidth: '.grid-sizer',
                            gutter: 12,
                            percentPosition: true,
                            initLayout: true // Perform initial layout when initialized
                        });
                        debugLog('[core.js] Masonry initialized for files.');
                    } else {
                        console.error('[core.js] Masonry could not be initialized for files. Masonry library missing or element not found.');
                        window.showToast('Masonry library not loaded. Please refresh.', 'error');
                        // Display error message directly in contentArea if Masonry is critical and fails to init
                        contentArea.innerHTML = `
                            <h2 class="text-xl font-semibold text-white mb-4 p-2 border-b border-gray-600">Your Files</h2>
                            <p class="text-center text-red-500 p-4">Error: Required libraries not loaded. Please refresh.</p>
                        `;
                        return;
                    }

                    // --- Delegated event listener for file-card clicks and toggle-public-btn ---
                    // This event listener will be attached *specifically* for the files section
                    // and will be removed by the cleanup logic above when another section is clicked.
                    if (!window.currentFilesClickHandler) { // Only attach if not already attached
                        const filesClickHandler = (event) => {
                            const fileCard = event.target.closest('.file-card');
                            const toggleBtn = event.target.closest('.toggle-public-btn');

                                                        
                            // Inside filesClickHandler, within the if (toggleBtn) block
                            if (toggleBtn) {
                                event.preventDefault(); // Prevent opening modal if button is clicked                                
                                const contentId = toggleBtn.dataset.id;
                                const isPublic = toggleBtn.dataset.public === '1'; // This is the *current* state
                                const newStateIsPublic = !isPublic; // <--- ADD THIS LINE HERE
                                
                                
                                fetch(`/api/content/${contentId}`, {
                                    method: 'PATCH',
                                    headers: {
                                        'Content-Type': 'application/json',
                                        'X-CSRF-Token': document.querySelector('meta[name="csrf-token"]')?.content || ''
                                    },
                                    credentials: 'include',
                                    body: JSON.stringify({ isPublic: !isPublic }) // Sending the *toggled* state to the server
                                })
                                    .then(response => response.json())
                                    .then(result => {
                                        if (result.success) {
                                            // PROBLEM: newStateIsPublic was used here without being defined.
                                            // The previous code had assumed it was magically available.
                                            toggleBtn.dataset.public = newStateIsPublic ? '1' : '0'; 
                                
                                            // Update button text and title (tooltip)
                                            toggleBtn.textContent = newStateIsPublic ? 'Public' : 'Private';
                                            toggleBtn.title = newStateIsPublic ? 'Make Private' : 'Make Public';

                                            // Update button classes for color
                                            toggleBtn.classList.remove('bg-red-600', 'hover:bg-red-700', 'bg-green-600', 'hover:bg-green-700'); // Remove existing color classes
                                            if (newStateIsPublic) {
                                                toggleBtn.classList.add('bg-green-600', 'hover:bg-green-700'); // Add green for public
                                            } else {
                                                toggleBtn.classList.add('bg-red-600', 'hover:bg-red-700');     // Add red for private
                                            }

                                            window.showToast(`Image is now ${newStateIsPublic ? 'public' : 'private'}.`, 'success');



                                        } else {
                                            throw new Error(result.error || 'Failed to update visibility');
                                        }
                                    })
                                    .catch(error => {
                                        window.showToast(`Failed to update visibility: ${error.message}`, 'error');
                                    });
                                return;
                            }

                            if (fileCard) {
                                const contentId = fileCard.dataset.id;
                                // Use the actual image URL from the img element's src
                                const imageUrl = fileCard.querySelector('img')?.src;
                                const promptText = fileCard.dataset.prompt || 'No prompt available.'; // If you store prompt on card dataset

                                if (window.openCommentsModal) {
                                    window.openCommentsModal(contentId, imageUrl, promptText);
                                    history.pushState({ contentId, section: 'files', modal: true }, '', `/image/${contentId}`);
                                    document.title = 'Image Details | Pixzor';

                                    const modal = document.getElementById('comments-modal');
                                    if (modal) {
                                        // Make sure modal close button correctly handles history state
                                        const closeButton = modal.querySelector('#close-comments-modal'); // Use the ID for consistency
                                        if (closeButton) {
                                            // Remove any existing listener before adding a new one
                                            const oldListener = modal._currentCloseListener; // Store listener reference
                                            if (oldListener) {
                                                closeButton.removeEventListener('click', oldListener);
                                            }
                                            const newCloseListener = () => {
                                                modal.classList.add('hidden');
                                                // Only go back if the state was specifically for this modal
                                                if (history.state && history.state.modal) {
                                                    history.back(); // Go back to previous state (e.g., /files)
                                                } else {
                                                    history.replaceState({}, '', '/'); // Fallback to root
                                                }
                                                document.title = 'Pixzor'; // Reset title
                                            };
                                            closeButton.addEventListener('click', newCloseListener, { once: true });
                                            modal._currentCloseListener = newCloseListener; // Store new listener reference
                                        }
                                    }
                                } else {
                                    window.showToast('Could not open image details.', 'error');
                                }
                            }
                        };
                        contentArea.addEventListener('click', filesClickHandler);
                        window.currentFilesClickHandler = filesClickHandler;
                        debugLog('[core.js] New files click handler attached to contentArea.');
                    }


                    // Define the function to load user files
                    const loadUserFiles = async () => {
                        const loadingIndicator = document.getElementById('files-loading-indicator');
                        const initialLoadingMessage = document.getElementById('initial-files-loading');
                        const fileListElement = document.getElementById('file-list');

                        // Prevent multiple simultaneous loads or loading when no more items
                        if (window.filesIsLoading || !window.filesHasMoreImages) {
                            debugLog('[core.js] loadUserFiles: Skipping, filesIsLoading:', window.filesIsLoading, 'filesHasMoreImages:', window.filesHasMoreImages);
                            const fileListHasAuthError = fileListElement?.innerHTML.includes('Please log in'); // Added optional chaining
                            const fileListHasGeneralError = fileListElement?.innerHTML.includes('Error loading files'); // Added optional chaining

                            if (loadingIndicator) {
                                if (fileListHasAuthError || fileListHasGeneralError) {
                                    loadingIndicator.style.display = 'none';
                                } else if (!window.filesHasMoreImages) {
                                    // Only show "No more files" if it's the *actual* final state
                                    loadingIndicator.textContent = 'No more files.';
                                    loadingIndicator.style.display = 'block';
                                }
                            }
                            return;
                        }

                        window.filesIsLoading = true; // Set loading flag early

                        // Show general loading indicator while data is being fetched
                        if (loadingIndicator) {
                            loadingIndicator.style.display = 'block';
                            loadingIndicator.textContent = 'Loading files...'; // Changed to "Loading files..." for first load
                        }
                        if (initialLoadingMessage) initialLoadingMessage.style.display = 'block'; // Ensure initial message is visible during load
                        debugLog('[core.js] Showing loading indicators for files.');


                        try {
                            const csrfToken = document.querySelector('meta[name="csrf-token"]')?.content || '';
                            const response = await fetch(`/api/files?page=${window.filesPage}&limit=${window.FILES_LOAD_LIMIT}`, {
                                method: 'GET',
                                headers: {
                                    'X-CSRF-Token': csrfToken,
                                    'Accept': 'application/json'
                                },
                                credentials: 'include'
                            });

                            // Ensure initial loading message is removed or hidden after successful fetch starts
                            if (initialLoadingMessage) initialLoadingMessage.style.display = 'none';
                            debugLog('[core.js] Initial loading message for files hidden after fetch.');

                            if (!response.ok) {
                                // If not OK, handle it as an error
                                const errorData = await response.json().catch(() => ({}));
                                // Mark as authentication error if status is 401
                                if (response.status === 401) {
                                    throw { isAuthError: true, status: response.status, message: errorData.error || 'Authentication required' };
                                }
                                throw new Error(errorData.message || `HTTP error! Status: ${response.status}`);
                            }
                            const data = await response.json();
                            const items = data.items;
                            debugLog(`[core.js] Fetched ${items.length} files for page ${window.filesPage}. Has more: ${data.hasMore}`);


                            if (items.length === 0) {
                                if (window.filesPage === 1) { // If no items on first load
                                    if (fileListElement) fileListElement.innerHTML = '<p class="text-center text-gray-400 p-4 col-span-full">No files yet.</p>'; // Added null check
                                }
                                if (loadingIndicator) {
                                    loadingIndicator.textContent = 'No files yet.'; // More appropriate for empty
                                    loadingIndicator.style.display = 'block';
                                }
                                window.filesHasMoreImages = false;
                                window.filesIsLoading = false; // Reset loading state
                                return; // Early exit on no items
                            }

                            // If we have items and it was the first page, clear "No files yet." if it was there
                            if (window.filesPage === 1 && fileListElement?.innerHTML.includes('No files yet.')) { // Added optional chaining
                                if (fileListElement) fileListElement.innerHTML = '<div class="grid-sizer"></div>'; // Re-add sizer if cleared, added null check
                            }

                            // Ensure fileListElement is valid before appending
                            if (!fileListElement) {
                                console.error('[core.js] fileListElement is null, cannot append images. This should not happen if the section is active.');
                                window.showToast('Error: File list container not found.', 'error');
                                window.filesHasMoreImages = false;
                                window.filesIsLoading = false;
                                return;
                            }


                            const fragment = document.createDocumentFragment();
                            const newItems = [];
                            items.forEach(item => {
                                const fileCard = document.createElement('div');
                                fileCard.classList.add(
                                    'file-card', 'relative', 'group', 'cursor-pointer', 'aspect-square'
                                    // Removed 'opacity-0', 'transition-opacity', 'duration-300' from here.
                                    // The `img` tag inside will handle opacity via CSS and JS.
                                );
                                fileCard.dataset.id = item.id;
                                fileCard.id = `file-card-${item.id}`;
                                fileCard.dataset.prompt = item.prompt || ''; // Store prompt for modal if needed

                                fileCard.innerHTML = `
                                    <img src="${item.image}" alt="File thumbnail" class="w-full h-full object-cover rounded-lg transition-transform duration-200 ease-in-out group-hover:scale-105" loading="lazy">
                                    <div class="absolute inset-0 bg-black bg-opacity-0 group-hover:bg-opacity-40 transition-opacity duration-200 ease-in-out rounded-lg"></div>
                                      
                                      
                                   ${window.isLoggedIn && item.isOwner ? `
                                        <button class="toggle-public-btn absolute top-2 left-2 px-3 py-1 rounded-full text-sm font-semibold transition-colors duration-200
                                            ${item.isPublic ? 'bg-green-600 hover:bg-green-700' : 'bg-red-600 hover:bg-red-700'}"
                                            data-id="${item.id}" data-public="${item.isPublic ? '1' : '0'}"
                                            title="${item.isPublic ? 'Make Private' : 'Make Public'}">
                                            ${item.isPublic ? 'Public' : 'Private'}
                                        </button>
                                    ` : ''}



                                    <div class="like-container absolute top-2 right-2 flex flex-col items-center space-y-0">
                                        <button class="like-btn ${item.isLikedByUser ? 'text-red-500' : 'text-gray-400'} hover:text-red-500"
                                                data-id="${item.id}" title="${item.isLikedByUser ? 'Unlike' : 'Like'}"
                                                ${window.isLoggedIn ? '' : 'disabled'}>
                                            <i class="fas fa-heart text-xl"></i>
                                        </button>
                                        <span class="like-count text-xs ${item.isLikedByUser ? 'text-red-500' : 'text-gray-200'}" data-id="${item.id}">${item.likeCount || 0}</span>
                                    </div>
                                `;
                                fragment.appendChild(fileCard);
                                newItems.push(fileCard);
                            });

                            fileListElement.appendChild(fragment); // This is line 751 based on typical formatting

                            // Store hasMore locally so we can use it in the imagesLoaded callback
                            const _hasMore = data.hasMore;

                            // Trigger Masonry layout only after newly added images are loaded
                            imagesLoaded(newItems).on('always', () => {
                                if (window.filesMasonryInstance) {
                                    window.filesMasonryInstance.appended(newItems);
                                    window.filesMasonryInstance.layout();
                                    // Make them visible by setting opacity to 1 on the images
                                    newItems.forEach(item => {
                                        const img = item.querySelector('img');
                                        if (img) img.style.opacity = '1';
                                    });
                                    debugLog('[core.js] Masonry layout complete for new files. Images visible.');
                                }

                                // --- CRITICAL CHANGE: Update hasMoreImages and loading indicator *after* images are visible ---
                                window.filesHasMoreImages = _hasMore; // Update global state based on fetched data

                                if (loadingIndicator) {
                                    if (window.filesHasMoreImages) {
                                        loadingIndicator.style.display = 'none'; // Hide if more pages are expected
                                    } else {
                                        loadingIndicator.textContent = 'No more files.'; // Show final message
                                        loadingIndicator.style.display = 'block'; // Keep visible to show this final message
                                    }
                                }
                                // --- END CRITICAL CHANGE ---

                                // Re-initialize like buttons for newly added elements
                                if (typeof window.initializeLikeButtons === 'function') {
                                    window.initializeLikeButtons();
                                }

                                // Only increment page and set isLoading to false *after* everything is visible and Masonry is done.
                                // This prevents scroll listener from firing too early if image loading is slow.
                                window.filesPage++;
                                window.filesIsLoading = false;
                                debugLog('[core.js] Files state updated. Page:', window.filesPage, 'hasMore:', window.filesHasMoreImages);
                            });

                        } catch (error) {
                            console.error('[core.js] Error loading user files:', error);

                            const initialMsg = document.getElementById('initial-files-loading');
                            if (window.filesPage === 1) { // Error on first load (auth error or other)
                                if (error.isAuthError) {
                                    if (initialMsg) {
                                        initialMsg.textContent = 'Please log in to access your files.';
                                        initialMsg.classList.add('text-center', 'text-gray-400', 'p-4', 'col-span-full');
                                        initialMsg.style.display = 'block'; // Ensure it's visible
                                    } else { // Fallback if element is missing
                                        if (fileListElement) fileListElement.innerHTML = '<p class="text-center text-gray-400 p-4 col-span-full">Please log in to access your files.</p>'; // Added null check
                                    }
                                    window.showToast('Please log in to view your files.', 'info'); // More direct toast
                                } else { // General error on first load
                                    if (initialMsg) {
                                        initialMsg.textContent = `Error loading files: ${error.message || 'An unknown error occurred'}`;
                                        initialMsg.classList.remove('text-gray-400'); // Change text color for error
                                        initialMsg.classList.add('text-red-500');
                                        initialMsg.style.display = 'block';
                                    } else {
                                        if (fileListElement) fileListElement.innerHTML = `<p class="text-center text-red-500 p-4 col-span-full">Error loading files: ${error.message || 'An unknown error occurred'}</p>`; // Added null check
                                    }
                                    window.showToast(`Error loading files: ${error.message}`, 'error');
                                }
                                // Hide the main loading indicator if there was an error on first load
                                if (loadingIndicator) loadingIndicator.style.display = 'none';
                            } else { // Error on subsequent infinite scroll load
                                if (loadingIndicator) {
                                    loadingIndicator.textContent = `Error loading more files: ${error.message || 'An unknown error occurred'}`;
                                    loadingIndicator.style.display = 'block'; // Keep visible to show the error message
                                }
                                window.showToast(`Error loading more files: ${error.message}`, 'error');
                            }
                            window.filesHasMoreImages = false; // Stop further attempts on error
                            window.filesIsLoading = false; // Ensure loading state is reset
                        } finally {
                            // This finally block is now mostly redundant for setting loading state and indicator display,
                            // as those are managed within the try/catch blocks and the imagesLoaded callback.
                            // It primarily ensures initialLoadingMessage is removed if somehow not already.
                            // No action needed here beyond what's in catch/try blocks.
                        }
                    };

                    // Initial load of files
                    loadUserFiles();

                    // Add scroll listener for infinite scroll to the WINDOW
                    // This will be removed by the cleanup logic above when another section is clicked.
                    if (!window.currentFilesScrollHandler) { // Only attach if not already attached
                        const filesScrollHandler = () => {
                            // Check document.documentElement for scroll properties, not contentArea
                            if (!window.filesMasonryInstance) return; 

                            // Debugging: Log scroll position and dimensions of the document
                            debugLog(`[core.js] Document Scroll: scrollTop=${document.documentElement.scrollTop}, clientHeight=${window.innerHeight}, scrollHeight=${document.documentElement.scrollHeight}`);

                            // Trigger when 600px from the bottom of the *document*
                            if (document.documentElement.scrollTop + window.innerHeight >= document.documentElement.scrollHeight - 600) {
                                if (!window.filesIsLoading && window.filesHasMoreImages) {
                                    debugLog('[core.js] Near bottom of files (document), loading more...');
                                    loadUserFiles();
                                } else {
                                    debugLog('[core.js] Not loading: filesIsLoading=', window.filesIsLoading, 'filesHasMoreImages=', window.filesHasMoreImages);
                                }
                            }
                        };
                        window.addEventListener('scroll', filesScrollHandler);
                        window.currentFilesScrollHandler = filesScrollHandler;
                        debugLog('[core.js] Files scroll handler attached to window.');
                    }
                    
                } else if (section === 'chat-history') {
                    contentArea.innerHTML = '<p class="text-center text-gray-400 p-4">Loading chat history...</p>';
                    fetch('/api/library/chats', {
                        method: 'GET',
                        headers: {
                            'X-CSRF-Token': document.querySelector('meta[name="csrf-token"]')?.content || '',
                            'Accept': 'application/json'
                        },
                        credentials: 'include'
                    })
                        .then(response => {
                            if (!response.ok) {
                                if (response.status === 401) {
                                    return Promise.reject({ isAuthError: true, status: response.status });
                                }
                                return response.text().then(text => {
                                    throw new Error(`HTTP error! Status: ${response.status}`);
                                });
                            }
                            return response.json();
                        })
                        .then(data => {
                            const html = data.items?.map(item => `
                                <div class="content-item chat-message flex justify-between items-center p-3 rounded hover:bg-gray-700 cursor-pointer border-b border-gray-600" data-chat-id="${item.id}">
                                    <div class="flex-grow mr-2 overflow-hidden" data-action="view-chat">
                                        <p class="font-semibold text-white truncate">${item.title || 'Chat Session'}</p>
                                        <p class="text-gray-400 text-sm">${new Date(item.timestamp).toLocaleString()}</p>
                                    </div>
                                    <button class="delete-chat-btn flex-shrink-0 p-1 text-gray-400 hover:text-red-500 rounded" data-chat-id="${item.id}" title="Delete Chat">
                                        <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                        </svg>
                                    </button>
                                </div>
                            `).join('') || `<p class="text-center text-gray-400">${data.message || 'No chat history yet.'}</p>`;
                            contentArea.innerHTML = `
                                <h2 class="text-xl font-semibold text-white mb-4 p-2 border-b border-gray-600">Chat History</h2>
                                <div class="space-y-1">${html}</div>
                            `;

                            function renderChatMessageContent(content) {
                                if (!window.marked) {
                                    return content || '';
                                }
                                let htmlContent = window.marked.parse(content || '', { sanitize: true, gfm: true, breaks: true });
                                const imageUrlRegex = /(\/images\/generated\/[^\s]+\.(?:jpg|jpeg|png|gif))\b/gi;
                                htmlContent = htmlContent.replace(imageUrlRegex, (match) => {
                                    return `<br><img src="${match}" alt="Chat Image" class="inline-block max-w-xs max-h-40 my-2 rounded shadow border border-gray-600">`;
                                });
                                return htmlContent;
                            }

                            document.querySelectorAll('.content-item.chat-message[data-chat-id]').forEach(chat => {
                                chat.addEventListener('click', (event) => {
                                    if (event.target.closest('.delete-chat-btn')) return;
                                    const chatId = chat.dataset.chatId;
                                    contentArea.innerHTML = '<p class="text-center text-gray-400 p-4">Loading chat...</p>';
                                    fetch(`/api/library/chats/${chatId}`, {
                                        method: 'GET',
                                        headers: {
                                            'X-CSRF-Token': document.querySelector('meta[name="csrf-token"]')?.content || '',
                                            'Accept': 'application/json'
                                        },
                                        credentials: 'include'
                                    })
                                        .then(response => {
                                            if (!response.ok) {
                                                return response.json().then(err => {
                                                    throw new Error(err.message || `HTTP error! Status: ${response.status}`);
                                                });
                                            }
                                            return response.json();
                                        })
                                        .then(chatData => {
                                            const messagesHtml = chatData.messages?.map(msg => `
                                                <div class="chat-message p-3 rounded mb-2 ${msg.role === 'user' ? 'bg-gray-800 text-right' : 'bg-gray-700 text-left'}">
                                                    <strong class="font-semibold">${msg.role === 'user' ? 'You' : 'Bot'}:</strong>
                                                    <div class="message-content mt-1">${renderChatMessageContent(msg.content)}</div>
                                                </div>
                                            `).join('') || `<p class="text-center text-gray-400">${chatData.message || 'No messages in this chat.'}</p>`;
                                            contentArea.innerHTML = `
                                                <button id="back-to-history" class="mb-4 px-3 py-1 bg-gray-600 hover:bg-gray-500 text-white rounded text-sm">← Back to History</button>
                                                <h3 class="text-lg font-semibold text-white mb-3 border-b border-gray-600 pb-2">${chatData.title || 'Chat Details'}</h3>
                                                <div class="space-y-2">${messagesHtml}</div>
                                            `;
                                            document.getElementById('back-to-history')?.addEventListener('click', () => {
                                                const historyItem = document.querySelector('.sidebar-item[data-section="chat-history"]');
                                                if (historyItem) historyItem.click();
                                            });
                                        })
                                        .catch(error => {
                                            contentArea.innerHTML = `<p class="text-center text-red-500 p-4">Error loading chat: ${error.message}</p>`;
                                        });
                                });
                            });

                            document.querySelectorAll('.delete-chat-btn').forEach(button => {
                                button.addEventListener('click', (event) => {
                                    event.stopPropagation();
                                    const chatId = button.dataset.chatId;
                                    const chatItemElement = button.closest('.content-item.chat-message');
                                    const chatTitle = chatItemElement?.querySelector('p.font-semibold')?.textContent || 'this chat';
                                    if (window.confirm(`Are you sure you want to delete "${chatTitle}"? This cannot be undone.`)) {
                                        fetch(`/api/library/chats/${chatId}`, {
                                            method: 'DELETE',
                                            headers: {
                                                'Content-Type': 'application/json',
                                                'X-CSRF-Token': document.querySelector('meta[name="csrf-token"]')?.content || ''
                                            },
                                            credentials: 'include'
                                        })
                                            .then(response => {
                                                if (!response.ok) {
                                                    return response.json().then(err => {
                                                        throw new Error(err.message || `HTTP error! Status: ${response.status}`);
                                                    });
                                                }
                                                return response.json();
                                            })
                                            .then(data => {
                                                if (chatItemElement) {
                                                    chatItemElement.remove();
                                                    window.showToast(`Chat "${chatTitle}" deleted successfully.`, 'success');
                                                    if (!contentArea.querySelector('.content-item.chat-message[data-chat-id]')) {
                                                        contentArea.querySelector('div.space-y-1').innerHTML = '<p class="text-center text-gray-400">No chat history yet.</p>';
                                                    }
                                                }
                                            })
                                            .catch(error => {
                                                window.showToast(`Failed to delete chat: ${error.message}`, 'error');
                                            });
                                    }
                                });
                            });
                        })
                        .catch(error => {
                            contentArea.classList.remove('loading');
                            contentArea.innerHTML = error.isAuthError 
                                ? '<p class="text-center text-gray-400 p-4">Please log in to access your chat history.</p>' 
                                : `<p class="text-center text-red-500 p-4">Error loading chat history: ${error.message || 'An unknown error occurred'}</p>`;
                        });
                } else if (section === 'chat') {
                    loadChatTab(section, 'chat-talk');
                } else if (section === 'gallery') {
                    contentArea.innerHTML = '<p class="text-center text-gray-400 p-4">Loading gallery...</p>';
                    fetch('/partials/gallery')
                        .then(response => {
                            if (!response.ok) {
                                throw new Error(`HTTP error! Status: ${response.status}`);
                            }
                            return response.text();
                        })
                        .then(html => {
                            contentArea.innerHTML = html;
                            if (typeof window.initializeGallery === 'function') {
                                // IMPORTANT: gallery.js also needs its scroll listener attached to window
                                // and removed by this global cleanup if it also has infinite scroll.
                                // It should also store its listener in window.currentGalleryScrollHandler
                                window.initializeGallery(); 
                            } else {
                                contentArea.innerHTML = '<p class="text-center text-red-500 p-4">Error loading gallery: Gallery script not found.</p>';
                            }
                        })
                        .catch(error => {
                            contentArea.innerHTML = `<p class="text-center text-red-500 p-4">Error loading gallery: ${error.message}</p>`;
                        });
                } else if (section === 'create-image') {
                    loadChatTab(section, 'create-images');
                } else if (section === 'feedback') {
                        
                        // Show the feedback modal
                        if (feedbackModal) {
                            feedbackModal.classList.remove('hidden');
                            feedbackModal.style.display = 'flex';
                        } else {
                            console.error('[core.js] Feedback modal element not found for display.');
                            window.showToast('Feedback modal not available.', 'error');
                        }
                    } else {
                    contentArea.innerHTML = `<p class="text-center text-gray-400 p-4">Section ${section} not implemented.</p>`;
                }
            } catch (error) {
                console.error('[core.js] Sidebar click error:', error);
                window.showToast(`Error loading section ${section}: ${error.message}`, 'error');
            }
        });
    });
} catch (error) {
    console.error('[core.js] Sidebar initialization error:', error);
}
    
    

    // public/js/core.js (only the 'Modals' block, as requested)

    // Modals
    try {
        document.addEventListener('DOMContentLoaded', () => { 
            debugLog('[core.js] Modals DOMContentLoaded fired');
            
            fetch('/partials/modals')
                .then(response => response.text())
                .then(html => {
                    const modalsContainer = document.getElementById('modals-container');
                    if (modalsContainer) {
                        modalsContainer.innerHTML = html;
                        debugLog('[core.js] Modals HTML injected into modals-container.');

                        // --- Global showModal/hideModal functions (updated) ---
                        window.showModal = function(id) {
                            const modal = document.getElementById(id);
                            if (modal) {
                                modal.classList.remove('hidden');
                                modal.style.display = 'flex'; // Ensure flex for centering (per your CSS)
                                debugLog(`[core.js] Modal ${id} shown`);
                            } else {
                                console.error(`[core.js] Modal with ID ${id} not found`);
                            }
                        };
                        window.hideModal = function(id) {
                            const modal = document.getElementById(id);
                            if (modal) {
                                modal.classList.add('hidden');
                                modal.style.display = 'none'; // Ensure display is none for full hiding
                                debugLog(`[core.js] Modal ${id} hidden`);
                            } else {
                                console.error(`[core.js] Modal with ID ${id} not found`);
                            }
                        };
                        
                        // --- Feedback Modal Logic ---
                        const feedbackModal = document.getElementById('feedbackModal');
                        const closeFeedbackModalBtn = document.getElementById('close-feedback-modal');
                        const cancelFeedbackModalBtn = document.getElementById('cancel-feedback-modal');
                        const feedbackForm = document.getElementById('feedbackForm');

                        // NEW: Elements for login required state
                        const feedbackLoginRequiredDiv = document.getElementById('feedback-login-required');
                        const feedbackLoginButton = document.getElementById('feedback-login-button');
                        const feedbackDescriptionText = document.getElementById('feedback-description-text');
                        // END NEW

                        const hideFeedbackModal = () => {
                            if (feedbackModal) {
                                feedbackModal.classList.add('hidden');
                                feedbackModal.style.display = 'none';
                                debugLog('[core.js] Feedback modal hidden.');
                            }
                        };
                        window.hideFeedbackModal = hideFeedbackModal; 

                        if (closeFeedbackModalBtn) {
                            closeFeedbackModalBtn.addEventListener('click', hideFeedbackModal);
                            debugLog('[core.js] Feedback modal close button listener attached.');
                        }
                        if (cancelFeedbackModalBtn) {
                            cancelFeedbackModalBtn.addEventListener('click', hideFeedbackModal);
                            debugLog('[core.js] Feedback modal cancel button listener attached.');
                        }

                        if (feedbackModal) { 
                            window.addEventListener('click', (event) => {
                                if (event.target === feedbackModal) { 
                                    hideFeedbackModal();
                                }
                            });
                            debugLog('[core.js] Feedback modal backdrop listener attached.');
                        }

                        // =======================================================
                        // NEW FUNCTION FOR FEEDBACK FORM VISIBILITY BASED ON LOGIN
                        // =======================================================
                        const toggleFeedbackFormVisibility = () => {
                            if (window.isLoggedIn) {
                                if (feedbackLoginRequiredDiv) feedbackLoginRequiredDiv.classList.add('hidden');
                                if (feedbackForm) feedbackForm.classList.remove('hidden'); // Show form
                                if (feedbackDescriptionText) feedbackDescriptionText.classList.remove('hidden'); // Show description
                                debugLog('[core.js] User logged in: showing feedback form.');
                            } else {
                                if (feedbackLoginRequiredDiv) feedbackLoginRequiredDiv.classList.remove('hidden'); // Show login required message
                                if (feedbackForm) feedbackForm.classList.add('hidden'); // Hide form
                                if (feedbackDescriptionText) feedbackDescriptionText.classList.add('hidden'); // Hide description
                                debugLog('[core.js] User logged out: showing login required message, hiding form.');
                            }
                        };
                        
                        // Initial call to set visibility when modal is loaded
                        toggleFeedbackFormVisibility();

                        // Attach listener for the login button inside the feedback modal
                        if (feedbackLoginButton) {
                            feedbackLoginButton.addEventListener('click', () => {
                                debugLog('[core.js] Feedback modal login button clicked, redirecting to Google auth.');
                                window.location.href = '/auth/google'; // Redirect to Google login
                            });
                        }

                        // IMPORTANT: Override window.showModal to call toggleFeedbackFormVisibility
                        // when the feedback modal is shown. This ensures state is correct on open.
                        const originalShowModal = window.showModal; // Save original for other modals
                        window.showModal = function(id) {
                            originalShowModal(id); // Call original showModal
                            if (id === 'feedbackModal') {
                                toggleFeedbackFormVisibility(); // Update form visibility specifically for feedback modal
                            }
                        };
                        // =======================================================
                        // END NEW FUNCTION
                        // =======================================================

                        if (feedbackForm) {
                            feedbackForm.addEventListener('submit', async (e) => {
                                e.preventDefault();
                                // This client-side check is now a double-safety. The UI should prevent this.
                                if (!window.isLoggedIn) {
                                    window.showToast('You must be logged in to submit feedback. Please log in first.', 'error');
                                    return;
                                }

                                const formData = new FormData(feedbackForm);
                                const payload = Object.fromEntries(formData);

                                try {
                                    const response = await fetch(feedbackForm.action, {
                                        method: feedbackForm.method,
                                        headers: {
                                            'Content-Type': 'application/json',
                                            'CSRF-Token': document.querySelector('meta[name="csrf-token"]') ? document.querySelector('meta[name="csrf-token"]').content : ''
                                        },
                                        body: JSON.stringify(payload)
                                    });

                                    if (response.ok) {
                                        const result = await response.json();
                                        window.showToast('Feedback submitted successfully! Thank you for your input.', 'success'); 
                                        hideFeedbackModal();
                                        feedbackForm.reset();
                                    } else {
                                        const errorData = await response.json();
                                        window.showToast(`Error submitting feedback: ${errorData.message || response.statusText}`, 'error');
                                    }
                                } catch (error) {
                                    console.error('Network error or unexpected issue:', error);
                                    window.showToast('Could not connect to the server to submit feedback. Please check your internet connection.', 'error');
                                }
                            });
                            debugLog('[core.js] Feedback form submit listener attached.');
                        }
                        // --- End Feedback Modal Logic ---


                        // --- Your existing modal logic for other modals (buy tokens, welcome, about) ---
                        // Re-get references to elements after HTML is loaded
                        // Ensure all elements here are also obtained *after* the HTML is injected
                        const tokensButton = document.getElementById('tokens-button');
                        if (tokensButton) {
                            tokensButton.addEventListener('click', () => {
                                if (!window.isLoggedIn) {
                                    window.showToast('Please log in to buy credits.', 'error');
                                    window.location.href = '/auth/google';
                                    return;
                                }
                                window.showModal('buy-tokens-modal');
                            });
                            debugLog('[core.js] Tokens button listener attached.');
                        }
                        
                        const buyTokensModal = document.getElementById('buy-tokens-modal');
                        const welcomeModal = document.getElementById('welcome-modal'); 
                        const closeBuyTokensModal = document.getElementById('close-buy-tokens-modal');
                        if (closeBuyTokensModal) {
                            closeBuyTokensModal.addEventListener('click', () => window.hideModal('buy-tokens-modal'));
                            debugLog('[core.js] Buy Tokens modal close button listener attached.');
                        }

                        const stripePublishableKey = 'pk_live_51QNNomGgZQx5JKvIyEzYuHbqZRdugWTVlseapCphcAL3gYdrXfSIN8R6toeaReScar1gFyxRODHv0XG1cf54xUsM00zJcyWw8j';
                        let stripe = null;
                        if (typeof Stripe === 'function') {
                            stripe = Stripe(stripePublishableKey);
                        } else {
                            console.error('[core.js] Stripe.js not loaded. Make sure it\'s included in your HTML.');
                            window.showToast('Payment system error. Please contact support.', 'error');
                        }
                        const buyTokensForm = document.getElementById('buy-tokens-form');
                        if (buyTokensForm && stripe) {
                            buyTokensForm.addEventListener('submit', async (e) => {
                                e.preventDefault();
                                const bundleSelect = document.getElementById('token-bundle');
                                const tokens = bundleSelect.value;
                                const selectedOption = bundleSelect.options[bundleSelect.selectedIndex];
                                const price = selectedOption.getAttribute('data-price');
                                if (!price) {
                                    console.error('[core.js] Missing data-price attribute on selected token bundle option.');
                                    window.showToast('Configuration error. Please select a valid bundle.', 'error');
                                    return;
                                }
                                try {
                                    const csrfToken = document.querySelector('meta[name="csrf-token"]').getAttribute('content');
                                    const response = await fetch('/payment/create-checkout-session', {
                                        method: 'POST',
                                        headers: {
                                            'Content-Type': 'application/json',
                                            'X-CSRF-Token': csrfToken
                                        },
                                        body: JSON.stringify({ tokens: tokens, price: price })
                                    });
                                    if (!response.ok) {
                                        const errorData = await response.json();
                                        throw new Error(errorData.error || `Server error: ${response.status}`);
                                    }
                                    const { sessionId } = await response.json();
                                    const { error } = await stripe.redirectToCheckout({ sessionId });
                                    if (error) {
                                        throw new Error(error.message || 'Failed to redirect to payment.');
                                    }
                                } catch (error) {
                                    console.error('[core.js] Error during token purchase:', error);
                                    window.showToast(`Payment failed: ${error.message}. Please try again.`, 'error');
                                }
                            });
                            debugLog('[core.js] Buy Tokens form submit listener attached.');
                        }

                        if (!localStorage.getItem('welcomeShown')) {
                            originalShowModal('welcome-modal'); // Use originalShowModal here to avoid recursive call
                            localStorage.setItem('welcomeShown', 'true');
                            debugLog('[core.js] Welcome modal shown (first visit).');
                        }
                        const closeWelcomeModal = document.getElementById('close-welcome-modal');
                        if (closeWelcomeModal) {
                            closeWelcomeModal.addEventListener('click', () => window.hideModal('welcome-modal'));
                            debugLog('[core.js] Welcome modal close button listener attached.');
                        }
                        const closeWelcomeModalBtn = document.getElementById('close-welcome-modal-btn');
                        if (closeWelcomeModalBtn) {
                            closeWelcomeModalBtn.addEventListener('click', () => window.hideModal('welcome-modal'));
                            debugLog('[core.js] Welcome modal secondary close button listener attached.');
                        }
                        const registerWithGoogle = document.getElementById('register-with-google');
                        if (registerWithGoogle) {
                            registerWithGoogle.addEventListener('click', () => {
                                window.location.href = '/auth/google';
                                window.hideModal('welcome-modal');
                            });
                            debugLog('[core.js] Register with Google listener attached.');
                        }
                        const closeAboutPopup = document.getElementById('close-about-popup');
                        if (closeAboutPopup) {
                            closeAboutPopup.addEventListener('click', () => window.hideModal('about-popup'));
                            debugLog('[core.js] About popup close button listener attached.');
                        }
                        const closeAboutPopupBtn = document.getElementById('close-about-popup-btn');
                        if (closeAboutPopupBtn) {
                            closeAboutPopupBtn.addEventListener('click', () => window.hideModal('about-popup'));
                            debugLog('[core.js] About popup secondary close button listener attached.');
                        }
                        
                        const currentContentArea = document.getElementById('content-area');
                        if (currentContentArea) {
                            currentContentArea.addEventListener('click', (e) => {
                                if (e.target.id === 'about-link') {
                                    e.preventDefault();
                                    originalShowModal('about-popup'); // Use originalShowModal
                                    debugLog('[core.js] About link clicked, opening popup.');
                                }
                            });
                        } else {
                            console.warn('[core.js] contentArea not found for about-link listener.');
                        }

                    } else {
                        console.error('[core.js] modals-container not found');
                        window.showToast('Modal container missing. Please refresh.', 'error');
                    }
                })
                .catch(error => {
                    console.error('[core.js] Error fetching or setting up modals:', error);
                    window.showToast('Failed to load site modals. Please refresh.', 'error');
                });
        });
    } catch (error) {
        console.error('[core.js] Modals initialization error:', error);
        window.showToast('A critical error occurred with modals. Please refresh.', 'error');
    }

} catch (error) {
    console.error('[core.js] Top-level error:', error);
}

debugLog('[core.js] Initial UI load is now handled by server-side rendering or specific user actions.');