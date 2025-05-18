document.addEventListener('DOMContentLoaded', () => {
    // Add popstate handler (unchanged)
    window.addEventListener('popstate', (event) => {
        console.log('[Popstate] Handling popstate event:', event.state, 'URL:', window.location.pathname);

        const modal = document.getElementById('comments-modal');
        if (event.state && event.state.modal && modal && !modal.classList.contains('hidden')) {
            console.log('[Popstate] Closing modal without reload');
            modal.classList.add('hidden');
            window.currentContentId = null; // Reset global from gallery.js
            return;
        }

        const path = window.location.pathname;
        const contentArea = document.getElementById('chat-messages') || document.getElementById('content-area');
        if (!contentArea) {
            console.error('[Popstate] Content area not found');
            return;
        }

        if (path === '/files') {
            console.log('[Popstate] Loading Files section');
            contentArea.innerHTML = '<p class="text-center text-gray-400 p-4">Loading files...</p>';
            fetch('/api/files')
                .then(response => response.json())
                .then(data => {
                    let html = data.items && data.items.length > 0
                        ? `<div id="file-list" class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3 p-4">
                            ${data.items.map(item => `
                                <div class="file-card relative group cursor-pointer aspect-square" data-id="${item.id}">
                                    <img src="${item.image}" alt="File thumbnail" class="w-full h-full object-cover rounded-lg" loading="lazy">
                                    <div class="absolute inset-0 bg-black bg-opacity-0 group-hover:bg-opacity-40 transition-opacity duration-200 ease-in-out rounded-lg"></div>
                                </div>
                            `).join('')}
                           </div>`
                        : '<p class="text-center text-gray-400 p-4">No files yet.</p>';
                    contentArea.innerHTML = html;
                })
                .catch(error => {
                    console.error('[Popstate] Error loading files:', error);
                    contentArea.innerHTML = `<p class="text-center text-red-500 p-4">Error loading files: ${error.message}</p>`;
                });
        } else if (path === '/gallery') {
            console.log('[Popstate] Triggering Gallery initialization');
            if (window.initializeGallery) {
                initializeGallery();
            } else {
                console.error('[Popstate] initializeGallery not available');
                contentArea.innerHTML = '<p class="text-center text-red-500 p-4">Error loading gallery.</p>';
            }
        } else if (path.match(/^\/image\/\d+$/)) {
            console.log('[Popstate] Image route detected, checking modal state');
            if (!event.state || !event.state.modal) {
                console.log('[Popstate] Reloading for direct image access');
                window.location.reload();
            }
        }
    });

    console.log('[core.js] Page loaded, checking modals...');
    const modals = document.querySelectorAll('.modal');
    modals.forEach(modal => {
        console.log(`[core.js] Modal ${modal.id}: display=${getComputedStyle(modal).display}, hidden=${modal.classList.contains('hidden')}`);
        const observer = new MutationObserver(mutations => {
            mutations.forEach(mutation => {
                if (mutation.attributeName === 'class') {
                    console.log(`[core.js] Modal ${modal.id} hidden class changed: ${modal.classList.contains('hidden')}`);
                }
            });
        });
        observer.observe(modal, { attributes: true });
    });
});

// Log any modal display changes (unchanged)
window.addEventListener('load', () => {
    console.log('[core.js] Window loaded, final modal states:');
    document.querySelectorAll('.modal').forEach(modal => {
        console.log(`[core.js] Modal ${modal.id}: display=${getComputedStyle(modal).display}, hidden=${modal.classList.contains('hidden')}`);
    });
});

// WebSocket (unchanged)
const protocol = window.location.protocol === 'http:' ? 'ws://' : 'wss://';
const ws = new WebSocket(`${protocol}${window.location.host}`);

ws.onopen = () => console.log('WebSocket connected');
ws.onerror = (error) => console.error('WebSocket error:', error);
ws.onclose = (event) => console.log('WebSocket disconnected:', event.code, event.reason);

function sendChatMsg(messageObject) {
    if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(messageObject));
    } else {
        console.error('WebSocket is not open. ReadyState:', ws.readyState);
        showToast('Connection lost. Please refresh.', 'error');
    }
}

