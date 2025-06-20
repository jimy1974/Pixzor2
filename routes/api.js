// routes\api.js
const express = require('express');
const router = express.Router();
const { User, GeneratedContent, ImageComment, ChatSession, ImageLike } = require('../db');
const { isAuthenticated, isAdminApi } = require('../middleware/authMiddleware');
const { generalUpload, UPLOAD_DIR } = require('../config/multerConfig');

const fs = require('fs');
const fsp = require('fs').promises;

const path = require('path');
const sharp = require('sharp'); // Sharp is imported, but not your custom function
const { Sequelize } = require('sequelize');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');

// --- CRITICAL CHANGE 1: Import gcsUtils as a single object ---
const gcsUtils = require('../utils/gcsUtils'); // Changed from destructuring!

// --- CRITICAL CHANGE 2: Import your generateThumbnail function ---
const { generateThumbnail } = require('../utils/imageProcessor'); // Add this line

const { Op } = require('sequelize');

// --- ADD THIS LINE TO GET BUCKET NAME FOR FILTERING ---
const GCS_BUCKET_NAME = gcsUtils.bucketName; // Access the exported bucketName


// Define the directory where feedback will be stored
const feedbackDir = path.join(__dirname, '..', 'feedback');
const feedbackFilePath = path.join(feedbackDir, 'feedback.txt');

// Admin route to generate missing thumbnails
router.post('/admin/generate-missing-thumbnails', isAuthenticated, isAdminApi, async (req, res) => {
    try {
        console.log('Admin: Starting thumbnail generation process...');
        const contentsWithoutThumbnails = await GeneratedContent.findAll({
            where: {
                type: 'image', // Only process images
                thumbnailUrl: null, // Only process images without a thumbnail
                // --- ADD THIS CONDITION TO FILTER BY GCS BUCKET ---
                contentUrl: {
                    [Op.like]: `https://storage.googleapis.com/${GCS_BUCKET_NAME}/%`
                }
            }
        });

        if (contentsWithoutThumbnails.length === 0) {
            console.log('No missing thumbnails found.');
            return res.json({ message: 'No missing images requiring thumbnail generation in your GCS bucket.' });
        }

        let processedCount = 0;
        let errors = [];

        for (const content of contentsWithoutThumbnails) {
            try {
                console.log(`Processing image ID: ${content.id}, URL: ${content.contentUrl}`);

                const originalImageBuffer = await gcsUtils.downloadFile(content.contentUrl);

                if (!originalImageBuffer) {
                    // This case should be less frequent with the Op.like filter
                    // but could happen if a GCS URL is valid but the file doesn't exist.
                    throw new Error(`Failed to download original image for ID: ${content.id}`);
                }

                const thumbnailBuffer = await generateThumbnail(originalImageBuffer, 'webp', 300);

                const originalFilename = content.contentUrl.substring(content.contentUrl.lastIndexOf('/') + 1);
                const thumbnailFilename = `thumbnails/${originalFilename.split('.')[0]}_thumb.webp`;
                const thumbnailUrl = await gcsUtils.uploadFile(thumbnailBuffer, thumbnailFilename, 'image/webp');

                if (!thumbnailUrl) {
                    throw new Error(`Failed to upload thumbnail for ID: ${content.id}`);
                }

                content.thumbnailUrl = thumbnailUrl;
                await content.save();

                processedCount++;
                console.log(`Successfully generated and saved thumbnail for ID: ${content.id}`);

            } catch (error) {
                console.error(`Error processing image ID ${content.id}:`, error);
                errors.push({ id: content.id, error: error.message });
            }
        }

        let message = `Successfully generated thumbnails for ${processedCount} images.`;
        if (errors.length > 0) {
            message += ` ${errors.length} images failed. Check server logs for details.`;
        }

        res.json({ message, processedCount, errors });

    } catch (error) {
        console.error('Unhandled error during thumbnail generation:', error);
        res.status(500).json({ message: 'Server error during thumbnail generation.', error: error.message });
    }
});



// For your /api/gallery-content route, ensure it also maps correctly.
// You should have already changed the 'limit' to 24 in the previous step.
// If your GeneratedContent model uses 'contentUrl' as the image field,
// ensure the `attributes` array and the `map` function correctly use it.
// routes\api.js

// ... (existing imports and other routes like generate-missing-thumbnails)

