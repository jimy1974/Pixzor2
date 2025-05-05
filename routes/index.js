const express = require('express');
const router = express.Router();
const { User, GeneratedContent, ImageComment, sequelize } = require('../db');
const { Op } = require('sequelize');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const fetch = require('node-fetch'); 
const path = require('path');
const multer = require('multer'); 
const { Runware } = require('@runware/sdk-js'); // Import Runware SDK
const { generateTextToImage, generateImageToImage } = require('../utils/runwareUtils'); // Import helpers
const { v4: uuidv4 } = require('uuid'); // Import uuid
const axios = require('axios'); // Import axios
const sharp = require('sharp');
const fs = require('fs').promises;
const { RUNWARE_MODELS } = require('../config/modelsConfig'); // Import model config
const { PROMPT_BASED_STYLES } = require('../config/stylesConfig'); // Import styles config

// Helper function to calculate dimensions based on ratio and max dimension, ensuring multiples of 64
function calculateDimensionsForRatio(ratioString, baseDimension = 1024) {
    const parts = ratioString.split(':');
    if (parts.length !== 2) return { width: baseDimension, height: baseDimension }; // Default to square

    const ratioW = parseInt(parts[0], 10);
    const ratioH = parseInt(parts[1], 10);
    if (isNaN(ratioW) || isNaN(ratioH) || ratioW <= 0 || ratioH <= 0) {
        return { width: baseDimension, height: baseDimension }; // Default square
    }

    let targetWidth, targetHeight;

    if (ratioW >= ratioH) { // Landscape or Square
        targetWidth = baseDimension;
        targetHeight = Math.round((baseDimension * ratioH) / ratioW);
    } else { // Portrait
        targetHeight = baseDimension;
        targetWidth = Math.round((baseDimension * ratioW) / ratioH);
    }

    // Ensure dimensions are multiples of 64 and at least 64
    targetWidth = Math.max(64, Math.round(targetWidth / 64) * 64);
    targetHeight = Math.max(64, Math.round(targetHeight / 64) * 64);

    return { width: targetWidth, height: targetHeight };
}

// --- Define Upload Directory ONCE --- 
const UPLOAD_DIR = path.join(__dirname, '..', 'public', 'uploads'); 
// Ensure the directory exists 
fs.mkdir(UPLOAD_DIR, { recursive: true }).catch(err => {
    if (err.code !== 'EEXIST') { 
        console.error("[Routes] Error creating upload directory:", err);
    }
});
// --- END Upload Directory Definition ---

// --- Initialize Runware SDK --- 
if (!process.env.RUNWARE_API_KEY) {
    console.error("FATAL ERROR: RUNWARE_API_KEY environment variable is not set.");
    process.exit(1); // Exit if API key is missing
}
const runware = new Runware({ apiKey: process.env.RUNWARE_API_KEY });

// --- Multer Setup for Image Upload --- 
// Storage strategy for image-to-image (memory for direct processing)
const memoryStorage = multer.memoryStorage();
const upload = multer({ 
    storage: memoryStorage, 
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
    fileFilter: (req, file, cb) => {
        // Basic image type check
        if (file.mimetype.startsWith('image/')) {
            cb(null, true);
        } else {
            cb(new Error('Only image files are allowed!'), false);
        }
    }
});

// --- Helper Function to Save Images Locally --- 
// (Keep this helper function defined before it's used in the routes)
async function saveImageLocally(imageBuffer, fileName) {
    const filePath = path.join(UPLOAD_DIR, fileName);
    const publicUrlPath = `/uploads/${fileName}`; // URL path accessible by the browser
    try {
        await fs.writeFile(filePath, imageBuffer);
        console.log(`[saveImageLocally] Saved image to: ${filePath}`);
        return publicUrlPath; // Return the web-accessible URL path
    } catch (error) {
        console.error(`[saveImageLocally] Error saving image locally: ${error}`);
        throw new Error('Failed to save image locally.'); // Re-throw for route handler
    }
}

