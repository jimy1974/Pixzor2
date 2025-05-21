// utils/websocketHandler.js
const WebSocket = require('ws');
const { OpenAI } = require('openai');
const { sessionMiddleware } = require('../server');
const { User, GeneratedContent, ChatSession } = require('../db');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const { uploadJsonToGcs, downloadJsonFromGcs, uploadImageBufferToGcs } = require('./gcsUtils');

// Initialize Qwen client
const qwen = new OpenAI({
    apiKey: process.env.QWEN_API_KEY,
    baseURL: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
});

// System prompt for intent detection
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
        server,
        verifyClient: (info, done) => {
            console.log('[WebSocket] Verifying client...');
            sessionMiddleware(info.req, {}, (err) => {
                if (err) {
                    console.error('[WebSocket] Session middleware error:', err);
                    return done(false, 500, 'Internal server error');
                }
                // TEMPORARY: Bypass auth for WebSocket connection for local debugging.
                // TODO: Restore proper authentication before production.
                console.warn('[WebSocket] TEMPORARY: Bypassing authentication for WebSocket connection for debugging purposes.');
                if (info.req.session && info.req.session.passport && info.req.session.passport.user) {
                    console.log('[WebSocket] Client verification successful (session found), User ID:', info.req.session.passport.user);
                    info.req.verifiedUserId = info.req.session.passport.user;
                } else {
                    console.log('[WebSocket] No authenticated session found for WebSocket, assigning temporary ID for debugging.');
                    info.req.verifiedUserId = 'temp_debug_user_' + Date.now(); // Assign a temporary ID
                }
                done(true);
                // Original logic:
                // if (info.req.session && info.req.session.passport && info.req.session.passport.user) {
                //     console.log('[WebSocket] Client verification successful, User ID:', info.req.session.passport.user);
                //     info.req.verifiedUserId = info.req.session.passport.user;
                //     done(true);
                // } else {
                //     console.log('[WebSocket] Client verification failed: No authenticated session found.');
                //     done(false, 401, 'Unauthorized');
                // }
            });
        }
    });

    console.log('[WebSocket] Server initialized and listening.');

    wss.on('connection', (ws, req) => {
        const connectedUserId = req.verifiedUserId;
        if (!connectedUserId) {
            console.error('[WebSocket] Connection established but verifiedUserId is missing.');
            ws.close(1011, 'Internal server error');
            return;
        }

        ws.userId = connectedUserId;
        console.log(`[WebSocket] Client connected. User ID: ${connectedUserId}`);

        ws.send(JSON.stringify({ type: 'message', message: 'Welcome!' }));

        ws.on('message', async (message) => {
            try {
                const parsedMessage = JSON.parse(message);
                console.log(`[WebSocket] User ${connectedUserId} Received:`, JSON.stringify(parsedMessage, null, 2));

                if (parsedMessage.type !== 'chat') {
                    console.log(`[WebSocket] User ${connectedUserId} Unhandled message type: ${parsedMessage.type}`);
                    return;
                }

                const userTextMessage = parsedMessage.message;
                if (!userTextMessage) {
                    ws.send(JSON.stringify({ type: 'error', message: 'Empty chat message received.' }));
                    return;
                }

                ws.send(JSON.stringify({ type: 'status', message: 'Understanding request...' }));
                console.log(`[WebSocket] User ${connectedUserId} Performing intent detection for: "${userTextMessage}"`);

                // Intent detection
                const intentDetectionResponse = await qwen.chat.completions.create({
                    model: 'qwen-turbo',
                    messages: [
                        { role: 'system', content: INTENT_DETECTION_SYSTEM_PROMPT },
                        { role: 'user', content: userTextMessage }
                    ],
                    temperature: 0.1
                });

                let detectedIntent = 'chat';
                let intentParams = {};
                const rawIntentResult = intentDetectionResponse.choices[0]?.message?.content;

                if (rawIntentResult) {
                    try {
                        const parsedResult = JSON.parse(rawIntentResult.trim());
                        detectedIntent = parsedResult.intent || 'chat';
                        intentParams = parsedResult.parameters || {};
                        console.log(`[WebSocket] User ${connectedUserId} Detected Intent: ${detectedIntent}, Params:`, intentParams);
                    } catch (parseError) {
                        console.error(`[WebSocket] User ${connectedUserId} Failed to parse intent JSON: ${parseError}. Raw: ${rawIntentResult}`);
                    }
                } else {
                    console.warn(`[WebSocket] User ${connectedUserId} Intent detection returned no content. Defaulting to 'chat'.`);
                }

                // Routing logic
                if (detectedIntent === 'image_generation') {
                    const prompt = intentParams.prompt;
                    if (!prompt) {
                        console.error(`[WebSocket] User ${connectedUserId} Image generation intent detected but no prompt extracted.`);
                        ws.send(JSON.stringify({ type: 'error', message: 'Could not understand the image description. Please try again.' }));
                        return;
                    }

                    console.log(`[WebSocket] User ${connectedUserId} Routing to Image Generation. Prompt: "${prompt}"`);
                    ws.send(JSON.stringify({ type: 'status', message: 'Generating image...' }));

                    // Check user tokens
                    const user = await User.findByPk(connectedUserId);
                    const imageCost = 10; // Adjust based on RUNWARE_MODELS if dynamic
                    if (!user || user.tokens < imageCost) {
                        ws.send(JSON.stringify({ type: 'error', message: `Insufficient tokens. Need ${imageCost}, have ${user?.tokens ?? 0}.` }));
                        return;
                    }

                    // Runware API call
                    const taskUUID = uuidv4();
                    const runwareParams = {
                        taskType: 'imageInference',
                        taskUUID: taskUUID,
                        positivePrompt: prompt,
                        model: 'runware:101@1',
                        width: 1024,
                        height: 1024,
                        steps: 28,
                        CFGScale: 3.5,
                        scheduler: 'Euler',
                        numberResults: 1,
                        outputFormat: 'JPEG',
                        outputType: ['URL'],
                        includeCost: true
                    };

                    const response = await axios.post(
                        'https://api.runware.ai/v1',
                        [runwareParams],
                        {
                            headers: {
                                'Authorization': `Bearer ${process.env.RUNWARE_API_KEY}`,
                                'Content-Type': 'application/json'
                            },
                            timeout: 120000
                        }
                    );

                    if (response.data.error) {
                        console.error('[WebSocket] Runware API error:', response.data.error);
                        throw new Error('Runware API error');
                    }

                    const resultData = response.data.data?.[0];
                    if (!resultData || !resultData.imageURL) {
                        console.error(`[WebSocket] User ${connectedUserId} Runware returned no image URL.`);
                        ws.send(JSON.stringify({ type: 'error', message: 'Image generation failed: No image URL returned.' }));
                        return;
                    }

                    // Upload to GCS
                    const imageResponse = await axios.get(resultData.imageURL, { responseType: 'arraybuffer' });
                    const imageBuffer = Buffer.from(imageResponse.data);
                    const contentType = imageResponse.headers['content-type'] || 'image/jpeg';
                    const fileExtension = contentType.split('/')[1] || 'jpg';
                    const uniqueFilename = `${uuidv4()}.${fileExtension}`;

                    let gcsUrl = await uploadImageBufferToGcs(imageBuffer, uniqueFilename, contentType);
                    if (!gcsUrl) {
                        console.error('[WebSocket] Failed to upload to GCS. Using Runware URL.');
                        gcsUrl = resultData.imageURL;
                    }

                    // Save to database
                    const newContent = await GeneratedContent.create({
                        userId: connectedUserId,
                        prompt: prompt,
                        type: 'image',
                        contentUrl: gcsUrl,
                        tokenCost: resultData.cost,
                        service: runwareParams.model,
                        metadata: {
                            imageUUID: resultData.imageUUID,
                            taskUUID: taskUUID
                        }
                    });

                    // Deduct tokens
                    await user.decrement('tokens', { by: imageCost });
                    console.log(`[WebSocket] User ${connectedUserId} Tokens deducted. New balance: ${user.tokens - imageCost}`);

                    // Save interaction to GCS
                    if (parsedMessage.chatSessionId) {
                        try {
                            const [session, created] = await ChatSession.findOrCreate({
                                where: { userId: connectedUserId, clientSessionId: parsedMessage.chatSessionId },
                                defaults: {
                                    userId: connectedUserId,
                                    clientSessionId: parsedMessage.chatSessionId,
                                    title: userTextMessage.substring(0, 50) + (userTextMessage.length > 50 ? '...' : '')
                                }
                            });

                            let currentHistory = [];
                            if (!created && session.historyGcsUrl) {
                                const existingHistory = await downloadJsonFromGcs(session.historyGcsUrl);
                                if (existingHistory && Array.isArray(existingHistory)) {
                                    currentHistory = existingHistory;
                                }
                            }

                            currentHistory.push({ role: 'user', content: userTextMessage });
                            currentHistory.push({ role: 'assistant', content: `Here is the image you requested: ${gcsUrl}` });

                            const gcsUri = await uploadJsonToGcs(connectedUserId, parsedMessage.chatSessionId, currentHistory);
                            if (gcsUri && session.historyGcsUrl !== gcsUri) {
                                await session.update({ historyGcsUrl: gcsUri });
                                console.log(`[WebSocket] User ${connectedUserId} Session ${parsedMessage.chatSessionId} updated with GCS URL: ${gcsUri}`);
                            }
                        } catch (dbOrGcsError) {
                            console.error(`[WebSocket] User ${connectedUserId} Error saving session ${parsedMessage.chatSessionId}:`, dbOrGcsError);
                        }
                    }

                    // Send success message
                    ws.send(JSON.stringify({
                        type: 'imageResult',
                        imageUrl: gcsUrl,
                        contentId: newContent.id
                    }));
                } else {
                    // Handle chat
                    ws.send(JSON.stringify({ type: 'status', message: 'Thinking...' }));
                    const stream = await qwen.chat.completions.create({
                        model: 'qwen-turbo',
                        messages: [{ role: 'user', content: userTextMessage }],
                        stream: true
                    });

                    let fullBotMessage = '';
                    for await (const chunk of stream) {
                        const content = chunk.choices[0]?.delta?.content || '';
                        fullBotMessage += content;
                        ws.send(JSON.stringify({
                            type: 'messageChunk',
                            sender: 'bot',
                            message: content
                        }));
                    }

                    // Save chat to GCS
                    if (parsedMessage.chatSessionId) {
                        try {
                            const [session, created] = await ChatSession.findOrCreate({
                                where: { userId: connectedUserId, clientSessionId: parsedMessage.chatSessionId },
                                defaults: {
                                    userId: connectedUserId,
                                    clientSessionId: parsedMessage.chatSessionId,
                                    title: userTextMessage.substring(0, 50) + (userTextMessage.length > 50 ? '...' : '')
                                }
                            });

                            let currentHistory = [];
                            if (!created && session.historyGcsUrl) {
                                const existingHistory = await downloadJsonFromGcs(session.historyGcsUrl);
                                if (existingHistory && Array.isArray(existingHistory)) {
                                    currentHistory = existingHistory;
                                }
                            }

                            currentHistory.push({ role: 'user', content: userTextMessage });
                            currentHistory.push({ role: 'assistant', content: fullBotMessage });

                            const gcsUri = await uploadJsonToGcs(connectedUserId, parsedMessage.chatSessionId, currentHistory);
                            if (gcsUri && session.historyGcsUrl !== gcsUri) {
                                await session.update({ historyGcsUrl: gcsUri });
                                console.log(`[WebSocket] User ${connectedUserId} Chat session ${parsedMessage.chatSessionId} updated with GCS URL: ${gcsUri}`);
                            }
                        } catch (dbOrGcsError) {
                            console.error(`[WebSocket] User ${connectedUserId} Error saving chat session ${parsedMessage.chatSessionId}:`, dbOrGcsError);
                        }
                    }
                }
            } catch (error) {
                console.error(`[WebSocket] User ${connectedUserId} Error in message handler:`, error);
                ws.send(JSON.stringify({ type: 'error', message: 'Sorry, something went wrong processing your request.' }));
            }
        });

        ws.on('close', () => {
            console.log(`[WebSocket] Client disconnected. User ID: ${connectedUserId}`);
        });

        ws.on('error', (error) => {
            console.error(`[WebSocket] Error for User ID ${connectedUserId}:`, error);
        });
    });

    return wss;
}

module.exports = { initializeWebSocket };