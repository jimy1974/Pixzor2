const express = require('express');
const router = express.Router();
const { User, GeneratedContent, ImageComment, sequelize } = require('../db');
const { Op } = require('sequelize');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const fetch = require('cross-fetch');
const fs = require('fs').promises;
const path = require('path');


router.get('/', (req, res) => {
    const isSuccess = req.query.success === 'true';
    console.log('Rendering home, success:', isSuccess);
    res.render('index', { 
        title: 'Pixzor AI',
        description: 'Create AI movies, images, and chat with Pixzor',
        layout: 'layouts/layout',
        includeChat: true,
        requestPath: req.path
    });
});

// New FLUX image generation route
router.post('/api/generate-flux-image', express.json(), async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ error: 'Login required' });

    const { prompt } = req.body;
    const userId = req.user.id;

    if (!prompt) return res.status(400).json({ error: 'Prompt is required' });

    const tokenCost = 1.0;
    const modelName = 'flux-1-schnell-fp8';

    try {
        const user = await User.findByPk(userId);
        if (!user) return res.status(404).json({ error: 'User not found' });
        if (user.tokens < tokenCost) return res.status(400).json({ error: 'Not enough tokens' });

        console.log(`Calling Fireworks API for prompt: "${prompt}"`);
        const fireworksResponse = await fetch(
            'https://api.fireworks.ai/inference/v1/workflows/accounts/fireworks/models/flux-1-schnell-fp8/text_to_image',
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'image/jpeg',
                    'Authorization': `Bearer ${process.env.FIREWORKS_API_KEY}`,
                },
                body: JSON.stringify({
                    prompt,
                    width: 1024,
                    height: 1024,
                }),
            }
        );

        if (!fireworksResponse.ok) {
            const errorText = await fireworksResponse.text();
            console.error('Fireworks API Error:', fireworksResponse.status, errorText);
            throw new Error(`Fireworks API failed: ${fireworksResponse.status}`);
        }

        const imageBuffer = Buffer.from(await fireworksResponse.arrayBuffer());

        const userImageDir = path.join(__dirname, '..', 'public', 'images', 'generated', userId.toString());
        await fs.mkdir(userImageDir, { recursive: true });

        const filename = `${Date.now()}.jpg`;
        const imagePath = path.join(userImageDir, filename);
        await fs.writeFile(imagePath, imageBuffer);
        console.log(`Image saved to: ${imagePath}`);

        const imageUrl = `/images/generated/${userId}/${filename}`;

        user.tokens = parseFloat(user.tokens) - tokenCost;
        await user.save();

        await GeneratedContent.create({
            userId,
            type: 'image',
            contentUrl: imageUrl,
            prompt,
            model: modelName,
            tokenCost,
        });

        console.log(`Tokens deducted. User ${userId} remaining tokens: ${user.tokens}`);

        res.json({
            imageUrl,
            tokenCost,
            remainingTokens: user.tokens,
        });
    } catch (error) {
        console.error('Error during FLUX image generation:', error);
        res.status(500).json({ error: error.message || 'Failed to generate image' });
    }
});

// --- ADDED IMAGE DETAIL ROUTE HERE ---
router.get('/image/:id', async (req, res) => {
    try {
        const contentId = req.params.id;
        const userId = req.user ? req.user.id : null;

        // Ensure models are available (assuming they are from require('../db'))
        const item = await GeneratedContent.findOne({
            where: { 
                id: contentId,
                [Op.or]: [
                    { isPublic: true },
                    { userId: userId }
                ]
            },
            include: [
                { model: User, as: 'user', attributes: ['id', 'username', 'photo'] },
                { 
                    model: ImageComment, 
                    as: 'comments', 
                    include: [{ model: User, as: 'user', attributes: ['id', 'username', 'photo'] }],
                    order: [['createdAt', 'ASC']]
                } // Include comments and their users
            ]
        });

        if (!item) {
            console.log(`[Image Detail Page] Content not found or access denied for ID: ${contentId}, User: ${userId}`);
            return res.status(404).send('Content not found or access denied.'); 
        }
        
        console.log(`[Image Detail Page] Rendering page for content ID: ${contentId}`);

        // Render the detail page template - layout should be applied automatically
        res.render('image-detail', { 
            title: `Image: ${item.prompt.substring(0, 30)}...`, 
            item: item, 
            user: req.user, 
            contentId: item.id,
            includeChat: true,
            requestPath: req.path
        });

    } catch (error) {
        console.error(`Error rendering image detail page for ID ${req.params.id}:`, error);
        res.status(500).send('Error loading image details.'); 
    }
});

router.get('/partials/modals', (req, res) => {
    res.render('partials/modals', { layout: false });
});

router.get('/chat-tab/:tab', (req, res) => {
    const { tab } = req.params;
    const validTabs = ['chat', 'create-images', 'create-videos'];
    if (!validTabs.includes(tab)) {
        return res.status(404).send('Tab not found');
    }
    if (tab === 'chat') {
        res.render('partials/chat-tab', { layout: false });
    } else if (tab === 'create-images') {
        res.render('partials/create-images', { layout: false });
    } else if (tab === 'create-videos') {
        res.render('partials/create-videos', { layout: false });
    }
});

router.get('/user-data', (req, res) => {
    if (req.user) {
        res.json({ loggedIn: true, tokens: req.user.tokens || 0 });
    } else {
        res.json({ loggedIn: false, tokens: 0 });
    }
});

// Add express.json() middleware to /buy-tokens
router.post('/buy-tokens', express.json(), async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ error: 'Login required' });
    const { tokens, price } = req.body;
    const validBundles = {
        '300': 300,
        '500': 500,
        '1200': 1000
    };
    if (!validBundles[tokens] || validBundles[tokens] !== parseFloat(price) * 100) {
        return res.status(400).json({ error: 'Invalid token bundle or price mismatch' });
    }
    try {
        const session = await stripe.checkout.sessions.create({
            payment_method_types: ['card'],
            line_items: [{
                price_data: {
                    currency: 'gbp',
                    product_data: { name: `${tokens} Tokens` },
                    unit_amount: validBundles[tokens],
                },
                quantity: 1,
            }],
            mode: 'payment',
            success_url: `${process.env.APP_BASE_URL}/success`,
            cancel_url: `${process.env.APP_BASE_URL}/?canceled=true`,
            metadata: { userId: req.user.id, tokens },
        });
        res.json({ url: session.url });
    } catch (error) {
        console.error('Error creating checkout session:', error);
        res.status(500).json({ error: 'Failed to create checkout session' });
    }
});

router.get('/success', async (req, res) => {
    if (!req.isAuthenticated()) {
        console.log('Unauthenticated user redirected from /success to /');
        return res.redirect('/');
    }
    console.log('Payment success, redirecting to /?success=true for user:', req.user.id);
    res.redirect('/?success=true');
});

module.exports = router;