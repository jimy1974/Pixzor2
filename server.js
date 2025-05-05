require('dotenv').config({ path: require('path').resolve(__dirname, '.env') });
const express = require('express');
const path = require('path');
const fs = require('fs').promises;
const fsSync = require('fs');
const expressLayouts = require('express-ejs-layouts');
const session = require('express-session'); 
const passport = require('passport');
const { OpenAI } = require('openai');
const fetch = require('node-fetch');
const { Op } = require('sequelize');
const routes = require('./routes'); 
const authRoutes = require('./routes/auth'); 
const stripeRouter = require('./routes/stripe'); 
const paymentRouter = require('./routes/payment'); 
const apiRoutes = require('./routes/api'); 
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
// --- Image Upload Deps ---
const sharp = require('sharp');
// --- Stripe Requirement ---
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const db = require('./db');
const { sequelize, User, GeneratedContent, ChatSession, ImageComment } = db;

const app = express();
const PORT = process.env.PORT || 3000; 

// --- Stripe Webhook Handler (Mount Router FIRST) ---
// IMPORTANT: The Stripe webhook needs the raw request body.
// Mount its router BEFORE express.json() middleware.
// app.use('/', stripeRouter); 

// Qwen clients
const qwen = new OpenAI({
    apiKey: process.env.QWEN_API_KEY,
    baseURL: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
});
const qwenIntent = new OpenAI({
    apiKey: process.env.QWEN_API_KEY,
    baseURL: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
});

// Middleware
app.use(express.static('public'));
// --- Stripe Webhook Handler (MUST BE BEFORE express.json) ---
/* TEMPORARILY COMMENTED OUT FOR DEBUGGING */ // app.use('/webhook', stripeRouter); // Mount Stripe webhook handler *only* at its specific path
app.use(express.json()); 
app.use(express.urlencoded({ extended: true }));
const sessionMiddleware = session({
    secret: process.env.SESSION_SECRET || 'your-secret',
    resave: false,
    saveUninitialized: false,
});
app.use(sessionMiddleware);
app.use(passport.initialize());
app.use(passport.session());

// Make session middleware accessible for WebSocket
module.exports.sessionMiddleware = sessionMiddleware;

// Static file serving
app.use('/images', express.static(path.join(__dirname, 'public', 'images')));
app.use('/videos', express.static(path.join(__dirname, 'public', 'videos')));
const generatedImagesPath = path.join(__dirname, 'public', 'images', 'generated');
fs.mkdir(generatedImagesPath, { recursive: true }).catch(console.error);
app.use('/images/generated', express.static(generatedImagesPath));

// Ensure Runware upload directory exists
const RUNWARE_UPLOAD_DIR = path.join(__dirname, 'public', 'uploads', 'generated_images');
if (!fsSync.existsSync(RUNWARE_UPLOAD_DIR)){
    try {
        fsSync.mkdirSync(RUNWARE_UPLOAD_DIR, { recursive: true });
        console.log(`Created Runware upload directory: ${RUNWARE_UPLOAD_DIR}`);
    } catch (err) {
        console.error(`Error creating Runware upload directory ${RUNWARE_UPLOAD_DIR}:`, err);
    }
}

// View engine setup
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');
app.use(expressLayouts);
app.set('layout', 'layouts/layout');

// Routes
app.use('/', routes); 
app.use('/', authRoutes); 
const paymentRoutes = require('./routes/payment');
const generateRoutes = require('./routes/generate');
const partialsRouter = require('./routes/partials');

app.use('/payment', paymentRoutes); 
app.use('/api', apiRoutes); 
app.use('/generate', generateRoutes); 
app.use('/partials', partialsRouter);

// Gallery routes
app.get('/gallery', (req, res) => {
    console.log('Gallery route hit');
    console.log('User:', req.user); 
    res.render('gallery', {
        title: 'Gallery',
        description: 'Browse AI generated content.',
        includeChat: false
    });
});

