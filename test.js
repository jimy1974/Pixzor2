require('dotenv').config();
const db = require('./db');

// Debug: Print environment variables
console.log('DB_HOST in server.js:', process.env.DB_HOST);
console.log('DB_USER in server.js:', process.env.DB_USER);
console.log('DB_PASSWORD in server.js:', process.env.DB_PASSWORD);
console.log('DB_NAME in server.js:', process.env.DB_NAME);

const express = require('express');
const path = require('path');
const expressLayouts = require('express-ejs-layouts');
const session = require('express-session');
const passport = require('passport');
const { Sequelize } = require('sequelize');  // Import Sequelize class
const routes = require('./routes');

// Create and export the sequelize instance
const sequelize = new Sequelize({
  database: process.env.DB_NAME,
  username: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  host: process.env.DB_HOST,
  dialect: 'mysql',
  logging: console.log
});

// Export the sequelize instance
module.exports = sequelize;

// Debug: Log the imported sequelize object
console.log('Imported sequelize object:', sequelize);

console.log('Database connection details:', {
  database: process.env.DB_NAME,
  username: process.env.DB_USER,
  password: '******', // Don't log actual password
  host: process.env.DB_HOST
});

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
  secret: process.env.SESSION_SECRET || 'your-secret',
  resave: false,
  saveUninitialized: false,
}));
app.use(passport.initialize());
app.use(passport.session());
app.use(express.static('public'));

// Set up view engine
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');
app.use(expressLayouts);
app.set('layout', 'layouts/layout');

// Serve static files
app.use('/images', express.static(path.join(__dirname, 'public', 'images')));

// Use routes
app.use('/', routes);

// Home route
app.get('/', (req, res) => {
    res.render('index', {
        title: 'Pixzor - AI Image Generation',
        description: 'Create stunning AI-generated images with Pixzor'
    });
});

// Test API endpoint with hardcoded data
app.get('/api/public-posts', (req, res) => {
  const testImages = [
    { id: 1, imageUrl: '/images/placeholder.png', thumbnailUrl: '/images/placeholder.png', prompt: 'Test Image 1' },
    { id: 2, imageUrl: '/images/placeholder.png', thumbnailUrl: '/images/placeholder.png', prompt: 'Test Image 2' },
  ];
  res.json({ images: testImages, hasMore: false });
});

// Test database connection
db.sequelize.authenticate()
  .then(() => {
    console.log('Database connection verified from server.js');
  })
  .catch(err => {
    console.error('Database connection error:', err);
  });

// Sync Database and Start Server
(async () => {
  try {
    // Debug: Log the sequelize instance
    console.log('Sequelize instance in server.js:', sequelize);

    // Test the connection first
    await sequelize.authenticate();
    console.log('Database connection established successfully.');

    // Then sync the models
    await sequelize.sync({ alter: true });
    console.log('Database synced.');

    // Start the server
    app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
  } catch (err) {
    console.error('Database connection or sync failed:', err);
    process.exit(1); // Exit with failure code
  }
})();