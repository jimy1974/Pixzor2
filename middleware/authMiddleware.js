// ===== middleware/authMiddleware.js =====

// Helper middleware to ensure user is authenticated
function isAuthenticated(req, res, next) {
    if (req.isAuthenticated()) {
        return next(); // User is authenticated, proceed
    }

    // Determine if the request is for an API endpoint or a regular web page
    // Using req.originalUrl.startsWith('/api/') as per your existing code
    if (req.originalUrl.startsWith('/api/')) {
        // For API calls, respond with 401 Unauthorized JSON
        console.warn(`[AuthMiddleware] API request to ${req.originalUrl} - User not authenticated, responding with 401.`);
        return res.status(401).json({ error: 'Unauthorized. Please log in to access this resource.' });
    } else {
        // For non-API (traditional web page) requests, redirect to login
        console.warn(`[AuthMiddleware] Web request to ${req.originalUrl} - User not authenticated, redirecting to login.`);
        // Optional: Save the original URL so the user can be redirected back after successful login
        req.session.returnTo = req.originalUrl; 
        return res.redirect('/auth/google'); // Assuming '/auth/google' is your login initiation route
    }
}

// NEW ADMIN MIDDLEWARE for HTML routes
// This middleware assumes isAuthenticated has already run successfully.
function isAdmin(req, res, next) {
    // If for some reason isAuthenticated didn't run or failed to attach user
    // (unlikely if used correctly, but good defensive programming)
    if (!req.isAuthenticated() || !req.user || !req.user.email) {
        console.warn('[AuthMiddleware] isAdmin check failed: User not authenticated or email missing. This should ideally be caught by isAuthenticated first.');
        return res.status(401).render('error', {
            layout: 'layouts/layout',
            title: 'Unauthorized',
            message: 'You must be logged in to access this page.',
            includeChat: false // Assuming this is a variable your error.ejs uses
        });
    }

    const adminEmail = process.env.ADMIN_EMAIL; // Your admin email from .env

    if (req.user.email === adminEmail) {
        console.log(`[AuthMiddleware] Admin access granted for user: ${req.user.email}`);
        return next(); // User is the admin, proceed
    } else {
        console.warn(`[AuthMiddleware] Forbidden access attempt for user ${req.user.email}: Not authorized as admin.`);
        return res.status(403).render('error', {
            layout: 'layouts/layout',
            title: 'Forbidden',
            message: 'You do not have permission to access this page.',
            includeChat: false
        });
    }
}

// NEW ADMIN MIDDLEWARE for API routes (responds with JSON)
// This middleware assumes isAuthenticated has already run successfully.
function isAdminApi(req, res, next) {
    // Defensive check (similar to isAdmin)
    if (!req.isAuthenticated() || !req.user || !req.user.email) {
        console.warn('[AuthMiddleware] isAdminApi check failed: User not authenticated or email missing.');
        return res.status(401).json({ error: 'Unauthorized: You must be logged in to perform this action.' });
    }

    const adminEmail = process.env.ADMIN_EMAIL; // Your admin email from .env

    if (req.user.email === adminEmail) {
        console.log(`[AuthMiddleware] Admin API access granted for user: ${req.user.email}`);
        return next(); // User is the admin, proceed
    } else {
        console.warn(`[AuthMiddleware] Forbidden API access attempt for user ${req.user.email}: Not authorized as admin.`);
        return res.status(403).json({ error: 'Forbidden: You do not have admin privileges.' });
    }
}

// Export all middleware functions
module.exports = { isAuthenticated, isAdmin, isAdminApi };