router.get('/gallery-content', async (req, res) => {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 24; // Increased default limit for gallery
    const offset = (page - 1) * limit;
    const userId = req.user ? req.user.id : null;

    console.log(`[API Gallery] Fetching page ${page}, limit ${limit}, userId ${userId}`);

    try {
        let whereCondition = {
            type: 'image',
            isPublic: true // Only fetch public images for the main gallery
        };

        const include = [
            { model: User, as: 'user', attributes: ['username'] }
        ];

        // IMPORTANT CHANGE 1: Include 'thumbnailUrl' in the selected attributes
        const attributesToSelect = ['id', 'contentUrl', 'thumbnailUrl', 'prompt', 'type', 'createdAt', 'isPublic', 'userId'];

        attributesToSelect.push(
            [Sequelize.literal('(SELECT COUNT(*) FROM `ImageLikes` WHERE `ImageLikes`.`contentId` = `GeneratedContent`.`id`)'), 'likeCount']
        );

        if (userId) {
            attributesToSelect.push([Sequelize.literal(`(EXISTS (SELECT 1 FROM \`ImageLikes\` WHERE \`ImageLikes\`.\`contentId\` = \`GeneratedContent\`.\`id\` AND \`ImageLikes\`.\`userId\` = ${parseInt(userId)}))`), 'isLikedByUser']);
        } else {
            attributesToSelect.push([Sequelize.literal('0'), 'isLikedByUser']);
        }

        const { count, rows } = await GeneratedContent.findAndCountAll({
            where: whereCondition,
            limit,
            offset,
            order: [['createdAt', 'DESC']],
            include,
            attributes: attributesToSelect,
            group: ['GeneratedContent.id']
        });

        const totalItems = count.length;
        const totalPages = Math.ceil(totalItems / limit);

        console.log(`[API Gallery] Found ${totalItems} total items, returning ${rows.length} for page ${page}. Total pages: ${totalPages}`);

        res.json({
            items: rows.map(item => ({
                id: item.id,
                contentUrl: item.contentUrl,
                thumbnailUrl: item.thumbnailUrl, // IMPORTANT CHANGE 2: Use item.thumbnailUrl directly from DB
                prompt: item.prompt,
                type: item.type,
                createdAt: item.createdAt,
                user: item.user ? { username: item.user.username } : null,
                isPublic: item.isPublic,
                isOwner: req.user && item.userId === req.user.id,
                likeCount: item.get('likeCount') ? parseInt(item.get('likeCount')) : 0,
                isLikedByUser: !!item.get('isLikedByUser')
            })),
            currentPage: page,
            totalPages,
            totalItems: totalItems,
            hasMore: page < totalPages
        });
    } catch (error) {
        console.error(`[API Gallery] Error fetching gallery content for page ${page}:`, error);
        res.status(500).json({ error: 'Internal server error while fetching gallery content.' });
    }
});