ws.onmessage = (event) => {
    const data = JSON.parse(event.data);
    const chatMessages = document.getElementById('chat-messages');

    console.log('[WebSocket Received]', data);

    const oldStatus = chatMessages?.querySelector('.chat-message.status');
    if (oldStatus && data.type !== 'status') {
        oldStatus.remove();
    }

    if (data.type === 'error') {
        showToast(data.message, 'error');
        const statusMsg = chatMessages?.querySelector('.chat-message.status');
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
        if (typeof marked !== 'undefined') {
            lastBotMessage.innerHTML = marked.parse(lastBotMessage.dataset.rawMarkdown, { sanitize: true, gfm: true, breaks: true });
        } else {
            console.warn('marked.js not found. Displaying raw text.');
            lastBotMessage.textContent = lastBotMessage.dataset.rawMarkdown;
        }
        chatMessages.scrollTop = chatMessages.scrollHeight;
    } else if (data.type === 'chat' && data.sender === 'ai') {
        const botDiv = document.createElement('div');
        botDiv.classList.add('chat-message', 'bot-message');
        if (typeof marked !== 'undefined') {
            botDiv.innerHTML = marked.parse(data.message || '', { sanitize: true, gfm: true, breaks: true });
        } else {
            console.warn('marked.js not found. Displaying raw text.');
            botDiv.textContent = data.message || '';
        }
        chatMessages.appendChild(botDiv);
        chatMessages.scrollTop = chatMessages.scrollHeight;
    } else if (data.type === 'status') {
        const existingStatus = chatMessages.querySelector('.chat-message.status');
        if (existingStatus) existingStatus.remove();
        const statusDiv = document.createElement('div');
        statusDiv.classList.add('chat-message', 'status');
        statusDiv.textContent = data.message || '...';
        chatMessages.appendChild(statusDiv);
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
        `;
        chatMessages.appendChild(imageDiv);
        chatMessages.scrollTop = chatMessages.scrollHeight;
    } else if (data.type === 'chatEnd' && data.image) {
        const loadingDiv = chatMessages.querySelector('.image-loading');
        if (loadingDiv) loadingDiv.remove();
        const imageDiv = document.createElement('div');
        imageDiv.classList.add('chat-message', 'bot-message');
        imageDiv.innerHTML = `Here is your image: <img src="${data.image}" class="thumbnail" alt="Generated Image">`;
        chatMessages.appendChild(imageDiv);
        chatMessages.scrollTop = chatMessages.scrollHeight;
    } else if (data.type === 'SetTitle') {
        document.title = `${data.newTitle} | Pixzor`;
    }
};

function showToast(message, type = 'info') {
    const toastContainer = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast-${type} p-4 mb-4 rounded-lg shadow-lg text-white flex items-center justify-between max-w-sm`;
    toast.innerHTML = `
        <span>${message}</span>
        <button class="ml-4 text-white hover:text-gray-200" onclick="this.parentElement.remove()">✕</button>
    `;
    toastContainer.appendChild(toast);
    setTimeout(() => toast.remove(), 5000);
}

// User Authentication (unchanged)
window.isLoggedIn = false;

fetch('/api/user-info')
    .then(response => {
        if (response.ok) {
            window.isLoggedIn = true;
            return response.json();
        } else {
            window.isLoggedIn = false;
            return null;
        }
    })
    .then(data => {
        const tokenCount = document.getElementById('token-count');
        const authButton = document.getElementById('google-auth-button');
        const authText = document.getElementById('auth-text');
        if (window.isLoggedIn) {
            const credits = parseFloat(data.credits) || 0;
            tokenCount.textContent = `$${credits.toFixed(2)} Credits`;
            authText.textContent = 'Logout';
            authButton.onclick = () => window.location.href = '/logout';
        } else {
            tokenCount.textContent = '- Credits';
            authText.textContent = 'Login';
            authButton.onclick = () => window.location.href = '/auth/google';
        }
    })
    .catch(error => {
        console.error('Error fetching user data:', error);
        document.getElementById('token-count').textContent = '0 Credits';
        window.isLoggedIn = false;
    });

// Sidebar Logic (MODIFIED)
const sidebarItems = document.querySelectorAll('.sidebar-item');
const contentArea = document.getElementById('content-area') || document.getElementById('chat-messages');

if (!contentArea) {
    console.error('[Sidebar] Content area not found');
}

sidebarItems.forEach(item => {
    item.addEventListener('click', (event) => {
        event.preventDefault();
        const section = item.dataset.section;
        console.log(`[Sidebar] Clicked on section: ${section}`);
        console.log(`[Sidebar Click] Detected section: '${section}'`);

        // Remove active class from all items and add to the clicked one
        sidebarItems.forEach(i => i.classList.remove('active'));
        item.classList.add('active');

        // Update history and title (MODIFIED)
        if (section === 'files') {
            history.pushState({ section }, '', '/files');
            document.title = 'Files | Pixzor';
        } else {
            history.replaceState({ section }, '', window.location.pathname);
            document.title = `${section.charAt(0).toUpperCase() + section.slice(1)} | Pixzor`;
        }

        if (!contentArea) {
            console.error('[Sidebar Click] Content area not found');
            return;
        }

        // Reset chat area flag
        window.isChatAreaClearedForSession = false;

        // Load section content (unchanged)
        if (section === 'home') {
            window.location.href = '/';
            return;
        } else if (section === 'files') {
            contentArea.innerHTML = '<p class="text-center text-gray-400 p-4">Loading files...</p>';

            const csrfToken = document.querySelector('meta[name="csrf-token"]')?.content || '';
            console.log(`[Files Load] CSRF Token: ${csrfToken}, isLoggedIn: ${window.isLoggedIn}`);

            fetch('/api/files', {
                method: 'GET',
                headers: {
                    'X-CSRF-Token': csrfToken,
                    'Accept': 'application/json'
                },
                credentials: 'include'
            })
                .then(response => {
                    console.log(`[Files Load] Response status: ${response.status}`);
                    if (!response.ok) {
                        console.log(`[Files Load] Response headers:`, response.headers);
                        if (response.status === 401) {
                            console.log('[Files Load] Detected 401 Unauthorized');
                            return Promise.reject({ isAuthError: true, status: response.status });
                        }
                        return response.json().then(err => {
                            console.error('[Files Load] Server error data:', err);
                            throw new Error(err.message || `HTTP error! status: ${response.status}`);
                        });
                    }
                    return response.json();
                })
                .then(data => {
                    console.log('[Files Load] Data received:', data);
                    let html;
                    if (data.items && data.items.length > 0) {
                        const gridItems = data.items.map(item => `
                            <div class="file-card relative group cursor-pointer aspect-square" data-id="${item.id}">
                                <img src="${item.image}" 
                                     alt="File thumbnail" 
                                     class="w-full h-full object-cover rounded-lg transition-transform duration-200 ease-in-out group-hover:scale-105"
                                     loading="lazy">
                                <div class="absolute inset-0 bg-black bg-opacity-0 group-hover:bg-opacity-40 transition-opacity duration-200 ease-in-out rounded-lg"></div>
                                ${window.isLoggedIn && item.isOwner ? `
                                    <button class="toggle-public-btn absolute top-2 left-2 bg-gray-800 text-white p-2 rounded-full hover:bg-gray-700"
                                            data-id="${item.id}" data-public="${item.isPublic ? '1' : '0'}"
                                            title="${item.isPublic ? 'Make Private' : 'Make Public'}">
                                        <i class="fas ${item.isPublic ? 'fa-lock' : 'fa-globe'}"></i>
                                    </button>
                                ` : ''}
                            </div>
                        `).join('');
                        // Add grid-sizer for Masonry
                        html = `<div id="file-list" class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3 p-4">
                                  <div class="grid-sizer"></div>
                                  ${gridItems}
                                </div>`;
                    } else {
                         // If no items, still provide the file-list container for consistency
                        html = `<div id="file-list" class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3 p-4">
                                  <div class="grid-sizer"></div>
                                  <p class="text-center text-gray-400 p-4 col-span-full">${data.message || 'No files yet.'}</p>
                                </div>`;
                    }
                    contentArea.innerHTML = html;

                    // Initialize Like Buttons for the newly added file cards
                    if (typeof initializeLikeButtons === 'function') {
                        console.log('[core.js Files Load] Calling initializeLikeButtons for #file-list content.');
                        initializeLikeButtons();
                    } else {
                        console.warn('[core.js Files Load] initializeLikeButtons function not found. Make sure gallery.js is loaded and initializeLikeButtons is global.');
                    }

                    // Initialize Masonry for the #file-list if items exist
                    const fileListElement = document.getElementById('file-list');
                    if (typeof Masonry !== 'undefined' && fileListElement && data.items && data.items.length > 0) {
                        try {
                            const msnry = new Masonry(fileListElement, {
                                itemSelector: '.file-card', // Correct selector for items in #file-list
                                columnWidth: '.grid-sizer',
                                gutter: 12,
                                percentPosition: true
                            });
                            window.masonryInstance = msnry; // Assign to global scope
                            console.log('[core.js Files Load] Masonry instance CREATED and assigned for #file-list:', window.masonryInstance);
                            
                            imagesLoaded(fileListElement).on('always', function() {
                                console.log('[core.js Files Load] imagesLoaded complete for #file-list, layout Masonry.');
                                if (window.masonryInstance) {
                                    window.masonryInstance.layout();
                                }
                            });
                        } catch (e) {
                            console.error('[core.js Files Load] Error initializing Masonry for #file-list:', e);
                            window.masonryInstance = null;
                        }
                    } else {
                        console.log('[core.js Files Load] Masonry NOT initialized for #file-list. Conditions: Masonry lib?', !!(typeof Masonry !== 'undefined'), 'fileListElement?', !!fileListElement, 'Has items?', !!(data.items && data.items.length > 0));
                        window.masonryInstance = null; // Ensure it's null if not initialized
                    }

                    contentArea.addEventListener('click', (event) => {
                        const fileCard = event.target.closest('.file-card');
                        const toggleBtn = event.target.closest('.toggle-public-btn');

                        if (toggleBtn) {
                            const contentId = toggleBtn.dataset.id;
                            const isPublic = toggleBtn.dataset.public === '1';
                            console.log(`[Files Click] Toggling public status for ID: ${contentId}, Current isPublic: ${isPublic}`);

                            fetch(`/api/content/${contentId}`, {
                                method: 'PATCH',
                                headers: {
                                    'Content-Type': 'application/json',
                                    'X-CSRF-Token': csrfToken
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
                                        showToast(`Image is now ${isPublic ? 'private' : 'public'}.`, 'success');
                                    } else {
                                        throw new Error(result.error || 'Failed to update visibility');
                                    }
                                })
                                .catch(error => {
                                    console.error('[Files Toggle] Error:', error);
                                    showToast(`Failed to update visibility: ${error.message}`, 'error');
                                });
                            return;
                        }

                        if (fileCard) {
                            const contentId = fileCard.dataset.id;
                            const imgElement = fileCard.querySelector('img');
                            const imageUrl = imgElement?.src;
                            console.log(`[Files Click] Clicked file card. ID: ${contentId}, URL: ${imageUrl}`);

                            if (window.openCommentsModal) {
                                openCommentsModal(contentId, imageUrl);
                                history.pushState({ contentId, section: 'files', modal: true }, '', `/image/${contentId}`);
                                document.title = data.items.find(item => item.id == contentId)?.prompt?.substring(0, 50) + '... | Pixzor' || 'Image Details | Pixzor';
                            } else {
                                console.error('[Files Click] openCommentsModal not available.');
                                showToast('Could not open image details.', 'error');
                            }
                        }
                    });
                })
                .catch(error => {
                    console.error('[Files Load] Error:', error);
                    contentArea.classList.remove('loading');
                    if (error && error.isAuthError) {
                        contentArea.innerHTML = '<p class="text-center text-gray-400 p-4">Please log in to access your files.</p>';
                    } else {
                        contentArea.innerHTML = `<p class="text-center text-red-500 p-4">Error loading files: ${error.message || 'An unknown error occurred'}</p>`;
                    }
                });
        } else if (section === 'chat-history') {
            contentArea.innerHTML = '<p class="text-center text-gray-400 p-4">Loading chat history...</p>';

            const csrfToken = document.querySelector('meta[name="csrf-token"]')?.content || '';
            console.log(`[Chat History Load] CSRF Token: ${csrfToken}, isLoggedIn: ${window.isLoggedIn}`);

            fetch('/api/library/chats', {
                method: 'GET',
                headers: {
                    'X-CSRF-Token': csrfToken,
                    'Accept': 'application/json'
                },
                credentials: 'include'
            })
                .then(response => {
                    console.log(`[Chat History Load] Response status: ${response.status}`);
                    if (!response.ok) {
                        if (response.status === 401) {
                            console.log('[Chat History Load] Detected 401 Unauthorized');
                            return Promise.reject({ isAuthError: true, status: response.status });
                        }
                        return response.text().then(text => {
                            console.error('[Chat History Load] Response text:', text.slice(0, 100));
                            throw new Error(`HTTP error! status: ${response.status}`);
                        });
                    }
                    return response.json();
                })
                .then(data => {
                    console.log('[Chat History Load] Data received:', data);
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
                            console.warn('[Chat History] Marked library not found, rendering plain text');
                            return content || '';
                        }
                        let htmlContent = marked.parse(content || '', { sanitize: true, gfm: true, breaks: true });
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
                            console.log(`[Chat History] Clicked on chat ID: ${chatId}`);
                            contentArea.innerHTML = '<p class="text-center text-gray-400 p-4">Loading chat...</p>';

                            fetch(`/api/library/chats/${chatId}`, {
                                method: 'GET',
                                headers: {
                                    'X-CSRF-Token': csrfToken,
                                    'Accept': 'application/json'
                                },
                                credentials: 'include'
                            })
                                .then(response => {
                                    console.log(`[Chat History] Fetch chat ID ${chatId} status: ${response.status}`);
                                    if (!response.ok) {
                                        return response.json().then(err => {
                                            throw new Error(err.message || `HTTP error! status: ${response.status}`);
                                        });
                                    }
                                    return response.json();
                                })
                                .then(chatData => {
                                    console.log('[Chat History] Received chat data:', chatData);
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
                                    console.error('[Chat History] Error loading chat:', error);
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
                                console.log(`[Chat History] Attempting to delete chat ID: ${chatId}`);
                                fetch(`/api/library/chats/${chatId}`, {
                                    method: 'DELETE',
                                    headers: {
                                        'Content-Type': 'application/json',
                                        'X-CSRF-Token': csrfToken
                                    },
                                    credentials: 'include'
                                })
                                    .then(response => {
                                        console.log(`[Chat History] Delete chat response status: ${response.status}`);
                                        if (!response.ok) {
                                            return response.json().then(err => {
                                                throw new Error(err.message || `HTTP error! status: ${response.status}`);
                                            });
                                        }
                                        return response.json();
                                    })
                                    .then(data => {
                                        console.log(`[Chat History] Successfully deleted chat ID: ${chatId}`, data);
                                        if (chatItemElement) {
                                            chatItemElement.remove();
                                            showToast(`Chat "${chatTitle}" deleted successfully.`, 'success');
                                            if (!contentArea.querySelector('.content-item.chat-message[data-chat-id]')) {
                                                contentArea.querySelector('div.space-y-1').innerHTML = '<p class="text-center text-gray-400">No chat history yet.</p>';
                                            }
                                        }
                                    })
                                    .catch(error => {
                                        console.error(`[Chat History] Error deleting chat ID ${chatId}:`, error);
                                        showToast(`Failed to delete chat: ${error.message}`, 'error');
                                    });
                            }
                        });
                    });
                })
                .catch(error => {
                    console.error('[Chat History] Error loading chat history:', error);
                    contentArea.classList.remove('loading');
                    if (error && error.isAuthError) {
                        contentArea.innerHTML = '<p class="text-center text-gray-400 p-4">Please log in to access your chat history.</p>';
                    } else {
                        contentArea.innerHTML = `<p class="text-center text-red-500 p-4">Error loading chat history: ${error.message || 'An unknown error occurred'}</p>`;
                    }
                });
        } else if (section === 'chat') {
            fetch('/partials/chat-tab')
                .then(response => {
                    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
                    return response.text();
                })
                .then(html => {
                    contentArea.innerHTML = html;
                    console.log("[Chat Tab] Partial HTML injected.");
                    if (typeof setupChat === 'function') {
                        console.log("[Chat Tab] Calling setupChat().");
                        setupChat();
                    } else {
                        console.error("[Chat Tab] setupChat function not found.");
                    }
                    if (typeof updateButtonState === 'function') {
                        updateButtonState('chat');
                    }
                })
                .catch(error => {
                    console.error("Error loading chat tab partial:", error);
                    contentArea.innerHTML = `<p>Error loading chat UI: ${error.message}</p>`;
                });
        } else if (section === 'gallery') {
            console.log('[core.js] Fetching gallery partial.');
            contentArea.innerHTML = '<p class="text-center text-gray-400 p-4">Loading gallery...</p>';
            fetch('/partials/gallery')
                .then(response => {
                    if (!response.ok) {
                        throw new Error(`HTTP error! status: ${response.status}`);
                    }
                    return response.text();
                })
                .then(html => {
                    contentArea.innerHTML = html;
                    console.log('[core.js] Gallery partial HTML injected.');
                    if (typeof initializeGallery === 'function') {
                        console.log('[core.js] Calling initializeGallery().');
                        initializeGallery();
                    } else {
                        console.error('[core.js] initializeGallery function not found after loading partial.');
                        contentArea.innerHTML = '<p class="text-center text-red-500 p-4">Error loading gallery: Gallery script not found.</p>';
                    }
                })
                .catch(error => {
                    console.error('[core.js] Error loading gallery partial:', error);
                    contentArea.innerHTML = `<p class="text-center text-red-500 p-4">Error loading gallery: ${error.message}</p>`;
                });
        } else if (section === 'create-image') {
            fetch('/partials/create-images')
                .then(response => {
                    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
                    return response.text();
                })
                .then(html => {
                    contentArea.innerHTML = html;
                    console.log("[Create Image] Partial HTML injected.");
                    const generateButton = document.getElementById('image-submit');
                    const promptInput = document.getElementById('image-input');
                    const resultsArea = document.getElementById('image-results-area');
                    console.log("[Create Image] Found elements:", { generateButton, promptInput, resultsArea });
                    if (!generateButton || !promptInput || !resultsArea) {
                        console.error("[Create Image] Could not find necessary elements in create-images partial.");
                        return;
                    }
                    console.log("[Create Image] Adding click listener to button:", generateButton);
                    generateButton.addEventListener('click', async () => {
                        console.log("[Create Image] Generate button clicked!");
                        const prompt = promptInput.value.trim();
                        if (!prompt) {
                            showToast('Please enter a prompt.', 'error');
                            return;
                        }
                        if (!window.isLoggedIn) {
                            showToast('Please log in to create images.', 'error');
                            return;
                        }
                        const originalButtonText = generateButton.textContent;
                        generateButton.disabled = true;
                        generateButton.textContent = 'Generating...';
                        try {
                            showToast('Image generation endpoint not yet implemented.', 'info');
                        } catch (error) {
                            console.error("Image generation error:", error);
                            showToast(`Error generating image: ${error.message}`, 'error');
                        } finally {
                            generateButton.disabled = false;
                            generateButton.textContent = originalButtonText;
                        }
                    });
                })
                .catch(error => {
                    console.error("Error loading create-images partial:", error);
                    contentArea.innerHTML = `<p>Error loading image creation UI: ${error.message}</p>`;
                });
        } else {
            contentArea.innerHTML = `<p class="text-center text-gray-400 p-4">Section ${section} not implemented.</p>`;
        }
    });
});

