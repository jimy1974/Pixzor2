// Helper middleware to ensure user is authenticated
function isAuthenticated(req, res, next) {
    if (req.isAuthenticated()) {
        return next();
    }
    // console.log('[AuthMiddleware] User not authenticated, redirecting to login.'); // Optional logging
    // Redirect to login page, maybe preserving intended destination
    // req.session.returnTo = req.originalUrl; // Optional: Save where they were going
    res.redirect('/login');
}

module.exports = { isAuthenticated };
