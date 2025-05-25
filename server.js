require('dotenv').config({ path: require('path').resolve(__dirname, '.env') });
const express = require('express');
const path = require('path');
const fs = require('fs/promises');
const fsSync = require('fs');
const expressLayouts = require('express-ejs-layouts');
const session = require('express-session');
const passport = require('passport');
const { OpenAI } = require('openai');
const { Op } = require('sequelize');
const routes = require('./routes');
const authRoutes = require('./routes/auth');
const stripeRouter = require('./routes/stripe');
const paymentRouter = require('./routes/payment');
const apiRoutes = require('./routes/api');
const { v4: uuidv4 } = require('uuid');
const sharp = require('sharp');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const cookieParser = require('cookie-parser');
const csrf = require('csurf');

// Import configurations
const { RUNWARE_MODELS } = require('./config/modelsConfig');
const { PROMPT_BASED_STYLES } = require('./config/stylesConfig');

const db = require('./db'); // Reverted to use the root db.js
const { sequelize, User, GeneratedContent, ChatSession, ImageComment, ImageLike } = db; // Ensure all models from root db.js are destructured

const app = express();
const PORT = process.env.PORT || 3000;

// Session middleware
const sessionMiddleware = session({
    secret: process.env.SESSION_SECRET || 'your-secret',
    resave: false,
    saveUninitialized: false,
    cookie: { secure: process.env.NODE_ENV === 'production' } // Secure in production
});

// Middleware
app.use(cookieParser());

