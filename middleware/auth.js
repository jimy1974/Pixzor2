function ensureAuthenticated(req, res, next) {
  if (req.isAuthenticated()) return next();
  res.status(401).json({ error: 'Please log in to perform this action.' });
}

module.exports = { ensureAuthenticated }; 