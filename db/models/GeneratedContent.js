// C:\Users\james\Desktop\PixzorProject\newWebsite5\db\models\GeneratedContent.js
const { DataTypes } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
    const GeneratedContent = sequelize.define('GeneratedContent', {
        id: {
            type: DataTypes.INTEGER,
            primaryKey: true,
            autoIncrement: true,
        },
        userId: {
            type: DataTypes.INTEGER,
            allowNull: false,
            references: {
                model: 'users',
                key: 'id',
            },
            onDelete: 'CASCADE',
        },
        type: {
            type: DataTypes.ENUM('image', 'video'),
            allowNull: false,
        },
        contentUrl: {
            type: DataTypes.STRING(255),
            allowNull: false,
        },
        thumbnailUrl: {
            type: DataTypes.STRING(255),
            allowNull: true,
        },
        prompt: {
            type: DataTypes.TEXT,
            allowNull: false,
        },
        model: {
            type: DataTypes.STRING(255),
            allowNull: true,
        },
        tokenCost: {
            type: DataTypes.DECIMAL(10, 2),
            allowNull: false,
        },
        isPublic: {
            type: DataTypes.BOOLEAN,
            allowNull: false,
            defaultValue: false,
        },
    }, {
        tableName: 'generated_content',
        timestamps: true,
    });

    GeneratedContent.associate = (models) => {
        GeneratedContent.belongsTo(models.User, { foreignKey: 'userId', as: 'user' });
        GeneratedContent.hasMany(models.ImageComment, { foreignKey: 'contentId', as: 'comments' });
    };

    return GeneratedContent;
};