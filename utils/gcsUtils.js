// utils/gcsUtils.js
require('dotenv').config();
const { Storage } = require('@google-cloud/storage');

const bucketName = process.env.BUCKET_NAME;
if (!bucketName) {
    console.error('Error: BUCKET_NAME environment variable is not set.');
    // Optionally throw an error or exit if the bucket name is critical
    // process.exit(1);
}

let storage;
try {
    storage = new Storage(); // Assumes GOOGLE_APPLICATION_CREDENTIALS is set
    console.log('[GCS Utils] Storage client initialized successfully.');
} catch (error) {
    console.error('[GCS Utils] Failed to initialize Google Cloud Storage client:', error);
    // Handle initialization error - maybe disable GCS features
}

/**
 * Uploads a JavaScript object (serialized as JSON) to GCS.
 * @param {string} userId - The user ID.
 * @param {string} clientSessionId - The client-generated chat session ID.
 * @param {object} historyObject - The JavaScript object (e.g., array) to upload.
 * @returns {Promise<string|null>} The GCS URI (gs://...) of the uploaded file, or null on error.
 */
async function uploadJsonToGcs(userId, clientSessionId, historyObject) {
    if (!storage || !bucketName) {
        console.error('[GCS Utils] Storage client not initialized or bucket name missing. Cannot upload.');
        return null;
    }
    if (!userId || !clientSessionId) {
         console.error('[GCS Utils] Missing userId or clientSessionId for GCS upload.');
         return null;
    }

    const filePath = `chats/${userId}/${clientSessionId}.json`;
    const jsonString = JSON.stringify(historyObject, null, 2); // Pretty print JSON
    const file = storage.bucket(bucketName).file(filePath);
    const gcsUri = `gs://${bucketName}/${filePath}`;

    try {
        await file.save(jsonString, {
            contentType: 'application/json',
            metadata: {
                cacheControl: 'no-cache', // Ensure clients get the latest version
            },
        });
        console.log(`[GCS Utils] Successfully uploaded chat history to ${gcsUri}`);
        return gcsUri;
    } catch (error) {
        console.error(`[GCS Utils] Failed to upload chat history to ${gcsUri}:`, error);
        return null;
    }
}

/**
 * Downloads and parses a JSON file from GCS using its URI.
 * @param {string} gcsUri - The GCS URI (gs://bucket-name/path/to/object).
 * @returns {Promise<object|null>} The parsed JavaScript object, or null if not found or error.
 */
async function downloadJsonFromGcs(gcsUri) {
    if (!storage) {
         console.error('[GCS Utils] Storage client not initialized. Cannot download.');
         return null;
    }
    if (!gcsUri || !gcsUri.startsWith('gs://')) {
        console.error(`[GCS Utils] Invalid GCS URI provided: ${gcsUri}`);
        return null;
    }

    // Extract bucket name and file path from URI
    const uriParts = gcsUri.substring(5).split('/');
    const bucket = uriParts.shift(); // First part is bucket name
    const filePath = uriParts.join('/'); // Rest is the file path

    if (!bucket || !filePath) {
        console.error(`[GCS Utils] Could not parse bucket/path from URI: ${gcsUri}`);
        return null;
    }

    try {
        const [contents] = await storage.bucket(bucket).file(filePath).download();
        console.log(`[GCS Utils] Successfully downloaded chat history from ${gcsUri}`);
        return JSON.parse(contents.toString('utf8'));
    } catch (error) {
        if (error.code === 404) {
             console.log(`[GCS Utils] Chat history file not found at ${gcsUri}`);
        } else {
             console.error(`[GCS Utils] Failed to download chat history from ${gcsUri}:`, error);
        }
        return null;
    }
}

/**
 * Uploads an image buffer to GCS under the 'images/' prefix and makes it public.
 * @param {Buffer} buffer - The image data buffer.
 * @param {string} filename - The desired filename (e.g., 'uuid.jpg').
 * @param {string} contentType - The MIME type of the image (e.g., 'image/jpeg').
 * @returns {Promise<string|null>} The public HTTPS URL of the uploaded image, or null on error.
 */
async function uploadImageBufferToGcs(buffer, filename, contentType) {
    if (!storage || !bucketName) {
        console.error('[GCS Utils] Storage client not initialized or bucket name missing. Cannot upload image.');
        return null;
    }
    if (!buffer || !filename || !contentType) {
        console.error('[GCS Utils] Missing buffer, filename, or contentType for GCS image upload.');
        return null;
    }

    const filePath = `images/${filename}`; // Store images under an 'images/' folder
    const file = storage.bucket(bucketName).file(filePath);

    try {
        await file.save(buffer, {
            contentType: contentType,
            public: true, // Make the image publicly accessible
            metadata: {
                cacheControl: 'public, max-age=31536000', // Cache publicly for 1 year
            },
        });
        const publicUrl = `https://storage.googleapis.com/${bucketName}/${filePath}`;
        console.log(`[GCS Utils] Successfully uploaded image to ${publicUrl}`);
        return publicUrl;
    } catch (error) {
        console.error(`[GCS Utils] Failed to upload image to GCS at ${filePath}:`, error);
        return null;
    }
}

module.exports = {
    uploadJsonToGcs,
    downloadJsonFromGcs,
    uploadImageBufferToGcs,
};
