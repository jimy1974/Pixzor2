require('dotenv').config({ path: require('path').resolve(__dirname, '.env') });
const { Sequelize, DataTypes } = require('sequelize');

// --- Import Model Definitions ---
// Corrected paths assuming models are in db/models/
const defineUserModel = require('./db/models/User');
const defineGeneratedContentModel = require('./db/models/GeneratedContent');
const defineChatSessionModel = require('./db/models/ChatSession');
const defineImageCommentModel = require('./db/models/ImageComment'); // Corrected path
const defineImageLikeModel = require('./db/models/ImageLike');    // Added ImageLike model

// Database connection settings
const dbConfig = {
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 3306,
    database: process.env.DB_NAME || 'pixzorai',
    username: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    dialect: 'mysql',
    logging: false
};

// Log the database configuration (without password)
console.log('Database configuration:', {
    ...dbConfig,
    password: dbConfig.password ? '[REDACTED]' : undefined
});

// Initialize Sequelize instance
const sequelize = new Sequelize(
    dbConfig.database,
    dbConfig.username,
    dbConfig.password,
    {
        host: dbConfig.host,
        port: dbConfig.port,
        dialect: dbConfig.dialect,
        logging: dbConfig.logging,
        underscored: true
    }
);

// --- Load Models ---
const db = {}; // Object to hold models

db.Sequelize = Sequelize; // Export Sequelize class
db.sequelize = sequelize; // Export configured instance

// Load models into the db object
db.User = defineUserModel(sequelize, DataTypes); // Example assuming default export structure
db.GeneratedContent = defineGeneratedContentModel(sequelize, DataTypes);
db.ChatSession = defineChatSessionModel(sequelize, DataTypes);
db.ImageComment = defineImageCommentModel(sequelize, DataTypes);
db.ImageLike = defineImageLikeModel(sequelize, DataTypes); // Load ImageLike model

// --- Define Associations ---
// Call associate method if defined in the model files
Object.keys(db).forEach(modelName => {
  if (db[modelName].associate) {
    db[modelName].associate(db);
    console.log(`Associations configured for ${modelName}`);
  } else if (modelName !== 'Sequelize' && modelName !== 'sequelize') {
       console.warn(`Model ${modelName} does not have an associate method.`);
  }
});

// --- Export ---
module.exports = db; 