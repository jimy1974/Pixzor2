require('dotenv').config({ path: require('path').resolve(__dirname, '.env') });
const express = require('express');
const path = require('path');
const fs = require('fs').promises;
const expressLayouts = require('express-ejs-layouts');
const session = require('express-session');
const passport = require('passport');
const { WebSocketServer } = require('ws');
const { OpenAI } = require('openai');
const Together = require('together-ai');
const fetch = require('node-fetch');
const { Op } = require('sequelize');
const routes = require('./routes');
// --- Stripe Requirement ---
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const db = require('./db');
const { sequelize, User, GeneratedContent, ChatSession, ImageComment } = db;

const app = express();
const PORT = process.env.PORT || 80; // Changed to 80 for production server

// --- Stripe Webhook Handler ---
// IMPORTANT: Define this BEFORE express.json() or express.urlencoded() global middleware
// Also ensure STRIPE_WEBHOOK_SECRET is set in your .env file (use whsec_... from `stripe listen` for local testing)
app.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
    const sig = req.headers['stripe-signature'];
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

    console.log('[Webhook] Received event.');

    if (!webhookSecret) {
        console.error('[Webhook] Error: STRIPE_WEBHOOK_SECRET is not set.');
        return res.status(500).send('Webhook configuration error.');
    }
    
    if (!sig) {
        console.error('[Webhook] Error: Missing stripe-signature header.');
        return res.status(400).send('Missing signature header.');
    }

    // Safe logging for raw body
    if (req.body && req.body.length > 0) { // Check body exists and is not empty
        console.log(`[Webhook] Raw body length: ${req.body.length}`);
        // console.log('[Webhook] Raw body sample:', req.body.slice(0, 80).toString()); // Optional: log sample if needed
    } else {
        console.log('[Webhook] Raw body is missing or empty.');
        // Stripe should always send a body for webhooks it expects a response for
        return res.status(400).send('Missing or empty request body.');
    }

    let event;
    try {
        event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
        console.log('[Webhook] Event verified:', event.type, 'ID:', event.id);
    } catch (err) {
        console.error(`[Webhook] Signature verification failed: ${err.message}`);
        return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    // Handle the checkout.session.completed event
    if (event.type === 'checkout.session.completed') {
        const session = event.data.object;
        
        // --- IMPORTANT: Read data based on what /create-checkout-session sends ---
        // We send userId in client_reference_id and tokens in metadata.tokens_purchased
        const userIdString = session.client_reference_id;
        const tokensPurchasedString = session.metadata.tokens_purchased;
        // --- End of important section ---

        console.log('[Webhook] Processing checkout.session.completed:', { 
            sessionId: session.id, 
            client_reference_id: userIdString, 
            metadata_tokens_purchased: tokensPurchasedString,
            payment_status: session.payment_status // Should be 'paid'
        });

        // Validate payment status
        if (session.payment_status !== 'paid') {
             console.log(`[Webhook] Ignoring session ${session.id}, payment status is ${session.payment_status}`);
             return res.status(200).json({ received: true, message: 'Session not paid' });
        }

        // Validate data received
        if (!userIdString || !tokensPurchasedString) {
            console.error(`[Webhook] Error: Missing client_reference_id (${userIdString}) or metadata.tokens_purchased (${tokensPurchasedString}) in session ${session.id}`);
            return res.status(400).json({ error: 'Missing required session data.' });
        }
        
        const userId = parseInt(userIdString, 10);
        const tokensToAdd = parseInt(tokensPurchasedString, 10);

        if (isNaN(userId) || isNaN(tokensToAdd) || tokensToAdd <= 0) {
            console.error(`[Webhook] Error: Invalid userId (${userIdString} -> ${userId}) or tokensToAdd (${tokensPurchasedString} -> ${tokensToAdd}) in session ${session.id}`);
            return res.status(400).json({ error: 'Invalid user ID or token amount.' });
        }

        try {
            const user = await User.findByPk(userId);
            if (user) {
                const currentTokens = parseFloat(user.tokens) || 0; 
                const newTotal = currentTokens + tokensToAdd;
                await user.update({ tokens: newTotal });
                console.log(`[Webhook] SUCCESS: Added ${tokensToAdd} tokens to user ${userId}. New total: ${newTotal}.`);
                // Respond AFTER successful update
                return res.status(200).json({ received: true, message: 'Tokens updated.' }); 
            } else {
                console.error(`[Webhook] Error: User ${userId} not found for session ${session.id}`);
                // Respond with 404, but maybe shouldn't tell attacker user doesn't exist?
                // A 400 might be better, indicating bad input data (the userId)
                return res.status(400).json({ error: 'User not found.' }); 
            }
        } catch (dbError) {
            console.error(`[Webhook] DB Error updating tokens for user ${userId} (Session ${session.id}):`, dbError);
            // Don't send detailed error back. Maybe retry logic could be added?
            return res.status(500).json({ error: 'Failed to update tokens due to server error.' });
        }
    } else {
        // Handle other event types if needed
        console.log(`[Webhook] Received unhandled event type: ${event.type}`);
    }

    // Acknowledge receipt of the event if not already handled
    res.status(200).json({ received: true, message: 'Event received but not processed.'});
});
//--- END ORIGINAL WEBHOOK HANDLER --- 

