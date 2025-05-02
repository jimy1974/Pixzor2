const express = require('express');
const router = express.Router();
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const sharp = require('sharp');
const { User, GeneratedContent } = require('../db'); // Adjust path as necessary
const { isAuthenticated } = require('../middleware/authMiddleware'); // Adjust path as necessary
const { runwareUpload } = require('../config/multerConfig'); // Adjust path as necessary
const { RUNWARE_MODELS } = require('../config/modelsConfig'); // Adjust path as necessary
const { calculateDimensionsForRatio, deductCredits, saveImageFromUrl } = require('../utils/helpers'); // Renamed deductTokens to deductCredits
const { uploadImageBufferToGcs } = require('../utils/gcsUtils'); // --- Import GCS Util --- 
const fs = require('fs').promises; // Needed if we were deleting, but we are using memory storage

// Text-to-Image Route (Protected)
// No file upload expected here, but ensure user is authenticated
router.post('/text-to-image', isAuthenticated, async (req, res) => {
    if (!req.user || !req.user.id) {
        // Redundant check due to isAuthenticated, but good practice
        return res.status(401).json({ success: false, error: 'User not authenticated.' });
    }

    const userId = req.user.id;
    console.log(`[Generate Txt2Img] User ${userId} request received.`);

    try {
        const { prompt, modelId, aspectRatio, styleName, negativePrompt } = req.body; // Removed tokenCost
        console.log(`[Generate Txt2Img] Params: modelId=${modelId}, aspect=${aspectRatio}, styleName=${styleName}, prompt=${prompt}`);

        const modelConfig = RUNWARE_MODELS[modelId] || Object.values(RUNWARE_MODELS).find(m => m.id === modelId);
        if (!modelConfig) {
            console.error(`[Generate Txt2Img] Unsupported model ID: ${modelId}`);
            return res.status(400).json({ success: false, error: 'Unsupported model selected.' });
        }
        console.log(`[Generate Txt2Img] Using model config: ${modelConfig.name}`);

        // Determine the cost to deduct based on the model config
        const costToDeduct = modelConfig.userPriceT2I;
        if (typeof costToDeduct !== 'number' || costToDeduct < 0) {
            console.error(`[Generate Txt2Img] Invalid user price for model ${modelId}: ${costToDeduct}`);
            return res.status(400).json({ success: false, error: 'Invalid cost configuration for this model.' });
        }
        console.log(`[Generate Txt2Img] Calculated user cost: $${costToDeduct}`);

        // Deduct credits BEFORE making the API call
        try {
            await deductCredits(userId, costToDeduct);
            console.log(`[Generate Txt2Img] Credits deducted successfully for user ${userId}. Cost: $${costToDeduct}`);
        } catch (creditError) {
            console.error(`[Generate Txt2Img] Credit deduction error for user ${userId}:`, creditError.message);
            const userFriendlyError = creditError.message.includes('Insufficient credits') 
                                    ? 'Insufficient credits to perform this generation.' 
                                    : 'Failed to process credit deduction.';
            return res.status(402).json({ success: false, error: userFriendlyError }); // 402 Payment Required
        }

        // Calculate dimensions (use helper)
        const baseDimension = modelConfig.baseDimension || 1024;
        const calculatedDimensions = calculateDimensionsForRatio(aspectRatio, baseDimension);

        // Prepare Runware API payload
        const taskUUID = uuidv4();
        let apiParams = {
            taskType: modelConfig.taskType || 'imageInference', // Use specific taskType if defined (like photoMaker)
            taskUUID: taskUUID,
            positivePrompt: prompt || modelConfig.defaultPrompt || 'A stunning image', // Use default if provided
            negativePrompt: negativePrompt || modelConfig.defaultParams?.negativePrompt || 'low quality, blurry', // Ensure a valid default
            numberResults: 1,
            width: modelConfig.width || calculatedDimensions.width, // Use fixed width if defined, else calculated
            height: modelConfig.height || calculatedDimensions.height, // Use fixed height if defined, else calculated
            outputFormat: 'JPEG', // Or 'PNG' if preferred
            outputType: ['URL'], // We need the URL to save it
            includeCost: true,
            model: modelId, // --- ADDED: The crucial model identifier --- 
            ...modelConfig.defaultParams, // Spread default model params (steps, CFG, scheduler)
        };

        const originalPrompt = prompt; // Keep original for DB maybe?
        let finalPrompt = prompt || modelConfig.defaultPrompt || 'A stunning image'; // Start with base prompt

        // --- START: Append Style to Prompt Logic --- 
        const requestedStyleName = req.body.styleName; // Use the display name sent from frontend

        if (requestedStyleName && requestedStyleName.trim() !== '' && requestedStyleName.toLowerCase() !== 'none') {
             // Format the style name (e.g., 'Disney Pixel Art' -> 'Disney Pixel Art')
             // The formatting might be less necessary now if the name is already clean, but keep for robustness
             const formattedStyle = requestedStyleName
                 .replace(/[-_]/g, ' ') // Replace hyphens/underscores with spaces
                 .split(' ')
                 .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()) // Capitalize each word
                 .join(' ');
            
             // Append the formatted style to the prompt
             // Check if the prompt already ends with a style (simple check)
             if (!finalPrompt.toLowerCase().endsWith(' style')) {
                 finalPrompt += `, ${formattedStyle} Style`;
                 console.log(`[Generate Txt2Img] Appended style to prompt. New prompt: "${finalPrompt}"`);
             } else {
                 console.log(`[Generate Txt2Img] Style detected in prompt already or style is 'None'. Not appending: "${finalPrompt}"`);
             }
        }
        // --- END: Append Style to Prompt Logic --- 

        apiParams.positivePrompt = finalPrompt; // Use the potentially modified prompt

        console.log(`[Generate Txt2Img] CHECKING apiParams.model before stringify:`, apiParams.model);
        console.log(`[Generate Txt2Img] Sending payload for ${modelConfig.name} (Task ${taskUUID}):`, JSON.stringify([apiParams], null, 2));

        // Make the API call to Runware
        const response = await axios.post(
            'https://api.runware.ai/v1',
            [apiParams], // API expects an array of tasks
            {
                headers: {
                    'Authorization': `Bearer ${process.env.RUNWARE_API_KEY}`,
                    'Content-Type': 'application/json',
                },
                timeout: 120000, // 120 seconds timeout
            }
        );

        // Validate Runware response
        if (!response.data || response.data.error || !response.data.data || response.data.data.length === 0) {
            console.error('[Generate Txt2Img] Runware API Error Response:', JSON.stringify(response.data, null, 2));
            const errorDetail = response.data?.error || response.data?.data?.[0]?.error || { message: 'Unknown Runware API error.' };
            // Attempt to refund credits on API failure
            try { await deductCredits(userId, -costToDeduct); console.log(`[Generate Txt2Img] Credits refunded for user ${userId} due to API error.`); } catch(refundError) { console.error(`[Generate Txt2Img] CRITICAL: Failed to refund credits for user ${userId} after API error:`, refundError); }
            throw new Error(errorDetail.message || 'Runware API returned an invalid response.');
        }

        const resultData = response.data.data[0];
        if (!resultData.imageURL) {
            console.error('[Generate Txt2Img] Runware API did not return imageURL:', JSON.stringify(resultData, null, 2));
            // Attempt to refund credits
             try { await deductCredits(userId, -costToDeduct); console.log(`[Generate Txt2Img] Credits refunded for user ${userId} due to missing imageURL.`); } catch(refundError) { console.error(`[Generate Txt2Img] CRITICAL: Failed to refund credits for user ${userId} after missing imageURL:`, refundError); }
            throw new Error('Runware failed to return the generated image URL.');
        }

        console.log(`[Generate Txt2Img] Runware Success (Task ${resultData.taskUUID || taskUUID}). Cost: ${resultData.cost}, URL: ${resultData.imageURL}`);

        // --- START: GCS Upload Logic for Text-to-Image --- 
        let finalImageUrl_Txt2Img = resultData.imageURL; // Default to Runware URL
        try {
            console.log(`[Generate Txt2Img] Attempting download from Runware URL: ${resultData.imageURL}`);
            const imageResponse = await axios.get(resultData.imageURL, { responseType: 'arraybuffer' });
            const imageBuffer = Buffer.from(imageResponse.data, 'binary');
            const contentType = imageResponse.headers['content-type'] || 'image/jpeg'; 
            const fileExtension = contentType.split('/')[1] || 'jpg';
            const uniqueFilename = `${uuidv4()}.${fileExtension}`;

            console.log(`[Generate Txt2Img] Preparing GCS Upload. Filename: ${uniqueFilename}, ContentType: ${contentType}, Buffer Size: ${imageBuffer ? imageBuffer.length : 'null'}`);
            const gcsUrl = await uploadImageBufferToGcs(imageBuffer, uniqueFilename, contentType);

            if (gcsUrl) {
                console.log(`[Generate Txt2Img] GCS Upload successful: ${gcsUrl}`);
                finalImageUrl_Txt2Img = gcsUrl; // Use GCS URL if successful
            } else {
                console.error('[Generate Txt2Img] GCS Upload failed. Falling back to Runware URL.');
            }
        } catch (gcsUploadError) {
            console.error('[Generate Txt2Img] Error during image download or GCS upload process. Falling back to Runware URL.', gcsUploadError);
            // Attempt to refund credits if GCS fails? Maybe too complex.
        }
        console.log(`[Generate Txt2Img] Final Image URL: ${finalImageUrl_Txt2Img}, Cost: ${costToDeduct}`);
        // --- END: GCS Upload Logic for Text-to-Image ---

        // Create Database Record
        const newContent = await GeneratedContent.create({
            userId: userId,
            type: 'image',
            contentUrl: finalImageUrl_Txt2Img, // Use GCS URL or Runware fallback
            prompt: originalPrompt, // Save the original user prompt to DB
            negativePrompt: apiParams.negativePrompt,
            modelUsed: modelConfig.name, // Store human-readable name or modelId
            modelId: modelConfig.id, // Store the specific ID used
            width: apiParams.width,
            height: apiParams.height,
            steps: apiParams.steps,
            cfgScale: apiParams.CFGScale,
            scheduler: apiParams.scheduler,
            style: apiParams.style || (apiParams.lora ? apiParams.lora[0].model : null),
            tokenCost: costToDeduct, // Store the user price (credits) deducted
            apiResponseId: resultData.taskUUID || taskUUID, 
            isPublic: false, // Default to private
        });
        console.log(`[Generate Txt2Img DB] Saved generated image record with ID: ${newContent.id}`);

        // Respond to client with success
        res.json({ 
            success: true, 
            message: 'Image generated successfully!',
            imageId: newContent.id, // Send the DB ID
            imageUrl: finalImageUrl_Txt2Img, // Send GCS/fallback URL
            prompt: originalPrompt, // Return original prompt to client?
            cost: costToDeduct // Return the user price (credits) deducted
        });

    } catch (error) {
        console.error(`[Generate Txt2Img] Overall Error for user ${userId}:`, error.message);
        // Log details if available (e.g., from Axios or token errors)
        if (error.response?.data) {
             console.error('[Generate Txt2Img] Axios error details:', error.response.data);
        }
        // Avoid sending detailed internal errors to the client
        const clientErrorMessage = error.message.includes('Insufficient credits') 
                                   ? 'Insufficient credits for generation.' 
                                   : (error.message.startsWith('Runware') || error.message.startsWith('Failed to download')) 
                                        ? 'Image generation service failed. Please try again later.' 
                                        : 'An unexpected error occurred during image generation.';
        
        const statusCode = error.message.includes('Insufficient credits') ? 402 : 500;
        
        res.status(statusCode).json({ success: false, error: clientErrorMessage });
    }
}); // Restore the closing parenthesis here


