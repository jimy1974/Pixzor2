const WebSocket = require('ws');
const { OpenAI } = require('openai');
const { sessionMiddleware } = require('../server'); 
const { User, GeneratedContent, ChatSession } = require('../db'); 
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const { uploadJsonToGcs, downloadJsonFromGcs, uploadImageBufferToGcs } = require('./gcsUtils'); // Import GCS utilities

// Initialize Qwen client (used for both intent detection and chat)
const qwen = new OpenAI({
    apiKey: process.env.QWEN_API_KEY,
    baseURL: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
});

// --- System Prompt for Intent Detection --- 
const INTENT_DETECTION_SYSTEM_PROMPT = `
You are an intelligent routing assistant. Analyze the user's message and determine their primary intent. Respond ONLY with a JSON object containing the 'intent' and relevant 'parameters'.

Available Intents:
- 'chat': General conversation, questions, requests for information.
- 'image_generation': User wants to create, generate, draw, or make an image, picture, photo, or sketch.

Parameters:
- For 'image_generation', extract the core subject or description into the 'prompt' parameter. Clean the prompt by removing instructional phrases like "create an image of".
- For 'chat', no specific parameters are needed (parameters can be an empty object {}).

Examples:
User: "Hi there, how are you?"
Assistant: {"intent": "chat", "parameters": {}}

User: "Can you generate an image of a blue dog flying a kite?"
Assistant: {"intent": "image_generation", "parameters": {"prompt": "a blue dog flying a kite"}}

User: "Tell me about the weather today."
Assistant: {"intent": "chat", "parameters": {}}

User: "Make a picture showing a futuristic city."
Assistant: {"intent": "image_generation", "parameters": {"prompt": "a futuristic city"}}

User: "Who won the world cup in 2022?"
Assistant: {"intent": "chat", "parameters": {}}

Respond ONLY with the JSON object.
`;

