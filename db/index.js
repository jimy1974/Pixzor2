// C:\Users\james\Desktop\PixzorProject\newWebsite5\db\index.js
const { Sequelize, DataTypes } = require('sequelize'); // Destructure DataTypes here

const sequelize = new Sequelize({
    dialect: 'mysql',
    host: 'localhost',
    username: 'jim',
    password: '1lonewolf',
    database: 'pixzorai',
});

const models = {
    User: require('./models/User')(sequelize, DataTypes),
    GeneratedContent: require('./models/GeneratedContent')(sequelize, DataTypes),
    ChatSession: require('./models/ChatSession')(sequelize, DataTypes),
    ImageComment: require('./models/ImageComment')(sequelize, DataTypes),
    ImageLike: require('./models/ImageLike')(sequelize, DataTypes)
};

// Ensure all models are valid before associating
for (const modelName in models) {
    if (typeof models[modelName].associate !== 'function') {
        console.warn(`[DB Setup] Model ${modelName} does not have an associate function or is not a valid model.`);
    }
}

Object.values(models).forEach(model => {
    if (model.associate) model.associate(models);
});

sequelize.authenticate()
    .then(() => console.log('Database connection established successfully.'))
    .catch(err => console.error('Unable to connect to the database:', err));

console.log('Sequelize instance in db/index.js:', sequelize);

module.exports = { sequelize, ...models };