const express = require('express');
const router = express.Router();
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const sharp = require('sharp');
const { User, GeneratedContent } = require('../db'); 
const { isAuthenticated } = require('../middleware/authMiddleware'); 
const { runwareUpload } = require('../config/multerConfig'); // Multer middleware for file uploads
const { RUNWARE_MODELS } = require('../config/modelsConfig'); 
const { calculateDimensionsForRatio, deductCredits, saveImageFromUrl } = require('../utils/helpers'); 
const { uploadImageBufferToGcs } = require('../utils/gcsUtils'); 
const fs = require('fs').promises; // Not explicitly used for temp files with multer memory storage, but good for context

// Text-to-Image Route (Protected)
router.post('/text-to-image', isAuthenticated, async (req, res) => {
    if (!req.user || !req.user.id) {
        return res.status(401).json({ success: false, error: 'User not authenticated.' });
    }

    const userId = req.user.id;
    console.log(`[Generate Txt2Img] User ${userId} request received.`);

    try {
        const { prompt, modelId, aspectRatio, styleName, negativePrompt } = req.body; 
        console.log(`[Generate Txt2Img] Params: modelId=${modelId}, aspect=${aspectRatio}, styleName=${styleName}, prompt=${prompt}`);

        const modelConfig = RUNWARE_MODELS[modelId] || Object.values(RUNWARE_MODELS).find(m => m.id === modelId);
        if (!modelConfig) {
            console.error(`[Generate Txt2Img] Unsupported model ID: ${modelId}`);
            return res.status(400).json({ success: false, error: 'Unsupported model selected.' });
        }
        console.log(`[Generate Txt2Img] Using model config: ${modelConfig.name}`);

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
            return res.status(402).json({ success: false, error: userFriendlyError }); 
        }

        const baseDimension = modelConfig.baseDimension || 1024;
        const calculatedDimensions = calculateDimensionsForRatio(aspectRatio, baseDimension);

        let finalPrompt = prompt || modelConfig.defaultPrompt || 'A stunning image'; 

        const requestedStyleName = req.body.styleName; 

        if (requestedStyleName && requestedStyleName.trim() !== '' && requestedStyleName.toLowerCase() !== 'none') {
             const formattedStyle = requestedStyleName
                 .replace(/[-_]/g, ' ') 
                 .split(' ')
                 .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()) 
                 .join(' ');
            
             if (!finalPrompt.toLowerCase().endsWith(' style')) {
                 finalPrompt += `, ${formattedStyle} Style`;
                 console.log(`[Generate Txt2Img] Appended style to prompt. New prompt: "${finalPrompt}"`);
             } else {
                 console.log(`[Generate Txt2Img] Style detected in prompt already or style is 'None'. Not appending: "${finalPrompt}"`);
             }
        }

        const taskUUID = uuidv4();
        let apiParams = {
            taskType: modelConfig.taskType || 'imageInference', 
            taskUUID: taskUUID,
            positivePrompt: finalPrompt, 
            negativePrompt: negativePrompt || modelConfig.defaultParams?.negativePrompt || 'low quality, blurry', 
            numberResults: 1,
            width: modelConfig.width || calculatedDimensions.width, 
            height: modelConfig.height || calculatedDimensions.height,
            outputFormat: 'JPEG', 
            outputType: ['URL'], 
            includeCost: true,
            model: modelId, 
            ...modelConfig.defaultParams, 
        };

        console.log(`[Generate Txt2Img] CHECKING apiParams.model before stringify:`, apiParams.model);
        console.log(`[Generate Txt2Img] Sending payload for ${modelConfig.name} (Task ${taskUUID}):`, JSON.stringify([apiParams], null, 2));

        const response = await axios.post(
            'https://api.runware.ai/v1',
            [apiParams], 
            {
                headers: {
                    'Authorization': `Bearer ${process.env.RUNWARE_API_KEY}`,
                    'Content-Type': 'application/json',
                },
                timeout: 120000, 
            }
        );

        if (!response.data || response.data.error || !response.data.data || response.data.data.length === 0) {
            console.error('[Generate Txt2Img] Runware API Error Response:', JSON.stringify(response.data, null, 2));
            const errorDetail = response.data?.error || response.data?.data?.[0]?.error || { message: 'Unknown Runware API error.' };
            try { await deductCredits(userId, -costToDeduct); console.log(`[Generate Txt2Img] Credits refunded for user ${userId} due to API error.`); } catch(refundError) { console.error(`[Generate Txt2Img] CRITICAL: Failed to refund credits for user ${userId} after API error:`, refundError); }
            throw new Error(errorDetail.message || 'Runware API returned an invalid response.');
        }

        const resultData = response.data.data[0];
        if (!resultData.imageURL) {
            console.error('[Generate Txt2Img] Runware API did not return imageURL:', JSON.stringify(resultData, null, 2));
             try { await deductCredits(userId, -costToDeduct); console.log(`[Generate Txt2Img] Credits refunded for user ${userId} due to missing imageURL.`); } catch(refundError) { console.error(`[Generate Txt2Img] CRITICAL: Failed to refund credits for user ${userId} after missing imageURL:`, refundError); }
            throw new Error('Runware failed to return the generated image URL.');
        }

        console.log(`[Generate Txt2Img] Runware Success (Task ${resultData.taskUUID || taskUUID}). Cost: ${resultData.cost}, URL: ${resultData.imageURL}`);

        let finalImageUrl_Txt2Img = resultData.imageURL; 
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
                finalImageUrl_Txt2Img = gcsUrl; 
            } else {
                console.error('[Generate Txt2Img] GCS Upload failed. Falling back to Runware URL.');
            }
        } catch (gcsUploadError) {
            console.error('[Generate Txt2Img] Error during image download or GCS upload process. Falling back to Runware URL.', gcsUploadError);
        }
        console.log(`[Generate Txt2Img] Final Image URL: ${finalImageUrl_Txt2Img}, Cost: ${costToDeduct}`);

        const newContent = await GeneratedContent.create({
            userId: userId,
            type: 'image',
            contentUrl: finalImageUrl_Txt2Img, 
            prompt: prompt, 
            negativePrompt: apiParams.negativePrompt,
            modelUsed: modelConfig.name, 
            modelId: modelConfig.id, 
            width: apiParams.width,
            height: apiParams.height,
            steps: apiParams.steps,
            cfgScale: apiParams.CFGScale,
            scheduler: apiParams.scheduler,
            style: apiParams.style || (apiParams.lora ? apiParams.lora[0].model : null),
            tokenCost: costToDeduct, 
            apiResponseId: resultData.taskUUID || taskUUID, 
            isPublic: false, 
        });
        console.log(`[Generate Txt2Img DB] Saved generated image record with ID: ${newContent.id}`);

        res.json({ 
            success: true, 
            message: 'Image generated successfully!',
            imageId: newContent.id, 
            imageUrl: finalImageUrl_Txt2Img, 
            prompt: prompt, 
            cost: costToDeduct 
        });

    } catch (error) {
        console.error(`[Generate Txt2Img] Overall Error for user ${userId}:`, error.message);
        if (error.response?.data) {
             console.error('[Generate Txt2Img] Axios error details:', error.response.data);
        }
        const clientErrorMessage = error.message.includes('Insufficient credits') 
                                   ? 'Insufficient credits for generation.' 
                                   : (error.message.startsWith('Runware') || error.message.startsWith('Failed to download')) 
                                        ? 'Image generation service failed. Please try again later.' 
                                        : 'An unexpected error occurred during image generation.';
        
        const statusCode = error.message.includes('Insufficient credits') ? 402 : 500;
        
        res.status(statusCode).json({ success: false, error: clientErrorMessage });
    }
}); 


