const express = require('express');
const router = express.Router();
const { User, GeneratedContent, ImageComment, sequelize } = require('../db');
const { Op } = require('sequelize');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const fetch = require('cross-fetch'); 
const fs = require('fs').promises;
const path = require('path');
const multer = require('multer'); 
const sharp = require('sharp');   

// --- Multer Configuration ---
const storage = multer.memoryStorage(); 
const upload = multer({
    storage: storage,
    limits: { fileSize: 10 * 1024 * 1024 }, 
    fileFilter: (req, file, cb) => {
        if (file.mimetype === 'image/jpeg' || file.mimetype === 'image/png') {
            cb(null, true);
        } else {
            cb(new Error('Invalid file type. Only JPEG and PNG are allowed.'), false);
        }
    }
});

// --- Define Upload Directory ---
const TEMP_UPLOAD_DIR = path.join(__dirname, '..', 'public', 'uploads', 'temp');
fs.mkdir(TEMP_UPLOAD_DIR, { recursive: true }).catch(console.error); 

// --- NEW: Image Upload Route ---
router.post('/api/upload-image', upload.single('image'), async (req, res) => {
    if (!req.isAuthenticated()) {
        console.log('Upload error: User not authenticated');
        return res.status(401).json({ error: 'Login required to upload images.' });
    }
    if (!req.file) {
        console.log('Upload error: No image file provided');
        return res.status(400).json({ error: 'No image file uploaded.' });
    }

    const imageBuffer = req.file.buffer;
    console.log(`Received image for upload, size: ${req.file.size} bytes`);

    try {
        const metadata = await sharp(imageBuffer).metadata();
        console.log(`Uploaded image metadata: ${metadata.width}x${metadata.height}, format: ${metadata.format}`);

        const aspectRatio = metadata.width / metadata.height;
        const maxDimension = 1024; 
        let targetWidth, targetHeight;

        if (metadata.width > metadata.height) {
            targetWidth = Math.min(maxDimension, metadata.width); 
            targetHeight = Math.round(targetWidth / aspectRatio);
        } else {
            targetHeight = Math.min(maxDimension, metadata.height); 
            targetWidth = Math.round(targetHeight * aspectRatio);
        }

        targetWidth = Math.round(targetWidth / 16) * 16;
        targetHeight = Math.round(targetHeight / 16) * 16;

        targetWidth = Math.max(16, targetWidth);
        targetHeight = Math.max(16, targetHeight);

        console.log(`Resizing uploaded image to: ${targetWidth}x${targetHeight}`);

        const resizedImageBuffer = await sharp(imageBuffer, { failOnError: false })
            .resize({
                width: targetWidth,
                height: targetHeight,
                fit: 'contain', 
                position: 'center',
                background: { r: 255, g: 255, b: 255, alpha: 1 } 
            })
            .png() 
            .toBuffer();

        const filename = `${req.user.id}-${Date.now()}-${Math.random().toString(36).substring(2, 8)}.png`;
        const tempFilePath = path.join(TEMP_UPLOAD_DIR, filename);
        await fs.writeFile(tempFilePath, resizedImageBuffer);
        const tempImageUrl = `/uploads/temp/${filename}`; 
        console.log(`Temporary image saved locally: ${tempFilePath}, URL: ${tempImageUrl}`);

        const deletionTimeout = 15 * 60 * 1000;
        setTimeout(async () => {
            try {
                await fs.unlink(tempFilePath);
                console.log(`Deleted temporary image: ${tempFilePath}`);
            } catch (error) {
                if (error.code !== 'ENOENT') {
                    console.warn(`Failed to delete temporary image ${tempFilePath}: ${error.message}`);
                }
            }
        }, deletionTimeout);

        res.json({ url: tempImageUrl, width: targetWidth, height: targetHeight });

    } catch (error) {
        console.error('Image upload processing error:', error);
        if (error.message.includes('Invalid file type')) {
             return res.status(400).json({ error: error.message });
        }
        res.status(500).json({ error: 'Failed to process uploaded image.', details: error.message });
    }
});

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

