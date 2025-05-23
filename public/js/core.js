window.DEBUG_ENABLED = false;

// Utility function for conditional logging
window.debugLog = (...args) => {
  if (window.DEBUG_ENABLED) {
    console.log(...args);
  }
};

// Debug: Confirm script is loading
debugLog('[core.js] Script loaded at:', new Date().toISOString());

try {
    document.addEventListener('DOMContentLoaded', () => {
        debugLog('[core.js] DOMContentLoaded fired');

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

   // User Authentication
    try {
        window.isLoggedIn = false;
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

    // Function to load chat tab partial
    const loadChatTab = async (section, activeTab = 'create-images') => {
      debugLog(`[core.js] loadChatTab called with section=${section}, activeTab=${activeTab}`);

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

                // Load section content
                if (section === 'home') {
                    window.location.href = '/';
                    return;
                } else if (section === 'files') {
                    contentArea.innerHTML = '<p class="text-center text-gray-400 p-4">Loading files...</p>';
                    fetch('/api/files', {
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
                                return response.json().then(err => {
                                    throw new Error(err.message || `HTTP error! Status: ${response.status}`);
                                });
                            }
                            return response.json();
                        })
                        .then(data => {
                            let html = `<div id="file-list" class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3 p-4">
                                <div class="grid-sizer"></div>
                                ${data.items?.length > 0 ? data.items.map(item => `
                                    <div class="file-card relative group cursor-pointer aspect-square" data-id="${item.id}">
                                        <img src="${item.image}" alt="File thumbnail" class="w-full h-full object-cover rounded-lg transition-transform duration-200 ease-in-out group-hover:scale-105" loading="lazy">
                                        <div class="absolute inset-0 bg-black bg-opacity-0 group-hover:bg-opacity-40 transition-opacity duration-200 ease-in-out rounded-lg"></div>
                                        ${window.isLoggedIn && item.isOwner ? `
                                            <button class="toggle-public-btn absolute top-2 left-2 bg-gray-800 text-white p-2 rounded-full hover:bg-gray-700" data-id="${item.id}" data-public="${item.isPublic ? '1' : '0'}" title="${item.isPublic ? 'Make Private' : 'Make Public'}">
                                                <i class="fas ${item.isPublic ? 'fa-lock' : 'fa-globe'}"></i>
                                            </button>
                                        ` : ''}
                                    </div>
                                `).join('') : `<p class="text-center text-gray-400 p-4 col-span-full">${data.message || 'No files yet.'}</p>`}
                            </div>`;
                            contentArea.innerHTML = html;

                            if (typeof window.initializeLikeButtons === 'function') {
                                window.initializeLikeButtons();
                            }
                            const fileListElement = document.getElementById('file-list');
                            if (typeof Masonry !== 'undefined' && fileListElement && data.items?.length > 0) {
                                const msnry = new Masonry(fileListElement, {
                                    itemSelector: '.file-card',
                                    columnWidth: '.grid-sizer',
                                    gutter: 12,
                                    percentPosition: true
                                });
                                window.masonryInstance = msnry;
                                window.imagesLoaded(fileListElement).on('always', () => {
                                    if (window.masonryInstance) {
                                        window.masonryInstance.layout();
                                    }
                                });
                            }
                            contentArea.addEventListener('click', (event) => {
                                const fileCard = event.target.closest('.file-card');
                                const toggleBtn = event.target.closest('.toggle-public-btn');
                                if (toggleBtn) {
                                    const contentId = toggleBtn.dataset.id;
                                    const isPublic = toggleBtn.dataset.public === '1';
                                    fetch(`/api/content/${contentId}`, {
                                        method: 'PATCH',
                                        headers: {
                                            'Content-Type': 'application/json',
                                            'X-CSRF-Token': document.querySelector('meta[name="csrf-token"]')?.content || ''
                                        },
                                        credentials: 'include',
                                        body: JSON.stringify({ isPublic: !isPublic })
                                    })
                                        .then(response => response.json())
                                        .then(result => {
                                            if (result.success) {
                                                toggleBtn.dataset.public = isPublic ? '0' : '1';
                                                toggleBtn.title = isPublic ? 'Make Public' : 'Make Private';
                                                toggleBtn.querySelector('i').className = `fas ${isPublic ? 'fa-globe' : 'fa-lock'}`;
                                                window.showToast(`Image is now ${isPublic ? 'private' : 'public'}.`, 'success');
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
                                    const imageUrl = fileCard.querySelector('img')?.src;
                                    if (window.openCommentsModal) {
                                        window.openCommentsModal(contentId, imageUrl);
                                        history.pushState({ contentId, section: 'files', modal: true }, '', `/image/${contentId}`);
                                        document.title = data.items.find(item => item.id == contentId)?.prompt?.substring(0, 50) + '... | Pixzor' || 'Image Details | Pixzor';
                                        const modal = document.getElementById('comments-modal');
                                        if (modal) {
                                            const closeButton = modal.querySelector('.modal-close');
                                            if (closeButton) {
                                                closeButton.addEventListener('click', () => {
                                                    modal.classList.add('hidden');
                                                    history.replaceState({}, '', '/');
                                                    document.title = 'Pixzor';
                                                }, { once: true });
                                            }
                                        }
                                    } else {
                                        window.showToast('Could not open image details.', 'error');
                                    }
                                }
                            });
                        })
                        .catch(error => {
                            contentArea.classList.remove('loading');
                            contentArea.innerHTML = error.isAuthError 
                                ? '<p class="text-center text-gray-400 p-4">Please log in to access your files.</p>' 
                                : `<p class="text-center text-red-500 p-4">Error loading files: ${error.message || 'An unknown error occurred'}</p>`;
                        });
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
                    } else {
                        console.error('[core.js] modals-container not found');
                    }
                    window.showModal = function(id) {
                        const modal = document.getElementById(id);
                        if (modal) {
                            modal.classList.remove('hidden');
                            debugLog(`[core.js] Modal ${id} shown`);
                        } else {
                            console.error(`[core.js] Modal with ID ${id} not found`);
                        }
                    };
                    window.hideModal = function(id) {
                        const modal = document.getElementById(id);
                        if (modal) {
                            modal.classList.add('hidden');
                            debugLog(`[core.js] Modal ${id} hidden`);
                        } else {
                            console.error(`[core.js] Modal with ID ${id} not found`);
                        }
                    };
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
                    }
                    const buyTokensModal = document.getElementById('buy-tokens-modal');
                    const welcomeModal = document.getElementById('welcome-modal');
                    const closeBuyTokensModal = document.getElementById('close-buy-tokens-modal');
                    if (closeBuyTokensModal) {
                        closeBuyTokensModal.addEventListener('click', () => window.hideModal('buy-tokens-modal'));
                    }

                    const stripePublishableKey = 'pk_live_51QNNomGgZQx5JKvIyEzYuHbqZRdugWTVlseapCphcAL3gYdrXfSIN8R6toeaReScar1gFyxRODHv0XG1cf54xUsM00zJcyWw8j';
                
                    //const stripePublishableKey = 'pk_test_51QNNomGgZQx5JKvI2PAzM2GO5f0ukOcam2RUMj0ceduOPIuoRmWgqt7nqs46lRF7eyKd46Q8MRs1OYX76xi7fxHQ00LwfUHss5';
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
                    }
                    if (!localStorage.getItem('welcomeShown')) {
                        window.showModal('welcome-modal');
                        localStorage.setItem('welcomeShown', 'true');
                    }
                    const closeWelcomeModal = document.getElementById('close-welcome-modal');
                    if (closeWelcomeModal) {
                        closeWelcomeModal.addEventListener('click', () => window.hideModal('welcome-modal'));
                    }
                    const closeWelcomeModalBtn = document.getElementById('close-welcome-modal-btn');
                    if (closeWelcomeModalBtn) {
                        closeWelcomeModalBtn.addEventListener('click', () => window.hideModal('welcome-modal'));
                    }
                    const registerWithGoogle = document.getElementById('register-with-google');
                    if (registerWithGoogle) {
                        registerWithGoogle.addEventListener('click', () => {
                            window.location.href = '/auth/google';
                            window.hideModal('welcome-modal');
                        });
                    }
                    const closeAboutPopup = document.getElementById('close-about-popup');
                    if (closeAboutPopup) {
                        closeAboutPopup.addEventListener('click', () => window.hideModal('about-popup'));
                    }
                    const closeAboutPopupBtn = document.getElementById('close-about-popup-btn');
                    if (closeAboutPopupBtn) {
                        closeAboutPopupBtn.addEventListener('click', () => window.hideModal('about-popup'));
                    }
                    const contentArea = document.getElementById('content-area');
                    if (contentArea) {
                        contentArea.addEventListener('click', (e) => {
                            if (e.target.id === 'about-link') {
                                e.preventDefault();
                                window.showModal('about-popup');
                            }
                        });
                    }
                })
                .catch(error => {
                    console.error('[core.js] Error fetching or setting up modals:', error);
                });
        });
    } catch (error) {
        console.error('[core.js] Modals initialization error:', error);
    }
} catch (error) {
    console.error('[core.js] Top-level error:', error);
}
// Removed automatic call to loadChatTab on initial page load.
// The server should render the initial state (e.g., with splash screen).
// window.isContentAreaDisplayingNewSession should be false initially (set in layout.ejs).
debugLog('[core.js] Initial UI load is now handled by server-side rendering or specific user actions.');