// --- Runware Model Mapping & Costs --- 
// const RUNWARE_MODELS = {
//     'runware:100@1': { name: 'Runware SDXL 1.0 Base', cost: 10, steps: 30, cfgScale: 7, scheduler: 'FlowMatchEulerDiscreteScheduler' }, 
//     'runware:101@1': { name: 'Runware SD 1.5', cost: 5, steps: 28, cfgScale: 3.5, scheduler: 'Euler' }, 
//     'rundiffusion:130@100': { name: 'Juggernaut Pro', cost: 15, steps: 33, cfgScale: 3, scheduler: 'FlowMatchEulerDiscreteScheduler', width: 640, height: 1024 }, // Added Juggernaut
//     'civitai:128491@132760': { name: 'Flux Schnell', cost: 8, steps: 8, cfgScale: 1.2, scheduler: 'FlowMatchEulerDiscreteScheduler', width: 1024, height: 1024 },
//     'civitai:133005@782002': { name: 'Face / Character', cost: 12, steps: 20, cfgScale: 7.5, scheduler: 'Default', width: 640, height: 1152, isPhotoMaker: true }, // Renamed, added flag
//     'runware:102@1': { name: 'Runware SDXL Turbo', cost: 6, steps: 8, cfgScale: 1.5, scheduler: 'EulerDiscreteScheduler', width: 1024, height: 1024 },
// };

// --- Standard Routes --- 
router.get('/', (req, res) => {
    const isSuccess = req.query.success === 'true';
    const isCanceled = req.query.canceled === 'true';
    console.log(`Rendering home, success: ${isSuccess}, canceled: ${isCanceled}`);
    res.render('index', { 
        title: 'Pixzor AI',
        description: 'Create AI movies, images, and chat with Pixzor',
        layout: 'layouts/layout',
        includeChat: true,
        requestPath: req.path,
        successMessage: isSuccess ? 'Token purchase successful!' : null,
        cancelMessage: isCanceled ? 'Token purchase canceled.' : null,
        user: req.user, // Pass user info for header
        runwareModels: RUNWARE_MODELS, // Pass models to the view
        promptBasedStyles: PROMPT_BASED_STYLES // Pass curated styles to the view
    });
});

router.get('/image/:id', async (req, res) => {
  try {
    const contentId = req.params.id;
    const userId = req.user ? req.user.id : null;
    console.log(`[Image Route] Fetching image ID: ${contentId}, User ID: ${userId}, Headers:`, req.headers);

    const item = await GeneratedContent.findOne({
      where: {
        id: contentId,
        [Op.or]: [
          { isPublic: true },
          { userId: userId },
        ],
      },
      include: [
        { model: User, as: 'user', attributes: ['id', 'username', 'photo'] },
        {
          model: ImageComment,
          as: 'comments',
          include: [{ model: User, as: 'user', attributes: ['id', 'username', 'photo'] }],
          order: [['createdAt', 'ASC']],
        },
      ],
    });

    console.log(`[Image Route] Query result for ID: ${contentId}, Found: ${!!item}, isPublic: ${item?.isPublic}, item.userId: ${item?.userId}`);
    if (!item) {
      console.log(`[Image Route] Content not found or access denied for ID: ${contentId}, User: ${userId}`);
      const message = userId ? 'The requested image could not be found or you do not have access.' : 'Please log in to view this image.';
      return res.status(404).render('error', {
        layout: 'layouts/layout',
        title: 'Image Not Found',
        message,
        user: req.user || null,
        includeChat: false,
      });
    }

    const renderData = {
      title: item.prompt
        ? `${item.prompt.substring(0, 50)}... | Pixzor`
        : 'Image Details | Pixzor',
      description: item.prompt
        ? `View this AI-generated image: ${item.prompt.substring(0, 100)}...`
        : 'View this AI-generated image on Pixzor.',
      imageUrl: item.contentUrl,
      url: `https://www.pixzor.com/image/${contentId}`,
      item: {
        ...item.toJSON(),
        comments: item.comments.map(c => ({
          commentText: c.commentText || c.text,
          user: c.user,
          createdAt: c.createdAt
        }))
      },
      user: req.user || null,
      isLoggedIn: req.isAuthenticated ? req.isAuthenticated() : false,
      csrfToken: req.csrfToken ? req.csrfToken() : '',
      contentId: item.id,
      includeChat: false,
      requestPath: req.path,
      layout: 'layouts/layout'
    };

    console.log(`[Image Route] Rendering image-detail for ID: ${contentId}, Data:`, {
      title: renderData.title,
      imageUrl: renderData.imageUrl,
      contentId: renderData.contentId
    });
    res.render('image-detail', renderData);
  } catch (error) {
    console.error(`[Image Route] Error rendering image detail page for ID ${req.params.id}:`, error.stack);
    res.status(500).render('error', {
      layout: 'layouts/layout',
      title: 'Server Error',
      message: `An error occurred while loading the image details: ${error.message}`,
      user: req.user || null,
      includeChat: false,
    });
  }
});