// POST Text-to-Image (Protected)
router.post('/text-to-image', isAuthenticated, async (req, res) => {
    const userId = req.user.id;
    const { prompt, chatSessionId } = req.body;

    console.log(`[API Text-to-Image] User ${userId} requested image with prompt: "${prompt}" (Session: ${chatSessionId || 'None'})`);

    if (!prompt) {
        return res.status(400).json({ error: 'Prompt is required.' });
    }

    try {
        const user = await User.findByPk(userId);
        const imageCost = 10;
        console.log(`[API Token Check] User ID: ${userId}, Tokens: ${user?.tokens}, Cost: ${imageCost}`);
        if (!user || parseFloat(user.tokens) < imageCost) {
            return res.status(403).json({ error: `Insufficient tokens. Need ${imageCost}, have ${user?.tokens ?? 0}.` });
        }

        // Deduct tokens (Moved here for consistent flow)
        const updatedTokens = parseFloat(user.tokens) - imageCost;
        await user.update({ tokens: updatedTokens });
        console.log(`[API Text-to-Image] User ${userId} tokens deducted. New balance: ${updatedTokens}`);

        // Call Runware API
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
            includeCost: true,
        };

        console.log('[API Text-to-Image] Sending Runware params:', JSON.stringify([runwareParams], null, 2));
        const runwareResponse = await axios.post(
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

        const successData = runwareResponse.data?.data?.[0];

        if (!successData || !successData.imageURL) {
            console.error('[API Text-to-Image] Runware API Error or Unexpected Format:', JSON.stringify(runwareResponse.data, null, 2));
            const errorMessage = runwareResponse.data?.error?.message || 'Unknown Runware API error or unexpected response format.';
            const detail = runwareResponse.data?.error?.detail;
            const fullError = detail ? `${errorMessage} Detail: ${detail}` : errorMessage;
            // Refund tokens on Runware API failure
            await user.update({ tokens: parseFloat(user.tokens) + imageCost });
            console.log(`[API Text-to-Image] Tokens refunded for user ${userId} due to Runware API error.`);
            return res.status(502).json({ error: `Image generation failed: ${fullError}` });
        }

        let finalImageUrl = successData.imageURL;
        let thumbnailImageUrl = null; // Initialize thumbnail URL

        try {
            console.log(`[API Text-to-Image] Attempting download from Runware URL: ${successData.imageURL}`);
            const imageResponse = await axios.get(successData.imageURL, { responseType: 'arraybuffer' });
            const imageBuffer = Buffer.from(imageResponse.data, 'binary');
            const contentType = imageResponse.headers['content-type'] || 'image/jpeg';
            const fileExtension = contentType.split('/')[1] || 'jpg';
            const uniqueFilename = `${uuidv4()}.${fileExtension}`;

            console.log(`[API Text-to-Image] Preparing GCS Upload. Filename: ${uniqueFilename}, ContentType: ${contentType}, Buffer Size: ${imageBuffer ? imageBuffer.length : 'null'}`);
            const gcsUrl = await gcsUtils.uploadFile(imageBuffer, `images/${uniqueFilename}`, contentType);

            if (gcsUrl) {
                console.log(`[API Text-to-Image] GCS Upload successful: ${gcsUrl}`);
                finalImageUrl = gcsUrl; // Use GCS URL if successful

                // --- Generate and upload thumbnail ---
                try {
                    const thumbnailBuffer = await generateThumbnail(imageBuffer, 'webp', 300); // Generate 300px wide WebP thumbnail
                    const thumbnailFilename = `thumbnails/${uniqueFilename.split('.')[0]}_thumb.webp`; // Unique name for thumbnail
                    const uploadedThumbnailUrl = await gcsUtils.uploadFile(thumbnailBuffer, thumbnailFilename, 'image/webp');
                    if (uploadedThumbnailUrl) {
                        thumbnailImageUrl = uploadedThumbnailUrl;
                        console.log(`[API Text-to-Image] Thumbnail generated and uploaded: ${thumbnailImageUrl}`);
                    } else {
                        console.warn('[API Text-to-Image] Failed to upload generated thumbnail. Proceeding without thumbnail URL.');
                    }
                } catch (thumbnailError) {
                    console.error('[API Text-to-Image] Error generating or uploading thumbnail:', thumbnailError);
                    // Continue even if thumbnail fails
                }
            } else {
                console.error('[API Text-to-Image] GCS Upload failed. Falling back to Runware URL and no thumbnail.');
            }
        } catch (gcsUploadError) {
            console.error('[API Text-to-Image] Error during image download or GCS upload process. Falling back to Runware URL and no thumbnail.', gcsUploadError);
        }
        console.log(`[API Text-to-Image] Final Image URL: ${finalImageUrl}, Thumbnail URL: ${thumbnailImageUrl}, Cost: ${successData.cost || imageCost}`);

        // 5. Save Generated Content
        const newContent = await GeneratedContent.create({
            userId: userId,
            type: 'image',
            contentUrl: finalImageUrl, // Use GCS URL or Runware fallback
            thumbnailUrl: thumbnailImageUrl, // <--- ADD THIS LINE
            prompt: prompt,
            model: runwareParams.model,
            tokenCost: successData.cost || imageCost,
            // isPublic: true, // Ensure default or set as needed (isPublic not provided in req.body for this route, so will use model default)
        });
        console.log(`[API Text-to-Image] GeneratedContent saved with ID: ${newContent.id}`);

        // 6. Save Chat History (if chatSessionId was provided)
        // ... (This logic remains unchanged)
        if (chatSessionId) {
            try {
                const chatSession = await ChatSession.findOne({ where: { clientSessionId: chatSessionId, userId: userId }});
                if (chatSession) {
                    const userMessageEntry = { type: 'user', message: `Generate image: ${prompt}` };
                    const botMessageEntry = { type: 'bot_image', imageUrl: finalImageUrl, generatedContentId: newContent.id, cost: successData.cost || imageCost };

                    let currentHistory = chatSession.history || [];
                    if (!Array.isArray(currentHistory)) {
                        console.warn(`[API Text-to-Image] Chat history for ${chatSessionId} was not an array, resetting.`);
                        currentHistory = [];
                    }
                    currentHistory.push(userMessageEntry);
                    currentHistory.push(botMessageEntry);

                    // Ensure 'history' column in ChatSession model is of type JSON or TEXT that can store JSON strings
                    // If it's a TEXT column, you might need to stringify it before saving.
                    // Assuming Sequelize JSON type or an object is handled.
                    await chatSession.update({ history: currentHistory });
                    console.log(`[API Text-to-Image] Chat history updated for session ${chatSessionId}`);
                } else {
                    console.warn(`[API Text-to-Image] Could not find chat session ${chatSessionId} to update history.`);
                }
            } catch (chatError) {
                console.error(`[API Text-to-Image] Error updating chat history for session ${chatSessionId}:`, chatError);
            }
        }

        // 7. Send Success Response
        res.status(201).json({
            imageUrl: finalImageUrl,
            thumbnailUrl: thumbnailImageUrl, // <--- ADD THIS LINE
            newTokens: updatedTokens,
            generatedContentId: newContent.id
        });

    } catch (error) {
        console.error(`[API Text-to-Image] Error in /text-to-image route for user ${userId}:`, error);
        if (axios.isAxiosError(error)) {
            const status = error.response?.status || 502;
            res.status(status).json({ error: `Image generation service request failed: ${error.message}` });
        } else {
            res.status(500).json({ error: 'Internal server error during image generation.' });
        }
    }
});






// Ensure the feedback directory exists
// These now correctly use the standard 'fs' module
if (!fs.existsSync(feedbackDir)) {
    fs.mkdirSync(feedbackDir, { recursive: true });
    console.log(`Created feedback directory: ${feedbackDir}`);
}

