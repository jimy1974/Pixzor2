// db\models\User.js
// const { DataTypes } = require('sequelize'); // Removed this line

module.exports = (sequelize, DataTypes) => { // Ensure this DataTypes is used
    const User = sequelize.define('User', {
        username: {
            type: DataTypes.STRING,
            unique: true,
            allowNull: false,
        },
        email: {
            type: DataTypes.STRING,
            unique: true,
            allowNull: false,
        },
        password: {
            type: DataTypes.STRING,
            allowNull: true,
        },
        credits: {
            type: DataTypes.DECIMAL(10, 2),
            defaultValue: 2.00,
        },
        googleId: {
            type: DataTypes.STRING,
            unique: true,
            allowNull: true,
        },
        photo: {
            type: DataTypes.STRING,
            allowNull: true,
        },       
    }, {
        tableName: 'users',
        timestamps: true,
    });

    User.associate = (models) => {
        User.hasMany(models.GeneratedContent, { foreignKey: 'userId', as: 'generatedContents' });
        User.hasMany(models.ChatSession, { foreignKey: 'userId', as: 'chatSessions' });
        User.hasMany(models.ImageComment, { foreignKey: 'userId', as: 'imageComments' });
        User.hasMany(models.ImageLike, { foreignKey: 'userId', as: 'imageLikes' }); // Add this line
    };

    return User;
};