// Intent detection with title suggestion
async function detectIntentAndTitle(userMessage) {
    const response = await qwenIntent.chat.completions.create({
        model: 'qwen-turbo',
        messages: [
            { 
                role: 'system', 
                content: "Analyze the user's message. Return a JSON object with: \"intent\" (\"greeting\", \"image_request\", \"other\") and \"title\" (a concise, descriptive chat title based on the message). Example: {\"intent\": \"greeting\", \"title\": \"Casual Hello\"}"
            },
            { role: 'user', content: userMessage }
        ],
        max_tokens: 50,
        temperature: 0.1,
    });
    return JSON.parse(response.choices[0].message.content.trim());
}

// Passport serialization
passport.serializeUser((user, done) => done(null, user.id));
passport.deserializeUser(async (id, done) => {
    try {
        const user = await User.findByPk(id, { attributes: ['id', 'username', 'email', 'googleId', 'credits', 'photo'] });
        done(null, user);
    } catch (err) {
        done(err, null);
    }
});

// API routes
app.use((req, res, next) => {
    console.log(`[Request] ${req.method} ${req.url} at ${new Date().toISOString()}`);
    next();
});



app.get('/api/user-info', (req, res) => {
    if (req.isAuthenticated()) {
        res.json({
            id: req.user.id,
            username: req.user.username,
            email: req.user.email,
            credits: req.user.credits,
            photo: req.user.photo
        });
    } else {
        res.status(401).json({ error: 'Please log in.' });
    }
});

app.get('/api/library/chats', async (req, res) => {
    if (!req.isAuthenticated()) return res.json({ items: [], message: 'Please log in to view your chat history.' });
    try {
        const chats = await ChatSession.findAll({ where: { userId: req.user.id }, order: [['updatedAt', 'DESC']], limit: 50 });
        const items = chats.map(chat => ({ id: chat.id, title: chat.title, timestamp: chat.updatedAt }));
        res.json({ items });
    } catch (err) {
        console.error('Error fetching chat history:', err);
        res.status(500).json({ items: [], message: 'Error loading chat history.' });
    }
});

const { downloadJsonFromGcs } = require('./utils/gcsUtils'); // Import GCS utility

app.get('/api/library/chats/:id', async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: 'Please log in.' });
    const chatId = req.params.id;
    try {
        const chat = await ChatSession.findOne({ where: { id: chatId, userId: req.user.id } });
        if (!chat) return res.status(404).json({ message: 'Chat not found.' });

        let messages = []; // Default to empty array
        if (chat.historyGcsUrl) {
            console.log(`[API Chat] Found GCS URL: ${chat.historyGcsUrl}. Attempting download...`);
            const downloadedHistory = await downloadJsonFromGcs(chat.historyGcsUrl);
            if (downloadedHistory) {
                messages = downloadedHistory; // Use the history downloaded from GCS
            } else {
                 console.warn(`[API Chat] Failed to download or parse history from ${chat.historyGcsUrl} for chat ID ${chatId}`);
                 // Keep messages as empty array, or return a specific error message?
            }
        } else {
             console.log(`[API Chat] No GCS URL found for chat ID ${chatId}. Returning empty history.`);
        }
        
        res.json({ title: chat.title, messages });

    } catch (err) {
        console.error('Error fetching chat messages:', err);
        res.status(500).json({ message: 'Error loading chat messages.' });
    }
});

app.delete('/api/library/chats/:chatId', async (req, res) => {
    console.log(`[Chat History] DELETE request received for chat ID: ${req.params.chatId}`);
    if (!req.isAuthenticated()) {
        console.log('[Chat History] User not authenticated.');
        return res.status(401).json({ message: 'Unauthorized' });
    }
    const chatId = req.params.chatId;
    try {
        const chatSession = await ChatSession.findOne({
            where: {
                id: chatId,
                userId: req.user.id
            }
        });
        if (!chatSession) {
            console.log(`[Chat History] Chat session not found for ID: ${chatId} and user ID: ${req.user.id}`);
            return res.status(404).json({ message: 'Chat session not found' });
        }
        await chatSession.destroy();
        console.log(`[Chat History] Chat session ${chatId} deleted successfully.`);
        res.json({ message: 'Chat session deleted successfully' });
    } catch (error) {
        console.error(`[Chat History] Error deleting chat session ${chatId}:`, error);
        res.status(500).json({ message: 'Failed to delete chat session' });
    }
});