// Example: Simple endpoint to receive feedback
router.post('/feedback', isAuthenticated, async (req, res) => {
    const { type, description } = req.body;
    const userId = req.user ? req.user.id : 'anonymous'; // Get user ID if logged in
    const timestamp = new Date().toISOString(); // Get current timestamp

    if (!type || !description) {
        return res.status(400).json({ message: 'Type and description are required.' });
    }

    try {
        // Format the feedback string
        const feedbackEntry = `
----------------------------------
Timestamp: ${timestamp}
User ID: ${userId}
Issue Type: ${type}
Description:
${description}
----------------------------------
`;

        // Append the feedback to the feedback.txt file
        // This now correctly uses the promise-based 'fsp' module
        await fsp.appendFile(feedbackFilePath, feedbackEntry + '\n'); // Add newline for readability

        console.log(`Feedback from ${userId} (${type}) logged to ${feedbackFilePath}`);
        res.status(200).json({ message: 'Feedback received successfully!' });

    } catch (error) {
        console.error('Failed to process feedback or write to file:', error);
        res.status(500).json({ message: 'Failed to submit feedback due to a server error. Please try again later.' });
    }
});




// NEW ADMIN ROUTE: Get All User Stats
router.get('/admin/user-stats', isAdminApi, async (req, res) => {
    console.log('[API Admin] Fetching user stats (access granted).');

    try {
        const users = await User.findAll({
            attributes: [
                'id',
                'username',
                'email',
                'credits',
                'createdAt',
                // Use the alias 'generatedContents' here
                [Sequelize.fn('COUNT', Sequelize.col('generatedContents.id')), 'imageCount']
            ],
            include: [{
                model: GeneratedContent,
                as: 'generatedContents', // <-- THIS IS THE CRUCIAL ADDITION
                attributes: [],
                duplicating: false
            }],
            group: ['User.id'],
            order: [['createdAt', 'ASC']]
        });

        console.log(`[API Admin] Found ${users.length} users with stats.`);
        res.json(users);
    } catch (error) {
        console.error('[API Admin] Error fetching user stats:', error);
        res.status(500).json({ error: 'Failed to retrieve user statistics.' });
    }
});



// GET User Files (Protected, Paginated)
router.get('/files', isAuthenticated, async (req, res) => {
    const userId = req.user.id;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 24;
    const offset = (page - 1) * limit;

    console.log(`[API Files] User ${userId} fetching page ${page}, limit ${limit}`);

    try {
        // IMPORTANT CHANGE 1: Include 'thumbnailUrl' in the selected attributes
        const attributesToSelect = ['id', 'contentUrl', 'thumbnailUrl', 'prompt', 'type', 'isPublic', 'createdAt', 'userId'];

        // Add like counts and isLikedByUser using Sequelize.literal subqueries
        attributesToSelect.push(
            [Sequelize.literal('(SELECT COUNT(*) FROM `ImageLikes` WHERE `ImageLikes`.`contentId` = `GeneratedContent`.`id`)'), 'likeCount']
        );
        attributesToSelect.push([Sequelize.literal(`(EXISTS (SELECT 1 FROM \`ImageLikes\` WHERE \`ImageLikes\`.\`contentId\` = \`GeneratedContent\`.\`id\` AND \`ImageLikes\`.\`userId\` = ${parseInt(userId)}))`), 'isLikedByUser']);

        const { count, rows } = await GeneratedContent.findAndCountAll({
            where: {
                userId: userId,
                type: 'image' // Assuming only image content is shown in "files"
            },
            limit,
            offset,
            order: [['createdAt', 'DESC']], // Order by creation date, newest first
            attributes: attributesToSelect, // Use the defined attributes
        });

        const totalItems = typeof count === 'number' ? count : (Array.isArray(count) && count.length > 0 ? count.length : 0);
        const totalPages = Math.ceil(totalItems / limit);

        console.log(`[API Files] User ${userId} found ${totalItems} total items, returning ${rows.length} for page ${page}. Total pages: ${totalPages}`);

        res.json({
            items: rows.map(item => ({
                id: item.id,
                // The 'image' property is for legacy frontend code that might expect 'image' directly.
                // 'contentUrl' and 'thumbnailUrl' are for explicit use.
                image: item.contentUrl,
                contentUrl: item.contentUrl,
                thumbnailUrl: item.thumbnailUrl, // IMPORTANT CHANGE 2: Use item.thumbnailUrl directly from DB
                prompt: item.prompt,
                type: item.type,
                createdAt: item.createdAt,
                isPublic: item.isPublic,
                isOwner: true, // Always true for /files route as it's user's own content
                likeCount: item.get('likeCount') ? parseInt(item.get('likeCount')) : 0,
                isLikedByUser: !!item.get('isLikedByUser') // Convert to boolean
            })),
            currentPage: page,
            totalPages,
            totalItems,
            hasMore: page < totalPages // Indicate if there are more pages
        });

    } catch (error) {
        console.error(`[API Files] Error fetching files for user ${userId} on page ${page}:`, error);
        res.status(500).json({ error: 'Internal server error while fetching user files.' });
    }
});


