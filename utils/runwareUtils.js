// utils/runwareUtils.js
const axios = require('axios');

/**
 * Generates images from text using the Runware API.
 * @param {object} runware - Initialized Runware SDK instance.
 * @param {object} params - Parameters for the text-to-image request.
 * @returns {Promise<Array<object>>} - Promise resolving to an array of image objects.
 */
async function generateTextToImage(runware, params) {
  const maxTimeout = 120000; // 120 seconds timeout
  try {
    console.log('[runwareUtils] Sending Text-to-Image request with params:', JSON.stringify(params, null, 2));
    
    // Use the documented requestImages method
    const response = await runware.requestImages(params);

    console.log('[runwareUtils] Text-to-Image API response:', JSON.stringify(response, null, 2));

    // Correct check: Verify 'response' is an array and the first item has needed properties
    if (!Array.isArray(response) || response.length === 0 || !response[0].cost || !response[0].imageURL) {
        console.error('[runwareUtils] Invalid API response structure:', JSON.stringify(response, null, 2));
        throw new Error('Invalid API response: No images returned or structure incorrect');
    }
    // Correct mapping: Map directly over the response array
    return response.map((image) => ({
        imageUUID: image.imageUUID,
        imageURL: image.imageURL,
        cost: image.cost,
        // Add other fields if needed, e.g., positivePrompt: image.positivePrompt
    }));
  } catch (error) {
    console.error('[runwareUtils] Text-to-Image generation failed:', error);
    throw new Error(`Text-to-Image generation failed: ${error.message}`);
  }
}

/**
 * Generates images from an initial image and text using the Runware API.
 * Includes retry logic and fallback for specific tasks.
 * @param {object} runware - Initialized Runware SDK instance.
 * @param {object} params - Parameters for the image-to-image request.
 * @returns {Promise<Array<object>>} - Promise resolving to an array of image objects.
 */
