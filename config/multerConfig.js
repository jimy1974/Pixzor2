const multer = require('multer');
const path = require('path');
const fsSync = require('fs');

// Define upload directory relative to project root
const PROJECT_ROOT = path.join(__dirname, '..'); 
const UPLOAD_DIR = path.join(PROJECT_ROOT, 'public', 'uploads');

// Ensure Upload directory exists
// Use try-catch for robustness in case of permissions issues or other errors
try {
    fsSync.mkdirSync(UPLOAD_DIR, { recursive: true });
    console.log(`Ensured upload directory exists: ${UPLOAD_DIR}`);
} catch (err) {
    // Only log error if it's not because the directory already exists
    if (err.code !== 'EEXIST') { 
        console.error(`Error creating upload directory ${UPLOAD_DIR}:`, err);
        // Depending on severity, you might want to throw the error or exit
        // throw new Error(`Could not create upload directory: ${err.message}`);
    }
}

// --- Multer Configuration (for General Uploads, e.g., source images for Img2Img) ---
const generalDiskStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  // Ensure req.user exists before accessing req.user.id
  filename: (req, file, cb) => {
    const userId = req.user ? req.user.id : 'guest'; // Use 'guest' or similar if user not logged in
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, `${userId}-${uniqueSuffix}${path.extname(file.originalname)}`);
  }
});

const generalUpload = multer({ 
    storage: generalDiskStorage, 
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
    fileFilter: (req, file, cb) => {
        // Basic MIME type check (more robust than just extension)
        if (file.mimetype === 'image/jpeg' || file.mimetype === 'image/png') {
            cb(null, true);
        } else {
            console.log(`[Multer Filter General] Rejecting file type: ${file.mimetype}`);
            // Pass an error to Multer
            cb(new Error('Invalid file type. Only JPEG or PNG images are allowed.'), false);
        }
    }
});

// --- Multer Configuration for Runware (expects image in memory) ---
const runwareMemoryStorage = multer.memoryStorage(); 

const runwareUpload = multer({ 
    storage: runwareMemoryStorage, 
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
    fileFilter: (req, file, cb) => {
        // Allow common image types Runware might accept
        if (file.mimetype.startsWith('image/')) { 
            cb(null, true);
        } else {
            console.log(`[Multer Filter Runware] Rejecting file type: ${file.mimetype}`);
             // Pass an error to Multer
            cb(new Error('Invalid file type for image generation.'), false);
        }
    }
});

module.exports = {
    generalUpload,
    runwareUpload,
    UPLOAD_DIR // Exporting UPLOAD_DIR might be useful elsewhere
};