router.get('/partials/modals', (req, res) => {
    res.render('partials/modals', { layout: false, user: req.user }); // Pass user data
});

router.get('/chat-tab/:tab', (req, res) => {
    const { tab } = req.params;
    const validTabs = ['chat', 'create-images', 'create-videos']; 
    if (!validTabs.includes(tab)) {
        return res.status(404).send('Tab not found');
    }
    try {
        // Pass user and runware models to the create-images tab partial
        const viewData = {
            layout: false, 
            user: req.user,
            runwareModels: RUNWARE_MODELS // Pass models for the dropdown
        };
        res.render(`partials/${tab}`, viewData); 
    } catch (err) {
        console.error(`Error rendering partial for tab ${tab}:`, err);
        res.status(500).send('Error loading tab content.');
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
         console.error(`Invalid token bundle or price mismatch. Received tokens: ${tokens}, price: ${price}. Expected price: ${validBundles[tokens]/100}`);
        return res.status(400).json({ error: 'Invalid token bundle or price mismatch' });
    }
    try {
        const session = await stripe.checkout.sessions.create({
            payment_method_types: ['card'],
            line_items: [{
                price_data: {
                    currency: 'gbp', 
                    product_data: { name: `${tokens} Tokens` },
                    unit_amount: validBundles[tokens], // Price in pence
                },
                quantity: 1,
            }],
            mode: 'payment',
            success_url: `${process.env.APP_BASE_URL || 'http://localhost:3000'}/success?session_id={CHECKOUT_SESSION_ID}`, 
            cancel_url: `${process.env.APP_BASE_URL || 'http://localhost:3000'}/?canceled=true`,
            metadata: { userId: req.user.id, tokens: tokens }, 
        });
        res.json({ url: session.url });
    } catch (error) {
        console.error('Error creating Stripe checkout session:', error);
        res.status(500).json({ error: 'Failed to create checkout session' });
    }
});

router.get('/success', async (req, res) => {
    if (!req.isAuthenticated()) {
        console.log('Unauthenticated user redirected from /success to /');
        return res.redirect('/');
    }
    const sessionId = req.query.session_id;
    if (!sessionId) {
        console.log('[Success Route] No session ID provided. Redirecting.');
        return res.redirect('/?error=payment_error');
    }

    // Here you would typically verify the session with Stripe
    // But for simplicity in this flow, we just redirect assuming success
    // If implementing verification, handle potential errors (e.g., session not paid)
    console.log(`[Success Route] User ${req.user.id} returned with session ID ${sessionId}. Redirecting to home with success flag.`);
    
    res.redirect('/?success=true'); 
});

