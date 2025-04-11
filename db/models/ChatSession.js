// models/ChatSession.js
const { DataTypes } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
    const ChatSession = sequelize.define('ChatSession', {
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
        title: {
            type: DataTypes.STRING(255),
            allowNull: false,
        },
    }, {
        tableName: 'chat_sessions',
        timestamps: true,
    });

    ChatSession.associate = (models) => {
        ChatSession.belongsTo(models.User, { foreignKey: 'userId', as: 'user' });
    };

    return ChatSession;
};