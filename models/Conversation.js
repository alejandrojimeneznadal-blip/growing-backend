const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const Conversation = sequelize.define('Conversation', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  userId: {
    type: DataTypes.UUID,
    allowNull: false,
    references: {
      model: 'Users',
      key: 'id'
    }
  },
  title: {
    type: DataTypes.STRING,
    allowNull: false,
    defaultValue: 'Nueva Consulta'
  },
  category: {
    type: DataTypes.ENUM('comercial', 'meta-ads', 'gohighlevel', 'general', 'delegado'),
    defaultValue: 'general'
  },
  status: {
    type: DataTypes.ENUM('active', 'resolved', 'pending', 'escalated'),
    defaultValue: 'active'
  },
  summary: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  metadata: {
    type: DataTypes.JSONB,
    defaultValue: {
      source: 'web',
      browser: null,
      device: null,
      satisfaction: null
    }
  },
  sessionId: {
    type: DataTypes.STRING,
    unique: true,
    allowNull: false
  },
  resolvedAt: {
    type: DataTypes.DATE,
    allowNull: true
  },
  escalatedAt: {
    type: DataTypes.DATE,
    allowNull: true
  },
  escalatedTo: {
    type: DataTypes.STRING,
    allowNull: true
  },
  tags: {
    type: DataTypes.ARRAY(DataTypes.STRING),
    defaultValue: []
  },
  rating: {
    type: DataTypes.INTEGER,
    allowNull: true,
    validate: {
      min: 1,
      max: 5
    }
  },
  feedback: {
    type: DataTypes.TEXT,
    allowNull: true
  }
}, {
  timestamps: true,
  indexes: [
    {
      fields: ['userId']
    },
    {
      fields: ['status']
    },
    {
      fields: ['category']
    },
    {
      fields: ['createdAt']
    }
  ]
});

// Class methods
Conversation.getAnalytics = async function(startDate, endDate) {
  const { Op } = require('sequelize');
  const where = {};
  if (startDate && endDate) {
    where.createdAt = {
      [Op.between]: [startDate, endDate]
    };
  }

  const [totalCount, byCategory, byStatus, avgRating] = await Promise.all([
    this.count({ where }),
    this.count({
      where,
      group: ['category'],
      attributes: ['category']
    }),
    this.count({
      where,
      group: ['status'],
      attributes: ['status']
    }),
    this.aggregate('rating', 'AVG', { where })
  ]);

  return {
    total: totalCount,
    byCategory,
    byStatus,
    averageRating: avgRating
  };
};

module.exports = Conversation;
