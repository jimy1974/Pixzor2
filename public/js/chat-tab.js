console.log('chat-tab.js: Script loaded.');

const waitForElement = (selector, timeout = 5000) => {
    return new Promise((resolve, reject) => {
        const element = document.querySelector(selector);
        if (element) {
            console.log(`[Chat Tab] Found ${selector}`);
            return resolve(element);
        }

        const observer = new MutationObserver(() => {
            const el = document.querySelector(selector);
            if (el) {
                console.log(`[Chat Tab] ${selector} appeared in DOM`);
                observer.disconnect();
                resolve(el);
            }
        });

        observer.observe(document.body, { childList: true, subtree: true });

        setTimeout(() => {
            observer.disconnect();
            console.warn(`[Chat Tab] ${selector} not found after ${timeout}ms`);
            reject(new Error(`${selector} not found`));
        }, timeout);
    });
};

async function reloadChatUI(activeTab = 'chat') {
    console.log(`[Chat Tab] Reloading chat UI for tab: ${activeTab}`);
    const chatTabContent = document.getElementById('chat-tab-content');
    if (!chatTabContent) {
        console.error('[Chat Tab] #chat-tab-content not found');
        window.showToast('Chat tab content not found. Please refresh.', 'error');
        return false;
    }

    try {
        const response = await fetch('/partials/chat-tab');
        if (!response.ok) {
            throw new Error(`HTTP error! Status: ${response.status}`);
        }
        const html = await response.text();
        console.log('[Chat Tab] Fetched HTML for chat-tab:', html);
        chatTabContent.innerHTML = html;
        console.log('[Chat Tab] Chat tab HTML injected into #chat-tab-content');

        const maxRetries = 5;
        let chatSubmitButton = null;
        for (let i = 0; i < maxRetries; i++) {
            chatSubmitButton = await waitForElement('#chat-submit', 5000);
            if (chatSubmitButton && chatSubmitButton.parentNode) {
                console.log('[Chat Tab] #chat-submit found with parentNode on attempt', i + 1);
                break;
            }
            console.warn('[Chat Tab] #chat-submit found but detached or not found, retrying...');
            await new Promise(resolve => setTimeout(resolve, 100));
        }

        if (!chatSubmitButton || !chatSubmitButton.parentNode) {
            console.error('[Chat Tab] ERROR: #chat-submit not found or detached after retries');
            window.showToast('Chat UI error: Submit button not found or detached. Please refresh.', 'error');
            return false;
        }

        const chatTalkContent = await waitForElement('#chat-talk', 5000);
        console.log('[Chat Tab] #chat-talk after reload:', chatTalkContent);
        console.log('[Chat Tab] #chat-submit after reload:', chatSubmitButton);
        console.log('[Chat Tab] #chat-submit parentNode:', chatSubmitButton.parentNode);

        const chatTabsContainer = document.querySelector('.chat-tabs');
        const createImagesContent = document.getElementById('create-images-content');

        if (chatTabsContainer && chatTalkContent && createImagesContent) {
            const chatTab = chatTabsContainer.querySelector('.chat-tab[data-tab="chat"]');
            const imagesTab = chatTabsContainer.querySelector('.chat-tab[data-tab="create-images"]');

            chatTabsContainer.querySelectorAll('.chat-tab').forEach(t => t.classList.remove('active'));
            chatTalkContent.classList.remove('active');
            createImagesContent.classList.remove('active');

            if (activeTab === 'chat') {
                chatTab.classList.add('active');
                chatTalkContent.classList.add('active');
                chatTalkContent.style.display = 'flex';
                createImagesContent.style.display = 'none';
                console.log('[Chat Tab] Set chat tab active');
                await new Promise(resolve => setTimeout(resolve, 100));
                await setupChat();
            } else if (activeTab === 'create-images') {
                imagesTab.classList.add('active');
                createImagesContent.classList.add('active');
                createImagesContent.style.display = 'flex';
                chatTalkContent.style.display = 'none';
                console.log('[Chat Tab] Set create-images tab active');
                if (typeof window.setupCreateTab === 'function') {
                    await window.setupCreateTab();
                }
            }
        } else {
            console.warn('[Chat Tab] Missing elements:', {
                chatTabs: !!chatTabsContainer,
                chatTalk: !!chatTalkContent,
                createImages: !!createImagesContent
            });
            window.showToast('Chat UI incomplete. Please refresh.', 'error');
            return false;
        }

        return true;
    } catch (error) {
        console.error('[Chat Tab] Error reloading chat UI:', error);
        window.showToast('Error loading chat UI. Please refresh.', 'error');
        return false;
    }
}

