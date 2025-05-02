const axios = require('axios');
const fs = require('fs').promises;
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { User, sequelize } = require('../db'); // Import User model and sequelize instance

// Define the upload directory path relative to this file
// Assuming utils/helpers.js and public/ are siblings of the project root
const PROJECT_ROOT = path.join(__dirname, '..'); 
const RUNWARE_UPLOAD_DIR = path.join(PROJECT_ROOT, 'public', 'uploads', 'generated_images');

// Ensure Runware upload directory exists (optional, can be done at startup)
fs.mkdir(RUNWARE_UPLOAD_DIR, { recursive: true }).catch(err => {
    if (err.code !== 'EEXIST') { // Ignore error if directory already exists
        console.error(`Error creating Runware upload directory ${RUNWARE_UPLOAD_DIR}:`, err);
    }
});

// Helper Function to Calculate Dimensions from Aspect Ratio
function calculateDimensionsForRatio(ratioString, baseDimension = 1024) {
    const parts = ratioString.split(':');
    if (parts.length !== 2) return { width: baseDimension, height: baseDimension }; // Default to square on invalid input

    const w = parseInt(parts[0], 10);
    const h = parseInt(parts[1], 10);

    if (isNaN(w) || isNaN(h) || w <= 0 || h <= 0) {
        return { width: baseDimension, height: baseDimension }; // Default on invalid numbers
    }

    const ratio = w / h;
    let width, height;

    if (ratio > 1) { // Landscape
        width = baseDimension;
        height = Math.round(baseDimension / ratio);
    } else if (ratio < 1) { // Portrait
        height = baseDimension;
        width = Math.round(baseDimension * ratio);
    } else { // Square (ratio === 1)
        width = baseDimension;
        height = baseDimension;
    }

    // Ensure dimensions are divisible by 8 or 16 (common AI requirement, 16 preferred for some models)
    width = Math.max(16, Math.round(width / 16) * 16);
    height = Math.max(16, Math.round(height / 16) * 16);

    // Add safety clamp if needed (e.g., max dimension 2048)
    // width = Math.min(width, 2048);
    // height = Math.min(height, 2048);

    console.log(`[Helpers] Calculated dimensions for ratio ${ratioString} (base ${baseDimension}): ${width}x${height}`);
    return { width, height };
}

// Renamed from deductTokens - Handles credit deduction and refunds
async function deductCredits(userId, cost) {
  console.log(`[Helpers] Attempting credit transaction for user ${userId}. Amount: $${cost}`);
  if (!userId) throw new Error('User ID not provided for credit deduction.');
  if (isNaN(cost)) throw new Error('Invalid cost provided for credit deduction.'); // Cost can be negative for refunds

  const costDecimal = parseFloat(cost); // Ensure we work with numbers

  // Use a transaction to ensure atomicity
  const t = await sequelize.transaction();

  try {
    const user = await User.findByPk(userId, { transaction: t, lock: t.LOCK.UPDATE }); // Lock the row during transaction

    if (!user) {
      await t.rollback();
      throw new Error(`User not found for credit deduction: ${userId}`);
    }

    const currentCredits = parseFloat(user.credits);
    console.log(`[Helpers] User ${userId} current credits: $${currentCredits.toFixed(2)}`);

    // Check for sufficient credits ONLY if deducting (cost is positive)
    if (costDecimal > 0 && currentCredits < costDecimal) {
      await t.rollback();
      console.warn(`[Helpers] Insufficient credits for user ${userId}. Required: $${costDecimal.toFixed(2)}, Available: $${currentCredits.toFixed(2)}`);
      throw new Error('Insufficient credits');
    }

    // Perform the deduction or addition (refund)
    // Use DECIMAL arithmetic carefully or convert temporarily
    const newCredits = currentCredits - costDecimal;
    user.credits = newCredits; // Sequelize handles DECIMAL conversion

    await user.save({ transaction: t });

    await t.commit(); // Commit the transaction
    console.log(`[Helpers] Successfully updated credits for user ${userId}. New balance: $${newCredits.toFixed(2)}`);
    return true;

  } catch (error) {
    await t.rollback(); // Rollback transaction on any error
    console.error(`[Helpers] Credit deduction failed for user ${userId}. Amount: $${costDecimal.toFixed(2)}. Error:`, error.message);
    // Re-throw the original error or a more specific one
    if (error.message === 'Insufficient credits') {
        throw error; // Keep the specific insufficient credits error
    }
    throw new Error(`Failed to update user credits: ${error.message}`); 
  }
}

// Helper to Save Image from URL to the Runware Upload Directory
async function saveImageFromUrl(imageUrl, userId) {
    console.log(`[Helpers] Attempting to save image for user ${userId} from URL: ${imageUrl}`);
    try {
        const response = await axios({ 
            url: imageUrl, 
            responseType: 'arraybuffer',
            timeout: 30000 // 30 second timeout for download
         });

        // Basic validation of response
        if (response.status !== 200) {
            throw new Error(`Failed to download image, status code: ${response.status}`);
        }
        if (!response.data || response.data.length === 0) {
             throw new Error('Downloaded image data is empty.');
        }

        // Determine file extension
        const contentType = response.headers['content-type'];
        let extension = 'jpg'; // Default
        if (contentType) {
            if (contentType.includes('jpeg')) extension = 'jpg';
            else if (contentType.includes('png')) extension = 'png';
            else if (contentType.includes('webp')) extension = 'webp';
        } else {
            // Fallback: try parsing from URL
            const urlPath = imageUrl.split('?')[0];
            const urlExt = urlPath.split('.').pop().toLowerCase();
             const validExtensions = ['jpg', 'jpeg', 'png', 'webp'];
             if (validExtensions.includes(urlExt)) {
                 extension = (urlExt === 'jpeg') ? 'jpg' : urlExt;
             }
        }

        const filename = `${userId}-${uuidv4()}.${extension}`;
        const localPath = path.join(RUNWARE_UPLOAD_DIR, filename);
        
        await fs.writeFile(localPath, response.data);
        
        const relativeUrl = `/uploads/generated_images/${filename}`; // URL path for frontend
        console.log(`[Helpers] Image saved successfully for user ${userId}: ${localPath} (URL: ${relativeUrl})`);
        
        return { localPath, relativeUrl, imageId: filename }; // Use filename as temporary ID

    } catch (error) {
        console.error(`[Helpers] Error saving image for user ${userId} from URL ${imageUrl}:`, error.message);
        // Log more details for specific error types if needed
        if (axios.isAxiosError(error)) {
             console.error('[Helpers] Axios error details:', error.response?.status, error.response?.data);
        }
        // Re-throw a more generic error or handle specific cases
        throw new Error('Failed to download or save the generated image.'); 
    }
}

module.exports = {
    calculateDimensionsForRatio,
    deductCredits, // Updated export name
    saveImageFromUrl,
};