// --- End Stripe Webhook Handler ---

// Qwen clients
const qwen = new OpenAI({
    apiKey: process.env.QWEN_API_KEY,
    baseURL: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
});
const qwenIntent = new OpenAI({
    apiKey: process.env.QWEN_API_KEY,
    baseURL: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
});
const together = new Together({ apiKey: process.env.TOGETHER_API_KEY });

// Middleware
app.use(express.static('public'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
    secret: process.env.SESSION_SECRET || 'your-secret',
    resave: false,
    saveUninitialized: false,
}));
app.use(passport.initialize());
app.use(passport.session());

// Static file serving
app.use('/images', express.static(path.join(__dirname, 'public', 'images')));
app.use('/videos', express.static(path.join(__dirname, 'public', 'videos')));
const generatedImagesPath = path.join(__dirname, 'public', 'images', 'generated');
fs.mkdir(generatedImagesPath, { recursive: true }).catch(console.error);
app.use('/images/generated', express.static(generatedImagesPath));

// View engine setup
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');
app.use(expressLayouts);
app.set('layout', 'layouts/layout');

// Routes
app.use('/', routes);

// --- Stripe Checkout Route ---

app.post('/create-checkout-session', async (req, res) => {
  if (!req.isAuthenticated()) {
    return res.status(401).json({ error: 'Please log in to purchase tokens.' });
  }

  const { tokens, price } = req.body;
  const userId = req.user.id; // Get logged-in user's ID

  console.log(`[Checkout] User ${userId} attempting purchase: ${tokens} tokens for £${price}`);

  // Basic validation for price (ensure it's a positive number string)
  const priceValue = parseFloat(price);
  if (isNaN(priceValue) || priceValue <= 0) {
    console.error(`[Checkout] Invalid price received: ${price}`);
    return res.status(400).json({ error: 'Invalid price format.' });
  }

  // Calculate amount in smallest currency unit (pence for GBP)
  // Multiply by 100 and ensure it's an integer
  const amountInPence = Math.round(priceValue * 100);

  // Validate amount is reasonable (optional, e.g., not zero)
  if (amountInPence <= 0) {
      console.error(`[Checkout] Calculated amount in pence is invalid: ${amountInPence}`);
      return res.status(400).json({ error: 'Invalid price amount.' });
  }
  
  // Validate tokens (optional, ensure it's a positive integer string)
  const tokensValue = parseInt(tokens, 10);
  if (isNaN(tokensValue) || tokensValue <= 0) {
      console.error(`[Checkout] Invalid tokens received: ${tokens}`);
      return res.status(400).json({ error: 'Invalid token amount.' });
  }

  // Use environment variable for base URL or default to localhost:80
  const YOUR_DOMAIN = process.env.APP_BASE_URL || 'http://47.236.4.206';
//  const YOUR_DOMAIN = process.env.APP_BASE_URL || 'http://localhost:80'; 

  try {
    // Create a Stripe Checkout Session using price_data
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [
        {
          // Provide the exact Price object: https://stripe.com/docs/api/checkout/sessions/create#create_checkout_session-line_items-price_data
          price_data: {
            currency: 'gbp', // Hardcoded GBP, change if needed
            product_data: {
              name: `${tokensValue} Tokens`, // Dynamic product name
            },
            unit_amount: amountInPence, // Amount in pence
          },
          quantity: 1,
        },
      ],
      mode: 'payment',
      // Use different URLs for success/cancel if needed, or handle logic there
      success_url: `${YOUR_DOMAIN}/payment/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${YOUR_DOMAIN}/payment/cancel`,
      client_reference_id: userId.toString(), // Pass user ID for webhook fulfillment
      metadata: { 
          tokens_purchased: tokensValue.toString() // Store how many tokens were bought
      }
    });

    console.log(`[Checkout] Stripe session created using price_data: ${session.id} for user ${userId}`);
    res.json({ sessionId: session.id });

  } catch (error) {
    console.error(`[Checkout] Stripe session creation failed for user ${userId}:`, error);
    // Provide a more generic error to the client potentially
    res.status(500).json({ error: 'Could not initiate payment session. Please try again later.' });
  }
});

// --- End Stripe Checkout Route ---

// --- Stripe Redirect Handlers ---

