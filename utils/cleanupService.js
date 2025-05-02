const fs = require('fs').promises;
const path = require('path');
const cron = require('node-cron');

const UPLOAD_DIR = path.join(__dirname, '..', 'public', 'uploads');
const MAX_AGE_HOURS = 24; // Files older than 24 hours will be deleted

async function cleanupOldFiles() {
    console.log('[Cleanup] Starting scheduled cleanup of old uploads...');
    const now = Date.now();
    const maxAgeMs = MAX_AGE_HOURS * 60 * 60 * 1000;
    let filesDeleted = 0;
    let errorsEncountered = 0;

    try {
        const items = await fs.readdir(UPLOAD_DIR);

        for (const item of items) {
            const itemPath = path.join(UPLOAD_DIR, item);
            try {
                const stats = await fs.stat(itemPath);

                // Check if it's a file and if it's older than the max age
                if (stats.isFile()) {
                    const fileAgeMs = now - stats.mtimeMs;
                    if (fileAgeMs > maxAgeMs) {
                        await fs.unlink(itemPath);
                        console.log(`[Cleanup] Deleted old file: ${itemPath}`);
                        filesDeleted++;
                    } 
                } else if (stats.isDirectory()) {
                    // Optional: Add logic here if you ever need to clean up old subdirectories
                    // console.log(`[Cleanup] Skipping directory: ${itemPath}`);
                }
            } catch (statError) {
                 // Handle case where file might be deleted between readdir and stat
                if (statError.code !== 'ENOENT') { 
                    console.error(`[Cleanup] Error getting stats for ${itemPath}:`, statError);
                    errorsEncountered++;
                }
            }
        }

        console.log(`[Cleanup] Finished cleanup. Files deleted: ${filesDeleted}. Errors: ${errorsEncountered}.`);

    } catch (error) {
        // Handle error reading the directory itself
        if (error.code === 'ENOENT') {
             console.log(`[Cleanup] Upload directory ${UPLOAD_DIR} not found. Skipping cleanup.`);
        } else {
             console.error(`[Cleanup] Error reading upload directory ${UPLOAD_DIR}:`, error);
        }
    }
}

// Schedule the cleanup job to run once a day (e.g., at 3:00 AM server time)
// You can adjust the cron schedule string as needed. See node-cron documentation.
// Format: <minute> <hour> <day_of_month> <month> <day_of_week>
function startCleanupSchedule() {
    // Run daily at 3:00 AM
    cron.schedule('0 3 * * *', cleanupOldFiles, {
        scheduled: true,
        timezone: "Europe/London" // Set to your server's timezone if needed
    });

    console.log(`[Cleanup] Scheduled cleanup job to run daily at 3:00 AM (Timezone: ${cron.getTasks().values().next().value.options.timezone || 'Server Default'}).`);

    // Optional: Run cleanup once immediately on server start
    // cleanupOldFiles(); 
}

module.exports = { startCleanupSchedule, cleanupOldFiles };