// GET User Credits (Protected) - Renamed from /tokens
router.get('/credits', isAuthenticated, async (req, res) => {
    if (!req.user || !req.user.id) { 
        return res.status(401).json({ error: 'User not authenticated.' });
    }
    try {
        // Refetch user to ensure latest credit count is retrieved
        const user = await User.findByPk(req.user.id);
        if (!user) {
            return res.status(404).json({ error: 'User not found.' });
        }
        res.json({ credits: user.credits }); // Return credits
    } catch (error) {
        console.error('Error fetching user credits:', error);
        res.status(500).json({ error: 'Failed to fetch credit balance.' });
    }
});

// GET Content Details (Public)
router.get('/content-details/:id', async (req, res) => {
    console.log(`[API Content Details] Request for ID: ${req.params.id}`);
    try {
        const contentId = req.params.id;
        const content = await GeneratedContent.findByPk(contentId, {
            include: [
                { 
                    model: User, 
                    as: 'user', 
                    attributes: ['username'] 
                }, 
                { 
                    model: ImageComment, 
                    as: 'comments', 
                    include: [{ model: User, as: 'user', attributes: ['username'] }],
                    order: [['createdAt', 'DESC']] 
                }
            ]
        });

        if (!content) {
            console.log(`[API Content Details] Content not found for ID: ${contentId}`);
            return res.status(404).json({ error: 'Content not found' });
        }

        console.log(`[API Content Details] Found content for ID: ${contentId}, Title: ${content.title}`);
        
        // Construct the full response object
        const responseData = {
            id: content.id,
            title: content.title,
            prompt: content.prompt,
            negativePrompt: content.negativePrompt,
            modelUsed: content.modelUsed,
            imageUrl: content.imageUrl, 
            isPublic: content.isPublic,
            createdAt: content.createdAt,
            isOwner: req.user ? req.user.id === content.userId : false, // Add isOwner flag
            // Add user info if available
            user: content.user ? { username: content.user.username } : null,
            // Map comments to include username
            comments: content.comments.map(comment => ({
                id: comment.id,
                text: comment.text,
                createdAt: comment.createdAt,
                user: comment.user ? { username: comment.user.username } : null
            })).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)) // Ensure descending order
        };

        // Debugging: Log the content.user object before sending response
        console.log('[API Content Details] Content object before response:', JSON.stringify(content, null, 2));

        res.json(responseData);
    } catch (error) {
        console.error(`[API Content Details] Error fetching content details for ID ${req.params.id}:`, error);
        res.status(500).json({ error: 'Internal server error while fetching content details.' });
    }
});

// GET Comments for Content (Public)
router.get('/content/:contentId/comments', async (req, res) => {
    try {
        const contentId = req.params.contentId;
        console.log(`[API Comments GET] Fetching comments for content ID: ${contentId}`);
        
        // Validate content exists (optional but good practice)
        const contentExists = await GeneratedContent.count({ where: { id: contentId } });
        if (contentExists === 0) {
            console.log(`[API Comments GET] Content not found for ID: ${contentId}`);
            return res.status(404).json({ error: 'Content not found.' });
        }

        const comments = await ImageComment.findAll({
            where: { contentId: contentId }, 
            order: [['createdAt', 'DESC']],
            include: [
                { model: User, as: 'user', attributes: ['username', 'photo'] } 
            ]
        });

        console.log(`[API Comments GET] Found ${comments.length} comments for content ID: ${contentId}`);
        
        // Explicitly map to plain objects to ensure clean JSON structure
        const commentsData = comments.map(comment => ({
            id: comment.id,
            contentId: comment.contentId,
            userId: comment.userId,
            commentText: comment.commentText, // Use the correct field name from the model
            createdAt: comment.createdAt,
            updatedAt: comment.updatedAt,
            user: comment.user ? { // Access associated user data via alias
                username: comment.user.username,
                photo: comment.user.photo
            } : null
        }));

        console.log(`[API Comments GET] Sending ${commentsData.length} mapped comments for content ID: ${contentId}`);
        res.json(commentsData);
         
    } catch (error) {
        console.error(`[API Comments GET] Error fetching comments for content ID ${req.params.contentId}:`, error);
        res.status(500).json({ error: 'Failed to fetch comments.' });
    }
});

// POST Comment to Content (Protected)
// routes/api.js

// ... (previous routes) ...