function initializeWebSocket(server) {
    const wss = new WebSocket.Server({ 
        verifyClient: (info, done) => {
            console.log('[WebSocket] Verifying client...');
            sessionMiddleware(info.req, {}, () => {
                if (info.req.session && info.req.session.passport && info.req.session.passport.user) {
                    console.log('[WebSocket] Client verification successful, User ID:', info.req.session.passport.user);
                    info.req.verifiedUserId = info.req.session.passport.user; // Attach userId here
                    done(true); // Accept connection
                } else {
                    console.log('[WebSocket] Client verification failed: No authenticated session found.');
                    done(false, 401, 'Unauthorized'); 
                }
            });
        },
        server 
    });

    console.log('[WebSocket] Server initialized and listening.');

    wss.on('connection', (ws, req) => {
        // Read the userId attached by verifyClient
        const connectedUserId = req.verifiedUserId; 

        // Add a check in case verifyClient somehow failed to attach it (shouldn't happen if verification succeeded)
        if (!connectedUserId) {
            console.error('[WebSocket] CRITICAL: Connection established but verifiedUserId is missing on req object.');
            ws.close(1011, 'Internal server error'); // Close connection with an error code
            return;
        }

        ws.userId = connectedUserId; // Still assign for potential use in close/error logs
        console.log(`[WebSocket] Client connected. User ID: ${connectedUserId}`);

        // Send welcome message or initial state
        ws.send(JSON.stringify({ type: 'message', message: 'Welcome!' }));

        ws.on('message', async (message) => {
            const userId = connectedUserId; // Use the captured ID from the outer scope
            console.log(`[WebSocket Debug] Using userId from connection scope: ${userId}`); // Add log
            let parsedMessage; 

            try {
                parsedMessage = JSON.parse(message); 
                console.log(`[WebSocket] User ${userId} Received:`, parsedMessage); 
            } catch (error) {
                console.error(`[WebSocket] User ${userId} Failed to parse message:`, Buffer.isBuffer(message) ? message.toString() : message, error);
                ws.send(JSON.stringify({ type: 'error', message: 'Invalid message format received.' }));
                return; 
            }

            console.log(`[WebSocket] User ${userId} Received (Full Log):`, JSON.stringify(parsedMessage, null, 2)); // Log the full parsed message with the correct userId

            if (parsedMessage.type === 'chat') {
                const userTextMessage = parsedMessage.message;
                if (!userTextMessage) {
                    ws.send(JSON.stringify({ type: 'error', message: 'Empty chat message received.' }));
                    return;
                }

                // --- AI-Powered Intent Detection --- 
                try {
                    ws.send(JSON.stringify({ type: 'status', message: 'Understanding request...' }));
                    console.log(`[WebSocket] User ${userId} Performing intent detection for: "${userTextMessage}"`);

                    const intentDetectionResponse = await qwen.chat.completions.create({
                        model: "qwen-turbo", // Or your preferred Qwen model
                        messages: [
                            { role: "system", content: INTENT_DETECTION_SYSTEM_PROMPT },
                            { role: "user", content: userTextMessage }
                        ],
                        temperature: 0.1, // Low temperature for deterministic classification
                        // Ensure response format is likely JSON (though parsing needed)
                        // top_p: 0.1 
                    });

                    let detectedIntent = 'chat'; // Default to chat
                    let intentParams = {};
                    const rawIntentResult = intentDetectionResponse.choices[0]?.message?.content;

                    if (rawIntentResult) {
                        console.log(`[WebSocket] User ${userId} Raw Intent Result: ${rawIntentResult}`);
                        try {
                            // Attempt to parse the JSON response from the LLM
                            const parsedResult = JSON.parse(rawIntentResult.trim());
                            detectedIntent = parsedResult.intent || 'chat';
                            intentParams = parsedResult.parameters || {};
                            console.log(`[WebSocket] User ${userId} Detected Intent: ${detectedIntent}, Params:`, intentParams);
                        } catch (parseError) {
                            console.error(`[WebSocket] User ${userId} Failed to parse intent JSON: ${parseError}. Raw: ${rawIntentResult}. Defaulting to 'chat'.`);
                            // Keep detectedIntent as 'chat'
                        }
                    } else {
                        console.warn(`[WebSocket] User ${userId} Intent detection returned no content. Defaulting to 'chat'.`);
                    }

                    // --- Routing Logic --- 
                    switch (detectedIntent) {
                        case 'image_generation':
                            try {
                                const prompt = intentParams.prompt;
                                if (!prompt) {
                                    console.error(`[WebSocket] User ${userId} Image generation intent detected but no prompt extracted.`);
                                    ws.send(JSON.stringify({ type: 'error', message: 'Could not understand the image description. Please try again.' }));
                                    break; // Exit switch
                                }
                                
                                console.log(`[WebSocket] User ${userId} Routing to Image Generation. Extracted Prompt: "${prompt}"`);
                                ws.send(JSON.stringify({ type: 'status', message: 'Generating image...' }));
                                
                                // Check/Deduct User Tokens (Keep this logic)
                                const user = await User.findByPk(userId); // Uses the correct userId now
                                const imageCost = 10; // Hardcoded cost
                                console.log(`[WebSocket Token Check] User ID: ${userId}, Found User: ${!!user}, User Tokens: ${user?.tokens}, Cost: ${imageCost}`);
                                if (!user || user.tokens < imageCost) {
                                    ws.send(JSON.stringify({ type: 'error', message: `Insufficient tokens. Need ${imageCost}, have ${user?.tokens ?? 0}.` }));
                                    break; // Exit switch if insufficient tokens
                                }

                                // Construct Runware Params using EXTRACTED prompt
                                const taskUUID = uuidv4();
                                const runwareParams = {
                                    taskType: 'imageInference',
                                    taskUUID: taskUUID, 
                                    positivePrompt: prompt, // Use extracted prompt
                                    model: 'runware:101@1', 
                                    width: 1024, 
                                    height: 1024,
                                    steps: 28, 
                                    CFGScale: 3.5,
                                    scheduler: 'Euler',
                                    numberResults: 1,
                                    outputFormat: 'JPEG',
                                    outputType: ['URL'],
                                    includeCost: true,
                                };

                                console.log('[WebSocket] Sending Runware params via axios:', JSON.stringify([runwareParams], null, 2));

                                // Call Runware API Directly using Axios (Keep this logic)
                                const response = await axios.post(
                                    'https://api.runware.ai/v1',
                                    [runwareParams],
                                    {
                                        headers: {
                                            'Authorization': `Bearer ${process.env.RUNWARE_API_KEY}`,
                                            'Content-Type': 'application/json',
                                        },
                                        timeout: 120000, 
                                    }
                                );

                                // Check for errors in the response data
                                if (response.data.error) {
                                    console.error('[WebSocket] Runware API returned an error:', JSON.stringify(response.data.error, null, 2));
                                    throw response.data; 
                                }

                                // Extract result
                                const resultData = response.data.data?.[0]; 
                                if (!resultData || !resultData.imageURL) {
                                    console.error(`[WebSocket] User ${userId} Runware axios call returned no image URL.`);
                                    ws.send(JSON.stringify({ type: 'error', message: 'Image generation failed: No image URL returned from API.' }));
                                    break; // Exit switch
                                }
                                
                                console.log(`[WebSocket] User ${userId} Runware success (axios). Image URL: ${resultData.imageURL}, Cost: ${resultData.cost}`);
                                
                                // Download image from Runware and upload to GCS
                                const imageResponse = await axios.get(resultData.imageURL, { responseType: 'arraybuffer' });
                                const imageBuffer = Buffer.from(imageResponse.data, 'binary');
                                const contentType = imageResponse.headers['content-type'] || 'image/jpeg'; // Default to jpeg if not provided
                                const fileExtension = contentType.split('/')[1] || 'jpg';
                                const uniqueFilename = `${uuidv4()}.${fileExtension}`;

                                console.log(`[WebSocket] Preparing GCS Upload. Filename: ${uniqueFilename}, ContentType: ${contentType}, Buffer Size: ${imageBuffer ? imageBuffer.length : 'null'}`);
                                console.log(`[WebSocket] Attempting to upload image buffer to GCS as ${uniqueFilename}`);
                                let gcsUrl = await uploadImageBufferToGcs(imageBuffer, uniqueFilename, contentType);
                                console.log(`[WebSocket] uploadImageBufferToGcs returned: ${gcsUrl}`); // Log the direct result

                                if (!gcsUrl) { // Handle GCS upload failure
                                    console.error('[WebSocket] Failed to upload image to GCS. Falling back to Runware URL.');
                                    gcsUrl = resultData.imageURL; // Use Runware URL as fallback
                                }

                                // Save to DB
                                const newContent = await GeneratedContent.create({ 
                                    userId: userId, 
                                    prompt: prompt, // Use extracted prompt
                                    type: 'image',                  
                                    contentUrl: gcsUrl, // Save the GCS URL
                                    tokenCost: resultData.cost,      
                                    service: runwareParams.model, 
                                    metadata: { 
                                        imageUUID: resultData.imageUUID, 
                                        taskUUID: taskUUID, 
                                    }
                                }); 
                                
                                // Deduct tokens 
                                await user.decrement('tokens', { by: imageCost });
                                console.log(`[WebSocket] User ${userId} tokens deducted. New balance: ${user.tokens - imageCost}`);
 
                                // --- Save Interaction to GCS --- 
                                if (parsedMessage.chatSessionId && userId) {
                                    console.log(`[WebSocket Debug] Preparing image interaction history for GCS: ${parsedMessage.chatSessionId}`);
                                    try {
                                        // Find or create the session record (title is set here)
                                        const [session, created] = await ChatSession.findOrCreate({
                                            where: { userId: userId, clientSessionId: parsedMessage.chatSessionId }, 
                                            defaults: {
                                                userId: userId,
                                                clientSessionId: parsedMessage.chatSessionId,
                                                // historyGcsUrl will be set after upload
                                                title: userTextMessage.substring(0, 50) + (userTextMessage.length > 50 ? '...' : '')
                                            }
                                        });

                                        // Download existing history if session is not new and has a GCS URL
                                        let currentHistory = [];
                                        if (!created && session.historyGcsUrl) {
                                            console.log(`[WebSocket Debug] Session existed. Attempting to download history from ${session.historyGcsUrl}`);
                                            const existingHistory = await downloadJsonFromGcs(session.historyGcsUrl);
                                            if (existingHistory && Array.isArray(existingHistory)) {
                                                currentHistory = existingHistory;
                                                console.log(`[WebSocket Debug] Successfully downloaded ${currentHistory.length} existing messages.`);
                                            } else {
                                                console.warn(`[WebSocket Debug] Failed to download or parse existing history from ${session.historyGcsUrl}. Starting fresh.`);
                                            }
                                        } else {
                                            console.log(`[WebSocket Debug] New session (${created}) or no existing GCS URL. Starting fresh history.`);
                                        }

                                        // Append new messages
                                        currentHistory.push({ role: 'user', content: userTextMessage });
                                        currentHistory.push({ role: 'assistant', content: `Here is the image you requested: ${gcsUrl}` });

                                        // Upload updated history to GCS
                                        const gcsUri = await uploadJsonToGcs(userId, parsedMessage.chatSessionId, currentHistory);

                                        if (gcsUri) {
                                            // Update the DB record with the potentially new GCS URL (or same if overwriting)
                                            if (session.historyGcsUrl !== gcsUri) {
                                                await session.update({ historyGcsUrl: gcsUri });
                                                console.log(`[WebSocket] User ${userId} Image interaction session ${parsedMessage.chatSessionId} DB record updated with GCS URL: ${gcsUri}`);
                                            } else {
                                                console.log(`[WebSocket] User ${userId} Image interaction session ${parsedMessage.chatSessionId} GCS file updated. URL unchanged.`);
                                            }
                                        } else {
                                            console.error(`[WebSocket] User ${userId} Failed to get GCS URI for session ${parsedMessage.chatSessionId}. DB record not updated with URL.`);
                                        }

                                    } catch (dbOrGcsError) {
                                        // Log the full error object for detailed diagnosis
                                        console.error(`[WebSocket] User ${userId} Error saving/updating image interaction session ${parsedMessage.chatSessionId} (DB or GCS):`, JSON.stringify(dbOrGcsError, null, 2));
                                        // Don't interrupt user flow, just log the error
                                    }
                                }
                                // --- End Save Interaction --- 
+
                                // Send success message
                                ws.send(JSON.stringify({ 
                                    type: 'imageResult', 
                                    imageUrl: gcsUrl,
                                    contentId: newContent.id 
                                }));

                            } catch (error) { // Catch ANY error from the image generation process (API, GCS, DB)
                                console.error(`[WebSocket] User ${userId} Overall Image Generation Error:`, error);
                                let clientErrorMessage = 'An error occurred during image generation.';
                                // Add more specific error checking if needed (e.g., axios errors, custom errors)
                                if (axios.isAxiosError(error)) {
                                    clientErrorMessage = `Image generation service error: ${error.response?.status || 'Network Error'}`;
                                }
                                ws.send(JSON.stringify({ type: 'error', message: clientErrorMessage }));
                            }
                            break; // End image_generation case

                        default:
                            // --- Handle Standard Chat (Default) --- 
                            console.log(`[WebSocket] User ${userId} Routing to Chat.`);
                            try {
                                ws.send(JSON.stringify({ type: 'status', message: 'Thinking...' }));
                                // Use the original user message for chat
                                const stream = await qwen.chat.completions.create({
                                    model: "qwen-turbo",
                                    messages: [{ role: "user", content: userTextMessage }],
                                    stream: true,
                                });
                                
                                // --- Keep existing chat streaming logic --- 
                                let fullBotMessage = "";
                                for await (const chunk of stream) {
                                    const content = chunk.choices[0]?.delta?.content || "";
                                    fullBotMessage += content;
                                    ws.send(JSON.stringify({ 
                                        type: 'messageChunk', 
                                        sender: 'bot', 
                                        message: content 
                                    }));
                                }
                                console.log(`[WebSocket] User ${userId} Bot full response: ${fullBotMessage}`);
                                // Optionally save chat messages to DB here if needed later

                                // --- Save Chat to GCS --- 
                                if (parsedMessage.chatSessionId && userId) {
                                    console.log(`[WebSocket Debug] Preparing chat history for GCS: ${parsedMessage.chatSessionId}`); // DEBUG LOG
                                    try {
                                        const [session, created] = await ChatSession.findOrCreate({
                                            where: { userId: userId, clientSessionId: parsedMessage.chatSessionId }, 
                                            defaults: {
                                                userId: userId,
                                                clientSessionId: parsedMessage.chatSessionId,
                                                title: userTextMessage.substring(0, 50) + (userTextMessage.length > 50 ? '...' : '') 
                                            }
                                        });

                                        // Download existing history if session is not new and has a GCS URL
                                        let currentHistory = [];
                                        if (!created && session.historyGcsUrl) {
                                            console.log(`[WebSocket Debug] Session existed. Attempting to download history from ${session.historyGcsUrl}`);
                                            const existingHistory = await downloadJsonFromGcs(session.historyGcsUrl);
                                            if (existingHistory && Array.isArray(existingHistory)) {
                                                currentHistory = existingHistory;
                                                console.log(`[WebSocket Debug] Successfully downloaded ${currentHistory.length} existing messages.`);
                                            } else {
                                                console.warn(`[WebSocket Debug] Failed to download or parse existing history from ${session.historyGcsUrl}. Starting fresh.`);
                                            }
                                        } else {
                                            console.log(`[WebSocket Debug] New session (${created}) or no existing GCS URL. Starting fresh history.`);
                                        }

                                        // Append new messages
                                        currentHistory.push({ role: 'user', content: userTextMessage }); 
                                        currentHistory.push({ role: 'assistant', content: fullBotMessage }); 

                                        // Upload updated history to GCS
                                        const gcsUri = await uploadJsonToGcs(userId, parsedMessage.chatSessionId, currentHistory);

                                        if (gcsUri) {
                                            // Update the DB record with the potentially new GCS URL (or same if overwriting)
                                            if (session.historyGcsUrl !== gcsUri) {
                                                await session.update({ historyGcsUrl: gcsUri });
                                                console.log(`[WebSocket] User ${userId} Chat session ${parsedMessage.chatSessionId} DB record updated with GCS URL: ${gcsUri}`);
                                            } else {
                                                console.log(`[WebSocket] User ${userId} Chat session ${parsedMessage.chatSessionId} GCS file updated. URL unchanged.`);
                                            }
                                        } else {
                                            console.error(`[WebSocket] User ${userId} Failed to get GCS URI for chat session ${parsedMessage.chatSessionId}. DB record not updated with URL.`);
                                        }

                                    } catch (dbOrGcsError) {
                                        // Log the full error object for detailed diagnosis
                                        console.error(`[WebSocket] User ${userId} Failed to save/update chat session ${parsedMessage.chatSessionId} (DB or GCS):`, JSON.stringify(dbOrGcsError, null, 2));
                                        // Don't interrupt user flow, just log the error
                                    }
                                }
                                // --- End Save Chat to GCS --- 
 
                            } catch (chatError) {
                                console.error("[WebSocket] Qwen Chat Error:", chatError);
                                ws.send(JSON.stringify({ type: 'error', message: 'Sorry, I encountered an error processing your chat message.' }));
                            }
                            break; // End chat case
                    }

                } catch (error) {
                    // General error handling for intent detection call or other upstream issues
                    console.error(`[WebSocket] User ${userId} Top-Level Error in message handler:`, error);
                    ws.send(JSON.stringify({ type: 'error', message: 'Sorry, something went wrong processing your request.' }));
                }

            } else {
                console.log(`[WebSocket] User ${userId} Received unhandled message type:`, parsedMessage.type);
            }
        });

        ws.on('close', () => {
            // Use the captured ID here too for consistency, though ws.userId *might* still be okay here
            console.log(`[WebSocket] Client disconnected. User ID: ${connectedUserId}`); 
        });

        ws.on('error', (error) => {
            // Use the captured ID here too
            console.error(`[WebSocket] Error for User ID ${connectedUserId || 'unknown'}:`, error);
        });
    });

    return wss;
}

module.exports = { initializeWebSocket };