app.get('/payment/success', async (req, res) => {
    // Check if user is logged in - important for context
    if (!req.isAuthenticated()) {
        console.log('[Payment Success] Unauthenticated user hit success URL. Redirecting to login.');
        // Redirect to login or home page, maybe with a message
        // For now, just redirect home, but login might be better
        return res.redirect('/'); 
    }

    const sessionId = req.query.session_id;
    console.log(`[Payment Success] User ${req.user.id} returned from Stripe. Session ID: ${sessionId}`);

    // **IMPORTANT SECURITY NOTE:** 
    // Relying solely on the success URL isn't secure for fulfillment.
    // A user could bookmark or guess this URL.
    // Use Stripe Webhooks (checkout.session.completed event) to reliably 
    // verify payment and update tokens in your database.
    
    // For now, we just redirect the user to the homepage with a success indicator.
    // The actual token update should happen via the webhook handler.
    console.log(`[Payment Success] Redirecting user ${req.user.id} to /?payment=success`);
    res.redirect('/?payment=success'); // You can adjust the query param name
});

app.get('/payment/cancel', (req, res) => {
    // User clicked cancel on the Stripe page or payment failed
    console.log('[Payment Cancel] User returned after cancelling Stripe session.');
    
    // Optionally check req.isAuthenticated() if you want different behavior for logged-in users
    
    // Redirect back to the home page with a cancellation indicator
    res.redirect('/?payment=cancelled'); // You can adjust the query param name
});

// --- End Stripe Redirect Handlers ---


// Gallery routes
app.get('/gallery', (req, res) => {
    console.log('Gallery route hit');
    console.log('User:', req.user); // Log user info
    res.render('gallery', {
        title: 'Gallery',
        description: 'Browse AI generated content.',
        includeChat: false
    });
});

app.get('/api/gallery-content', async (req, res) => {
    console.log('Gallery API endpoint hit');
    try {
        const page = parseInt(req.query.page, 10) || 1;
        const limit = parseInt(req.query.limit, 10) || 15;
        const offset = (page - 1) * limit;

        // Build where clause to only show public content or user's own content
        const whereClause = {
            type: 'image',
            [Op.or]: [
                { isPublic: true },
                { userId: req.user ? req.user.id : null }
            ]
        };
	    console.log('User ID:', req.user ? req.user.id : null);
        console.log('Fetching gallery content with where clause:', whereClause);

        const { count, rows } = await GeneratedContent.findAndCountAll({
            where: whereClause,
            include: [{ model: User, as: 'user', attributes: ['id', 'username'] }],
            limit: limit,
            offset: offset,
            order: [['createdAt', 'DESC']],
        });

 console.log('DB Count:', count);
        console.log(`Found ${count} total images, returning ${rows.length} for current page`);

        const hasMore = offset + limit < count;

        const images = rows.map(item => ({
            id: item.id,
            imageUrl: item.contentUrl,
            thumbnailUrl: item.contentUrl,
            prompt: item.prompt,
            userId: item.userId,
            username: item.User ? item.User.username : 'Unknown',
            likes: 0,
            likedByUser: false,
            isPublic: item.isPublic,
            style: null,
            model: item.model
        }));

        res.json({ images, hasMore });

    
        } catch (error) {
            console.error("Error fetching gallery content:", error);
    	console.error("Error details:", error.message, error.stack);
            res.status(500).json({ error: "Failed to fetch gallery content." });
        }
    });
app.get('/api/content-details/:id', async (req, res) => {
    try {
        const contentId = req.params.id;
        
        // Build where clause to only allow access to public content or user's own content
        const whereClause = {
            id: contentId,
            [Op.or]: [
                { isPublic: true },
                { userId: req.user ? req.user.id : null }
            ]
        };

        const item = await GeneratedContent.findOne({
            where: whereClause,
            include: [{ model: User, as: 'user', attributes: ['id', 'username', 'photo'] }],
        });

        if (!item) {
            return res.status(404).json({ error: 'Content not found or access denied' });
        }

        // Log the fetched item to check the 'user' association
        console.log("[API Content Details] Found item:", JSON.stringify(item, null, 2)); 

        res.json({
            id: item.id,
            imageUrl: item.contentUrl,
            thumbnailUrl: item.contentUrl, // Assuming same for now
            prompt: item.prompt,
            userId: item.userId,
            // Corrected access using the alias 'user'
            username: item.user ? item.user.username : 'Unknown',
            userPhoto: item.user ? item.user.photo : null,
            model: item.model,
            // Placeholder values
            likes: 0, 
            isLiked: false,
            isOwner: (req.user && req.user.id === item.userId),
            isPublic: item.isPublic
        });

    } catch (error) {
        console.error(`Error fetching content details for ID ${req.params.id}:`, error);
        res.status(500).json({ error: 'Failed to fetch content details.' });
    }
});

// --- NEW: Comment Routes ---

