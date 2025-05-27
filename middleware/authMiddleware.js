// middleware/authMiddleware.js

// Helper middleware to ensure user is authenticated
function isAuthenticated(req, res, next) {
    if (req.isAuthenticated()) {
        return next(); // User is authenticated, proceed
    }

    // Check if the request is an API call
    // A simple way is to check if the originalUrl starts with '/api/'
    // You could also check for an 'Accept: application/json' header,
    // or a custom 'X-Requested-With: XMLHttpRequest' header if you send it.
    if (req.originalUrl.startsWith('/api/')) {
        // For API calls, respond with 401 Unauthorized JSON
        console.log('[AuthMiddleware] API request - User not authenticated, responding with 401.');
        return res.status(401).json({ error: 'Unauthorized. Please log in to access your files.' });
    } else {
        // For non-API (traditional web page) requests, redirect to login
        console.log('[AuthMiddleware] Web request - User not authenticated, redirecting to login.');
        // req.session.returnTo = req.originalUrl; // Optional: Save where they were going
        return res.redirect('/login');
    }
}

module.exports = { isAuthenticated };