// Serve static files from 'public' directory
app.use(express.static('public', {
    setHeaders: (res, path) => {
        if (path.endsWith('.css')) {
            res.setHeader('Content-Type', 'text/css');
        } else if (path.endsWith('.js')) {
            res.setHeader('Content-Type', 'application/javascript');
        }
    }
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(sessionMiddleware);
app.use(passport.initialize());
app.use(passport.session());
//app.use(csrf({ cookie: true }));

// Bypass CSRF for /api/add-generated-image
app.use((req, res, next) => {
    if (req.path === '/api/add-generated-image') {
        return next();
    }
    csrf({ cookie: true })(req, res, next);
});

app.use(expressLayouts);
app.set('view engine', 'ejs');
app.set('views', './views');
app.set('layout', 'layouts/layout');

// Pass CSRF token and globals to all views
app.use((req, res, next) => {
    res.locals.csrfToken = typeof req.csrfToken === 'function' && req.path !== '/api/add-generated-image' ? req.csrfToken() : null;
    res.locals.isLoggedIn = req.isAuthenticated();
    res.locals.user = req.user ? {
        id: req.user.id,
        username: req.user.username,
        email: req.user.email,
        credits: req.user.credits,
        photo: req.user.photo
    } : null;
    res.locals.runwareModels = RUNWARE_MODELS;
    res.locals.promptBasedStyles = PROMPT_BASED_STYLES;
    next();
});

// Static file serving
app.use('/images', express.static(path.join(__dirname, 'public', 'images')));
app.use('/videos', express.static(path.join(__dirname, 'public', 'videos')));
const generatedImagesPath = path.join(__dirname, 'public', 'images', 'generated');
fs.mkdir(generatedImagesPath, { recursive: true })
    .then(() => console.log(`Ensured generated images directory exists: ${generatedImagesPath}`))
    .catch(err => console.error(`Error creating generated images directory ${generatedImagesPath}:`, err));
app.use('/images/generated', express.static(generatedImagesPath));

// Ensure Runware upload directory exists
const RUNWARE_UPLOAD_DIR = path.join(__dirname, 'public', 'uploads', 'generated_images');
if (!fsSync.existsSync(RUNWARE_UPLOAD_DIR)) {
    try {
        fsSync.mkdirSync(RUNWARE_UPLOAD_DIR, { recursive: true });
        console.log(`Created Runware upload directory: ${RUNWARE_UPLOAD_DIR}`);
    } catch (err) {
        console.error(`Error creating Runware upload directory ${RUNWARE_UPLOAD_DIR}:`, err);
    }
}

// Qwen clients
const qwen = new OpenAI({
    apiKey: process.env.QWEN_API_KEY,
    baseURL: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
});
const qwenIntent = new OpenAI({
    apiKey: process.env.QWEN_API_KEY,
    baseURL: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
});

// Routes
app.use('/', routes);
app.use('/', authRoutes);
app.use('/payment', paymentRouter);
app.use('/generate', require('./routes/generate'));
app.use('/partials', require('./routes/partials'));
app.use('/api', apiRoutes);
// app.use('/webhook', stripeRouter); // Uncomment when needed

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

// API routes logging
app.use((req, res, next) => {
    console.log(`[Request] ${req.method} ${req.url} at ${new Date().toISOString()}`);
    next();
});

// Main app routes
// server.js (replace the existing app.get(['/', '/gallery', '/chat-history', '/files']) route)
app.get('/', async (req, res) => {
    try {
        console.log(`[Server] Rendering index.ejs for homepage`);
        res.render('index', {
            title: 'Pixzor',
            description: 'Create AI movies, images, and chat with Pixzor'
        });
    } catch (error) {
        console.error('[Server] Error rendering index.ejs:', error.stack);
        res.status(500).send('Internal Server Error');
    }
});



app.get('/chat-history', async (req, res) => {
    try {
        console.log(`[Server] Rendering chat_history.ejs for /chat-history`);
        if (!req.isAuthenticated()) {
            return res.render('partials/login_prompt', {
                layout: 'layouts/layout',
                title: 'Chat History - Pixzor',
                description: 'Log in to view your chat history on Pixzor',
                message: 'Please log in to view your chat history.'
            });
        }
        const chats = await ChatSession.findAll({
            where: { userId: req.user.id },
            order: [['updatedAt', 'DESC']],
            limit: 50
        });
        res.render('partials/chat_history', {
            layout: 'layouts/layout',
            title: 'Chat History - Pixzor',
            description: 'View your chat history on Pixzor',
            chats: chats.map(chat => ({
                id: chat.id,
                title: chat.title,
                timestamp: chat.updatedAt
            }))
        });
    } catch (error) {
        console.error('[Server] Error rendering chat_history.ejs:', error.stack);
        res.status(500).render('error', {
            layout: 'layouts/layout',
            title: 'Server Error',
            message: 'Failed to load chat history.',
            includeChat: false
        });
    }
});

app.get('/chat-history/:id', async (req, res) => {
    try {
        console.log(`[Server] Rendering chat_history.ejs for /chat-history/${req.params.id}`);
        if (!req.isAuthenticated()) {
            return res.render('partials/login_prompt', {
                layout: 'layouts/layout',
                title: 'Chat History - Pixzor',
                description: 'Log in to view your chat history on Pixzor',
                message: 'Please log in to view this chat.'
            });
        }
        const chat = await ChatSession.findOne({
            where: { id: req.params.id, userId: req.user.id }
        });
        if (!chat) {
            return res.status(404).render('error', {
                layout: 'layouts/layout',
                title: 'Chat Not Found',
                message: 'The requested chat could not be found.',
                includeChat: false
            });
        }
        let messages = [];
        if (chat.historyGcsUrl) {
            const downloadedHistory = await require('./utils/gcsUtils').downloadJsonFromGcs(chat.historyGcsUrl);
            if (downloadedHistory) {
                messages = downloadedHistory;
            }
        }
        res.render('partials/chat_history', {
            layout: 'layouts/layout',
            title: `Chat: ${chat.title} - Pixzor`,
            description: `View chat history: ${chat.title} on Pixzor`,
            chats: [{ id: chat.id, title: chat.title, timestamp: chat.updatedAt }],
            selectedChat: { id: chat.id, title: chat.title, messages }
        });
    } catch (error) {
        console.error('[Server] Error rendering chat_history.ejs:', error.stack);
        res.status(500).render('error', {
            layout: 'layouts/layout',
            title: 'Server Error',
            message: 'Failed to load chat.',
            includeChat: false
        });
    }
});

app.get('/files', async (req, res) => {
    try {
        console.log(`[Server] Rendering files.ejs for /files`);
        if (!req.isAuthenticated()) {
            return res.render('partials/login_prompt', {
                layout: 'layouts/layout',
                title: 'Files - Pixzor',
                description: 'Log in to view your files on Pixzor',
                message: 'Please log in to view your files.'
            });
        }
        const files = await GeneratedContent.findAll({
            where: { userId: req.user.id },
            order: [['createdAt', 'DESC']],
            limit: 50
        });
        res.render('partials/files', {
            layout: 'layouts/layout',
            title: 'Files - Pixzor',
            description: 'View your generated files on Pixzor',
            files: files.map(file => ({
                id: file.id,
                type: file.type,
                contentUrl: file.contentUrl,
                thumbnailUrl: file.thumbnailUrl || file.contentUrl,
                prompt: file.prompt,
                createdAt: file.createdAt
            }))
        });
    } catch (error) {
        console.error('[Server] Error rendering files.ejs:', error.stack);
        res.status(500).render('error', {
            layout: 'layouts/layout',
            title: 'Server Error',
            message: 'Failed to load files.',
            includeChat: false
        });
    }
});

// API user info
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

// Chat History routes
app.get('/api/library/chats', async (req, res) => {
    try {
        const userId = req.user ? req.user.id : null;
        console.log(`[API Chat History] Fetching chats for User ID: ${userId}, Session ID: ${req.sessionID}, Cookies:`, req.cookies);

        if (!userId || !req.isAuthenticated()) {
            console.log('[API Chat History] No authenticated user');
            return res.json({ items: [], message: 'Please log in to view your chat history.' });
        }

        const chats = await ChatSession.findAll({
            where: { userId },
            order: [['updatedAt', 'DESC']],
            limit: 50
        });

        console.log(`[API Chat History] Found ${chats.length} chats for User ID: ${userId}`);
        res.json({
            items: chats.map(chat => ({
                id: chat.id,
                title: chat.title,
                timestamp: chat.updatedAt
            }))
        });
    } catch (err) {
        console.error('[API Chat History] Error fetching chat history:', err.stack);
        res.status(500).json({ items: [], message: 'Error loading chat history.' });
    }
});



app.post('/api/add-generated-image', async (req, res) => {
    try {
        const token = req.headers.authorization?.split('Bearer ')[1];
        if (process.env.WEBSITE_API_TOKEN && token !== process.env.WEBSITE_API_TOKEN) {
            console.log('[API Add Image] Unauthorized access attempt', { token: token?.slice(0, 8) });
            return res.status(401).json({ success: false, error: 'Unauthorized' });
        }

        const {
            userId,
            contentUrl,
            prompt,
            modelUsed,
            modelId,
            width,
            height,
            apiResponseId,
            isPublic = true
        } = req.body;

        console.log('[API Add Image] Received payload:', {
            userId,
            contentUrl,
            prompt: prompt?.length > 50 ? prompt.substring(0, 50) + '...' : prompt,
            modelUsed,
            modelId,
            width,
            height,
            apiResponseId,
            isPublic
        });

        if (!userId || !contentUrl || !prompt) {
            console.log('[API Add Image] Missing required fields:', req.body);
            return res.status(400).json({ success: false, error: 'Missing required fields' });
        }

        const newContent = await GeneratedContent.create({
            userId,
            type: 'image',
            contentUrl,
            prompt,
            modelUsed,
            modelId,
            width,
            height,
            apiResponseId,
            isPublic,
            tokenCost: 1
        });

        console.log(`[API Add Image] Saved image record with ID: ${newContent.id}, isPublic: ${newContent.isPublic}`);
        return res.json({ success: true, imageId: newContent.id });
    } catch (error) {
        console.error('[API Add Image] Error:', {
            message: error.message,
            name: error.name,
            stack: error.stack,
            payload: {
                userId: req.body.userId,
                contentUrl: req.body.contentUrl,
                prompt: req.body.prompt?.length > 50 ? req.body.prompt.substring(0, 50) + '...' : req.body.prompt,
                isPublic: req.body.isPublic
            }
        });
        return res.status(500).json({ success: false, error: error.message || 'Failed to add image to database' });
    }
});

const { downloadJsonFromGcs } = require('./utils/gcsUtils');
app.get('/api/library/chats/:id', async (req, res) => {
    try {
        const userId = req.user ? req.user.id : null;
        const chatId = req.params.id;
        console.log(`[API Chat] Fetching chat ID: ${chatId} for User ID: ${userId}`);

        if (!userId || !req.isAuthenticated()) {
            console.log('[API Chat] No authenticated user');
            return res.status(401).json({ message: 'Please log in.' });
        }

        const chat = await ChatSession.findOne({ where: { id: chatId, userId } });
        if (!chat) {
            console.log(`[API Chat] Chat ID: ${chatId} not found for User ID: ${userId}`);
            return res.status(404).json({ message: 'Chat not found.' });
        }

        let messages = [];
        if (chat.historyGcsUrl) {
            console.log(`[API Chat] Found GCS URL: ${chat.historyGcsUrl}. Attempting download...`);
            const downloadedHistory = await downloadJsonFromGcs(chat.historyGcsUrl);
            if (downloadedHistory) {
                messages = downloadedHistory;
            } else {
                console.warn(`[API Chat] Failed to download or parse history from ${chat.historyGcsUrl} for chat ID ${chatId}`);
            }
        } else {
            console.log(`[API Chat] No GCS URL found for chat ID ${chatId}. Returning empty history.`);
        }

        res.json({ title: chat.title, messages });
    } catch (err) {
        console.error('[API Chat] Error fetching chat messages:', err.stack);
        res.status(500).json({ message: 'Error loading chat messages.' });
    }
});

app.delete('/api/library/chats/:chatId', async (req, res) => {
    const chatId = req.params.chatId;
    const userId = req.user ? req.user.id : null;
    console.log(`[API Chat History] DELETE request for chat ID: ${chatId} by User ID: ${userId}`);

    if (!userId || !req.isAuthenticated()) {
        console.log('[API Chat History] No authenticated user');
        return res.status(401).json({ message: 'Unauthorized' });
    }

    let transaction;
    try {
        transaction = await sequelize.transaction();

        const deletedMessagesCount = await ChatMessage.destroy({
            where: { chatSessionId: chatId },
            transaction
        });
        console.log(`[API Chat History] Deleted ${deletedMessagesCount} messages for chat ID: ${chatId}`);

        const deletedChatCount = await ChatSession.destroy({
            where: { id: chatId, userId },
            transaction
        });

        await transaction.commit();

        if (deletedChatCount > 0) {
            console.log(`[API Chat History] Successfully deleted chat ID: ${chatId}`);
            res.status(200).json({ message: 'Chat deleted successfully.' });
        } else {
            console.log(`[API Chat History] Chat ID: ${chatId} not found or user ${userId} not authorized`);
            res.status(404).json({ message: 'Chat not found or you do not have permission to delete it.' });
        }
    } catch (error) {
        console.error(`[API Chat History] Error deleting chat ID ${chatId}:`, error.stack);
        if (transaction) await transaction.rollback();
        res.status(500).json({ message: 'Failed to delete chat.' });
    }
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error('[Server] Error:', err.stack);
    if (req.path.startsWith('/api')) {
        // Return JSON for API routes
        if (err.code === 'EBADCSRFTOKEN') {
            return res.status(403).json({ success: false, error: 'Invalid CSRF token' });
        }
        return res.status(500).json({ success: false, error: err.message || 'Internal Server Error' });
    }
    // Render HTML for non-API routes
    if (err.code === 'EBADCSRFTOKEN') {
        res.status(403).send('Invalid CSRF token');
    } else {
        res.status(500).render('error', {
            layout: 'layouts/layout',
            title: 'Server Error',
            message: 'Something went wrong on the server.',
            includeChat: false
        });
    }
});

// Server startup
(async () => {
    try {
        await sequelize.authenticate();
        console.log('Database connection established successfully.');
        await sequelize.sync({ alter: false });
        console.log('[DB Sync] Database synced successfully with alter option.');

        const { startCleanupSchedule } = require('./utils/cleanupService');
        startCleanupSchedule();

        const server = app.listen(PORT, () => {
            console.log(`Server is running on port ${PORT}`);
        });

        const { initializeWebSocket } = require('./utils/websocketHandler');
        initializeWebSocket(server);
    } catch (err) {
        console.error('Database connection or sync failed:', err);
        process.exit(1);
    }
})();

// Export session middleware for WebSocket
module.exports.sessionMiddleware = sessionMiddleware;