async function setupChat() {
    console.log('--- [Chat Tab] ATTEMPTING setupChat (SUPER DEBUG MODE) ---');

    const tryWaitForElement = async (selector, timeout, retries = 5, delay = 1000) => {
        for (let i = 0; i < retries; i++) {
            try {
                const element = await waitForElement(selector, timeout);
                console.log(`--- [Chat Tab] Found ${selector} on attempt ${i + 1} ---`);
                if (element.parentNode) {
                    return element;
                } else {
                    console.warn(`--- [Chat Tab] ${selector} found but has no parentNode, retrying... ---`);
                    if (i < retries - 1) await new Promise(resolve => setTimeout(resolve, delay));
                }
            } catch (error) {
                console.warn(`--- [Chat Tab] Retry ${i + 1}/${retries} for ${selector}:`, error);
                if (i < retries - 1) await new Promise(resolve => setTimeout(resolve, delay));
            }
        }
        throw new Error(`Failed to find ${selector} with a valid parentNode after ${retries} retries`);
    };

    try {
        const chatTalkPanel = document.getElementById('chat-talk');
        if (!chatTalkPanel) {
            console.error('--- [Chat Tab] ERROR: #chat-talk panel not found ---');
            throw new Error('#chat-talk panel not found');
        }
        console.log('--- [Chat Tab] #chat-talk panel found ---');

        const chatSubmitButton = await tryWaitForElement('#chat-submit', 15000);
        const chatInputField = await tryWaitForElement('#chat-talk-input', 15000);

        console.log('--- [Chat Tab] SUCCESS: Found chat-submit button:', chatSubmitButton, '---');
        console.log('--- [Chat Tab] SUCCESS: Found chat-talk-input field:', chatInputField, '---');

        // Attach event listener directly to chatSubmitButton
        console.log('--- [Chat Tab] ATTACHING CLICK LISTENER to #chat-submit ---');
        chatSubmitButton.addEventListener('click', async () => {
            console.log('!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!');
            console.log('--- [Chat Tab] CHAT SEND BUTTON CLICKED! HANDLER EXECUTED! ---');
            console.log('!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!');

            const message = chatInputField.value.trim();

            if (!message) {
                console.log('--- [Chat Tab] No message entered. Aborting send. ---');
                if (typeof window.showToast === 'function') {
                    window.showToast('Please enter a message.', 'info');
                }
                return;
            }

            let messagesContainerForThisSend;
            const mainContentHost = document.getElementById('content-area');

            if (!mainContentHost) {
                console.error('[Chat Tab] Send: Main #content-area not found.');
                if (typeof window.showToast === 'function') {
                    window.showToast('Chat UI error: Content area not found.', 'error');
                }
                chatInputField.value = message;
                return;
            }

            if (window.hasAccessedSideMenu || !window.isContentAreaDisplayingNewSession) {
                console.log('[Chat Tab] Send: Clearing main #content-area for new chat session.');
                mainContentHost.innerHTML = '';
                messagesContainerForThisSend = document.createElement('div');
                messagesContainerForThisSend.id = 'chat-messages';
                messagesContainerForThisSend.classList.add('flex-1', 'overflow-y-auto', 'pb-32');
                mainContentHost.appendChild(messagesContainerForThisSend);
                messagesContainerForThisSend.innerHTML = '<h3 class="chat-area-title text-lg font-semibold text-center py-2">New Chat Conversation</h3>';
                window.currentChatSessionId = null;
                window.isContentAreaDisplayingNewSession = true;
                window.hasAccessedSideMenu = false;
            } else {
                messagesContainerForThisSend = document.getElementById('chat-messages');
                if (!messagesContainerForThisSend) {
                    console.warn('[Chat Tab] Send: #chat-messages not found. Recreating.');
                    mainContentHost.innerHTML = '';
                    messagesContainerForThisSend = document.createElement('div');
                    messagesContainerForThisSend.id = 'chat-messages';
                    messagesContainerForThisSend.classList.add('flex-1', 'overflow-y-auto', 'pb-32');
                    mainContentHost.appendChild(messagesContainerForThisSend);
                    messagesContainerForThisSend.innerHTML = '<h3 class="chat-area-title text-lg font-semibold text-center py-2">Chat</h3>';
                }
            }

            if (!window.currentChatSessionId) {
                window.currentChatSessionId = `chat_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
                console.log('[Chat Tab] New Chat Session ID:', window.currentChatSessionId);
            }

            const userDiv = document.createElement('div');
            userDiv.classList.add('chat-message', 'user', 'bg-gray-800', 'p-3', 'rounded', 'mb-2', 'text-right');
            userDiv.innerHTML = `<strong class="font-semibold">You:</strong><div class="message-content mt-1">${message.replace(/</g, "<").replace(/>/g, ">")}</div>`;

            if (messagesContainerForThisSend) {
                messagesContainerForThisSend.appendChild(userDiv);
                messagesContainerForThisSend.scrollTop = messagesContainerForThisSend.scrollHeight;
            } else {
                console.error('[Chat Tab] Send: messagesContainerForThisSend is null.');
                if (typeof window.showToast === 'function') {
                    window.showToast('Chat UI error: Messages container not found.', 'error');
                }
            }

            console.log('[Chat Tab] Sending message via WebSocket:', message);
            if (typeof window.sendChatMsg === 'function') {
                window.sendChatMsg({
                    type: 'chat',
                    message: message,
                    chatSessionId: window.currentChatSessionId,
                    mode: 'chat-talk'
                });
            } else {
                console.error('--- [Chat Tab] ERROR: window.sendChatMsg is NOT a function! ---');
                if (typeof window.showToast === 'function') {
                    window.showToast('Chat system error: Unable to send message.', 'error');
                }
            }

            chatInputField.value = '';
            if (chatInputField.tagName === 'TEXTAREA') {
                autoResizeTextarea(chatInputField);
            }
        });

        if (chatInputField && chatInputField.tagName === 'TEXTAREA') {
            chatInputField.addEventListener('input', () => autoResizeTextarea(chatInputField));
            autoResizeTextarea(chatInputField);
            console.log('--- [Chat Tab] Textarea listener attached. ---');
        }

        console.log('--- [Chat Tab] setupChat (SUPER DEBUG MODE) finished. ---');
    } catch (error) {
        console.error('--- [Chat Tab] ERROR in setupChat:', error, '---');
        if (typeof window.showToast === 'function') {
            window.showToast('Failed to initialize chat. Please refresh.', 'error');
        }
        throw error;
    }
}


document.addEventListener('DOMContentLoaded', async () => {
  console.log('--- [Chat Tab] DOMContentLoaded event fired ---');

  const trySetupChat = async (retries = 5, delay = 1000) => {
    for (let i = 0; i < retries; i++) {
      if (document.querySelector('#chat-talk')) {
        console.log('--- [Chat Tab] #chat-talk found on load, running setupChat ---');
        try {
          await setupChat();
          return;
        } catch (error) {
          console.error('--- [Chat Tab] setupChat failed, retrying...', error);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      } else {
        console.log('--- [Chat Tab] #chat-talk not found on load, retrying...');
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
    console.warn('--- [Chat Tab] Gave up on setupChat after retries ---');
    window.showToast('Chat panel not found. Please refresh.', 'error');
  };

  await trySetupChat();

  const chatTabsContainer = document.querySelector('.chat-tabs');
  if (chatTabsContainer) {
    chatTabsContainer.addEventListener('click', async (event) => {
      const clickedTab = event.target.closest('.chat-tab');
      if (!clickedTab) return;

      const tabName = clickedTab.dataset.tab;
      console.log(`--- [Chat Tab] Tab clicked: ${tabName} ---`);

      if (window.isLoadingChatTab) {
        console.log('--- [Chat Tab] loadChatTab is already in progress. Ignoring click. ---');
        return;
      }

      if (typeof window.loadChatTab !== 'function') {
        console.error('--- [Chat Tab] ERROR: window.loadChatTab is not defined! ---');
        if (typeof window.showToast === 'function') {
          window.showToast('UI loading function missing. Please refresh.', 'error');
        }
        return;
      }

      window.isLoadingChatTab = true;
      try {
        if (tabName === 'chat') {
          await window.loadChatTab('chat', 'chat-talk');
          console.log('--- [Chat Tab] Running setupChat for chat tab ---');
          await trySetupChat();
        } else if (tabName === 'create-images') {
          await window.loadChatTab('create-image', 'create-images');
        } else if (tabName === 'create-videos') {
          if (typeof window.showToast === 'function') {
            window.showToast('Video creation is not yet available.', 'info');
          }
          await window.loadChatTab('create-image', 'create-images');
        }
      } catch (error) {
        console.error(`--- [Chat Tab] Error during loadChatTab for tab ${tabName}:`, error);
        if (typeof window.showToast === 'function') {
          window.showToast('Error switching tabs. Please refresh.', 'error');
        }
      } finally {
        window.isLoadingChatTab = false;
      }
    });
    console.log('--- [Chat Tab] Tab click listener attached to .chat-tabs ---');
  } else {
    console.error('--- [Chat Tab] ERROR: .chat-tabs container not found ---');
    if (typeof window.showToast === 'function') {
      window.showToast('Tab container not found. Please refresh.', 'error');
    }
  }

  console.log('--- [Chat Tab] DOMContentLoaded finished ---');
});