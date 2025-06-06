// utils/gcsUtils.js
require('dotenv').config();
const { Storage } = require('@google-cloud/storage');
const path = require('path');

const bucketName = process.env.BUCKET_NAME; // Ensure this env variable is set (e.g., in .env file)
if (!bucketName) {
    console.error('Error: BUCKET_NAME environment variable is not set. GCS operations may fail.');
}

let storage;
try {
    storage = new Storage(); // Assumes GOOGLE_APPLICATION_CREDENTIALS is set for authentication
    console.log('[GCS Utils] Storage client initialized successfully.');
} catch (error) {
    console.error('[GCS Utils] Failed to initialize Google Cloud Storage client:', error);
}

/**
 * Uploads a JavaScript object (serialized as JSON) to GCS.
 * (Your existing function - no change needed here)
 * @param {string} userId - The user ID.
 * @param {string} clientSessionId - The client-generated chat session ID.
 * @param {object} historyObject - The JavaScript object (e.g., array) to upload.
 * @returns {Promise<string|null>} The GCS URI (gs://...) of the uploaded file, or null on error.
 */
async function uploadJsonToGcs(userId, clientSessionId, historyObject) {
    if (!storage || !bucketName) {
        console.error('[GCS Utils] Storage client not initialized or bucket name missing. Cannot upload JSON.');
        return null;
    }
    if (!userId || !clientSessionId) {
         console.error('[GCS Utils] Missing userId or clientSessionId for GCS JSON upload.');
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
 * (Your existing function - no change needed here)
 * @param {string} gcsUri - The GCS URI (gs://bucket-name/path/to/object).
 * @returns {Promise<object|null>} The parsed JavaScript object, or null if not found or error.
 */
async function downloadJsonFromGcs(gcsUri) {
    if (!storage) {
         console.error('[GCS Utils] Storage client not initialized. Cannot download JSON.');
         return null;
    }
    if (!gcsUri || !gcsUri.startsWith('gs://')) {
        console.error(`[GCS Utils] Invalid GCS URI provided for JSON download: ${gcsUri}`);
        return null;
    }

    // Extract bucket name and file path from URI
    const uriParts = gcsUri.substring(5).split('/');
    const bucket = uriParts.shift(); // First part is bucket name
    const filePath = uriParts.join('/'); // Rest is the file path

    if (!bucket || !filePath) {
        console.error(`[GCS Utils] Could not parse bucket/path from JSON URI: ${gcsUri}`);
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
 * (Your existing function - no change needed here, as it's specifically for 'images/' folder)
 * This function can remain separate if you always want new images to go to 'images/'.
 * The new general `uploadFile` can be used for other purposes (like thumbnails).
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
            // public: true, // This is correctly commented out
            metadata: {
                cacheControl: 'public, max-age=31536000', // Cache publicly for 1 year
            },
        });
        const publicUrl = `https://storage.googleapis.com/${bucketName}/${filePath}`;
        console.log(`[GCS Utils] Successfully uploaded image to ${publicUrl}`);
        return publicUrl;
    } catch (error) {
        console.error(`[GCS Utils] Failed to upload image to GCS at ${filePath}:`, error);
        throw error; // Re-throw to propagate error to calling function
    }
}

// --- NEW GENERAL PURPOSE GCS FUNCTIONS ---

/**
 * Uploads a file buffer to GCS to a specified destination path and makes it public.
 * This is a more general utility for uploading any file buffer.
 * @param {Buffer} buffer - The file data buffer.
 * @param {string} destinationPath - The desired full path in the bucket (e.g., 'folder/subfolder/file.ext').
 * @param {string} contentType - The MIME type of the file (e.g., 'image/webp', 'application/pdf').
 * @returns {Promise<string|null>} The public HTTPS URL of the uploaded file, or null on error.
 */
async function uploadFile(buffer, destinationPath, contentType) {
    if (!storage || !bucketName) {
        console.error('[GCS Utils] Storage client not initialized or bucket name missing. Cannot upload file.');
        return null;
    }
    if (!buffer || !destinationPath || !contentType) {
        console.error('[GCS Utils] Missing buffer, destinationPath, or contentType for GCS upload.');
        return null;
    }

    const file = storage.bucket(bucketName).file(destinationPath);

    try {
        await file.save(buffer, {
            contentType: contentType,
            // public: true, // <--- THIS IS THE LINE TO REMOVE!
            metadata: {
                cacheControl: 'public, max-age=31536000',
            },
        });
        const publicUrl = `https://storage.googleapis.com/${bucketName}/${destinationPath}`;
        console.log(`[GCS Utils] Successfully uploaded file to ${publicUrl}`);
        return publicUrl;
    } catch (error) {
        console.error(`[GCS Utils] Failed to upload file to GCS at ${destinationPath}:`, error);
        throw error; // Re-throw to propagate error to calling function
    }
}

/**
 * Downloads a file buffer from GCS using its public HTTPS URL.
 * This is a general utility for downloading any publicly accessible file.
 * @param {string} gcsPublicUrl - The public HTTPS URL of the GCS object
 *                                (e.g., https://storage.googleapis.com/your-bucket/path/to/object).
 * @returns {Promise<Buffer|null>} The file data as a Buffer, or null if not found or on error.
 */
async function downloadFile(gcsPublicUrl) {
    if (!storage || !bucketName) {
        console.error('[GCS Utils] Storage client not initialized or bucket name missing. Cannot download file.');
        return null;
    }
    // Validate if it's a GCS public URL and matches our bucket
    if (!gcsPublicUrl || !gcsPublicUrl.startsWith(`https://storage.googleapis.com/${bucketName}/`)) {
        console.error(`[GCS Utils] Invalid or non-matching GCS public URL provided for download: ${gcsPublicUrl}`);
        return null;
    }

    // Extract file path from the public URL
    // e.g., 'https://storage.googleapis.com/my-bucket/images/img1.jpg'
    // filePath will be 'images/img1.jpg'
    const filePath = gcsPublicUrl.substring(`https://storage.googleapis.com/${bucketName}/`.length);

    if (!filePath) {
        console.error(`[GCS Utils] Could not parse file path from URL: ${gcsPublicUrl}`);
        return null;
    }

    try {
        const file = storage.bucket(bucketName).file(filePath);
        // Check if file exists before attempting to download
        const [exists] = await file.exists();
        if (!exists) {
            console.warn(`[GCS Utils] File does not exist in GCS at ${filePath} (from URL: ${gcsPublicUrl})`);
            return null; // Return null if file not found
        }

        const [fileBuffer] = await file.download();
        console.log(`[GCS Utils] Successfully downloaded file from ${gcsPublicUrl}`);
        return fileBuffer;
    } catch (error) {
        if (error.code === 404) {
             console.log(`[GCS Utils] File not found at ${gcsPublicUrl}`); // Log 404 specifically
        } else {
             console.error(`[GCS Utils] Failed to download file from ${gcsPublicUrl}:`, error);
        }
        return null;
    }
}

module.exports = {
    uploadJsonToGcs,
    downloadJsonFromGcs,
    uploadImageBufferToGcs,
    uploadFile,
    downloadFile,
    bucketName // <--- ENSURE THIS IS EXPORTED for api.js filtering
};