// --- NEW: Together AI Image Generation Route ---
router.post('/api/generate-image', express.json(), async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ error: 'Login required' });

    const {
        prompt,
        aspectRatio, // e.g., "1:1", "16:9"
        model: modelName, // e.g., "FLUX.1 Depth"
        imageUrl, // Optional: URL from /api/upload-image
        imageWidth, // Optional: Width from /api/upload-image
        imageHeight, // Optional: Height from /api/upload-image
        strength // Optional: Strength value (0-1)
    } = req.body;
    const userId = req.user.id;

    if (!prompt) return res.status(400).json({ error: 'Prompt is required' });
    if (!modelName) return res.status(400).json({ error: 'Model selection is required' });

    // --- Model Mapping & Cost ---
    const modelMap = {
        'FLUX.1 Schnell': { id: 'black-forest-labs/FLUX.1-schnell', cost: 1, control: null, minSize: true },
        'FLUX Dev': { id: 'black-forest-labs/FLUX.1-dev', cost: 10, control: null, minSize: true },
        'FLUX.1.1-pro': { id: 'black-forest-labs/FLUX.1.1-pro', cost: 10, control: null, minSize: true },
        'FLUX.1 Canny': { id: 'black-forest-labs/FLUX.1-canny', cost: 10, control: 'canny', minSize: false },
        'FLUX.1 Depth': { id: 'black-forest-labs/FLUX.1-depth', cost: 10, control: 'depth', minSize: false },
        'FLUX.1 Redux': { id: 'black-forest-labs/FLUX.1-redux', cost: 10, control: 'redux', minSize: false }
    };

    const selectedModel = modelMap[modelName];
    if (!selectedModel) return res.status(400).json({ error: 'Invalid model selected' });

    const tokenCost = selectedModel.cost;
    const togetherModelId = selectedModel.id;
    const controlType = selectedModel.control;
    const isImageToImage = !!controlType;
    const useMinSize = !!selectedModel.minSize;

    // --- Input Validation for Img2Img ---
    if (isImageToImage && !['FLUX.1 Schnell', 'FLUX.1.1-pro', 'FLUX Dev'].includes(modelName)) {
        if (!imageUrl || !imageWidth || !imageHeight) {
            return res.status(400).json({ error: 'Image URL and dimensions are required for this model.' });
        }
        if (isNaN(parseFloat(strength)) || strength < 0 || strength > 1) {
             console.warn(`Invalid strength received: ${strength}. Using default 0.85`);
             strength = 0.85; // Default strength if invalid
        }
    } else if (imageUrl) {
        console.warn('Image provided but model does not support image input. Ignoring image.');
        // Clear img2img variables if not applicable
        imageUrl = null;
        imageWidth = null;
        imageHeight = null;
        strength = null;
    }

    // --- Aspect Ratio to Width/Height ---
    // Assuming base 1024x1024, adjust based on ratio
    let outputWidth, outputHeight;
    if (useMinSize) {
        // Low-res for FLUX.1 Schnell and FLUX.1.1-pro
        if (aspectRatio === '1:1') {
            outputWidth = 512;
            outputHeight = 512;
        } else if (aspectRatio === '16:9') {
            outputWidth = 656;
            outputHeight = 368;
        } else if (aspectRatio === '9:16') {
            outputWidth = 368;
            outputHeight = 656;
        } else {
            outputWidth = 512;
            outputHeight = 512;
        }
        // Ensure multiples of 16
        outputWidth = Math.floor(outputWidth / 16) * 16;
        outputHeight = Math.floor(outputHeight / 16) * 16;
        outputWidth = Math.max(16, outputWidth);
        outputHeight = Math.max(16, outputHeight);
    } else {
        outputWidth = 1024;
        outputHeight = 1024;
        if (aspectRatio && aspectRatio !== '1:1') {
            const [ratioW, ratioH] = aspectRatio.split(':').map(Number);
            if (ratioW > ratioH) {
                outputHeight = Math.round(outputWidth * (ratioH / ratioW));
            } else if (ratioH > ratioW) {
                outputWidth = Math.round(outputHeight * (ratioW / ratioH));
            }
            outputWidth = Math.round(outputWidth / 16) * 16;
            outputHeight = Math.round(outputHeight / 16) * 16;
            outputWidth = Math.max(16, outputWidth);
            outputHeight = Math.max(16, outputHeight);
        }
    }
    console.log(`Output dimensions set to: ${outputWidth}x${outputHeight}`);

    try {
        const user = await User.findByPk(userId);
        if (!user) return res.status(404).json({ error: 'User not found' });
        if (user.tokens < tokenCost) return res.status(402).json({ error: 'Not enough tokens' }); // 402 Payment Required

        // --- Prepare Together AI Payload ---
        const payload = {
            model: togetherModelId,
            prompt: prompt,
            n: 1, // Generate 1 image
            steps: 12, // Together AI only allows 1-12 steps
            cfg_scale: isImageToImage ? 3.5 : 4.5, // Adjust cfg_scale for img2img
            width: outputWidth,
            height: outputHeight,
            seed: Math.floor(Math.random() * 1000000), // Random seed
        };

        if (isImageToImage) {
            payload.control_type = controlType;
            payload.control_strength = 0.7; // Default control strength, can be adjusted
            payload.strength = parseFloat(strength); // Image-to-image strength
            // Construct absolute URL for the image_url if it's relative
            const absoluteImageUrl = imageUrl.startsWith('http') ? imageUrl : `${process.env.APP_BASE_URL}${imageUrl}`;
            payload.image_url = absoluteImageUrl;
             console.log(`Using image for generation: ${payload.image_url}, strength: ${payload.strength}, control: ${payload.control_type}`);
        }

        console.log(`Calling Together AI API (${togetherModelId}) for user ${userId}...`);
        console.log('Payload:', JSON.stringify(payload, null, 2));
        // --- Call Together AI API with retry if reference image fails ---
        let togetherResponse, togetherResult, togetherError;
        for (let attempt = 1; attempt <= 3; attempt++) {
            togetherResponse = await fetch(
                'https://api.together.xyz/v1/images/generations',
                {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${process.env.TOGETHER_API_KEY}`,
                        'User-Agent': 'PixzorApp/1.0'
                    },
                    body: JSON.stringify(payload),
                }
            );
            if (togetherResponse.ok) {
                togetherResult = await togetherResponse.json();
                if (!togetherResult.error || !togetherResult.error.message.includes('invalid reference image')) {
                    break;
                } else {
                    togetherError = togetherResult.error.message;
                }
            } else {
                togetherError = await togetherResponse.text();
                try { togetherError = JSON.parse(togetherError); } catch (e) {}
                if (typeof togetherError === 'object' && togetherError?.error?.message && togetherError.error.message.includes('invalid reference image')) {
                    // retry
                } else {
                    break;
                }
            }
            if (attempt < 3) {
                console.warn(`Attempt ${attempt} failed: invalid reference image. Retrying in 5s...`);
                await new Promise(resolve => setTimeout(resolve, 5000));
            }
        }
        if (!togetherResponse.ok || (togetherResult && togetherResult.error)) {
            let userMessage = `Together AI API failed: ${togetherResponse.status}`;
            if (togetherResult && togetherResult.error && togetherResult.error.message) {
                userMessage = `API Error: ${togetherResult.error.message}`;
            } else if (typeof togetherError === 'string') {
                userMessage = togetherError;
            }
            throw new Error(userMessage);
        }
        const result = togetherResult || await togetherResponse.json();
        console.log('Together AI API Success:', result);

        if (!togetherResponse.ok) {
            let errorDetails = await togetherResponse.text();
            try { errorDetails = JSON.parse(errorDetails); } catch (e) { /* Keep as text if not JSON */ }
            console.error('Together AI API Error:', togetherResponse.status, errorDetails);
            // Provide a more specific error if possible
            let userMessage = `Together AI API failed: ${togetherResponse.status}`;
            if (typeof errorDetails === 'object' && errorDetails?.error?.message) {
                 userMessage = `API Error: ${errorDetails.error.message}`;
                 // Handle specific known errors, like invalid reference image
                 if (errorDetails.error.message.includes('invalid reference image')) {
                     userMessage = 'Error: The reference image could not be processed. Please try a different image or check its format/URL.';
                 }
            } else if (typeof errorDetails === 'string' && errorDetails.includes('invalid reference image')) {
                 userMessage = 'Error: The reference image could not be processed. Please try a different image or check its format/URL.';
            }
            throw new Error(userMessage);
        }

        const result = await togetherResponse.json();
        console.log('Together AI API Success:', result);

        if (!result.data || result.data.length === 0 || !result.data[0].url) {
             throw new Error('Together AI response did not contain a valid image URL.');
        }

        const generatedImageUrl = result.data[0].url;

        // --- Download the generated image ---
        console.log(`Downloading generated image from: ${generatedImageUrl}`);
        const imageDownloadResponse = await fetch(generatedImageUrl);
        if (!imageDownloadResponse.ok) {
            throw new Error(`Failed to download generated image: ${imageDownloadResponse.status}`);
        }
        const imageBuffer = Buffer.from(await imageDownloadResponse.arrayBuffer());
        const contentType = imageDownloadResponse.headers.get('content-type') || 'image/png'; // Default to png
        const fileExtension = contentType.split('/')[1] || 'png';

        // --- Save image permanently ---
        const userImageDir = path.join(__dirname, '..', 'public', 'images', 'generated', userId.toString());
        await fs.mkdir(userImageDir, { recursive: true });

        const finalFilename = `${Date.now()}.${fileExtension}`;
        const finalImagePath = path.join(userImageDir, finalFilename);
        await fs.writeFile(finalImagePath, imageBuffer);
        console.log(`Generated image saved to: ${finalImagePath}`);

        const finalImageUrl = `/images/generated/${userId}/${finalFilename}`; // URL for client

        // --- Update DB ---
        user.tokens = parseFloat(user.tokens) - tokenCost;
        await user.save();

        await GeneratedContent.create({
            userId,
            type: 'image',
            contentUrl: finalImageUrl,
            prompt,
            model: modelName, // Store the user-facing model name
            tokenCost,
            // Optionally store other details like seed, dimensions, etc.
            width: outputWidth,
            height: outputHeight,
            seed: payload.seed,
            isPublic: false // Default to private
        });

        console.log(`Tokens deducted. User ${userId} remaining tokens: ${user.tokens}`);

        // --- Respond to client ---
        res.json({
            imageUrl: finalImageUrl,
            tokenCost,
            remainingTokens: user.tokens,
            prompt: prompt, // Echo back prompt
            // Include other useful info if needed
             width: outputWidth,
             height: outputHeight,
             model: modelName
        });

    } catch (error) {
        console.error('Error during Together AI image generation:', error);
        res.status(500).json({ error: error.message || 'Failed to generate image' });
    }
});
// --- END: Together AI Image Generation Route ---

// --- ADDED IMAGE DETAIL ROUTE HERE ---
router.get('/image/:id', async (req, res) => {
    try {
        const contentId = req.params.id;
        const userId = req.user ? req.user.id : null;

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
                } 
            ]
        });

        if (!item) {
            console.log(`[Image Detail Page] Content not found or access denied for ID: ${contentId}, User: ${userId}`);
            return res.status(404).send('Content not found or access denied.'); 
        }
        
        console.log(`[Image Detail Page] Rendering page for content ID: ${contentId}`);

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