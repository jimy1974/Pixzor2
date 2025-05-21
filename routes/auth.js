const express = require('express');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const { User, Sequelize } = require('../db');
const router = express.Router();

const appBaseUrl = process.env.APP_BASE_URL || 'http://localhost:3000';
const googleRedirectUri = process.env.GOOGLE_REDIRECT_URI || `${appBaseUrl}/auth/google/callback`;
console.log(`[Auth] Using Google Redirect URI: ${googleRedirectUri}`);

passport.use(new GoogleStrategy({
  clientID: process.env.GOOGLE_CLIENT_ID,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  callbackURL: googleRedirectUri,
}, async (accessToken, refreshToken, profile, done) => {
  try {
    console.log('[Auth Strategy] Received profile:', profile.id, profile.displayName, profile.emails?.[0]?.value);
    let user = await User.findOne({
      where: {
        [Sequelize.Op.or]: [
          { googleId: profile.id },
          { email: profile.emails?.[0]?.value }
        ]
      }
    });

    const primaryEmail = profile.emails?.[0]?.value;
    if (!primaryEmail) {
      console.error('[Auth Strategy] Error: No email found in Google profile.');
      return done(new Error('No email found in Google profile.'), null);
    }

    if (user) {
      console.log(`[Auth Strategy] Found user: ${user.email}`);
      await user.update({
        googleId: profile.id,
        photo: profile.photos?.[0]?.value || user.photo,
        updatedAt: new Date()
      });
    } else {
      console.log(`[Auth Strategy] Creating new user for ${primaryEmail}`);
      let username = profile.displayName || primaryEmail.split('@')[0];
      let suffix = 1;
      while (await User.findOne({ where: { username } })) {
        username = `${profile.displayName || primaryEmail.split('@')[0]}${suffix}`;
        suffix++;
      }
      user = await User.create({
        googleId: profile.id,
        email: primaryEmail,
        username,
        credits: 2.00,
        photo: profile.photos?.[0]?.value,
        createdAt: new Date(),
        updatedAt: new Date()
      });
      console.log(`[Auth Strategy] New user created with ID: ${user.id}`);
    }
    return done(null, user);
  } catch (error) {
    console.error('[Auth Strategy] Error during authentication:', error);
    return done(error, null);
  }
}));

router.get('/auth/google', passport.authenticate('google', { scope: ['profile', 'email'] }));

router.get('/auth/google/callback',
  passport.authenticate('google', { 
    failureRedirect: '/?login=failed',
    failureMessage: true
  }),
  (req, res) => {
    console.log('[Auth Callback] Successful authentication');
    req.session.save(err => {
      if (err) {
        console.error('[Auth Callback] Error saving session:', err);
        return res.redirect('/?login=failed');
      }
      res.redirect('/');
    });
  }
);

router.get('/logout', (req, res, next) => {
  console.log('[Auth Logout] Logging out user.');
  req.logout(err => {
    if (err) return next(err);
    req.session.destroy(err => {
      if (err) console.error('[Auth Logout] Error destroying session:', err);
      res.clearCookie('connect.sid');
      res.redirect('/');
    });
  });
});

module.exports = router;