// Image-to-Image Route (Protected)
// Uses runwareUpload middleware to handle the 'image' field in FormData
router.post('/image-to-image', isAuthenticated, runwareUpload.single('image'), async (req, res) => {
    if (!req.user || !req.user.id) {
        return res.status(401).json({ success: false, error: 'User not authenticated.' });
    }
    // Check if file was uploaded by multer
    if (!req.file) {
        console.log('[Generate Img2Img] No image file uploaded.');
        return res.status(400).json({ success: false, error: 'No image file provided.' });
    }

    const userId = req.user.id;
    console.log(`[Generate Img2Img] User ${userId} request received. File: ${req.file.originalname}, Size: ${req.file.size}`);

    try {
        // Extract parameters from request body
        const { prompt, modelId, strength, width, height, style, negativePrompt } = req.body; // Removed tokenCost
        console.log(`[Generate Img2Img] Params: modelId=${modelId}, strength=${strength}, size=${width}x${height}, style=${style}, prompt=${prompt}`);

        const modelConfig = RUNWARE_MODELS[modelId] || Object.values(RUNWARE_MODELS).find(m => m.id === modelId);
        if (!modelConfig) {
            console.error(`[Generate Img2Img] Unsupported model ID: ${modelId}`);
            return res.status(400).json({ success: false, error: 'Unsupported model selected.' });
        }
        console.log(`[Generate Img2Img] Using model config: ${modelConfig.name}`);

        // Determine the cost to deduct based on the model config and type
        let costToDeduct;
        if (modelConfig.taskType === 'photoMaker') {
            costToDeduct = modelConfig.userPrice;
        } else {
            costToDeduct = modelConfig.userPriceI2I;
        }

        if (typeof costToDeduct !== 'number' || costToDeduct < 0) {
            console.error(`[Generate Img2Img] Invalid user price for model ${modelId}: ${costToDeduct}`);
            return res.status(400).json({ success: false, error: 'Invalid cost configuration for this model.' });
        }
         console.log(`[Generate Img2Img] Calculated user cost: $${costToDeduct}`);

        // Deduct credits BEFORE making the API call
        try {
            await deductCredits(userId, costToDeduct);
            console.log(`[Generate Img2Img] Credits deducted successfully for user ${userId}. Cost: $${costToDeduct}`);
        } catch (creditError) {
            console.error(`[Generate Img2Img] Credit deduction error for user ${userId}:`, creditError.message);
            const userFriendlyError = creditError.message.includes('Insufficient credits') 
                                    ? 'Insufficient credits to perform this generation.' 
                                    : 'Failed to process credit deduction.';
            return res.status(402).json({ success: false, error: userFriendlyError });
        }

        // Get image dimensions using sharp
        let imageMetadata;
        try {
            imageMetadata = await sharp(req.file.buffer).metadata();
        } catch (sharpError) {
            console.error(`[Generate Img2Img] Sharp failed to read input image metadata:`, sharpError);
             // Attempt credit refund
             try { await deductCredits(userId, -costToDeduct); } catch(e) {}
            return res.status(400).json({ success: false, error: 'Could not process input image.' });
        }
        
        if (!imageMetadata.width || !imageMetadata.height) {
            console.error(`[Generate Img2Img] Invalid image dimensions from sharp: ${imageMetadata.width}x${imageMetadata.height}`);
             // Attempt credit refund
             try { await deductCredits(userId, -costToDeduct); } catch(e) {}
            return res.status(400).json({ success: false, error: 'Invalid input image dimensions.' });
        }
        console.log(`[Generate Img2Img] Input image dimensions: ${imageMetadata.width}x${imageMetadata.height}`);

        // Prepare Runware API payload
        const taskUUID = uuidv4();
        const base64Image = req.file.buffer.toString('base64');
        const inputImage = `data:${req.file.mimetype};base64,${base64Image}`;

        let apiParams = {
            model: modelId, // Add the model ID
            taskType: modelConfig.taskType || 'imageInference', // Usually 'imageInference' for img2img, 'photoMaker' for photomaker
            taskUUID: taskUUID,
            positivePrompt: prompt || modelConfig.defaultPrompt || 'A transformation based on the image',
            negativePrompt: negativePrompt || modelConfig.defaultParams?.negativePrompt || 'ugly', // Include negative prompt
            seedImage: inputImage,
            numberResults: 1,
            // Use dimensions from request, model config, or fallback to input image dimensions
            width: parseInt(width) || modelConfig.width || imageMetadata.width, 
            height: parseInt(height) || modelConfig.height || imageMetadata.height,
            outputFormat: 'JPEG',
            outputType: ['URL'], // We need the URL to save it
            includeCost: true,
            // Optional parameters based on model config defaults
            ...(modelConfig.defaultParams?.steps && { steps: modelConfig.defaultParams.steps }),
            ...(modelConfig.defaultParams?.guidance_scale && { CFGScale: parseFloat(modelConfig.defaultParams.guidance_scale) }), // Ensure CFGScale is a number
            ...(modelConfig.defaultParams?.scheduler && { scheduler: modelConfig.defaultParams.scheduler }),
            // Include strength from request or model default
            strength: parseFloat(strength) || parseFloat(modelConfig.defaultParams?.strength || '0.75'),
            // Seed (only if model supports it and a seed is provided, otherwise omitted)
            // Style/LoRA handling
        };

        // Handle style parameter for img2img (if applicable)
        let styleValue = style || req.body.style || null;
        if (styleValue && styleValue.startsWith('civitai:')) {
            // Handle LoRA style
            console.log(`[Generate Img2Img] Adding LoRA: ${styleValue}`);
            apiParams.lora = [{ model: styleValue, weight: 1 }];
            // Also append the style name to the prompt if it's a recognizable style
            const styleName = styleValue.split('@')[0].replace('civitai:', ''); // Extract a readable name if possible
            // Use styleLabel if provided by the client, otherwise fall back to the extracted ID
            const readableStyleName = req.body.styleLabel || styleName;
            apiParams.positivePrompt = `${prompt}, in the style of ${readableStyleName} style`;
        } else if (styleValue && modelConfig.usesPromptBasedStyling) {
            // Handle appending prompt-based styles if the model supports it for img2img (less common)
            console.log(`[Generate Img2Img] Appending prompt-based style: ${styleValue}`);
            apiParams.positivePrompt = `${prompt}, in the style of ${styleValue} style`;
        }

        // PhotoMaker specific style parameter
        if (modelConfig.taskType === 'photoMaker') {
            apiParams.style = (style || modelConfig.defaultStyle || 'photographic').toLowerCase();
            console.log(`[Generate Img2Img] Applying PhotoMaker style: ${apiParams.style}`);
            apiParams.inputImages = [inputImage];
            delete apiParams.seedImage;
            // PhotoMaker requires strength as an integer between 15 and 50
            apiParams.strength = Math.min(Math.max(parseInt(strength) || 15, 15), 50);
        } else {
            apiParams.strength = parseFloat(strength) || 0.75;
            apiParams.seedImage = inputImage;
        }

        console.log(`[Generate Img2Img] Sending payload for ${modelConfig.name} (Task ${taskUUID}):`, JSON.stringify([apiParams], null, 2));

        // Make the API call to Runware directly with axios
        const response = await axios.post(
            'https://api.runware.ai/v1',
            [apiParams],
            {
                headers: {
                    'Authorization': `Bearer ${process.env.RUNWARE_API_KEY}`,
                    'Content-Type': 'application/json',
                },
                timeout: 120000, // 120 seconds
            }
        );

        // Validate Response
        if (!response.data || response.data.error || !response.data.data || response.data.data.length === 0) {
            console.error('[Generate Img2Img] Runware API Error Response:', JSON.stringify(response.data, null, 2));
            const errorDetail = response.data?.error || response.data?.data?.[0]?.error || { message: 'Unknown Runware API error.' };
            // Attempt to refund credits
            try { await deductCredits(userId, -costToDeduct); console.log(`[Generate Img2Img] Credits refunded for user ${userId} due to API error.`); } catch(refundError) { console.error(`[Generate Img2Img] CRITICAL: Failed to refund credits for user ${userId} after API error:`, refundError); }
            throw new Error(errorDetail.message || 'Runware API returned an invalid response.');
        }

        const resultData = response.data.data[0];
        // Validate response structure
        if (!resultData.imageURL) {
            console.error('[Generate Img2Img] Runware API did not return imageURL:', JSON.stringify(resultData, null, 2));
            // Attempt to refund credits
             try { await deductCredits(userId, -costToDeduct); console.log(`[Generate Img2Img] Credits refunded for user ${userId} due to missing imageURL.`); } catch(refundError) { console.error(`[Generate Img2Img] CRITICAL: Failed to refund credits for user ${userId} after missing imageURL:`, refundError); }
            throw new Error('Runware failed to return the generated image URL.');
        }

        console.log(`[Generate Img2Img] Runware Success (Task ${taskUUID}). Cost: ${resultData.cost}, URL: ${resultData.imageURL}`);

        // --- START: GCS Upload Logic for Image-to-Image --- 
        let finalImageUrl_Img2Img = resultData.imageURL; // Default to Runware URL
        try {
            console.log(`[Generate Img2Img] Attempting download from Runware URL: ${resultData.imageURL}`);
            const imageResponse = await axios.get(resultData.imageURL, { responseType: 'arraybuffer' });
            const imageBuffer = Buffer.from(imageResponse.data, 'binary');
            const contentType = imageResponse.headers['content-type'] || 'image/jpeg'; 
            const fileExtension = contentType.split('/')[1] || 'jpg';
            const uniqueFilename = `${uuidv4()}.${fileExtension}`;

            console.log(`[Generate Img2Img] Preparing GCS Upload. Filename: ${uniqueFilename}, ContentType: ${contentType}, Buffer Size: ${imageBuffer ? imageBuffer.length : 'null'}`);
            const gcsUrl = await uploadImageBufferToGcs(imageBuffer, uniqueFilename, contentType);

            if (gcsUrl) {
                console.log(`[Generate Img2Img] GCS Upload successful: ${gcsUrl}`);
                finalImageUrl_Img2Img = gcsUrl; // Use GCS URL if successful
            } else {
                console.error('[Generate Img2Img] GCS Upload failed. Falling back to Runware URL.');
            }
        } catch (gcsUploadError) {
            console.error('[Generate Img2Img] Error during image download or GCS upload process. Falling back to Runware URL.', gcsUploadError);
             // Attempt to refund credits if GCS fails? Might be complex if cost was already deducted.
        }
         console.log(`[Generate Img2Img] Final Image URL: ${finalImageUrl_Img2Img}, Cost: ${costToDeduct}`);
        // --- END: GCS Upload Logic for Image-to-Image ---

        // Create Database Record
        const newContent = await GeneratedContent.create({
            userId: userId,
            type: 'image', // Keep type consistent as 'image'
            contentUrl: finalImageUrl_Img2Img, // Use GCS URL or fallback
            prompt: apiParams.positivePrompt,
            negativePrompt: apiParams.negativePrompt,
            modelUsed: modelConfig.name,
            modelId: modelConfig.id,
            width: apiParams.width,
            height: apiParams.height,
            steps: apiParams.steps,
            cfgScale: apiParams.CFGScale,
            scheduler: apiParams.scheduler,
            style: apiParams.style || (apiParams.lora ? apiParams.lora[0].model : null),
            strength: apiParams.strength, // Store the strength used
            // inputImageUrl: '?', // How to store reference to input? Maybe save input temp and link?
            tokenCost: costToDeduct, // Store the user price (credits) deducted
            apiResponseId: resultData.taskUUID || taskUUID,
            isPublic: false, // Default to private
        });
        console.log(`[Generate Img2Img DB] Saved generated image record with ID: ${newContent.id}`);

        // Respond to client
        res.json({ 
            success: true, 
             message: 'Image generated successfully!',
            imageId: newContent.id, // Send the DB ID
            imageUrl: finalImageUrl_Img2Img, // Send GCS/fallback URL
            prompt: apiParams.positivePrompt, // Send back the prompt used
            cost: costToDeduct // Send back the cost
        });

    } catch (error) {
        console.error(`[Generate Img2Img] Overall Error for user ${userId}:`, error.message);
         if (error.response?.data) {
             console.error('[Generate Img2Img] Axios error details:', error.response.data);
        }
        const clientErrorMessage = error.message.includes('Insufficient credits') 
                                   ? 'Insufficient credits for generation.' 
                                   : (error.message.startsWith('Runware') || error.message.startsWith('Failed to download') || error.message.startsWith('Could not process')) 
                                        ? 'Image generation service failed. Please try again later.' 
                                        : 'An unexpected error occurred during image generation.';
                                        
        const statusCode = error.message.includes('Insufficient credits') ? 402 : (error.message.includes('Could not process') ? 400 : 500);

        res.status(statusCode).json({ success: false, error: clientErrorMessage });
    }
});

// Middleware for handling Multer errors specifically (optional but good practice)
router.use((err, req, res, next) => {
    if (err instanceof multer.MulterError) {
        console.error('[Multer Error Handler]', err);
        // Customize messages based on err.code
        let message = 'Image upload error.';
        if (err.code === 'LIMIT_FILE_SIZE') {
            message = 'Image file is too large (max 10MB).';
        } else if (err.code === 'LIMIT_UNEXPECTED_FILE') {
            message = 'Unexpected file field received.';
        }
        return res.status(400).json({ success: false, error: message });
    } else if (err) {
        // Handle other errors passed from fileFilter etc.
        console.error('[File Filter/Other Error Handler]', err.message);
         // Check if the error message came from our custom filter
        if (err.message.includes('Invalid file type')) {
            return res.status(400).json({ success: false, error: err.message });
        } 
        // Fallback for other unexpected errors during upload/middleware phase
        return res.status(500).json({ success: false, error: 'An internal error occurred during file processing.' });
    }
    next();
});

module.exports = router;
