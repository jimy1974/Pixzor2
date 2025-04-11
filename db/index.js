// C:\Users\james\Desktop\PixzorProject\newWebsite5\db\index.js
const { Sequelize } = require('sequelize');

const sequelize = new Sequelize({
    dialect: 'mysql',
    host: 'localhost',
    username: 'jim',
    password: '1lonewolf',
    database: 'pixzorai',
});

const models = {
    User: require('./models/User')(sequelize),
    GeneratedContent: require('./models/GeneratedContent')(sequelize),
    ChatSession: require('./models/ChatSession')(sequelize),
};

Object.values(models).forEach(model => {
    if (model.associate) model.associate(models);
});

sequelize.authenticate()
    .then(() => console.log('Database connection established successfully.'))
    .catch(err => console.error('Unable to connect to the database:', err));

console.log('Sequelize instance in db/index.js:', sequelize);

module.exports = { sequelize, ...models };