// POST Comment to Content (Protected)
router.post('/content/:contentId/comments', isAuthenticated, async (req, res) => {
    if (!req.user || !req.user.id) {
        return res.status(401).json({ error: 'User not authenticated.' });
    }
    // --- CHANGE THIS LINE ---
    // Instead of { text }, destructure { commentText } to match the client payload.
    const { commentText } = req.body; // <-- MODIFIED HERE
    // --- END CHANGE ---

    const userId = req.user.id;
    const contentId = req.params.contentId;

    // --- Adjust console.log and validation to use 'commentText' ---
    console.log(`[API Comments POST] User ${userId} posting comment to content ${contentId}: "${commentText}"`);

    if (!commentText || commentText.trim() === '') { // <-- MODIFIED HERE
        console.log(`[API Comments POST] Validation failed: Comment text is empty.`);
        return res.status(400).json({ error: 'Comment text cannot be empty.' });
    }
    // --- End Adjustments ---

    try {
        // Optional: Validate content exists before creating comment
        const content = await GeneratedContent.findByPk(contentId);
        if (!content) {
            console.log(`[API Comments POST] Content not found for ID: ${contentId}`);
            return res.status(404).json({ error: 'Content not found.' });
        }

        const newComment = await ImageComment.create({
            commentText: commentText.trim(), // This line was already correct!
            userId: userId,
            contentId: contentId
        });

        // Fetch the comment again to include the username and photo for the client-side update
        const commentWithUser = await ImageComment.findByPk(newComment.id, {
            include: [{ model: User, as: 'user', attributes: ['username', 'photo'] }] // <-- ADDED 'photo' here for consistency
        });

        console.log(`[API Comments POST] Comment saved successfully with ID: ${newComment.id}`);
        // Respond with the created comment including user info (username and photo)
        res.status(201).json({
            id: commentWithUser.id,
            commentText: commentWithUser.commentText,
            createdAt: commentWithUser.createdAt,
            user: commentWithUser.user ? { username: commentWithUser.user.username, photo: commentWithUser.user.photo } : null // <-- ADDED 'photo' here for response
        });

    } catch (error) {
        console.error(`[API Comments POST] Error saving comment for user ${userId} on content ${contentId}:`, error);
        res.status(500).json({ error: 'Failed to save comment.' });
    }
});


// DELETE Content (Protected, User must own content)
router.delete('/content/:contentId', isAuthenticated, async (req, res) => {
    const contentId = req.params.contentId;
    const userId = req.user.id;
    console.log(`[API Delete] User ${userId} attempting to delete content ID: ${contentId}`);

    try {
        const content = await GeneratedContent.findOne({ 
            where: { id: contentId, userId: userId } 
        });

        if (!content) {
            // Check if content exists but belongs to another user
            const exists = await GeneratedContent.count({ where: { id: contentId } });
            if (exists) {
                console.log(`[API Delete] Forbidden: User ${userId} does not own content ID: ${contentId}`);
                return res.status(403).json({ error: 'You do not have permission to delete this content.' });
            } else {
                console.log(`[API Delete] Content not found for ID: ${contentId}`);
                return res.status(404).json({ error: 'Content not found.' });
            }
        }

        // Proceed with deletion
        const imageUrlPath = content.imageUrl; // e.g., /uploads/generated_images/user-123-abc.png

        // 1. Delete comments associated with the content
        await ImageComment.destroy({ where: { contentId: contentId } });
        console.log(`[API Delete] Deleted comments for content ID: ${contentId}`);

        // 2. Delete the content record from the database
        await content.destroy();
        console.log(`[API Delete] Deleted content record from DB for ID: ${contentId}`);

        // 3. Delete the associated image file (if it exists)
        if (imageUrlPath) {
            // Construct the full path relative to the project root
            // Assuming imageUrlPath is like '/uploads/generated_images/filename.png'
            // and the script is run from the project root, or paths are adjusted
            const PROJECT_ROOT = path.join(__dirname, '..'); // Go up one level from routes directory
            const fullImagePath = path.join(PROJECT_ROOT, 'public', imageUrlPath);
            
            try {
                await fs.access(fullImagePath); // Check if file exists
                await fs.unlink(fullImagePath);
                console.log(`[API Delete] Deleted image file: ${fullImagePath}`);
            } catch (fileError) {
                if (fileError.code === 'ENOENT') {
                    console.warn(`[API Delete] Image file not found, skipping deletion: ${fullImagePath}`);
                } else {
                    console.error(`[API Delete] Error deleting image file ${fullImagePath}:`, fileError);
                    // Decide if this should be a fatal error - maybe not, DB entry is gone.
                }
            }
        } else {
             console.warn(`[API Delete] No image URL found for content ID: ${contentId}, skipping file deletion.`);
        }

        res.status(200).json({ success: true, message: 'Content deleted successfully.' });

    } catch (error) {
        console.error(`[API Delete] Error deleting content ID ${contentId} for user ${userId}:`, error);
        // Check for specific Sequelize errors if needed
        if (error instanceof Sequelize.ForeignKeyConstraintError) {
             console.error('[API Delete] ForeignKey Constraint Error during deletion. This might indicate related data still exists.');
        }
        res.status(500).json({ error: 'Failed to delete content.' });
    }
});