// GET comments for a specific content ID
app.get('/api/content/:contentId/comments', async (req, res) => {
    const contentId = parseInt(req.params.contentId, 10);
    if (isNaN(contentId)) {
        return res.status(400).json({ error: 'Invalid content ID.' });
    }

    try {
        console.log(`[API Comments GET] Fetching comments for contentId: ${contentId}`);
        const comments = await ImageComment.findAll({
            where: { contentId: contentId },
            include: [{
                model: User,
                as: 'user',
                attributes: ['id', 'username', 'photo'] // Select user fields needed
            }],
            order: [['createdAt', 'ASC']] // Show oldest comments first
        });

        console.log(`[API Comments GET] Found ${comments.length} comments.`);
        
        // Map and filter out comments where user might be missing (robustness)
        const formattedComments = comments
            .filter(comment => comment.user) // Ensure user association loaded
            .map(comment => ({
                id: comment.id,
                text: comment.commentText,
                createdAt: comment.createdAt,
                user: {
                    id: comment.user.id,
                    username: comment.user.username,
                    photo: comment.user.photo
                }
            }));
            
        res.json(formattedComments);

    } catch (error) {
        console.error(`[API Comments GET] Error fetching comments for contentId ${contentId}:`, error);
        res.status(500).json({ error: 'Failed to fetch comments.' });
    }
});

// POST a new comment
app.post('/api/content/:contentId/comments', isAuthenticated, async (req, res) => {
    const contentId = parseInt(req.params.contentId, 10);
    const userId = req.user.id;
    const { commentText } = req.body;

    if (isNaN(contentId)) {
        return res.status(400).json({ error: 'Invalid content ID.' });
    }
    if (!commentText || typeof commentText !== 'string' || commentText.trim().length === 0) {
        return res.status(400).json({ error: 'Comment text cannot be empty.' });
    }

    try {
        console.log(`[API Comments POST] User ${userId} posting comment for contentId ${contentId}`);
        
        // Verify the content exists and is accessible (optional but good practice)
        const content = await GeneratedContent.findByPk(contentId);
        if (!content || (!content.isPublic && content.userId !== userId)) {
             return res.status(404).json({ error: 'Content not found or not accessible.' });
        }

        const newComment = await ImageComment.create({
            contentId: contentId,
            userId: userId,
            commentText: commentText.trim()
        });

        // Fetch the comment again with user details to return to frontend
        const commentWithUser = await ImageComment.findOne({
             where: { id: newComment.id },
             include: [{ model: User, as: 'user', attributes: ['id', 'username', 'photo'] }]
        });
        
        // ** Add check here **
        if (!commentWithUser || !commentWithUser.user) {
            console.error(`[API Comments POST] Failed to retrieve comment with user details after creation. Comment ID: ${newComment.id}`);
            // Send a generic error, or perhaps the basic comment data if acceptable
            return res.status(500).json({ error: 'Failed to process comment creation.' }); 
        }

        console.log(`[API Comments POST] Comment ${commentWithUser.id} created successfully.`);
        res.status(201).json({
            id: commentWithUser.id,
            text: commentWithUser.commentText,
            createdAt: commentWithUser.createdAt,
            user: {
                id: commentWithUser.user.id,
                username: commentWithUser.user.username,
                photo: commentWithUser.user.photo
            }
        });

    } catch (error) {
        console.error(`[API Comments POST] Error creating comment for contentId ${contentId} by user ${userId}:`, error);
        res.status(500).json({ error: 'Failed to post comment.' });
    }
});

// --- END: Comment Routes ---

// --- NEW: Delete Content Route ---
app.delete('/api/content/:contentId', isAuthenticated, async (req, res) => {
    const contentId = parseInt(req.params.contentId, 10);
    const userId = req.user.id;

    if (isNaN(contentId)) {
        return res.status(400).json({ error: 'Invalid content ID.' });
    }

    try {
        console.log(`[API DELETE] User ${userId} attempting to delete contentId ${contentId}`);
        const content = await GeneratedContent.findOne({
            where: { id: contentId, userId: userId } // Ensure user owns the content
        });

        if (!content) {
            console.log(`[API DELETE] Content ${contentId} not found or user ${userId} not authorized.`);
            return res.status(404).json({ error: 'Content not found or you do not have permission.' });
        }

        // Optional: Delete the associated file from storage (e.g., public/images/generated)
        if (content.contentUrl && content.contentUrl.startsWith('/images/generated/')) {
            const filename = path.basename(content.contentUrl);
            const filePath = path.join(__dirname, 'public', 'images', 'generated', filename);
            try {
                await fs.unlink(filePath);
                console.log(`[API DELETE] Deleted file: ${filePath}`);
            } catch (fileError) {
                // Log error but continue deletion from DB
                console.error(`[API DELETE] Error deleting file ${filePath}:`, fileError.code === 'ENOENT' ? 'File not found' : fileError.message);
            }
        }

        // Delete the database record (comments will cascade delete due to table constraint)
        await content.destroy();
        console.log(`[API DELETE] Deleted content ${contentId} from database.`);
        res.json({ message: 'Content deleted successfully.' });

    } catch (error) {
        console.error(`[API DELETE] Error deleting content ${contentId} by user ${userId}:`, error);
        res.status(500).json({ error: 'Failed to delete content.' });
    }
});

