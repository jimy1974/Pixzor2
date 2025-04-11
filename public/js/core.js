// public/js/core.js
const protocol = window.location.protocol === 'http:' ? 'ws://' : 'wss://';
const ws = new WebSocket(`${protocol}${window.location.host}`);

ws.onopen = () => console.log('WebSocket connected');
ws.onerror = (error) => console.error('WebSocket error:', error);
ws.onclose = (event) => console.log('WebSocket disconnected:', event.code, event.reason);

window.sendChatMsg = (message) => {
    if (message && ws.readyState === WebSocket.OPEN) {
        const chatMessages = document.getElementById('chat-messages');
        chatMessages.dataset.lastPrompt = message;
        ws.send(JSON.stringify({ type: 'chat', message }));
    }
};

ws.onmessage = (event) => {
    const data = JSON.parse(event.data);
    const chatMessages = document.getElementById('chat-messages');

    if (data.type === 'chatChunk') {
        let lastBotMessage = chatMessages.querySelector('.chat-message.bot-message:last-child:not(.image-loading)');
        if (!lastBotMessage) {
            lastBotMessage = document.createElement('div');
            lastBotMessage.classList.add('chat-message', 'bot-message');
            chatMessages.appendChild(lastBotMessage);
        }
        lastBotMessage.innerHTML += data.data;
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
    } else if (data.type === 'chatChunk' && !data.data.startsWith('#')) {
        // Display user message only once via WebSocket
        const userDiv = document.createElement('div');
        userDiv.classList.add('chat-message', 'user');
        userDiv.innerHTML = chatMessages.dataset.lastPrompt;
        if (!chatMessages.querySelector(`.chat-message.user:last-child[innerHTML="${chatMessages.dataset.lastPrompt}"]`)) {
            chatMessages.appendChild(userDiv);
        }
        chatMessages.scrollTop = chatMessages.scrollHeight;
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
fetch('/user-data')
    .then(response => response.json())
    .then(data => {
        const tokenCount = document.getElementById('token-count');
        const authButton = document.getElementById('google-auth-button');
        const authText = document.getElementById('auth-text');
        if (data.loggedIn) {
            window.isLoggedIn = true;
            tokenCount.textContent = `${data.tokens} Tokens`;
            authText.textContent = 'Logout';
            authButton.onclick = () => window.location.href = '/logout';
        } else {
            window.isLoggedIn = false;
            tokenCount.textContent = '0 Tokens';
            authText.textContent = 'Login';
            authButton.onclick = () => window.location.href = '/auth/google';
        }
    })
    .catch(error => {
        console.error('Error fetching user data:', error);
        document.getElementById('token-count').textContent = '0 Tokens';
        window.isLoggedIn = false;
    });


// Sidebar Logic
const sidebarItems = document.querySelectorAll('.sidebar-item');
const contentArea = document.getElementById('chat-messages');

sidebarItems.forEach(item => {
    item.addEventListener('click', () => {
        const section = item.dataset.section;
        console.log(`[Sidebar Click] Detected section: '${section}'`);

        sidebarItems.forEach(i => i.classList.remove('active'));
        item.classList.add('active');

        contentArea.innerHTML = '<p>Loading...</p>';

        if (section === 'home') {
            fetch('/')
                .then(response => response.text())
                .then(html => contentArea.innerHTML = html.match(/<section.*<\/section>/s)?.[0] || '<p>Error loading home content.</p>');
        } else if (section === 'files') {
            fetch('/api/files')
                .then(response => {
                    if (!response.ok) {
                        if (response.status === 401) {
                            return Promise.reject({ isAuthError: true, status: response.status });
                        }
                        throw new Error(`HTTP error! status: ${response.status}`);
                    }
                    return response.json();
                })
                .then(data => {
                    // Check if items exist and create the grid container
                    let html;
                    if (data.items && data.items.length > 0) {
                        const gridItems = data.items.map(item => `
                            <div class="file-card relative group cursor-pointer aspect-square" data-id="${item.id}">
                                <img src="${item.image}" 
                                     alt="File thumbnail" 
                                     class="w-full h-full object-cover rounded-lg transition-transform duration-200 ease-in-out group-hover:scale-105"
                                     loading="lazy">
                                <!-- Optional: Add overlay or icon on hover if desired -->
                                <div class="absolute inset-0 bg-black bg-opacity-0 group-hover:bg-opacity-40 transition-opacity duration-200 ease-in-out rounded-lg"></div>      
                            </div>
                        `).join('');
                        // Using Tailwind grid classes - adjust columns as needed
                        html = `<div id="file-list" class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3 p-4">
                                    ${gridItems}
                                </div>`;
                    } else {
                        // Handle case with no files
                        html = `<p class="text-center text-gray-400 p-4">${data.message || 'No files yet.'}</p>`;
                    }
                    contentArea.innerHTML = html;

                    // Add delegated click event listener to the content area for file cards
                    contentArea.addEventListener('click', (event) => {
                        const fileCard = event.target.closest('.file-card');
                        if (fileCard) {
                            // -- DEBUGGING START --
                            console.log('[Files Click] Target element:', event.target);
                            console.log('[Files Click] Found fileCard element:', fileCard);
                            console.log('[Files Click] fileCard.dataset:', fileCard.dataset); 
                            // -- DEBUGGING END --

                            const contentId = fileCard.dataset.id; // Retrieving data-id here
                            const imgElement = fileCard.querySelector('img');
                            const imageUrl = imgElement?.src; // Get the thumbnail URL

                            console.log(`[Files Click] Clicked file card. ID: ${contentId}, URL: ${imageUrl}`);

                            // Ensure the modal function from gallery.js is available
                            if (typeof openCommentsModal === 'function') {
                                if (contentId && imageUrl) {
                                    // Call the existing modal function used by the gallery
                                    openCommentsModal(contentId, imageUrl); 
                                } else {
                                    console.error('[Files Click] Missing content ID or image URL for clicked file card.', { contentId, imageUrl });
                                    showToast('Could not open file details.', 'error');
                                }
                            } else {
                                console.error('[Files Click] openCommentsModal function not found! Was gallery.js loaded globally?');
                                // Fallback: Maybe open the image in a fullscreen modal or show an error
                                if (typeof openFullscreenModal === 'function' && imageUrl) {
                                     console.warn('[Files Click] Falling back to fullscreen view.');
                                     openFullscreenModal(imageUrl);
                                } else {
                                     showToast('Cannot display file details. Functionality missing.', 'error');
                                }
                            }
                        }
                    });
                })
                .catch(error => {
                    console.error('[Files Load] Error loading files:', error); // Add context to error log
                    if (error && error.isAuthError) {
                        contentArea.innerHTML = '<p class="text-center text-gray-400 p-4">Please log in to access your files.</p>';
                    } else {
                        contentArea.innerHTML = `<p class="text-center text-red-500 p-4">Error loading files: ${error.message || 'An unknown error occurred'}</p>`;
                    }
                });
        } else if (section === 'chat-history') {
            fetch('/api/library/chats')
                .then(response => {
                    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
                    return response.json();
                })
                .then(data => {
                    const html = data.items?.map(item => `
                        <div class="content-item chat-message flex justify-between items-center p-3 rounded hover:bg-gray-700 cursor-pointer border-b border-gray-600" data-chat-id="${item.id}">
                            <div class="flex-grow mr-2 overflow-hidden" data-action="view-chat">
                                <p class="font-semibold text-white truncate">${item.title}</p>
                                <p class="text-gray-400 text-sm">${new Date(item.timestamp).toLocaleString()}</p>
                            </div>
                            <button class="delete-chat-btn flex-shrink-0 p-1 text-gray-400 hover:text-red-500 rounded" data-chat-id="${item.id}" title="Delete Chat">
                                <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                </svg>
                            </button>
                        </div>
                    `).join('') || `<p class="text-center text-gray-400">${data.message || 'No chat history yet.'}</p>`;
                    contentArea.innerHTML = `<h2 class="text-xl font-semibold text-white mb-4 p-2 border-b border-gray-600">Chat History</h2><div class="space-y-1">${html}</div>`; // Added header and structure
                    
                    // Helper function to render content, converting image URLs to <img> tags
                    function renderChatMessageContent(content) {
                        // Regex to find image URLs starting with /images/generated/ within the text
                        const imageUrlRegex = /(\/images\/generated\/[^\s]+\.(?:jpg|jpeg|png|gif))\b/gi;
                        // Replace found URLs with <img> tags
                        // Added some basic Tailwind styling
                        return content.replace(imageUrlRegex, (match) => {
                            return `<br><img src="${match}" alt="Chat Image" class="inline-block max-w-xs max-h-40 my-2 rounded shadow border border-gray-600">`;
                        });
                    }
                    
                    document.querySelectorAll('.content-item.chat-message[data-chat-id]').forEach(chat => {
                        chat.addEventListener('click', () => {
                            const chatId = chat.dataset.chatId;
                            console.log(`[Chat History] Clicked on chat ID: ${chatId}`);
                            contentArea.innerHTML = '<p class="text-center text-gray-400">Loading chat...</p>'; // Loading state
                            fetch(`/api/library/chats/${chatId}`)
                                .then(response => {
                                    if (!response.ok) throw new Error(`HTTP error fetching chat ${chatId}! status: ${response.status}`);
                                    return response.json();
                                })
                                .then(chatData => {
                                    console.log("[Chat History] Received chat data:", chatData);
                                    const messagesHtml = chatData.messages?.map(msg => `
                                        <div class="chat-message p-3 rounded mb-2 ${msg.role === 'user' ? 'bg-blue-900 text-right' : 'bg-gray-700 text-left'}">
                                            <strong class="font-semibold">${msg.role === 'user' ? 'You' : 'Bot'}:</strong>
                                            <div class="message-content mt-1">${renderChatMessageContent(msg.content)}</div>
                                        </div>
                                    `).join('') || `<p class="text-center text-gray-400">${chatData.message || 'No messages in this chat.'}</p>`;
                                    contentArea.innerHTML = `
                                        <button id="back-to-history" class="mb-4 px-3 py-1 bg-gray-600 hover:bg-gray-500 text-white rounded text-sm">← Back to History</button>
                                        <h3 class="text-lg font-semibold text-white mb-3 border-b border-gray-600 pb-2">${chatData.title || 'Chat Details'}</h3>
                                        <div class="space-y-2">${messagesHtml}</div>
                                    `;
                                    // Add event listener for the back button
                                    document.getElementById('back-to-history')?.addEventListener('click', () => {
                                        // Re-trigger the sidebar click simulation for 'chat-history'
                                        const historyItem = document.querySelector('.sidebar-item[data-section="chat-history"]');
                                        if (historyItem) historyItem.click();
                                    });
                                })
                                .catch(error => {
                                     console.error('[Chat History] Error loading specific chat:', error);
                                     contentArea.innerHTML = `<p class="text-center text-red-500">Error loading chat: ${error.message}</p>`;
                                });
                        });
                    });
                    
                    // Attach delete listeners
                    document.querySelectorAll('.delete-chat-btn').forEach(button => {
                        button.addEventListener('click', (event) => {
                            event.stopPropagation(); // Prevent triggering the view chat click
                            const chatId = button.dataset.chatId;
                            const chatItemElement = button.closest('.content-item.chat-message');
                            const chatTitle = chatItemElement?.querySelector('p.font-semibold')?.textContent || 'this chat';

                            if (window.confirm(`Are you sure you want to delete "${chatTitle}"? This cannot be undone.`)) {
                                console.log(`[Chat History] Attempting to delete chat ID: ${chatId}`);
                                fetch(`/api/library/chats/${chatId}`, {
                                    method: 'DELETE',
                                    headers: {
                                        // Add authentication headers if needed, e.g., CSRF token
                                        'Content-Type': 'application/json'
                                    }
                                })
                                .then(response => {
                                    console.log(`[Chat History] Delete chat response status: ${response.status}`);
                                    if (!response.ok) {
                                        return response.json().then(err => {
                                            console.error(`[Chat History] Delete chat error data:`, err);
                                            throw new Error(err.message || `HTTP error! status: ${response.status}`);
                                        });
                                    }
                                    return response.json();
                                })
                                .then(deleteData => {
                                    console.log(`[Chat History] Successfully deleted chat ID: ${chatId}`, deleteData);
                                    if (chatItemElement) {
                                        chatItemElement.remove(); // Remove from UI
                                    }
                                    showToast(`Chat "${chatTitle}" deleted successfully.`, 'success');
                                    // Check if the list is now empty
                                    if (contentArea.querySelectorAll('.content-item.chat-message[data-chat-id]').length === 0) {
                                        contentArea.querySelector('div.space-y-1').innerHTML = '<p class="text-center text-gray-400">No chat history yet.</p>';
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
                    contentArea.innerHTML = `<p class="text-center text-red-500">Error loading chat history: ${error.message}</p>`;
                });
        } else if (section === 'chat') {
            fetch('/partials/chat-tab') // Fetch the chat partial content
                .then(response => {
                    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
                    return response.text();
                })
                .then(html => {
                    contentArea.innerHTML = html; // Inject the partial's HTML
                    console.log("[Chat Tab] Partial HTML injected.");
                    
                    // Call the setup function from chat-tab.js
                    if (typeof setupChat === 'function') {
                        console.log("[Chat Tab] Calling setupChat().");
                        setupChat(); 
                    } else {
                        console.error("[Chat Tab] setupChat function not found.");
                    }
                    // Optionally, call updateButtonState if needed, though setupChat might handle it
                    if (typeof updateButtonState === 'function') {
                         updateButtonState('chat');
                    }
                })
                .catch(error => {
                    console.error("Error loading chat tab partial:", error);
                    contentArea.innerHTML = `<p>Error loading chat UI: ${error.message}</p>`;
                });
        } else if (section === 'gallery') {
            // Fetch the gallery partial content
            fetch('/partials/gallery') // Changed from /gallery to /partials/gallery
                .then(response => {
                    if (!response.ok) throw new Error(`HTTP error fetching gallery partial! Status: ${response.status}`);
                    return response.text(); // Get the HTML content of the gallery partial
                })
                .then(html => {
                    // Inject the whole partial content directly
                    contentArea.innerHTML = html; 
                    console.log("[core.js] Gallery partial HTML injected.");

                    // NOW call the initializer from gallery.js
                    if (typeof initializeGallery === 'function') {
   if (document.getElementById('image-list')) {
                        console.log("[core.js] Calling initializeGallery().");
                        initializeGallery();
   } else {
   console.log("[core.js] #image-list not found, skipping initializeGallery().");
   }
                    } else {
                        console.error("[core.js] initializeGallery function not found. Was gallery.js loaded?");
                    }
                })
                .catch(error => {
                     console.error("Error loading gallery partial:", error);
                     contentArea.innerHTML = `<p>Error loading gallery: ${error.message}</p>`;
                 });
        } else if (section === 'create-image') {
            fetch('/partials/create-images') // Fetch the partial content
                .then(response => {
                    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
                    return response.text();
                })
                .then(html => {
                    contentArea.innerHTML = html; // Inject the partial's HTML
                    console.log("[Create Image] Partial HTML injected."); // Log 1

                    // Now that HTML is loaded, find the elements and add listener
                    const generateButton = document.getElementById('image-submit'); // Use correct ID
                    const promptInput = document.getElementById('image-input'); // Use correct ID
                    const resultsArea = document.getElementById('image-results-area'); // Use correct ID

                    // Log element findings
                    console.log("[Create Image] Found elements:", { generateButton, promptInput, resultsArea });

                    if (!generateButton || !promptInput || !resultsArea) {
                        console.error("[Create Image] Could not find necessary elements in create-images partial.");
                        return;
                    }
                    
                    console.log("[Create Image] Adding click listener to button:", generateButton); // Log 3
                    generateButton.addEventListener('click', async () => {
                        console.log("[Create Image] Generate button clicked!"); // Log 4

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
                            // API call will be added here in the next step
                            showToast('Image generation endpoint not yet implemented.', 'info'); 
                            // Placeholder API call remains the same...
                            // const response = await fetch('/api/generate-image', { ... }); 
                            // if (!response.ok) { ... }
                            // const result = await response.json();
                            // const imgElement = document.createElement('img');
                            // imgElement.src = result.imageUrl;
                            // imgElement.alt = result.prompt || prompt; 
                            // imgElement.classList.add('w-full', 'rounded-lg'); // Add styling
                            // resultsArea.prepend(imgElement); // Add new image at the top
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
        }
    });
});

document.addEventListener('DOMContentLoaded', () => {
    console.log('DOM fully loaded and parsed.'); // Check if listener fires

    fetch('/partials/modals')
        .then(response => response.text())
        .then(html => {
            document.getElementById('modals-container').innerHTML = html;
            const showModal = (id) => document.getElementById(id)?.classList.add('active');
            const hideModal = (id) => document.getElementById(id)?.classList.remove('active');

            document.getElementById('tokens-button')?.addEventListener('click', () => {
                if (!window.isLoggedIn) {
                    showToast('Please log in to buy tokens.', 'error');
                    // Optionally show welcome/login modal instead of just a toast
                    // showModal('welcome-modal'); 
                } else {
                    showModal('buy-tokens-modal');
                }
            });
            document.getElementById('close-buy-tokens-modal')?.addEventListener('click', () => hideModal('buy-tokens-modal'));

            // --- Stripe Integration ---
            // Ensure Stripe.js script is loaded in your main HTML layout (layout.ejs)
            // Example: <script src="https://js.stripe.com/v3/"></script> 
            const stripePublishableKey = 'pk_test_51QNNomGgZQx5JKvI2PAzM2GO5f0ukOcam2RUMj0ceduOPIuoRmWgqt7nqs46lRF7eyKd46Q8MRs1OYX76xi7fxHQ00LwfUHss5'; // Replace with your actual key if different
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
                    e.preventDefault(); // Prevent default form submission
                    const bundleSelect = document.getElementById('token-bundle');
                    const tokens = bundleSelect.value; // e.g., "300"
                    const selectedOption = bundleSelect.options[bundleSelect.selectedIndex];
                    const price = selectedOption.getAttribute('data-price'); // Using data-price

                    if (!price) {
                        console.error('Missing data-price attribute on selected token bundle option.');
                        showToast('Configuration error. Please select a valid bundle.', 'error');
                        return;
                    }

                    console.log(`Attempting to buy ${tokens} tokens for price: £${price}`);

                    try {
                        // Call your backend to create the Checkout Session, sending tokens and price
                        const response = await fetch('/create-checkout-session', { 
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ tokens: tokens, price: price }) // Send tokens and price
                        });

                        console.log('Backend response status:', response.status); // Debug

                        if (!response.ok) {
                            const errorData = await response.json();
                            console.error('Backend error:', errorData);
                            throw new Error(errorData.error || `Server error: ${response.status}`);
                        }

                        const { sessionId } = await response.json(); // Expecting sessionId from backend

                        // Redirect to Stripe Checkout
                        const { error } = await stripe.redirectToCheckout({ sessionId });

                        if (error) {
                            console.error('Stripe redirect error:', error);
                            throw new Error(error.message || 'Failed to redirect to payment.');
                        }
                        // If redirect is successful, the user leaves this page.
                        // They will be redirected back to success/cancel URLs defined in the backend session creation.

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
            // --- End Stripe Integration ---


            // Handle Welcome Modal (unchanged from your provided code)
            if (!localStorage.getItem('welcomeShown')) {
                showModal('welcome-modal');
                localStorage.setItem('welcomeShown', 'true');
            }
            document.getElementById('close-welcome-modal')?.addEventListener('click', () => hideModal('welcome-modal'));
            document.getElementById('close-welcome-modal-btn')?.addEventListener('click', () => hideModal('welcome-modal'));
            document.getElementById('register-with-google')?.addEventListener('click', () => {
                // Redirect to Google Auth instead of alert
                window.location.href = '/auth/google';
                hideModal('welcome-modal');
            });
            
            // Handle About Popup (unchanged from your provided code)
            document.getElementById('close-about-popup')?.addEventListener('click', () => hideModal('about-popup'));
            document.getElementById('close-about-popup-btn')?.addEventListener('click', () => hideModal('about-popup'));
            document.getElementById('content-area')?.addEventListener('click', (e) => {
                if (e.target.id === 'about-link') {
                    e.preventDefault();
                    showModal('about-popup');
                }
            });
        })
        .catch(error => {
            console.error("Error fetching or setting up modals:", error);
            // Optionally show a user-facing error
        });
}); // End of DOMContentLoaded