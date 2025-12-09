const router = require('express').Router();
const { body, query, validationResult } = require('express-validator');
const { Feedback, Conversation } = require('../models');
const { authMiddleware } = require('../middleware/auth');
const { Op } = require('sequelize');

// Guardar feedback (puede ser parcial - se va guardando a medida que el usuario responde)
router.post('/', authMiddleware, [
  body('conversationId').optional().isUUID(),
  body('messageId').optional().isString(),
  body('resolved').optional().isBoolean(),
  body('speedRating').optional().isInt({ min: 1, max: 5 }),
  body('qualityRating').optional().isInt({ min: 1, max: 5 }),
  body('clearSteps').optional().isBoolean(),
  body('escalatedCategory').optional().isString(),
  body('continuedAfterEscalation').optional().isBoolean()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        errors: errors.array()
      });
    }

    const {
      conversationId,
      messageId,
      resolved,
      speedRating,
      qualityRating,
      clearSteps,
      escalatedCategory,
      continuedAfterEscalation
    } = req.body;

    // Verificar que la conversación existe y pertenece al usuario
    if (conversationId) {
      const conversation = await Conversation.findOne({
        where: {
          id: conversationId,
          userId: req.userId
        }
      });

      if (!conversation) {
        return res.status(404).json({
          success: false,
          message: 'Conversation not found'
        });
      }
    }

    // Buscar feedback existente para esta conversación/mensaje o crear uno nuevo
    let feedback;
    
    if (conversationId && messageId) {
      feedback = await Feedback.findOne({
        where: {
          conversationId,
          messageId,
          userId: req.userId
        }
      });
    }

    if (feedback) {
      // Actualizar feedback existente
      const updates = {};
      
      if (resolved !== undefined) updates.resolved = resolved;
      if (speedRating !== undefined) updates.speedRating = speedRating;
      if (qualityRating !== undefined) updates.qualityRating = qualityRating;
      if (clearSteps !== undefined) updates.clearSteps = clearSteps;
      if (escalatedCategory !== undefined) {
        updates.escalatedCategory = escalatedCategory;
        updates.escalated = true;
      }
      if (continuedAfterEscalation !== undefined) updates.continuedAfterEscalation = continuedAfterEscalation;

      await feedback.update(updates);

      console.log('Feedback updated:', feedback.id, updates);
    } else {
      // Crear nuevo feedback
      feedback = await Feedback.create({
        conversationId: conversationId || null,
        userId: req.userId,
        messageId: messageId || null,
        resolved: resolved !== undefined ? resolved : null,
        speedRating: speedRating || null,
        qualityRating: qualityRating || null,
        clearSteps: clearSteps !== undefined ? clearSteps : null,
        escalated: escalatedCategory ? true : false,
        escalatedCategory: escalatedCategory || null,
        continuedAfterEscalation: continuedAfterEscalation || false
      });

      console.log('Feedback created:', feedback.id);
    }

    // Si se escaló, actualizar la categoría de la conversación a "delegado"
    if (escalatedCategory && conversationId) {
      await Conversation.update(
        { 
          category: 'delegado',
          status: 'escalated',
          escalatedAt: new Date()
        },
        { where: { id: conversationId } }
      );
      console.log('Conversation escalated:', conversationId);
    }

    res.json({
      success: true,
      data: feedback
    });

  } catch (error) {
    console.error('Save feedback error:', error);
    res.status(500).json({
      success: false,
      message: 'Error saving feedback'
    });
  }
});

// Obtener estadísticas de feedback (admin)
router.get('/stats', authMiddleware, [
  query('startDate').optional().isISO8601(),
  query('endDate').optional().isISO8601(),
  query('category').optional().isString()
], async (req, res) => {
  try {
    const { startDate, endDate, category } = req.query;

    const stats = await Feedback.getStats({
      startDate: startDate ? new Date(startDate) : null,
      endDate: endDate ? new Date(endDate) : null,
      category
    });

    // Obtener distribución por categoría escalada
    const byCategory = await Feedback.findAll({
      where: {
        escalated: true,
        ...(startDate && endDate ? {
          createdAt: { [Op.between]: [new Date(startDate), new Date(endDate)] }
        } : {})
      },
      attributes: [
        'escalatedCategory',
        [require('sequelize').fn('COUNT', require('sequelize').col('id')), 'count']
      ],
      group: ['escalatedCategory'],
      raw: true
    });

    // Obtener tendencia diaria (últimos 30 días)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const dailyTrend = await Feedback.findAll({
      where: {
        createdAt: { [Op.gte]: thirtyDaysAgo }
      },
      attributes: [
        [require('sequelize').fn('DATE', require('sequelize').col('createdAt')), 'date'],
        [require('sequelize').fn('COUNT', require('sequelize').col('id')), 'total'],
        [require('sequelize').fn('SUM', require('sequelize').literal('CASE WHEN resolved = true THEN 1 ELSE 0 END')), 'resolved'],
        [require('sequelize').fn('SUM', require('sequelize').literal('CASE WHEN escalated = true THEN 1 ELSE 0 END')), 'escalated']
      ],
      group: [require('sequelize').fn('DATE', require('sequelize').col('createdAt'))],
      order: [[require('sequelize').fn('DATE', require('sequelize').col('createdAt')), 'ASC']],
      raw: true
    });

    res.json({
      success: true,
      data: {
        ...stats,
        byCategory,
        dailyTrend
      }
    });

  } catch (error) {
    console.error('Get feedback stats error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching feedback stats'
    });
  }
});

// Obtener feedback de una conversación específica
router.get('/conversation/:conversationId', authMiddleware, async (req, res) => {
  try {
    const { conversationId } = req.params;

    // Verificar que la conversación pertenece al usuario (o es admin)
    const conversation = await Conversation.findOne({
      where: {
        id: conversationId,
        userId: req.userId
      }
    });

    if (!conversation) {
      return res.status(404).json({
        success: false,
        message: 'Conversation not found'
      });
    }

    const feedbacks = await Feedback.findAll({
      where: { conversationId },
      order: [['createdAt', 'DESC']]
    });

    res.json({
      success: true,
      data: feedbacks
    });

  } catch (error) {
    console.error('Get conversation feedback error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching feedback'
    });
  }
});

// Listar todos los feedbacks (admin) con filtros
router.get('/', authMiddleware, [
  query('resolved').optional().isBoolean(),
  query('escalated').optional().isBoolean(),
  query('limit').optional().isInt({ min: 1, max: 100 }),
  query('offset').optional().isInt({ min: 0 })
], async (req, res) => {
  try {
    const { resolved, escalated, limit = 50, offset = 0 } = req.query;
    
    const where = {};
    if (resolved !== undefined) where.resolved = resolved === 'true';
    if (escalated !== undefined) where.escalated = escalated === 'true';

    const { count, rows } = await Feedback.findAndCountAll({
      where,
      include: [{
        model: Conversation,
        as: 'conversation',
        attributes: ['id', 'title', 'category']
      }],
      order: [['createdAt', 'DESC']],
      limit: parseInt(limit),
      offset: parseInt(offset)
    });

    res.json({
      success: true,
      data: {
        feedbacks: rows,
        pagination: {
          total: count,
          limit: parseInt(limit),
          offset: parseInt(offset),
          hasMore: count > parseInt(offset) + parseInt(limit)
        }
      }
    });

  } catch (error) {
    console.error('List feedbacks error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching feedbacks'
    });
  }
});

module.exports = router;
