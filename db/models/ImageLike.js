// const { DataTypes, Model } = require('sequelize'); // Removed this line
const { Model } = require('sequelize'); // Keep Model import if ImageLike extends it

module.exports = (sequelize, DataTypes) => { // Ensure this DataTypes is used
  class ImageLike extends Model {
    static associate(models) {
      ImageLike.belongsTo(models.User, {
        foreignKey: 'userId',
        as: 'user',
        onDelete: 'CASCADE', // If a user is deleted, their likes are deleted
      });
      ImageLike.belongsTo(models.GeneratedContent, {
        foreignKey: 'contentId',
        as: 'generatedContent',
        onDelete: 'CASCADE', // If content is deleted, its likes are deleted
      });
    }
  }

  ImageLike.init({
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
      allowNull: false
    },
    userId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: {
        model: 'users', // Corrected to actual table name
        key: 'id'
      },
      onUpdate: 'CASCADE',
      onDelete: 'CASCADE'
    },
    contentId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: {
        model: 'generated_content', // Corrected to actual table name
        key: 'id'
      },
      onUpdate: 'CASCADE',
      onDelete: 'CASCADE'
    },
    // Timestamps are managed by Sequelize by default (createdAt, updatedAt)
  }, {
    sequelize,
    modelName: 'ImageLike',
    tableName: 'ImageLikes', // Explicitly define table name
    timestamps: true, // Enable timestamps
    // Optional: Add a unique constraint to prevent a user from liking the same content multiple times
    indexes: [
      {
        unique: true,
        fields: ['userId', 'contentId']
      }
    ]
  });

  return ImageLike;
};