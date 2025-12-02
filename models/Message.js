const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const Message = sequelize.define('Message', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  conversationId: {
    type: DataTypes.UUID,
    allowNull: false,
    references: {
      model: 'Conversations',
      key: 'id'
    }
  },
  sender: {
    type: DataTypes.ENUM('user', 'bot', 'admin'),
    allowNull: false
  },
  content: {
    type: DataTypes.TEXT,
    allowNull: true  // Cambiado a true (puede ser solo imagen)
  },
  imageData: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  imageMimeType: {
    type: DataTypes.STRING(50),
    allowNull: true
  },
  attachments: {
    type: DataTypes.JSONB,
    defaultValue: []
  },
  metadata: {
    type: DataTypes.JSONB,
    defaultValue: {
      confidence: null,
      intent: null,
      tokens: null,
      model: null
    }
  },
  isRead: {
    type: DataTypes.BOOLEAN,
    defaultValue: false
  },
  editedAt: {
    type: DataTypes.DATE,
    allowNull: true
  },
  deletedAt: {
    type: DataTypes.DATE,
    allowNull: true
  }
}, {
  timestamps: true,
  paranoid: true,
  indexes: [
    {
      fields: ['conversationId']
    },
    {
      fields: ['sender']
    },
    {
      fields: ['createdAt']
    }
  ]
});

module.exports = Message;