// Image-to-Image Route (Protected)
// Multer middleware still handles the 'image' field for file uploads,
// and parses other form fields into req.body.
router.post('/image-to-image', isAuthenticated, runwareUpload.single('image'), async (req, res) => {
    if (!req.user || !req.user.id) {
        return res.status(401).json({ success: false, error: 'User not authenticated.' });
    }

    let inputImageBuffer;
    let inputImageMimetype;
    let inputImageOriginalname; 

    // --- NEW LOGIC: Check for req.file first, then req.body.imageForEditUrl ---
    if (req.file) { // Case 1: User uploaded a new image directly
        inputImageBuffer = req.file.buffer;
        inputImageMimetype = req.file.mimetype;
        inputImageOriginalname = req.file.originalname;
        console.log(`[Generate Img2Img] Using uploaded file: ${req.file.originalname}, Size: ${req.file.size}`);
    } else if (req.body.imageForEditUrl) { // Case 2: User clicked 'Edit Image' and no new file was uploaded
        const imageUrl = req.body.imageForEditUrl;
        console.log(`[Generate Img2Img] Using image from URL: ${imageUrl}`);
        try {
            // Fetch the image from the URL
            const imageResponse = await axios.get(imageUrl, { responseType: 'arraybuffer' });
            inputImageBuffer = Buffer.from(imageResponse.data, 'binary');
            // Attempt to infer mimetype, default to jpeg
            inputImageMimetype = imageResponse.headers['content-type'] || 'image/jpeg'; 
            inputImageOriginalname = `downloaded_image.${inputImageMimetype.split('/')[1] || 'jpeg'}`;
            console.log(`[Generate Img2Img] Downloaded image from URL. Size: ${inputImageBuffer.length}`);
        } catch (downloadError) {
            console.error('[Generate Img2Img] Error downloading image from URL:', downloadError.message);
            // Return 400 as it's a client-side issue (bad URL, unreachable, etc.)
            return res.status(400).json({ success: false, error: 'Failed to download image from the provided URL.' });
        }
    } else { // Case 3: Neither a file nor a URL was provided
        console.log('[Generate Img2Img] No image file uploaded and no image URL provided.');
        return res.status(400).json({ success: false, error: 'No image file or URL provided to start generation.' });
    }
    // --- END NEW LOGIC ---

    const userId = req.user.id;
    console.log(`[Generate Img2Img] User ${userId} request received.`);

    try {
        // Extract parameters from request body (parsed by Multer into req.body)
        const { prompt, modelId, strength, width, height, style, negativePrompt } = req.body; 
        console.log(`[Generate Img2Img] Params: modelId=${modelId}, strength=${strength}, size=${width}x${height}, style=${style}, prompt=${prompt}`);

        const modelConfig = RUNWARE_MODELS[modelId] || Object.values(RUNWARE_MODELS).find(m => m.id === modelId);
        if (!modelConfig) {
            console.error(`[Generate Img2Img] Unsupported model ID: ${modelId}`);
            return res.status(400).json({ success: false, error: 'Unsupported model selected.' });
        }
        console.log(`[Generate Img2Img] Using model config: ${modelConfig.name}`);

        // Determine the cost to deduct
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

        // Get image dimensions using sharp from the determined inputImageBuffer
        let imageMetadata;
        try {
            imageMetadata = await sharp(inputImageBuffer).metadata();
        } catch (sharpError) {
            console.error(`[Generate Img2Img] Sharp failed to read input image metadata:`, sharpError);
             // Attempt credit refund
             try { await deductCredits(userId, -costToDeduct); console.log(`[Generate Img2Img] Credits refunded due to image processing error.`);} catch(e) {console.error(`[Generate Img2Img] CRITICAL: Failed to refund credits after sharp error:`, e);}
            return res.status(400).json({ success: false, error: 'Could not process input image for generation.' });
        }
        
        if (!imageMetadata.width || !imageMetadata.height) {
            console.error(`[Generate Img2Img] Invalid image dimensions from sharp: ${imageMetadata.width}x${imageMetadata.height}`);
             // Attempt credit refund
             try { await deductCredits(userId, -costToDeduct); console.log(`[Generate Img2Img] Credits refunded due to invalid image dimensions.`);} catch(e) {console.error(`[Generate Img2Img] CRITICAL: Failed to refund credits after invalid dimensions:`, e);}
            return res.status(400).json({ success: false, error: 'Invalid input image dimensions.' });
        }
        console.log(`[Generate Img2Img] Input image dimensions: ${imageMetadata.width}x${imageMetadata.height}`);

        // Prepare Runware API payload
        const taskUUID = uuidv4();
        const base64Image = inputImageBuffer.toString('base64');
        const inputImage = `data:${inputImageMimetype};base64,${base64Image}`;

        let apiParams = {
            model: modelId, 
            taskType: modelConfig.taskType || 'imageInference', 
            taskUUID: taskUUID,
            positivePrompt: prompt || modelConfig.defaultPrompt || 'A transformation based on the image',
            negativePrompt: negativePrompt || modelConfig.defaultParams?.negativePrompt || 'ugly', 
            numberResults: 1,
            // Use dimensions from request, model config, or fallback to input image dimensions
            width: parseInt(width) || modelConfig.width || imageMetadata.width, 
            height: parseInt(height) || modelConfig.height || imageMetadata.height,
            outputFormat: 'JPEG',
            outputType: ['URL'], 
            includeCost: true,
            // Optional parameters based on model config defaults
            ...(modelConfig.defaultParams?.steps && { steps: modelConfig.defaultParams.steps }),
            ...(modelConfig.defaultParams?.guidance_scale && { CFGScale: parseFloat(modelConfig.defaultParams.guidance_scale) }), 
            ...(modelConfig.defaultParams?.scheduler && { scheduler: modelConfig.defaultParams.scheduler }),
            // Include strength from request or model default
            strength: parseFloat(strength) || parseFloat(modelConfig.defaultParams?.strength || '0.75'),
        };

        // Handle style parameter for img2img (if applicable)
        let styleValue = style || req.body.style || null; 
        if (styleValue && styleValue.startsWith('civitai:')) {
            console.log(`[Generate Img2Img] Adding LoRA: ${styleValue}`);
            apiParams.lora = [{ model: styleValue, weight: 1 }];
            const readableStyleName = req.body.styleLabel || styleValue.split('@')[0].replace('civitai:', ''); 
            apiParams.positivePrompt = `${prompt}, in the style of ${readableStyleName} style`;
        } else if (styleValue && modelConfig.usesPromptBasedStyling) {
            console.log(`[Generate Img2Img] Appending prompt-based style: ${styleValue}`);
            apiParams.positivePrompt = `${prompt}, in the style of ${styleValue} style`;
        }

        // PhotoMaker specific style parameter
        if (modelConfig.taskType === 'photoMaker') {
            apiParams.style = (style || modelConfig.defaultStyle || 'photographic').toLowerCase();
            console.log(`[Generate Img2Img] Applying PhotoMaker style: ${apiParams.style}`);
            apiParams.inputImages = [inputImage];
            delete apiParams.seedImage; // PhotoMaker uses inputImages, not seedImage
            apiParams.strength = Math.min(Math.max(parseInt(strength) || 15, 15), 50); // PhotoMaker strength range is typically 15-50
        } else {
            apiParams.seedImage = inputImage; // For regular img2img
        }

        console.log(`[Generate Img2Img] Sending payload for ${modelConfig.name} (Task ${taskUUID}):`, JSON.stringify([apiParams], null, 2));

        // Make the API call to Runware
        const response = await axios.post(
            'https://api.runware.ai/v1',
            [apiParams],
            {
                headers: {
                    'Authorization': `Bearer ${process.env.RUNWARE_API_KEY}`,
                    'Content-Type': 'application/json',
                },
                timeout: 120000, 
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
        if (!resultData.imageURL) {
            console.error('[Generate Img2Img] Runware API did not return imageURL:', JSON.stringify(resultData, null, 2));
            // Attempt to refund credits
             try { await deductCredits(userId, -costToDeduct); console.log(`[Generate Img2Img] Credits refunded for user ${userId} due to missing imageURL.`); } catch(refundError) { console.error(`[Generate Img2Img] CRITICAL: Failed to refund credits for user ${userId} after missing imageURL:`, refundError); }
            throw new Error('Runware failed to return the generated image URL.');
        }

        console.log(`[Generate Img2Img] Runware Success (Task ${taskUUID}). Cost: ${resultData.cost}, URL: ${resultData.imageURL}`);

        // GCS Upload Logic for Image-to-Image 
        let finalImageUrl_Img2Img = resultData.imageURL; 
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
                finalImageUrl_Img2Img = gcsUrl; 
            } else {
                console.error('[Generate Img2Img] GCS Upload failed. Falling back to Runware URL.');
            }
        } catch (gcsUploadError) {
            console.error('[Generate Img2Img] Error during image download or GCS upload process. Falling back to Runware URL.', gcsUploadError);
        }
         console.log(`[Generate Img2Img] Final Image URL: ${finalImageUrl_Img2Img}, Cost: ${costToDeduct}`);

        // Create Database Record
        const newContent = await GeneratedContent.create({
            userId: userId,
            type: 'image', 
            contentUrl: finalImageUrl_Img2Img, 
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
            strength: apiParams.strength, 
            tokenCost: costToDeduct, 
            apiResponseId: resultData.taskUUID || taskUUID,
            isPublic: false, 
        });
        console.log(`[Generate Img2Img DB] Saved generated image record with ID: ${newContent.id}`);

        // Respond to client
        res.json({ 
            success: true, 
             message: 'Image generated successfully!',
            imageId: newContent.id, 
            imageUrl: finalImageUrl_Img2Img, 
            prompt: apiParams.positivePrompt, 
            cost: costToDeduct 
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
                                        
        const statusCode = error.message.includes('Insufficient credits') ? 402 : (error.message.includes('Could not process') || error.message.includes('Failed to download')) ? 400 : 500;

        res.status(statusCode).json({ success: false, error: clientErrorMessage });
    }
});

// Middleware for handling Multer errors specifically
router.use((err, req, res, next) => {
    // Check for Multer errors directly if a file was attempted to be uploaded
    if (err instanceof require('multer').MulterError) { // Use require('multer') to ensure MulterError is available
        console.error('[Multer Error Handler]', err);
        let message = 'Image upload error.';
        if (err.code === 'LIMIT_FILE_SIZE') {
            message = 'Image file is too large (max 10MB).';
        } else if (err.code === 'LIMIT_UNEXPECTED_FILE') {
            message = 'Unexpected file field received.';
        }
        return res.status(400).json({ success: false, error: message });
    } else if (err) {
        console.error('[File Filter/Other Error Handler]', err.message);
        if (err.message.includes('Invalid file type')) {
            return res.status(400).json({ success: false, error: err.message });
        } 
        return res.status(500).json({ success: false, error: 'An internal error occurred during file processing.' });
    }
    next();
});

module.exports = router;