// --- NEW: Runware Image-to-Image Route --- 
router.post('/image-to-image', upload.single('image'), async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ error: 'Login required' });

    // Get text fields from req.body (populated by multer)
    const { modelId, prompt, strength, aspectRatio, style, styleLabel, negativePromptOverride } = req.body; // Use 'style' to match demo
 
    const userId = req.user.id;
    const parsedStrength = parseFloat(strength) || 0.75; // Use default if invalid

    console.log(`[Image-to-Image Route] Received style: ${style}`);

    console.log(`[Image-to-Image] Received: modelId='${modelId}', prompt='${prompt}', strength='${strength}', userId=${userId}`);

    // Check if file was uploaded
    if (!req.file) {
        console.error('[Image-to-Image] No image file uploaded.');
        return res.status(400).json({ error: 'Image file is required' });
    }

    let originalWidth, originalHeight;
    try {
        const metadata = await sharp(req.file.buffer).metadata();
        originalWidth = metadata.width;
        originalHeight = metadata.height;
        if (!originalWidth || !originalHeight) {
            throw new Error('Could not read image dimensions.');
        }
        console.log(`[Image-to-Image] Original dimensions: ${originalWidth}x${originalHeight}`);
    } catch (err) {
        console.error('[Image-to-Image] Error reading image metadata:', err);
        return res.status(400).json({ error: 'Could not process uploaded image file.' });
    }

    // --- Calculate Target Dimensions (Maintain Aspect Ratio, Target ~1MP, Multiple of 64) ---
    const MAX_DIMENSION = 1024; // Target for the longer side
    const MIN_DIMENSION = 64;   // Minimum dimension allowed
    const MULTIPLE = 64;

    let targetWidth, targetHeight;
    const aspectRatioValue = originalWidth / originalHeight;

    if (originalWidth > originalHeight) {
        targetWidth = Math.min(MAX_DIMENSION, originalWidth); // Don't upscale beyond MAX if original is large
        targetHeight = targetWidth / aspectRatioValue;
    } else {
        targetHeight = Math.min(MAX_DIMENSION, originalHeight);
        targetWidth = targetHeight * aspectRatioValue;
    }

    // Round DOWN to the nearest multiple of 64, ensuring minimum size
    targetWidth = Math.max(MIN_DIMENSION, Math.floor(targetWidth / MULTIPLE) * MULTIPLE);
    targetHeight = Math.max(MIN_DIMENSION, Math.floor(targetHeight / MULTIPLE) * MULTIPLE);

    console.log(`[Image-to-Image] Calculated target dimensions: ${targetWidth}x${targetHeight}`);
    // ----------------------------------------------------------------------------------

    // Validate modelId
    const selectedModelInfo = RUNWARE_MODELS[modelId];
    console.log('[Image-to-Image] Found selectedModelInfo:', selectedModelInfo);
    if (!selectedModelInfo) {
        console.error(`[Image-to-Image] Invalid modelId received: ${modelId}`);
        return res.status(400).json({ error: 'Invalid model selected' });
    }

    // Validate prompt (optional, but good practice)
    if (!prompt || typeof prompt !== 'string' || prompt.trim().length === 0) {
         console.error(`[Image-to-Image] Invalid or missing prompt: ${prompt}`);
        return res.status(400).json({ error: 'A text prompt is required' });
    }

    // Check model cost and user tokens
    if (typeof selectedModelInfo.cost !== 'number') {
        console.error(`[Image-to-Image] Invalid cost for model ${modelId}: ${selectedModelInfo.cost}`);
        return res.status(500).json({ error: 'Internal error: Invalid model cost' });
    }
    if (req.user.tokens < selectedModelInfo.cost) {
        console.log(`[Image-to-Image] Insufficient tokens for user ${userId} to generate image with model ${modelId}. Tokens: ${req.user.tokens}, Cost: ${selectedModelInfo.cost}`);
        return res.status(402).json({ error: 'Insufficient tokens' });
    }

    try {
        // Convert uploaded image buffer to base64 for Runware SDK
        const imageBase64 = req.file.buffer.toString('base64');

        let generatedImageUrl;
        let actualCost;
        let runwareImageUUID;

        if (selectedModelInfo.isPhotoMaker) {
            // --- PhotoMaker Specific Logic --- 
            console.log(`[Image-to-Image] Using PhotoMaker specific logic for model ${modelId}`);
            // Validate strength for PhotoMaker (e.g., 15-50, adjust as needed)
            const photoMakerStrength = Math.max(15, Math.min(50, parseInt(strength, 10) || 15));

            console.log('[Image-to-Image Route] Passing to calculateDimensionsForRatio:', aspectRatio || '1:1');
            const { width: photoMakerWidth, height: photoMakerHeight } = calculateDimensionsForRatio(aspectRatio || '1:1', 1024);
            console.log(`[Image-to-Image] PhotoMaker using selected ratio '${aspectRatio || '1:1'}', base 1024, calculated dims: ${photoMakerWidth}x${photoMakerHeight}`);

            const photoMakerPayload = {
                taskType: 'photoMaker',
                model: modelId,
                taskUUID: uuidv4(), // Add the required task UUID
                positivePrompt: prompt.trim(),
                negativePrompt: 'deformed, blurry, bad anatomy, worst quality', // Example negative prompt
                steps: selectedModelInfo.steps,
                CFGScale: selectedModelInfo.cfgScale,
                width: photoMakerWidth,  // Use calculated dimensions based on selected ratio
                height: photoMakerHeight,
                inputImages: [`data:${req.file.mimetype};base64,${imageBase64}`], // Array with base64 data URI
                style: (style || 'photographic').toLowerCase(), // Add style like in demo
                strength: photoMakerStrength,
                outputType: ['URL'],
                includeCost: true,
                numberResults: 1 // Ensure we only ask for one result
            };

            console.log('[Image-to-Image] PhotoMaker Payload:', JSON.stringify(photoMakerPayload).substring(0, 500) + '...'); // Log payload (truncated base64)

            try {
                console.log('[Image-to-Image] Calling Runware API directly via axios for PhotoMaker:', photoMakerPayload);
                const response = await axios.post(
                    'https://api.runware.ai/v1',
                    [photoMakerPayload], // API expects an array of tasks
                    {
                        headers: {
                            'Authorization': `Bearer ${process.env.RUNWARE_API_KEY}`,
                            'Content-Type': 'application/json',
                        },
                        timeout: 120000, // 2 minute timeout
                    }
                );
                
                console.log('[Image-to-Image] Raw PhotoMaker API Response:', JSON.stringify(response.data, null, 2));
                
                if (!response.data || !response.data.data || !Array.isArray(response.data.data) || response.data.data.length === 0) {
                    throw new Error('Invalid API response from PhotoMaker: No images returned or invalid format.');
                }
                
                const firstImageResult = response.data.data[0];
                if (!firstImageResult.imageURL || typeof firstImageResult.cost === 'undefined') {
                     throw new Error('Invalid API response from PhotoMaker: Missing imageURL or cost.');
                }
                
                generatedImageUrl = firstImageResult.imageURL;
                actualCost = firstImageResult.cost;
                runwareImageUUID = firstImageResult.imageUUID; // Get UUID if available
                console.log(`[Image-to-Image] PhotoMaker result: URL=${generatedImageUrl}, Cost=${actualCost}, UUID=${runwareImageUUID}`);

            } catch (axiosError) {
                 console.error('[Image-to-Image] Axios error calling PhotoMaker API:', axiosError.response ? JSON.stringify(axiosError.response.data) : axiosError.message);
                 throw new Error(`Failed to generate image using PhotoMaker: ${axiosError.message}`);
            }
            // --- End PhotoMaker Specific Logic --- 
        } else {
            // --- Standard Image-to-Image Logic --- 
            console.log(`[Image-to-Image] Using standard SDK call for model ${modelId} with strength: ${parsedStrength}`);
            
            // Construct params object for standard call
            const params = {
                taskType: 'imageInference',
                taskUUID: uuidv4(),
                positivePrompt: styleLabel ? `${prompt.trim()}, ${styleLabel} style` : prompt.trim(), // Append style label AND 'style' keyword
                negativePrompt: negativePromptOverride, // Use the style-specific NP from the hidden input
                model: modelId,
                seedImage: `data:${req.file.mimetype};base64,${imageBase64}`, // Add data URI prefix
                width: targetWidth,
                height: targetHeight,
                strength: parsedStrength,
                steps: selectedModelInfo.steps,
                CFGScale: selectedModelInfo.cfgScale,
                scheduler: selectedModelInfo.scheduler,
                outputFormat: 'JPEG',
                numberResults: 1,
                outputType: ['URL'],
                includeCost: true,
                ...(style && style !== '' && { lora: [{ model: style, weight: 1.0 }] }) // Add lora for style like demo
            };

            console.log('[Image-to-Image] Final Constructed Prompts -> Positive:', params.positivePrompt, '|| Negative:', params.negativePrompt);

            console.log('[Image-to-Image] Standard SDK Params:', {
                ...params,
                seedImage: params.seedImage ? '<base64_string_hidden>' : 'undefined',
            });

            const result = await generateImageToImage(runware, params);

            if (!result || result.length === 0) {
                throw new Error("Standard Image generation returned no results.");
            }
            const firstImage = result[0];
            generatedImageUrl = firstImage.imageURL;
            actualCost = firstImage.cost;
            runwareImageUUID = firstImage.imageUUID;
            console.log(`[Image-to-Image] Standard result: URL=${generatedImageUrl}, Cost=${actualCost}, UUID=${runwareImageUUID}`);
            // --- End Standard Image-to-Image Logic --- 
        }

        // --- Shared Logic: Verify Cost, Save Image, Deduct Tokens, Send Response ---
        // Verify user has enough tokens based on actual cost (redundant check, but safe)
        const user = await User.findByPk(userId);
        if (user.tokens < actualCost) {
             console.error(`[Image-to-Image] Insufficient tokens for user ${userId} based on actual cost. Tokens: ${user.tokens}, Actual Cost: ${actualCost}`);
             // Note: We already deducted based on estimated cost, this check might be too late if API cost is higher.
             // Consider how to handle this discrepancy if it's a major issue.
            // For now, we proceed but log the error.
        }

        // Use the predefined cost for deduction, log the actual API cost
        const costToDeduct = selectedModelInfo.cost;
        console.log(`[Image-to-Image] Cost to deduct: ${costToDeduct}, Actual API cost: ${actualCost}`);

        // Save the image locally
        const imageBuffer = await fetch(generatedImageUrl).then(res => res.buffer()); // Use the URL from either branch
        const uniqueFilename = `${uuidv4()}.png`;
        const localSavePath = await saveImageLocally(imageBuffer, uniqueFilename);
        const filename = path.basename(localSavePath);
        const publicImageUrl = `/uploads/${filename}`; // Corrected path

        console.log('[Image-to-Image] Constructed publicImageUrl:', publicImageUrl);

        // Save metadata to DB
        await GeneratedContent.create({
            userId: userId,
            prompt: prompt.trim(), // Use trimmed prompt
            modelUsed: modelId,
            contentUrl: publicImageUrl,
            tokenCost: costToDeduct, // Log the deducted cost
            isPublic: false,
            type: 'image', // Add the type field
            metadata: JSON.stringify({
                runwareImageUUID: runwareImageUUID || null, // Use captured UUID
                originalUrl: generatedImageUrl, // Use captured URL
                apiCost: actualCost // Optionally store the actual API cost in metadata
            })
        });

        // Deduct tokens using the predefined cost
        await User.update({ tokens: sequelize.literal(`tokens - ${costToDeduct}`) }, { where: { id: userId } });

        // Send back the public URL of the locally saved image
        res.json({ imageUrl: publicImageUrl, cost: costToDeduct }); // Return the deducted cost

    } catch (error) {
        console.error(`Error generating image-to-image for user ${userId} with model ${modelId}:`, error);
        res.status(500).json({ error: 'Failed to generate image' });
    }
});

