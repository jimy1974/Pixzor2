const { DataTypes } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
    const ImageComment = sequelize.define('ImageComment', {
        id: {
            type: DataTypes.INTEGER,
            primaryKey: true,
            autoIncrement: true,
        },
        contentId: {
            type: DataTypes.INTEGER,
            allowNull: false,
            references: {
                model: 'generated_content', // Ensure this matches the table name of GeneratedContent
                key: 'id',
            },
            onDelete: 'CASCADE',
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
        commentText: { // Match the column name from your CREATE TABLE statement
            type: DataTypes.TEXT,
            allowNull: false,
        },
        // createdAt and updatedAt are handled by Sequelize timestamps: true
    }, {
        tableName: 'image_comments',
        timestamps: true, // Automatically adds createdAt and updatedAt
    });

    ImageComment.associate = (models) => {
        // A comment belongs to one piece of generated content
        ImageComment.belongsTo(models.GeneratedContent, { foreignKey: 'contentId', as: 'content' });
        // A comment belongs to one user
        ImageComment.belongsTo(models.User, { foreignKey: 'userId', as: 'user' });
    };

    return ImageComment;
};
