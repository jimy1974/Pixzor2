const express = require('express');
const router = express.Router();
const { isAuthenticated } = require('../middleware/authMiddleware'); // Adjust path as necessary

// Route to serve the create-images partial (Requires login)
router.get('/create-images', isAuthenticated, (req, res) => {
    // Pass user data if needed by the partial
    res.render('partials/create-images', { layout: false, user: req.user }); 
});

// Route to serve the chat-tab partial (Requires login)
router.get('/chat-tab', isAuthenticated, (req, res) => {
    // Pass user data if needed by the partial
    res.render('partials/chat-tab', { layout: false, user: req.user }); 
});

// Route to serve the gallery partial (Publicly accessible HTML structure)
router.get('/gallery', (req, res) => {
    // Renders views/gallery.ejs without the main layout
    res.render('gallery', { layout: false }); 
});

module.exports = router;