async function generateImageToImage(runware, params) {
  const maxTimeout = 120000; // 120 seconds timeout
  const maxRetries = 1; // Set retries (e.g., 1 for now)
  let retries = maxRetries;

  while (retries >= 0) {
    try {
      console.log('[runwareUtils] Sending Image-to-Image request (attempt %d) with params:', maxRetries - retries + 1, JSON.stringify({ ...params, seedImage: '<base64_string>', inputImages: params.inputImages ? ['<base64_string>'] : undefined }, null, 2));

      // Use the documented requestImages method
      const response = await runware.requestImages(params);

      console.log('[runwareUtils] Image-to-Image API response:', JSON.stringify(response, null, 2));

      // Correct check for Image-to-Image as well
      if (!Array.isArray(response) || response.length === 0 || !response[0].cost || !response[0].imageURL) {
        console.error('[runwareUtils] Invalid I2I API response structure:', JSON.stringify(response, null, 2));
        throw new Error('Invalid API response: No images returned or structure incorrect');
      }

      // Correct mapping for Image-to-Image
      return response.map((image) => ({
        imageUUID: image.imageUUID,
        imageURL: image.imageURL,
        cost: image.cost,
      }));

    } catch (error) {
      console.error(`[runwareUtils] Image-to-Image generation failed (attempt ${maxRetries - retries + 1}):`, error);
      // Capture raw error response
      let rawResponse = null;
      if (error.response) {
        rawResponse = {
          status: error.response.status,
          data: error.response.data,
          headers: error.response.headers,
        };
      }

      const errorMessage = error.message || 'Unknown Runware API error';
      const errorDetails = {
        message: errorMessage,
        response: rawResponse,
        status: rawResponse ? rawResponse.status : null,
        rawError: JSON.stringify(error, Object.getOwnPropertyNames(error), 2),
        errorStack: error.stack || 'N/A',
        params: { // Log params without potentially large image data
          taskType: params.taskType || 'imageInference',
          model: params.model,
          taskUUID: params.taskUUID,
          width: params.width,
          height: params.height,
          steps: params.steps,
          strength: params.strength,
          CFGScale: params.CFGScale,
          scheduler: params.scheduler,
          style: params.style || 'N/A',
          lora: params.lora ? JSON.stringify(params.lora) : 'N/A',
          positivePrompt: params.positivePrompt,
          negativePrompt: params.negativePrompt || 'N/A',
          hasInputImages: !!params.inputImages,
          hasSeedImage: !!params.seedImage,
        },
        retryAttempt: maxRetries - retries + 1,
      };
      console.error('[runwareUtils] Image-to-Image Generation Error Details:', JSON.stringify(errorDetails, null, 2));

      // Fallback for photoMaker (using raw axios - requires RUNWARE_API_KEY in env)
      if (params.taskType === 'photoMaker' && retries === maxRetries && process.env.RUNWARE_API_KEY) {
        console.log('[runwareUtils] Attempting raw HTTP request to Runware API for photoMaker...');
        try {
          const response = await axios.post(
            'https://api.runware.ai/v1',
            [params], // Wrap params in array
            {
              headers: {
                'Authorization': `Bearer ${process.env.RUNWARE_API_KEY}`,
                'Content-Type': 'application/json',
              },
              timeout: maxTimeout,
            }
          );
          console.log('[runwareUtils] Raw HTTP API response:', JSON.stringify(response.data, null, 2));
          if (!response.data || !response.data.result || !response.data.result.images || !Array.isArray(response.data.result.images) || response.data.result.images.length === 0) { // Demo response is { data: [...] }
             if (!response.data.data || !response.data.data.result || !response.data.data.result.images || !Array.isArray(response.data.data.result.images) || response.data.data.result.images.length === 0) { // Check nested data field
                 throw new Error('Invalid raw HTTP API response: No images returned in data field');
             }
             // Map from nested data field if necessary
             return response.data.data.result.images.map((image) => ({
                imageUUID: image.imageUUID,
                imageURL: image.imageURL,
                cost: image.cost,
             }));
          }
          // Map directly if top-level is array
          return response.data.result.images.map((image) => ({
            imageUUID: image.imageUUID,
            imageURL: image.imageURL,
            cost: image.cost,
          }));
        } catch (httpError) {
            let httpErrorDetails = { message: httpError.message, status: null, data: null };
            if (httpError.response) {
                httpErrorDetails.status = httpError.response.status;
                httpErrorDetails.data = httpError.response.data;
            }
            console.error('[runwareUtils] Raw HTTP Request Error:', JSON.stringify(httpErrorDetails, null, 2));
            // Fall through to retry logic if HTTP attempt failed
        }
      }

      if (
        (errorMessage.includes('timeout') ||
          errorMessage.includes('server error') ||
          errorMessage.includes('socket hang up') || // Add common network errors
          errorDetails.status === 504 ||
          errorDetails.status === 503 ||
          errorDetails.status === 502 || // Add bad gateway
          error.code === 'ECONNRESET' || // Add connection reset
          error.code === 'ETIMEDOUT') && // Add timeout code
        retries > 0
      ) {
        console.log(`[runwareUtils] Retryable error, retrying in ${2000}ms... (${retries} retries left)`);
        retries--;
        await new Promise((resolve) => setTimeout(resolve, 2000 + Math.random() * 100)); // Add jitter
        continue;
      }

      // Enhanced error message for LoRA-specific issues
      if (errorMessage.includes('Model not found') && params.lora) {
        throw new Error(`LoRA model not found: ${params.lora[0].model}. Please verify the AIR identifier in Runware.ai Model Explorer or upload the model.`);
      }

      throw new Error(`Image-to-Image generation failed: ${errorMessage}`);
    }
  }

  throw new Error('Image-to-Image generation failed: Max retries exceeded');
}

module.exports = { generateTextToImage, generateImageToImage };