// POST Upload Image (for Img2Img source - Protected)
// Use the 'generalUpload' middleware which saves to disk
router.post('/upload-image', isAuthenticated, generalUpload.single('uploadedImage'), async (req, res) => { 
    console.log('[API Upload Image] Received request.');

    if (!req.file) {
        console.log('[API Upload Image] Error: No image file provided in request.');
        // Multer's fileFilter might have already sent an error, but this catches cases where file is just missing
        return res.status(400).json({ success: false, error: 'No image file uploaded.' });
    }
    // If multer's fileFilter rejected, the request might not reach here, 
    // but if it did, req.file might exist but have an error flag.
    // Better to rely on the middleware handling errors or catching them in an error handler.

    const userId = req.user.id;
    const uploadedFilePath = req.file.path; // Full path from diskStorage
    const originalFilename = req.file.originalname;
    console.log(`[API Upload Image] User ${userId} uploaded file: ${originalFilename}, saved to: ${uploadedFilePath}`);

    try {
        // Use Sharp to get metadata and potentially resize/convert
        const imageBuffer = await fs.readFile(uploadedFilePath);
        const metadata = await sharp(imageBuffer).metadata();
        console.log(`[API Upload Image] Original image (${originalFilename}): ${metadata.width}x${metadata.height}, format: ${metadata.format}`);
        
        // --- Simple Response: Return the path/URL of the saved file --- 
        // The file is already saved by multer's diskStorage
        // We just need to provide a web-accessible URL path
        const relativePath = path.relative(path.join(__dirname, '..', 'public'), uploadedFilePath);
        const imageUrl = `/${relativePath.replace(/\\/g, '/')}`; // Convert backslashes to forward slashes for URL
        
        console.log(`[API Upload Image] Successfully processed upload for user ${userId}. Image URL: ${imageUrl}`);
        res.json({ 
            success: true, 
            message: 'Image uploaded successfully.',
            publicImageUrl: imageUrl, // URL for client use
            // Optionally include dimensions if needed by client immediately
            // width: metadata.width, 
            // height: metadata.height
        });

        // Optional: Schedule deletion of the uploaded file after a delay if it's temporary
        // const deletionTimeout = 15 * 60 * 1000; // 15 minutes
        // setTimeout(async () => {
        //     try {
        //         await fs.unlink(uploadedFilePath);
        //         console.log(`[API Upload Image] Automatically deleted temporary upload: ${uploadedFilePath}`);
        //     } catch (error) {
        //         console.warn(`[API Upload Image] Failed to delete temporary upload ${uploadedFilePath}: ${error.message}`);
        //     }
        // }, deletionTimeout);

    } catch (error) {
        console.error(`[API Upload Image] Error processing uploaded file ${uploadedFilePath} for user ${userId}:`, error);
        // Clean up the uploaded file if processing failed
        try {
            await fs.unlink(uploadedFilePath);
            console.log(`[API Upload Image] Cleaned up failed upload: ${uploadedFilePath}`);
        } catch (cleanupError) {
            console.error(`[API Upload Image] Error cleaning up failed upload ${uploadedFilePath}:`, cleanupError);
        }
        
        // Check for specific sharp errors
        if (error.message.includes('Input buffer contains unsupported image format')) {
             return res.status(400).json({ success: false, error: 'Unsupported image format.' });
        }
        res.status(500).json({ success: false, error: 'Image processing failed.', details: error.message });
    }
});




// GET Content Details (Public)
router.get('/content-details/:id', async (req, res) => {
    console.log(`[API Content Details] Request for ID: ${req.params.id}`);
    try {
        const contentId = req.params.id;
        const content = await GeneratedContent.findByPk(contentId, {
            include: [
                { 
                    model: User, 
                    as: 'user', 
                    attributes: ['username'] 
                }, 
                { 
                    model: ImageComment, 
                    as: 'comments', 
                    include: [{ model: User, as: 'user', attributes: ['username'] }],
                    order: [['createdAt', 'DESC']] 
                }
            ]
        });

        if (!content) {
            console.log(`[API Content Details] Content not found for ID: ${contentId}`);
            return res.status(404).json({ error: 'Content not found' });
        }

        console.log(`[API Content Details] Found content for ID: ${contentId}, Title: ${content.title}`);
        
        // Construct the full response object
        const responseData = {
            id: content.id,
            title: content.title,
            prompt: content.prompt,
            negativePrompt: content.negativePrompt,
            modelUsed: content.modelUsed,
            imageUrl: content.imageUrl, 
            isPublic: content.isPublic,
            createdAt: content.createdAt,
            // Add user info if available
            user: content.user ? { username: content.user.username } : null,
            // Map comments to include username
            comments: content.comments.map(comment => ({
                id: comment.id,
                text: comment.text,
                createdAt: comment.createdAt,
                user: comment.user ? { username: comment.user.username } : null
            })).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)) // Ensure descending order
        };

        // Debugging: Log the content.user object before sending response
        console.log('[API Content Details] Content object before response:', JSON.stringify(content, null, 2));

        res.json(responseData);
    } catch (error) {
        console.error(`[API Content Details] Error fetching content details for ID ${req.params.id}:`, error);
        res.status(500).json({ error: 'Internal server error while fetching content details.' });
    }
});