app.post('/api/content/:id/like', (req, res) => {
    console.log(`Like request for content ${req.params.id}`);
    res.status(501).json({ message: 'Like functionality not implemented yet.' });
});

// Route to serve the create-images partial
app.get('/partials/create-images', (req, res) => {
    res.render('partials/create-images', { layout: false }); // Render without the main layout
});

// Route to serve the chat-tab partial
app.get('/partials/chat-tab', (req, res) => {
    res.render('partials/chat-tab', { layout: false, user: req.user }); 
});

// Route to serve the gallery partial
app.get('/partials/gallery', (req, res) => {
    res.render('gallery', { layout: false }); // Render gallery.ejs without layout
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
        const user = await User.findByPk(id, { attributes: ['id', 'username', 'email', 'googleId', 'tokens', 'photo'] });
        done(null, user);
    } catch (err) {
        done(err, null);
    }
});

// Google OAuth
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const appBaseUrl = process.env.APP_BASE_URL || 'http://47.236.4.206';
const googleRedirectUri = process.env.GOOGLE_REDIRECT_URI || `${appBaseUrl}/auth/google/callback`;

passport.use(new GoogleStrategy({
    clientID: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL: googleRedirectUri,
}, async (accessToken, refreshToken, profile, done) => {
    try {
        let user = await User.findOne({ where: { googleId: profile.id } });
        if (!user) {
            const existingEmailUser = await User.findOne({ where: { email: profile.emails[0].value } });
            if (existingEmailUser) {
                existingEmailUser.googleId = profile.id;
                await existingEmailUser.save();
                user = existingEmailUser;
            } else {
                user = await User.create({
                    googleId: profile.id,
                    tokens: 50,
                    username: profile.displayName || `User${Date.now()}`,
                    email: profile.emails[0].value,
                    photo: profile.photos[0] ? profile.photos[0].value : null,
                });
            }
        }
        return done(null, user);
    } catch (err) {
        console.error('Error in Google strategy:', err);
        return done(err, null);
    }
}));

// Auth routes
app.get('/auth/google', passport.authenticate('google', { scope: ['profile', 'email'] }));
app.get('/auth/google/callback', 
    passport.authenticate('google', { failureRedirect: '/' }),
    (req, res) => res.redirect('/')
);
app.get('/logout', (req, res, next) => {
    req.logout((err) => {
        if (err) return next(err);
        res.redirect('/');
    });
});

// API routes
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

app.get('/api/library/chats/:id', async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: 'Please log in.' });
    const chatId = req.params.id;
    try {
        const chat = await ChatSession.findOne({ where: { id: chatId, userId: req.user.id } });
        if (!chat) return res.status(404).json({ message: 'Chat not found.' });
        const filePath = path.join(__dirname, 'chats', `user_${req.user.id}`, `chat_${chatId}.json`);
        const messages = await fs.readFile(filePath, 'utf8').then(data => JSON.parse(data)).catch(() => []);
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
                chatSessionId: chatId, // Assuming ChatMessage links via chatSessionId
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
            // await transaction.rollback(); // Not needed if only deletes are involved and the second failed
            res.status(404).json({ message: 'Chat not found or you do not have permission to delete it.' });
        }

    } catch (error) {
        console.error(`[API] Error deleting chat ID ${chatId}:`, error);
        // Rollback the transaction in case of error
        if (transaction) await transaction.rollback();
        res.status(500).json({ message: 'Failed to delete chat.' });
    }
});

// Helper middleware to ensure user is authenticated
function isAuthenticated(req, res, next) {
    if (req.isAuthenticated()) {
        return next();
    }
    console.log('[Auth] User not authenticated for API request:', req.path);
    res.status(401).json({ message: 'Authentication required.' });
}

// Near the top of server.js
const { Storage } = require('@google-cloud/storage');
const storage = new Storage();
const bucketName = process.env.BUCKET_NAME || 'pixzor-images-2025';
const bucket = storage.bucket(bucketName);

