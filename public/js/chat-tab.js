// public/js/chat-tab.js
console.log('chat-tab.js: Script loaded.');

// Keep track of which scripts are loaded for different tabs if needed
// (Currently create-tab.js seems loaded globally via layout.ejs preload/script tag)
// const tabScripts = {
//     'create-images': '/js/create-tab.js',
//     'create-videos': '/js/create-videos-tab.js' // Example
// };
// const loadedScripts = new Set();

// function loadTabScriptIfNeeded(tabName) {
//     if (!loadedScripts.has(tabName) && tabScripts[tabName]) {
//         console.log(`[Chat Tab] Loading script for: ${tabName}`);
//         const script = document.createElement('script');
//         script.src = tabScripts[tabName];
//         script.onload = () => loadedScripts.add(tabName);
//         script.onerror = () => console.error(`Failed to load ${tabName} script`);
//         document.body.appendChild(script);
//     }
// }

function setupChat() {
    console.log("[Chat Tab] Attempting setupChat...");
    const contentArea = document.getElementById('chat-messages'); // Main message display area
    const chatSubmit = document.querySelector('#chat-submit[data-mode="chat-talk"]');
    const input = document.querySelector('#chat-talk-input');

    // Prevent attaching listeners multiple times
    if (!chatSubmit || chatSubmit.dataset.listenerAttached === 'true') {
        if (!chatSubmit) console.log("[Chat Tab] setupChat: chatSubmit button not found.");
        // else console.log("[Chat Tab] setupChat: Listener already attached.");
        return; // Don't attach listener if button missing or already attached
    }

    console.log("[Chat Tab] Found chat elements, attaching listener:", { chatSubmit, input });
    chatSubmit.dataset.listenerAttached = 'true'; // Mark as attached

    // --- Add auto-resize listener for the textarea ---
    if (input && input.tagName === 'TEXTAREA') { // Ensure it's a textarea
        input.addEventListener('input', () => {
            input.style.height = 'auto'; // Reset height to recalculate
            // Set height to scrollHeight, capped by CSS max-height
            input.style.height = `${input.scrollHeight}px`; 
        });
        // Trigger resize on initial load in case there's pre-filled text (unlikely here)
        // input.dispatchEvent(new Event('input')); 
    }
    // --- End auto-resize listener ---

    let currentChatSessionId = null; // Variable to hold the unique ID for the current chat session in this tab

    chatSubmit.addEventListener('click', () => {
        console.log("[Chat Tab] Chat submit clicked.");
        const message = input?.value.trim();
        const contentArea = document.getElementById('chat-messages'); // Re-get content area here for safety

        // Ensure contentArea exists before trying to modify it
        if (!contentArea) {
            console.error("[Chat Tab] Cannot find #chat-messages to clear/append.");
            return;
        }

        if (!window.isLoggedIn) {
            window.showToast('Please log in to send messages!', 'info');
            // Storing might be complex if user navigates away, simplify for now
            // localStorage.setItem('pendingChatMessage', message);
            // setTimeout(() => window.location.href = '/auth/google', 1000);
            return;
        }

        if (message && input) {
             // --- Clear area ONLY if it hasn't been cleared yet for this session ---
             if (!window.isChatAreaClearedForSession) {
                 console.log("[Chat Tab] First chat message in session, clearing content area.");
                 contentArea.innerHTML = '';
                 window.isChatAreaClearedForSession = true;
             }
             // --- End clear logic ---

             // Generate a session ID if this is the first message in this tab instance
             if (!currentChatSessionId) {
                currentChatSessionId = `chat_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
                console.log('[Chat Tab] New Chat Session ID generated:', currentChatSessionId);
                // Clear any old messages when starting a new session ID
                if (contentArea) contentArea.innerHTML = '';
            }

             // --- Re-enabled adding user message visually --- 
             const userDiv = document.createElement('div');
             userDiv.classList.add('chat-message', 'user');
             // Basic text insertion, consider sanitizing if needed
             userDiv.textContent = message; 
             contentArea.appendChild(userDiv);
             contentArea.scrollTop = contentArea.scrollHeight;
             // --- End re-enabled code ---

            console.log("[Chat Tab] Sending message via WebSocket:", message);
            window.sendChatMsg({ 
                type: 'chat', 
                message: message,
                chatSessionId: currentChatSessionId // Include the session ID
            }); // Use core.js function
            input.value = '';
        } else {
            console.log("[Chat Tab] No message entered.");
        }
    });

    // Existing WebSocket message handling should be in core.js, not duplicated here.
    // Remove ws.onmessage handler from here if it exists in core.js
}

// Initialize tabs and potentially the default chat setup
document.addEventListener('DOMContentLoaded', () => {
    // Flag to track if the main chat area has been cleared for the current "session"
    // A "session" resets when non-chat content is loaded into #chat-messages
    window.isChatAreaClearedForSession = false;

    console.log('[Chat Tab] DOMContentLoaded event.');
    const chatTabsContainer = document.querySelector('.chat-tabs');
    const chatTabContent = document.getElementById('chat-tab-content'); // Container for sub-content divs

    if (!chatTabsContainer || !chatTabContent) {
        console.error("[Chat Tab] Could not find .chat-tabs or #chat-tab-content");
        return;
    }

    const chatTalkContent = document.getElementById('chat-talk');
    const createImagesContent = document.getElementById('create-images-content');
    // Add video content div reference if it exists
    // const createVideosContent = document.getElementById('create-videos-content');

    if (!chatTalkContent || !createImagesContent) {
         console.error("[Chat Tab] Could not find #chat-talk or #create-images-content divs.");
         return;
    }

    // Setup tab switching
    chatTabsContainer.addEventListener('click', (event) => {
        const clickedTab = event.target.closest('.chat-tab');
        if (!clickedTab) return; // Ignore clicks that aren't on a tab

        const tabName = clickedTab.dataset.tab;
        console.log(`[Chat Tab] Tab clicked: ${tabName}`);

        // Update active tab style
        chatTabsContainer.querySelectorAll('.chat-tab').forEach(t => t.classList.remove('active'));
        clickedTab.classList.add('active');

        // --- Simplified Visibility Toggle --- 
        // Deactivate all content areas first
        chatTalkContent.classList.remove('active');
        createImagesContent.classList.remove('active');
        // if (createVideosContent) { createVideosContent.classList.remove('active'); }

        // Activate the selected sub-content area
        if (tabName === 'chat') {
            chatTalkContent.classList.add('active');
            // Don't explicitly clear here. Let the 'send' logic handle it if needed.
            setupChat(); // Ensure chat listener is attached
        } else if (tabName === 'create-images') {
            createImagesContent.classList.add('active');
             // Clear content and reset the flag, as we are leaving the chat flow
             document.getElementById('chat-messages').innerHTML = ''; 
             window.isChatAreaClearedForSession = false; // Reset flag
        } else if (tabName === 'create-videos') {
            // Handle video tab - maybe show a message
            window.showToast('Video creation is not yet available.', 'info');
             // Clear main content area - Keep this clear for unimplemented tabs
             // Clear content and reset the flag
             document.getElementById('chat-messages').innerHTML = ''; 
             window.isChatAreaClearedForSession = false; // Reset flag
        }
        // --- End Simplified Visibility Toggle ---
    });

    // Initial setup: Ensure chat is set up if it's the default active tab
    const initialActiveTab = chatTabsContainer.querySelector('.chat-tab.active');
    if (initialActiveTab && initialActiveTab.dataset.tab === 'chat') {
        console.log('[Chat Tab] Initializing chat setup.');
        // Flag is initially false. First send click will clear if needed.
        setupChat();
    } else if (initialActiveTab && initialActiveTab.dataset.tab === 'create-images') {
        // Pre-clear content area if starting on image tab
        document.getElementById('chat-messages').innerHTML = ''; 
        window.isChatAreaClearedForSession = false; // Ensure flag is false
    } else {
        // Default initial load (advert) - flag is already false.
    }
});