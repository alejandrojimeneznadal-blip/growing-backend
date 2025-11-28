const router = require('express').Router();
const { Op } = require('sequelize');
const { User, Conversation, Message } = require('../models');
const { authMiddleware, adminMiddleware } = require('../middleware/auth');
const sequelize = require('../config/database');

// Apply auth and admin middleware to all routes
router.use(authMiddleware, adminMiddleware);

// Get all users
router.get('/users', async (req, res) => {
  try {
    const { role, isActive, limit = 50, offset = 0 } = req.query;
    
    const where = {};
    if (role) where.role = role;
    if (isActive !== undefined) where.isActive = isActive === 'true';

    const users = await User.findAll({
      where,
      attributes: { exclude: ['password'] },
      order: [['createdAt', 'DESC']],
      limit: parseInt(limit),
      offset: parseInt(offset)
    });

    const total = await User.count({ where });

    res.json({
      success: true,
      data: {
        users,
        pagination: {
          total,
          limit: parseInt(limit),
          offset: parseInt(offset)
        }
      }
    });
  } catch (error) {
    console.error('Get users error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching users'
    });
  }
});

// Get user details
router.get('/users/:id', async (req, res) => {
  try {
    const user = await User.findByPk(req.params.id, {
      attributes: { exclude: ['password'] },
      include: [{
        model: Conversation,
        as: 'conversations',
        attributes: ['id', 'title', 'category', 'status', 'rating', 'createdAt']
      }]
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    res.json({
      success: true,
      data: user
    });
  } catch (error) {
    console.error('Get user details error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching user details'
    });
  }
});

// Update user
router.patch('/users/:id', async (req, res) => {
  try {
    const { role, isActive } = req.body;
    
    const user = await User.findByPk(req.params.id);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    const updates = {};
    if (role) updates.role = role;
    if (isActive !== undefined) updates.isActive = isActive;

    await user.update(updates);

    res.json({
      success: true,
      message: 'User updated successfully',
      data: user
    });
  } catch (error) {
    console.error('Update user error:', error);
    res.status(500).json({
      success: false,
      message: 'Error updating user'
    });
  }
});

// Get all conversations (admin view)
router.get('/conversations', async (req, res) => {
  try {
    const { status, category, userId, startDate, endDate, limit = 50, offset = 0 } = req.query;
    
    const where = {};
    if (status) where.status = status;
    if (category) where.category = category;
    if (userId) where.userId = userId;
    
    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) where.createdAt[Op.gte] = new Date(startDate);
      if (endDate) where.createdAt[Op.lte] = new Date(endDate);
    }

    const conversations = await Conversation.findAll({
      where,
      include: [{
        model: User,
        as: 'user',
        attributes: ['id', 'name', 'email', 'company']
      }],
      order: [['createdAt', 'DESC']],
      limit: parseInt(limit),
      offset: parseInt(offset)
    });

    const total = await Conversation.count({ where });

    res.json({
      success: true,
      data: {
        conversations,
        pagination: {
          total,
          limit: parseInt(limit),
          offset: parseInt(offset)
        }
      }
    });
  } catch (error) {
    console.error('Get conversations error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching conversations'
    });
  }
});