async function saveImage(imageBuffer, fileName, userId, chatId = null) {
  try {
    if (process.env.GOOGLE_APPLICATION_CREDENTIALS || process.env.NODE_ENV === 'production') {
      const filePath = `images/generated/${fileName}`;
      const file = bucket.file(filePath);
      await file.save(imageBuffer, {
        contentType: 'image/jpeg',
        metadata: { metadata: { userId, chatId } }, // Optional metadata
      });
      await file.makePublic(); // Public access for simplicity
      return `https://storage.googleapis.com/${bucketName}/${filePath}`;
    }
    const localPath = path.join(__dirname, 'public/images/generated', fileName);
    await fs.mkdir(path.dirname(localPath), { recursive: true });
    await fs.writeFile(localPath, imageBuffer);
    return `/images/generated/${fileName}`;
  } catch (error) {
    console.error('Error saving image:', error);
    throw error;
  }
}

// ... (other unchanged parts like middleware, routes)

// Updated /api/generate-image
app.post('/api/generate-image', async (req, res) => {
  console.log("[/api/generate-image] Endpoint hit");
  if (!req.user) {
    console.log("[/api/generate-image] Auth failed");
    return res.status(401).json({ error: 'Authentication required.' });
  }

  const { prompt, aspectRatio } = req.body;
  if (!prompt) {
    console.log("[/api/generate-image] Bad request: Missing prompt");
    return res.status(400).json({ error: 'Prompt is required.' });
  }

  const validRatios = ['1:1', '16:9', '9:16'];
  if (aspectRatio && !validRatios.includes(aspectRatio)) {
    console.log("[/api/generate-image] Bad request: Invalid aspect ratio", aspectRatio);
    return res.status(400).json({ error: 'Invalid aspect ratio provided.' });
  }

  console.log(`[/api/generate-image] User ${req.user.id} requested image with prompt: "${prompt}"${aspectRatio ? ", Aspect Ratio: " + aspectRatio : ''}`);

  try {
    let width = 1024;
    let height = 1024;
    if (aspectRatio === '16:9') {
      width = 1024;
      height = 576;
    } else if (aspectRatio === '9:16') {
      width = 576;
      height = 1024;
    }
    console.log(`[/api/generate-image] Using dimensions: ${width}x${height}`);

    console.log("[/api/generate-image] Calling Together AI image creation...");
    const apiParams = {
      prompt: prompt,
      model: 'black-forest-labs/FLUX.1-schnell-Free',
      n: 1,
      steps: 4,
      width: width,
      height: height
    };

    const response = await together.images.create(apiParams);
    const imageUrl = response.data[0]?.url;
    console.log("[/api/generate-image] Generation returned URL:", imageUrl);

    if (!imageUrl) {
      throw new Error('Image generation failed, no URL returned.');
    }

    console.log("[/api/generate-image] Downloading image from URL:", imageUrl);
    const fetchResponse = await fetch(imageUrl);
    if (!fetchResponse.ok) {
      throw new Error(`Failed to download image: ${fetchResponse.statusText}`);
    }
    const imageBuffer = await fetchResponse.buffer();

    const imageFileName = `generated-${req.user.id}-${Date.now()}.jpg`;
    const publicImageUrl = await saveImage(imageBuffer, imageFileName, req.user.id);

    console.log("[/api/generate-image] Image saved to:", publicImageUrl);

    console.log("[/api/generate-image] Saving to DB...");
    const savedContent = await GeneratedContent.create({
      userId: req.user.id,
      prompt: prompt,
      type: 'image',
      contentUrl: publicImageUrl,
      model: 'black-forest-labs/FLUX.1-schnell-Free',
      isPublic: false,
      aspectRatio: aspectRatio || '1:1',
      tokenCost: 1.00
    });
    console.log("[/api/generate-image] Saved content ID:", savedContent.id);

    res.json({
      imageUrl: publicImageUrl,
      prompt: prompt,
      contentId: savedContent.id
    });
  } catch (error) {
    console.error("[/api/generate-image] Error during image generation:", error);
    res.status(500).json({ error: 'Failed to generate image.' });
  }
});


