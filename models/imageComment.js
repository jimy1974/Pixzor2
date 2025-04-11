'use strict';
const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class ImageComment extends Model {
    /**
     * Helper method for defining associations.
     * This method is not a part of Sequelize lifecycle.
     * The `models/index` file will call this method automatically.
     */
    static associate(models) {
      // define association here
      ImageComment.belongsTo(models.User, {
        foreignKey: 'userId',
        as: 'user' // Alias to access the user who made the comment
      });
      ImageComment.belongsTo(models.GeneratedContent, {
        foreignKey: 'contentId',
        as: 'content' // Alias to access the commented content
      });
    }
  }
  ImageComment.init({
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
      allowNull: false
    },
    contentId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: {
        model: 'generated_content', // Name of the target table
        key: 'id'
      },
      onDelete: 'CASCADE'
    },
    userId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: {
        model: 'users', // Name of the target table
        key: 'id'
      },
       onDelete: 'CASCADE'
    },
    commentText: {
      type: DataTypes.TEXT,
      allowNull: false
    },
    createdAt: {
      allowNull: false,
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW
    },
    updatedAt: {
      allowNull: false,
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW
    }
  }, {
    sequelize,
    modelName: 'ImageComment',
    tableName: 'image_comments', // Explicitly specify the table name
    timestamps: true // Enables createdAt and updatedAt
  });
  return ImageComment;
}; 