// GET Download Image
router.get('/download-image/:contentId', async (req, res) => {
    const { contentId } = req.params;
    console.log(`[API Route] Download request received for contentId: ${contentId}`);

    try {
        const content = await GeneratedContent.findByPk(contentId);

        if (!content || !content.contentUrl) {
            console.log(`[API Download] Content not found or contentUrl missing for ID: ${contentId}`);
            return res.status(404).send('Image not found or URL is missing.');
        }

        console.log(`[API Download] Found contentUrl: ${content.contentUrl}`);
        const imageUrl = content.contentUrl;
        const filename = `pixzor_content_${contentId}${path.extname(new URL(imageUrl).pathname) || '.jpg'}`;
        console.log(`[API Download] Attempting to fetch image for download. Filename: ${filename}`);

        // Fetch the image from the external URL as a stream
        const response = await axios({
            method: 'get',
            url: imageUrl,
            responseType: 'stream',
        });

        // Set headers to trigger download
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        // Try to get content type from Runware response, default to application/octet-stream
        const contentType = response.headers['content-type'] || 'application/octet-stream';
        res.setHeader('Content-Type', contentType);
        console.log(`[API Download] Streaming image with Content-Type: ${contentType}`);

        // Pipe the image stream directly to the client response
        response.data.pipe(res);

        response.data.on('end', () => {
            console.log(`[API Download] Finished streaming image for ${contentId}`);
        });

        response.data.on('error', (err) => {
            console.error(`[API Download] Error streaming image data for ${contentId}:`, err);
            // Important: Try to end the response if headers weren't sent yet
            if (!res.headersSent) {
                res.status(500).send('Error downloading image data.');
            } else {
                // If headers are sent, we might not be able to send a new status
                // The connection might just terminate abruptly for the client
                res.end(); 
            }
        });

    } catch (error) {
        console.error(`[API Download] Error fetching image for contentId ${contentId}:`, error.message);
        // Check if it's an Axios error to provide more detail
        if (error.response) {
            console.error('[API Download] Axios error details:', {
                 status: error.response.status,
                 headers: error.response.headers,
                 data: error.response.data // Careful logging data, might be large
             });
             res.status(error.response.status || 500).send('Failed to fetch the image from the source.');
        } else if (error.request) {
             console.error('[API Download] Axios request error (no response):', error.request);
             res.status(502).send('No response received from image source.');
        } else {
             // Generic server error
             res.status(500).send('Server error while processing download request.');
        }
    }
});


// Like an image (Protected)
router.post('/content/:contentId/like', isAuthenticated, async (req, res) => {
    const userId = req.user.id;
    const contentId = req.params.contentId;
    console.log(`[API Like] User ${userId} attempting to like content ID: ${contentId}`);

    try {
        const content = await GeneratedContent.findByPk(contentId);
        if (!content) {
            console.log(`[API Like] Content not found for ID: ${contentId}`);
            return res.status(404).json({ error: 'Content not found' });
        }

        // Check if the user has already liked this content
        const existingLike = await ImageLike.findOne({ where: { contentId, userId } });
        if (existingLike) {
            // If already liked, perhaps the client-side logic should prevent this call,
            // but we can return the current state.
            const currentLikeCount = await ImageLike.count({ where: { contentId } });
            console.log(`[API Like] User ${userId} already liked content ID: ${contentId}. Current count: ${currentLikeCount}`);
            return res.status(200).json({ // Changed from 400 to 200 as it's not an error, just a state
                message: 'You already liked this image',
                likeCount: currentLikeCount,
                isLiked: true
            });
        }

        // Create the new like
        await ImageLike.create({ contentId, userId, createdAt: new Date() });
        console.log(`[API Like] Like added for content ID: ${contentId} by user ${userId}`);
        
        // Get the new total like count for this content
        const likeCount = await ImageLike.count({ where: { contentId } });
        
        // Respond with success, new like count, and liked status
        res.status(201).json({ // 201 Created
            success: true,
            message: 'Image liked successfully.',
            likeCount: likeCount,
            isLiked: true
        });
    } catch (error) {
        console.error(`[API Like] Error liking content ID ${contentId} for user ${userId}:`, error);
        res.status(500).json({ error: 'Failed to like image' });
    }
});

router.delete('/content/:contentId/like', isAuthenticated, async (req, res) => {
    const userId = req.user.id;
    const contentId = req.params.contentId;
    console.log(`[API Unlike] User ${userId} attempting to unlike content ID: ${contentId}`);

    try {
        const like = await ImageLike.findOne({ where: { contentId, userId } });
        if (!like) {
            // If not liked, perhaps the client-side logic should prevent this call,
            // but we can return the current state.
            const currentLikeCount = await ImageLike.count({ where: { contentId } });
            console.log(`[API Unlike] User ${userId} has not liked content ID: ${contentId}. Current count: ${currentLikeCount}`);
            return res.status(200).json({ // Changed from 400 to 200
                message: 'You have not liked this image',
                likeCount: currentLikeCount,
                isLiked: false
            });
        }

        await like.destroy();
        console.log(`[API Unlike] Like removed for content ID: ${contentId} by user ${userId}`);
        
        // Get the new total like count for this content
        const likeCount = await ImageLike.count({ where: { contentId } });

        // Respond with success, new like count, and liked status
        res.status(200).json({
            success: true,
            message: 'Image unliked successfully.',
            likeCount: likeCount,
            isLiked: false
        });
    } catch (error) {
        console.error(`[API Unlike] Error unliking content ID ${contentId} for user ${userId}:`, error);
        res.status(500).json({ error: 'Failed to unlike image' });
    }
});

// Update /gallery-content to include like data

module.exports = router;