// --- NEW: Define Multer Locally for Upload API --- 
const generalDiskStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => cb(null, `${uuidv4()}${path.extname(file.originalname)}`) // Unique filename
});

const generalUpload = multer({ 
    storage: generalDiskStorage, 
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
    fileFilter: (req, file, cb) => { // Add basic file filter
        const allowedTypes = /jpeg|jpg|png|webp/;
        const mimetype = allowedTypes.test(file.mimetype);
        const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
        if (mimetype && extname) {
            return cb(null, true);
        }
        cb(new Error('Error: File upload only supports the following filetypes - ' + allowedTypes));
    }
}).single('image'); // Use .single here as it's middleware for ONE file named 'image'

// --- NEW: Image Upload Endpoint (Using locally defined generalUpload) --- 
router.post('/api/upload-image', (req, res, next) => {
    // Apply the multer middleware
    generalUpload(req, res, function (err) {
        if (err instanceof multer.MulterError) {
            // A Multer error occurred (e.g., file size limit).
            console.error('[Upload API] Multer error:', err);
            return res.status(400).json({ error: `Upload error: ${err.message}` });
        } else if (err) {
            // An unknown error occurred (e.g., file type filter).
            console.error('[Upload API] Unknown upload error:', err);
             return res.status(400).json({ error: err.message || 'Invalid file type.' });
        }
        // If no errors, proceed to the main route logic
        next();
    });
}, async (req, res) => {
    // This part runs *after* multer successfully processes the upload
    if (!req.isAuthenticated()) {
        // This check might be redundant if you have global auth middleware, but safe to keep
        return res.status(401).json({ error: 'Login required' });
    }

    if (!req.file) {
        // This case should ideally be caught by multer errors, but check just in case
        console.error('[Upload API] File object missing after multer.');
        return res.status(400).json({ error: 'No image file provided or upload failed.' });
    }

    console.log(`[Upload API] File received: ${req.file.filename}, Size: ${req.file.size}`);

    // --- Optional: Post-upload Validation (Sharp validation can be complex here)
    // Since multer's fileFilter handles types, sharp might only be needed for more complex checks (dimensions, etc.)
    // For simplicity, we'll rely on the fileFilter for now.
    // try {
    //     const metadata = await sharp(req.file.path).metadata();
    //     console.log(`[Upload API] Valid image uploaded: ${req.file.filename}, Format: ${metadata.format}`);
    // } catch (sharpError) { ... }
    // --- End Optional Validation ---

    // Construct the URL to the uploaded file
    const fileUrl = `/uploads/${req.file.filename}`;

    res.json({
        message: 'Image uploaded successfully',
        imageUrl: fileUrl,
        filename: req.file.filename
    });
});
// --- END NEW ---

// ... rest of the code remains the same ...

// --- NEW: Add the missing GET / route handler --- 
router.get('/', (req, res) => {
    console.log('[Route /] Rendering homepage.');
    console.log('[Route /] Data being passed to template:', JSON.stringify(RUNWARE_MODELS, null, 2));
    // Render the index view (which uses the layout) and pass necessary data
    res.render('index', {
        title: 'Pixzor AI', // Example title
        description: 'Create consistent characters, stylize images or make movies.', // Example description
        runwareModels: RUNWARE_MODELS, // Pass the imported models config
        promptBasedStyles: PROMPT_BASED_STYLES, // Pass the imported styles config
        includeChat: true // Assuming the chat should be included on the homepage
    });
});

module.exports = router;