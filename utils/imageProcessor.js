// utils/imageProcessor.js
const sharp = require('sharp');
const path = require('path'); // Useful for path manipulation if needed

/**
 * Generates a thumbnail from an image buffer.
 * @param {Buffer} imageBuffer - The buffer of the original image.
 * @param {string} format - The desired output format (e.g., 'jpeg', 'webp').
 * @param {number} width - The desired width of the thumbnail.
 * @param {number} height - The desired height of the thumbnail (optional, will maintain aspect ratio if not provided).
 * @returns {Promise<Buffer>} - A promise that resolves with the thumbnail image buffer.
 */
async function generateThumbnail(imageBuffer, format = 'jpeg', width = 300, height = null) {
    let s = sharp(imageBuffer);

    if (height) {
        s = s.resize(width, height, { fit: 'inside', withoutEnlargement: true });
    } else {
        s = s.resize(width, null, { fit: 'inside', withoutEnlargement: true });
    }

    // Convert to specified format (e.g., WebP for better performance)
    if (format === 'webp') {
        s = s.webp({ quality: 80 });
    } else if (format === 'jpeg') {
        s = s.jpeg({ quality: 85 });
    } else if (format === 'png') {
        s = s.png({ compressionLevel: 9 });
    } else {
        // Default to JPEG if unknown format
        s = s.jpeg({ quality: 85 });
    }

    return s.toBuffer();
}

module.exports = {
    generateThumbnail,
};