document.addEventListener('DOMContentLoaded', () => {
    console.log('DOM fully loaded and parsed.');
    fetch('/partials/modals')
        .then(response => response.text())
        .then(html => {
            document.getElementById('modals-container').innerHTML = html;
            window.showModal = function(id) {
                const modal = document.getElementById(id);
                if (modal) {
                    modal.classList.remove('hidden');
                    console.log(`Modal ${id} shown`);
                } else {
                    console.error(`Modal with ID ${id} not found`);
                }
            };
            window.hideModal = function(id) {
                const modal = document.getElementById(id);
                if (modal) {
                    modal.classList.add('hidden');
                    console.log(`Modal ${id} hidden`);
                } else {
                    console.error(`Modal with ID ${id} not found`);
                }
            };
            document.getElementById('tokens-button')?.addEventListener('click', () => {
                if (!window.isLoggedIn) {
                    showToast('Please log in to buy credits.', 'error');
                    window.location.href = '/auth/google';
                    return;
                }
                window.showModal('buy-tokens-modal');
            });
            document.addEventListener('DOMContentLoaded', () => {
                console.log('Checking for modal elements on page load');
                const buyTokensModal = document.getElementById('buy-tokens-modal');
                const welcomeModal = document.getElementById('welcome-modal');
                console.log('Buy Tokens Modal exists:', !!buyTokensModal);
                console.log('Welcome Modal exists:', !!welcomeModal);
            });
            document.getElementById('close-buy-tokens-modal')?.addEventListener('click', () => window.hideModal('buy-tokens-modal'));
            const stripePublishableKey = 'pk_test_51QNNomGgZQx5JKvI2PAzM2GO5f0ukOcam2RUMj0ceduOPIuoRmWgqt7nqs46lRF7eyKd46Q8MRs1OYX76xi7fxHQ00LwfUHss5';
            let stripe = null;
            if (typeof Stripe === 'function') {
                stripe = Stripe(stripePublishableKey);
            } else {
                console.error("Stripe.js not loaded. Make sure it's included in your HTML.");
                showToast('Payment system error. Please contact support.', 'error');
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
                        console.error('Missing data-price attribute on selected token bundle option.');
                        showToast('Configuration error. Please select a valid bundle.', 'error');
                        return;
                    }
                    console.log(`Attempting to buy ${tokens} tokens for price: £${price}`);
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
                        console.log('Backend response status:', response.status);
                        if (!response.ok) {
                            const errorData = await response.json();
                            console.error('Backend error:', errorData);
                            throw new Error(errorData.error || `Server error: ${response.status}`);
                        }
                        const { sessionId } = await response.json();
                        const { error } = await stripe.redirectToCheckout({ sessionId });
                        if (error) {
                            console.error('Stripe redirect error:', error);
                            throw new Error(error.message || 'Failed to redirect to payment.');
                        }
                    } catch (error) {
                        console.error('Error during token purchase:', error);
                        showToast(`Payment failed: ${error.message}. Please try again.`, 'error');
                    }
                });
            } else if (!buyTokensForm) {
                console.warn('#buy-tokens-form not found.');
            } else if (!stripe) {
                console.warn('Stripe object not initialized, cannot setup buy tokens form.');
            }
            if (!localStorage.getItem('welcomeShown')) {
                window.showModal('welcome-modal');
                localStorage.setItem('welcomeShown', 'true');
            }
            document.getElementById('close-welcome-modal')?.addEventListener('click', () => window.hideModal('welcome-modal'));
            document.getElementById('close-welcome-modal-btn')?.addEventListener('click', () => window.hideModal('welcome-modal'));
            document.getElementById('register-with-google')?.addEventListener('click', () => {
                window.location.href = '/auth/google';
                window.hideModal('welcome-modal');
            });
            document.getElementById('close-about-popup')?.addEventListener('click', () => window.hideModal('about-popup'));
            document.getElementById('close-about-popup-btn')?.addEventListener('click', () => window.hideModal('about-popup'));
            document.getElementById('content-area')?.addEventListener('click', (e) => {
                if (e.target.id === 'about-link') {
                    e.preventDefault();
                    window.showModal('about-popup');
                }
            });
        })
        .catch(error => {
            console.error("Error fetching or setting up modals:", error);
        });
});