// Server startup
(async () => {
    try {
        await sequelize.authenticate();
        console.log('Database connection established successfully.');
        await sequelize.sync({ force: false });
        console.log('Database synced.');

        const chatsDir = path.join(__dirname, 'chats');
        await fs.mkdir(chatsDir, { recursive: true });

        const server = app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
        const wss = new WebSocketServer({ server });

        const decisionTree = {
            "root": {
                "id": "root",
                "instruction": `
                    You are Pixzor, an AI assistant. Respond naturally and concisely to the user's message. I can create images and videos on request—don't offer these services unless the user asks explicitly (e.g., "create an image" or "what can you do?"). If the user asks about services or image/video generation, include '#services'. Do not include '#chatTitle'—title is handled separately.
                `,
                "children": {
                    "services": {
                        "id": "services",
                        "instruction": `
                            I can assist with:
                            - #createImage: [prompt] - Generate an image based on the user's exact description.
                            - #createVideo: [prompt] - Generate a video (not yet implemented).
                            - #enhanceImage: [prompt] - Enhance an image (not yet implemented).
                            - #styleImage: [prompt] - Style an image (not yet implemented).
                            Respond naturally to the user's request. If they ask for an image, use #createImage followed by their full description in square brackets (e.g., "#createImage: A young girl riding a horse in a meadow"). Do not truncate or omit the prompt.
                        `,
                        "children": {}
                    }
                }
            }
        };

        // In wss.on('connection', ...)
        wss.on('connection', (ws, req) => {
          console.log('WebSocket client connected');
          let currentChatId = null;
          let currentNode = decisionTree.root;
          let currentTitle = 'New Chat';

          ws.on('message', async (message) => {
            try {
              const data = JSON.parse(message);
              if (data.type !== 'chat') return;

              const userMessage = data.message;
              const user = req.user || { id: 1 };

              const { intent, title } = await detectIntentAndTitle(userMessage);

              const userDir = path.join(chatsDir, `user_${user.id}`);
              await fs.mkdir(userDir, { recursive: true });
              let messages = [];
              let filePath = null;

              if (!currentChatId) {
                const chat = await ChatSession.create({ userId: user.id, title });
                currentChatId = chat.id;
                currentTitle = title;
                filePath = path.join(userDir, `chat_${currentChatId}.json`);
                messages = [{ role: 'user', content: userMessage }];
                await fs.writeFile(filePath, JSON.stringify(messages));
              } else {
                filePath = path.join(userDir, `chat_${currentChatId}.json`);
                messages = JSON.parse(await fs.readFile(filePath, 'utf8'));
                messages.push({ role: 'user', content: userMessage });
                if (title !== currentTitle) {
                  await ChatSession.update(
                    { title: title.substring(0, 50) },
                    { where: { id: currentChatId } }
                  );
                  currentTitle = title;
                  ws.send(JSON.stringify({ type: 'SetTitle', chatId: currentChatId, newTitle: title }));
                }
                await fs.writeFile(filePath, JSON.stringify(messages));
              }

              let conversationHistory = [
                { role: 'system', content: currentNode.instruction },
                ...messages.map(msg => ({
                  role: msg.role === 'bot' ? 'assistant' : msg.role,
                  content: msg.content
                }))
              ];

              if (intent === 'image_request') {
                currentNode = decisionTree.root.children.services;
                conversationHistory[0].content = currentNode.instruction;
              }

              const stream = await qwen.chat.completions.create({
                model: 'qwen-plus',
                messages: conversationHistory,
                max_tokens: 500,
                temperature: 0.5,
                stream: true,
              });

              let botResponse = '';
              let visibleResponse = '';
              for await (const chunk of stream) {
                const content = chunk.choices[0].delta.content;
                if (content) {
                  botResponse += content;
                  if (!content.match(/^#\w+:/)) {
                    visibleResponse += content;
                    ws.send(JSON.stringify({ type: 'chatChunk', data: content, chatId: currentChatId }));
                  }
                }
              }

              const commands = extractCommands(botResponse);
              for (const { command, data: commandData } of commands) {
                switch (command) {
                  case 'services':
                    currentNode = traverseDecisionTree(decisionTree.root, 'services');
                    await processNodeInstruction(ws, currentNode, messages, filePath, user);
                    break;
                  case 'createImage':
                    const imageResponse = await together.images.create({
                      model: 'black-forest-labs/FLUX.1-schnell-Free',
                      prompt: commandData,
                      steps: 4,
                      n: 1,
                    });

                    if (!imageResponse.data || !imageResponse.data[0].url) {
                      throw new Error('No image URL returned from Together AI');
                    }

                    const imageUrl = imageResponse.data[0].url;
                    const fetchResponse = await fetch(imageUrl);
                    if (!fetchResponse.ok) throw new Error(`Fetch failed: ${fetchResponse.statusText}`);
                    const imageBuffer = await fetchResponse.buffer();

                    const imageFileName = `generated-${currentChatId}-${Date.now()}.jpg`;
                    const publicImageUrl = await saveImage(imageBuffer, imageFileName, user.id, currentChatId);

                    ws.send(JSON.stringify({
                      type: 'chatChunk',
                      data: `Here is your image: <img src="${publicImageUrl}" class="thumbnail" />`,
                      chatId: currentChatId
                    }));
                    ws.send(JSON.stringify({ type: 'chatEnd', image: publicImageUrl, chatId: currentChatId }));
                    messages.push({ role: 'assistant', content: `Image created: ${publicImageUrl}` });
                    await fs.writeFile(filePath, JSON.stringify(messages));
                    await GeneratedContent.create({
                      userId: user.id,
                      type: 'image',
                      contentUrl: publicImageUrl,
                      prompt: commandData,
                      tokenCost: 1.00
                    });
                    break;
                  // ... (other cases unchanged)
                }
              }

              if (!commands.some(cmd => cmd.command === 'services')) {
                ws.send(JSON.stringify({ type: 'chatEnd', chatId: currentChatId }));
              }
              messages.push({ role: 'assistant', content: visibleResponse });
              await fs.writeFile(filePath, JSON.stringify(messages));
            } catch (error) {
              console.error('Error processing WebSocket message:', error);
              ws.send(JSON.stringify({ type: 'chatChunk', data: 'Sorry, something went wrong.', chatId: currentChatId }));
              ws.send(JSON.stringify({ type: 'chatEnd', chatId: currentChatId }));
            }
          });

          ws.on('close', () => {
            console.log('WebSocket client disconnected');
            currentChatId = null;
          });
        });

    } catch (err) {
        console.error('Database connection or sync failed:', err);
        process.exit(1);
    }
})();

// Helper functions
async function processNodeInstruction(ws, node, messages, filePath, user) {
    messages.push({ role: 'system', content: node.instruction });
    await fs.writeFile(filePath, JSON.stringify(messages));

    const instructionStream = await qwen.chat.completions.create({
        model: 'qwen-plus',
        messages: messages.map(msg => ({
            role: msg.role === 'bot' ? 'assistant' : msg.role,
            content: msg.content
        })),
        max_tokens: 500,
        stream: true,
    });

    let visibleInstructionResponse = '';
    let botResponse = '';
    for await (const chunk of instructionStream) {
        const content = chunk.choices[0].delta.content;
        if (content) {
            botResponse += content;
            if (!content.match(/^#\w+:/)) {
                visibleInstructionResponse += content;
                ws.send(JSON.stringify({ type: 'chatChunk', data: content, chatId: messages[messages.length - 1].chatId }));
            }
        }
    }

    const commands = extractCommands(botResponse);
    for (const { command, data: commandData } of commands) {
        switch (command) {
            case 'createImage':
                const imageResponse = await together.images.create({
                    model: 'black-forest-labs/FLUX.1-schnell-Free',
                    prompt: commandData,
                    steps: 4,
                    n: 1,
                });

                if (!imageResponse.data || !imageResponse.data[0].url) {
                    throw new Error('No image URL returned from Together AI');
                }

                const imageUrl = imageResponse.data[0].url;
                const fetchResponse = await fetch(imageUrl);
                if (!fetchResponse.ok) throw new Error(`Fetch failed: ${fetchResponse.statusText}`);
                const imageBuffer = await fetchResponse.buffer();

                const imageFileName = `generated-${messages[messages.length - 1].chatId}-${Date.now()}.jpg`;
                const imagePath = path.join(generatedImagesPath, imageFileName);
                await fs.writeFile(imagePath, imageBuffer);

                const publicImageUrl = `/images/generated/${imageFileName}`;
                ws.send(JSON.stringify({
                    type: 'chatChunk',
                    data: `Here is your image: <img src="${publicImageUrl}" class="thumbnail" />`,
                    chatId: messages[messages.length - 1].chatId
                }));
                ws.send(JSON.stringify({ type: 'chatEnd', image: publicImageUrl, chatId: messages[messages.length - 1].chatId }));
                messages.push({ role: 'assistant', content: `Image created: ${publicImageUrl}` });
                await fs.writeFile(filePath, JSON.stringify(messages));
                await GeneratedContent.create({
                    userId: user.id,
                    type: 'image',
                    contentUrl: publicImageUrl,
                    prompt: commandData,
                    tokenCost: 1.00
                });
                break;
            case 'createVideo':
            case 'enhanceImage':
            case 'styleImage':
                ws.send(JSON.stringify({
                    type: 'chatChunk',
                    data: `${command} is not yet implemented. Prompt: ${commandData}`,
                    chatId: messages[messages.length - 1].chatId
                }));
                ws.send(JSON.stringify({ type: 'chatEnd', chatId: messages[messages.length - 1].chatId }));
                messages.push({ role: 'assistant', content: `${command} prompt: ${commandData}` });
                await fs.writeFile(filePath, JSON.stringify(messages));
                break;
        }
    }

    if (!commands.length) {
        ws.send(JSON.stringify({ type: 'chatEnd', chatId: messages[messages.length - 1].chatId }));
    }
    messages.push({ role: 'assistant', content: visibleInstructionResponse });
    await fs.writeFile(filePath, JSON.stringify(messages));
}

function extractCommands(message) {
    const commandPattern = /#(\w+):?\s*([^\n#]*)/gm;
    const commands = [];
    let match;
    while ((match = commandPattern.exec(message)) !== null) {
        commands.push({ command: match[1], data: match[2].trim() });
    }
    return commands;
}

function traverseDecisionTree(currentNode, command) {
    return currentNode.children && currentNode.children[command] ? currentNode.children[command] : null;
}