app.get('/api/files', async (req, res) => {
    if (!req.isAuthenticated()) {
        return res.status(401).json({ message: 'Please log in to view your files.' });
    }
    try {
        const files = await GeneratedContent.findAll({
            where: { userId: req.user.id, type: 'image' },
            order: [['createdAt', 'DESC']],
            limit: 50,
        });
        const items = files.map(file => ({
            id: file.id,
            image: file.contentUrl,
            prompt: file.prompt,
            createdAt: file.createdAt,
        }));
        res.json({ items });
    } catch (err) {
        console.error('Error fetching files:', err);
        res.status(500).json({ message: 'Error loading files.' });
    }
});

// DELETE a specific chat session and its messages
app.delete('/api/library/chats/:chatId', async (req, res) => {
    const chatId = req.params.chatId;
    const userId = req.user.id;
    console.log(`[API] DELETE request for chat ID: ${chatId} by user ID: ${userId}`);

    let transaction;
    try {
        // Start a transaction
        transaction = await sequelize.transaction();

        // 1. Delete messages associated with the chat session for this user
        const deletedMessagesCount = await ChatMessage.destroy({
            where: {
                chatSessionId: chatId, 
                // We don't necessarily need userId here if chatSessionId is unique and owned by the user,
                // but adding it adds a layer of safety if the model allows it.
                // If ChatMessage doesn't have userId, rely on the ChatSession check below.
            },
            transaction
        });
        console.log(`[DB] Deleted ${deletedMessagesCount} messages for chat ID: ${chatId}`);

        // 2. Delete the chat session itself, ensuring it belongs to the user
        const deletedChatCount = await ChatSession.destroy({
            where: {
                id: chatId,
                userId: userId
            },
            transaction
        });

        // Commit the transaction
        await transaction.commit();

        if (deletedChatCount > 0) {
            console.log(`[API] Successfully deleted chat ID: ${chatId}`);
            res.status(200).json({ message: 'Chat deleted successfully.' });
        } else {
            // If no chat was deleted, it means either it didn't exist or didn't belong to the user
            console.warn(`[API] Chat ID: ${chatId} not found or user ${userId} not authorized to delete.`);
            // Rollback not strictly needed here as nothing was deleted, but good practice if other ops were involved
            // await transaction.rollback(); 
            res.status(404).json({ message: 'Chat not found or you do not have permission to delete it.' });
        }

    } catch (error) {
        console.error(`[API] Error deleting chat ID ${chatId}:`, error);
        // Rollback the transaction in case of error
        if (transaction) await transaction.rollback();
        res.status(500).json({ message: 'Failed to delete chat.' });
    }
});

// Server startup
(async () => {
    try {
        await sequelize.authenticate();
        console.log('Database connection established successfully.');
        console.log('[DB Sync] NODE_ENV:', process.env.NODE_ENV);
        // Sync database
        console.log('[DB Sync] NODE_ENV:', process.env.NODE_ENV);
        await sequelize.sync({ alter: false }); // Use alter: true to modify tables without dropping them
        console.log('[DB Sync] Database synced successfully with alter option.');
        // Import Cleanup Service
        const { startCleanupSchedule } = require('./utils/cleanupService');

        // Start the scheduled cleanup job
        startCleanupSchedule();

        const server = app.listen(PORT, () => {
            console.log(`Server is running on port ${PORT}`);
        });
        
        // Initialize WebSocket Server
        // Correct the path to utils directory
        const { initializeWebSocket } = require('./utils/websocketHandler'); 
        initializeWebSocket(server);

    } catch (err) {
        console.error('Database connection or sync failed:', err);
        process.exit(1);
    }
})();