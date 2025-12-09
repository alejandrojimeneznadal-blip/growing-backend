const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const Feedback = sequelize.define('Feedback', {
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
  userId: {
    type: DataTypes.UUID,
    allowNull: false,
    references: {
      model: 'Users',
      key: 'id'
    }
  },
  messageId: {
    type: DataTypes.STRING,
    allowNull: true,
    comment: 'ID del mensaje en el frontend (para correlación)'
  },
  resolved: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    comment: 'Si el usuario indicó que se resolvió su consulta'
  },
  speedRating: {
    type: DataTypes.INTEGER,
    allowNull: true,
    validate: {
      min: 1,
      max: 5
    },
    comment: 'Valoración de velocidad (1-5 estrellas)'
  },
  qualityRating: {
    type: DataTypes.INTEGER,
    allowNull: true,
    validate: {
      min: 1,
      max: 5
    },
    comment: 'Valoración de calidad (1-5 estrellas)'
  },
  clearSteps: {
    type: DataTypes.BOOLEAN,
    allowNull: true,
    comment: 'Si los pasos fueron claros para resolver'
  },
  escalated: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
    comment: 'Si el usuario escaló la consulta'
  },
  escalatedCategory: {
    type: DataTypes.STRING,
    allowNull: true,
    comment: 'Categoría seleccionada para escalar'
  },
  continuedAfterEscalation: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
    comment: 'Si el usuario continuó el chat después de escalar'
  },
  metadata: {
    type: DataTypes.JSONB,
    defaultValue: {},
    comment: 'Datos adicionales (navegador, dispositivo, etc.)'
  }
}, {
  timestamps: true,
  indexes: [
    { fields: ['conversationId'] },
    { fields: ['userId'] },
    { fields: ['resolved'] },
    { fields: ['createdAt'] },
    { fields: ['escalated'] }
  ]
});

// Métodos de clase para estadísticas
Feedback.getStats = async function(options = {}) {
  const { Op } = require('sequelize');
  const where = {};
  
  if (options.startDate && options.endDate) {
    where.createdAt = {
      [Op.between]: [options.startDate, options.endDate]
    };
  }
  
  if (options.category) {
    where.escalatedCategory = options.category;
  }

  const [
    totalFeedback,
    resolvedCount,
    notResolvedCount,
    escalatedCount,
    avgSpeedRating,
    avgQualityRating,
    clearStepsYes,
    clearStepsNo
  ] = await Promise.all([
    this.count({ where }),
    this.count({ where: { ...where, resolved: true } }),
    this.count({ where: { ...where, resolved: false } }),
    this.count({ where: { ...where, escalated: true } }),
    this.aggregate('speedRating', 'AVG', { where: { ...where, speedRating: { [Op.ne]: null } } }),
    this.aggregate('qualityRating', 'AVG', { where: { ...where, qualityRating: { [Op.ne]: null } } }),
    this.count({ where: { ...where, clearSteps: true } }),
    this.count({ where: { ...where, clearSteps: false } })
  ]);

  return {
    total: totalFeedback,
    resolved: {
      yes: resolvedCount,
      no: notResolvedCount,
      percentage: totalFeedback > 0 ? Math.round((resolvedCount / totalFeedback) * 100) : 0
    },
    escalated: {
      count: escalatedCount,
      percentage: totalFeedback > 0 ? Math.round((escalatedCount / totalFeedback) * 100) : 0
    },
    ratings: {
      speed: avgSpeedRating ? parseFloat(avgSpeedRating.toFixed(2)) : null,
      quality: avgQualityRating ? parseFloat(avgQualityRating.toFixed(2)) : null
    },
    clearSteps: {
      yes: clearStepsYes,
      no: clearStepsNo,
      percentage: (clearStepsYes + clearStepsNo) > 0 
        ? Math.round((clearStepsYes / (clearStepsYes + clearStepsNo)) * 100) 
        : 0
    }
  };
};

module.exports = Feedback;