// Get analytics dashboard
router.get('/analytics', async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    
    const dateFilter = {};
    if (startDate || endDate) {
      dateFilter.createdAt = {};
      if (startDate) dateFilter.createdAt[Op.gte] = new Date(startDate);
      if (endDate) dateFilter.createdAt[Op.lte] = new Date(endDate);
    }

    // Get various statistics
    const [
      totalUsers,
      activeUsers,
      totalConversations,
      activeConversations,
      resolvedConversations,
      totalMessages,
      conversationsByCategory,
      averageRating,
      conversationsPerDay
    ] = await Promise.all([
      User.count(),
      User.count({ where: { isActive: true } }),
      Conversation.count({ where: dateFilter }),
      Conversation.count({ where: { ...dateFilter, status: 'active' } }),
      Conversation.count({ where: { ...dateFilter, status: 'resolved' } }),
      Message.count({ 
        include: [{
          model: Conversation,
          as: 'conversation',
          where: dateFilter,
          required: true
        }]
      }),
      Conversation.findAll({
        where: dateFilter,
        attributes: [
          'category',
          [sequelize.fn('COUNT', sequelize.col('category')), 'count']
        ],
        group: ['category']
      }),
      Conversation.aggregate('rating', 'AVG', { where: { ...dateFilter, rating: { [Op.ne]: null } } }),
      sequelize.query(`
        SELECT 
          DATE(created_at) as date,
          COUNT(*) as count
        FROM "Conversations"
        WHERE created_at >= :startDate
        GROUP BY DATE(created_at)
        ORDER BY date DESC
        LIMIT 30
      `, {
        replacements: { 
          startDate: startDate || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) 
        },
        type: sequelize.QueryTypes.SELECT
      })
    ]);

    // Calculate response times
    const avgResponseTime = await sequelize.query(`
      SELECT AVG(response_time) as avg_response_time
      FROM (
        SELECT 
          m1.conversation_id,
          EXTRACT(EPOCH FROM (m2.created_at - m1.created_at)) as response_time
        FROM "Messages" m1
        JOIN "Messages" m2 ON m1.conversation_id = m2.conversation_id
        WHERE m1.sender = 'user' 
          AND m2.sender = 'bot'
          AND m2.created_at > m1.created_at
          AND m2.id = (
            SELECT id FROM "Messages" 
            WHERE conversation_id = m1.conversation_id 
              AND sender = 'bot' 
              AND created_at > m1.created_at 
            ORDER BY created_at ASC 
            LIMIT 1
          )
      ) as response_times
    `, {
      type: sequelize.QueryTypes.SELECT
    });

    res.json({
      success: true,
      data: {
        users: {
          total: totalUsers,
          active: activeUsers
        },
        conversations: {
          total: totalConversations,
          active: activeConversations,
          resolved: resolvedConversations,
          resolutionRate: totalConversations > 0 
            ? ((resolvedConversations / totalConversations) * 100).toFixed(2) 
            : 0
        },
        messages: {
          total: totalMessages,
          averagePerConversation: totalConversations > 0 
            ? (totalMessages / totalConversations).toFixed(2) 
            : 0
        },
        categories: conversationsByCategory.map(cat => ({
          category: cat.category,
          count: parseInt(cat.dataValues.count)
        })),
        satisfaction: {
          averageRating: averageRating ? parseFloat(averageRating).toFixed(2) : null
        },
        responseTime: {
          average: avgResponseTime[0]?.avg_response_time 
            ? parseFloat(avgResponseTime[0].avg_response_time).toFixed(2) 
            : null
        },
        trend: conversationsPerDay
      }
    });
  } catch (error) {
    console.error('Analytics error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching analytics'
    });
  }
});

// Add admin message to conversation
router.post('/conversations/:id/message', async (req, res) => {
  try {
    const { content } = req.body;
    
    if (!content) {
      return res.status(400).json({
        success: false,
        message: 'Message content is required'
      });
    }

    const conversation = await Conversation.findByPk(req.params.id);
    if (!conversation) {
      return res.status(404).json({
        success: false,
        message: 'Conversation not found'
      });
    }

    const message = await Message.create({
      conversationId: conversation.id,
      sender: 'admin',
      content,
      metadata: {
        adminId: req.userId,
        adminName: req.user.name
      }
    });

    // Update conversation status if it was resolved
    if (conversation.status === 'resolved') {
      await conversation.update({ status: 'active' });
    }

    res.json({
      success: true,
      message: 'Message sent successfully',
      data: message
    });
  } catch (error) {
    console.error('Send admin message error:', error);
    res.status(500).json({
      success: false,
      message: 'Error sending message'
    });
  }
});

// Export data
router.get('/export/:type', async (req, res) => {
  try {
    const { type } = req.params;
    const { startDate, endDate, format = 'json' } = req.query;
    
    const dateFilter = {};
    if (startDate || endDate) {
      dateFilter.createdAt = {};
      if (startDate) dateFilter.createdAt[Op.gte] = new Date(startDate);
      if (endDate) dateFilter.createdAt[Op.lte] = new Date(endDate);
    }

    let data;
    
    switch (type) {
      case 'users':
        data = await User.findAll({
          attributes: { exclude: ['password'] }
        });
        break;
      
      case 'conversations':
        data = await Conversation.findAll({
          where: dateFilter,
          include: [
            {
              model: User,
              as: 'user',
              attributes: ['name', 'email']
            },
            {
              model: Message,
              as: 'messages'
            }
          ]
        });
        break;
      
      case 'messages':
        data = await Message.findAll({
          include: [{
            model: Conversation,
            as: 'conversation',
            where: dateFilter,
            required: true
          }]
        });
        break;
      
      default:
        return res.status(400).json({
          success: false,
          message: 'Invalid export type'
        });
    }

    if (format === 'csv') {
      // Simple CSV conversion (you might want to use a library like csv-writer)
      const headers = Object.keys(data[0].dataValues).join(',');
      const rows = data.map(item => Object.values(item.dataValues).join(',')).join('\n');
      const csv = `${headers}\n${rows}`;
      
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename=${type}_export.csv`);
      res.send(csv);
    } else {
      res.json({
        success: true,
        data,
        count: data.length
      });
    }
  } catch (error) {
    console.error('Export error:', error);
    res.status(500).json({
      success: false,
      message: 'Error exporting data'
    });
  }
});

module.exports = router;
