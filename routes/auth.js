const express = require('express');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const User = require('../db').User; // Assuming User model is exported from db
const router = express.Router();

// Determine Base URL and Redirect URI (copied from server.js)
const appBaseUrl = process.env.APP_BASE_URL || 'http://localhost:3000'; // Default to localhost for safety
const googleRedirectUri = process.env.GOOGLE_REDIRECT_URI || `${appBaseUrl}/auth/google/callback`;

console.log(`[Auth] Using Google Redirect URI: ${googleRedirectUri}`); // Add log for debugging

// Google OAuth Strategy Configuration (copied from server.js)
passport.use(new GoogleStrategy({
    clientID: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL: googleRedirectUri,
}, async (accessToken, refreshToken, profile, done) => {
    try {
        console.log('[Auth Strategy] Received profile:', profile.id, profile.displayName, profile.emails?.[0]?.value);
        let user = await User.findOne({ where: { googleId: profile.id } });
        if (!user) {
            console.log(`[Auth Strategy] Google ID ${profile.id} not found, checking email...`);
            const primaryEmail = profile.emails && profile.emails.length > 0 ? profile.emails[0].value : null;
            if (!primaryEmail) {
                 console.error('[Auth Strategy] Error: No email found in Google profile.');
                 return done(new Error('No email found in Google profile.'), null);
            }
            const existingEmailUser = await User.findOne({ where: { email: primaryEmail } });
            if (existingEmailUser) {
                 console.log(`[Auth Strategy] Found existing user by email ${primaryEmail}, linking Google ID.`);
                existingEmailUser.googleId = profile.id;
                // Optionally update photo if missing or different
                if (!existingEmailUser.photo && profile.photos && profile.photos.length > 0) {
                    existingEmailUser.photo = profile.photos[0].value;
                }
                await existingEmailUser.save();
                user = existingEmailUser;
            } else {
                 console.log(`[Auth Strategy] No existing user found, creating new user for ${primaryEmail}.`);
                user = await User.create({
                    googleId: profile.id,
                    credits: 2.00, // Default credits instead of tokens
                    email: primaryEmail,
                    username: profile.displayName || primaryEmail.split('@')[0], // Use display name or derive from email
                    photo: profile.photos && profile.photos.length > 0 ? profile.photos[0].value : null
                });
                 console.log(`[Auth Strategy] New user created with ID: ${user.id}`);
            }
        } else {
            console.log(`[Auth Strategy] Found user by Google ID ${profile.id}: User ID ${user.id}`);
        }
        return done(null, user);
    } catch (error) {
        console.error('[Auth Strategy] Error during authentication:', error.message);
        console.error('[Auth Strategy] Full error details:', error);
        return done(error, null);
    }
}));

// Auth routes (copied from server.js)
router.get('/auth/google', passport.authenticate('google', { scope: ['profile', 'email'] }));

router.get('/auth/google/callback',
    passport.authenticate('google', { 
        failureRedirect: '/?login=failed', // Redirect to home with failure param
        failureMessage: true // Store failure message in session flash
    }),
    (req, res) => {
        console.log('[Auth Callback] Successful authentication, attempting to save session before redirecting...');
        // Explicitly save the session before redirecting
        req.session.save((err) => {
            if (err) {
                console.error('[Auth Callback] Error saving session:', err);
                // Handle error appropriately, maybe redirect to an error page or login
                return res.redirect('/?login=failed'); // Redirect with failure param on save error
            }
            console.log('[Auth Callback] Session saved successfully. Redirecting to /');
            res.redirect('/');
        });
    }
);

router.get('/logout', (req, res, next) => {
    console.log('[Auth Logout] Logging out user.');
    req.logout((err) => {
        if (err) {
            console.error('[Auth Logout] Error during logout:', err);
            return next(err);
        }
        req.session.destroy((err) => { // Also destroy session data
            if (err) {
                 console.error('[Auth Logout] Error destroying session:', err);
            }
            res.clearCookie('connect.sid'); // Optional: Clear session cookie
            console.log('[Auth Logout] Logout successful, redirecting to /');
            res.redirect('/');
        });
    });
});

module.exports = router;
