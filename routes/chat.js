const router = require('express').Router();
const axios = require('axios');
const { body, validationResult } = require('express-validator');
const { Conversation, Message, User } = require('../models');
const { authMiddleware } = require('../middleware/auth');
const { Op } = require('sequelize');

// Send message to n8n and save to database
router.post('/message', authMiddleware, [
  body('message').optional().trim(),
  body('conversationId').optional().isUUID(),
  body('image').optional().isObject(),
  body('image.data').optional().isString(),
  body('image.mimeType').optional().isString(),
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        errors: errors.array()
      });
    }

    const { message, conversationId, image } = req.body;
    
    // Require either message or image
    if (!message && !image) {
      return res.status(400).json({
        success: false,
        message: 'Message or image is required'
      });
    }
    
    let conversation;

    // Get user info for n8n
    const user = await User.findByPk(req.userId, {
      attributes: ['id', 'name', 'email', 'company']
    });

    // Get or create conversation
    if (conversationId) {
      conversation = await Conversation.findOne({
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
    } else {
      // Create new conversation
      const sessionId = `${req.userId}_${Date.now()}`;
      const title = message ? message.substring(0, 50) + (message.length > 50 ? '...' : '') : 'Imagen adjunta';
      conversation = await Conversation.create({
        userId: req.userId,
        sessionId,
        title,
        status: 'active'
      });
    }

    // Save user message WITH image data
    const userMessage = await Message.create({
      conversationId: conversation.id,
      sender: 'user',
      content: message || '',
      imageData: image ? image.data : null,
      imageMimeType: image ? image.mimeType : null
    });

    // Count messages in this conversation
    const messageCount = await Message.count({
      where: { conversationId: conversation.id }
    });

    // Build payload for n8n
    const n8nPayload = {
      message: message || '',
      conversationId: conversation.id,
      userId: req.userId,
      userName: user ? user.name : 'Usuario',
      userEmail: user ? user.email : null,
      userCompany: user ? user.company : null,
      sessionId: conversation.sessionId,
      category: conversation.category || 'general',
      messageCount,
      hasImage: !!image
    };

    // Add image if present
    if (image && image.data && image.mimeType) {
      n8nPayload.image = {
        data: image.data,
        mimeType: image.mimeType
      };
    }

    // Send to n8n webhook
    try {
      const n8nResponse = await axios.post(
        process.env.N8N_WEBHOOK_URL || 'http://localhost:5678/webhook/chat',
        n8nPayload,
        {
          timeout: 60000,
          headers: {
            'Content-Type': 'application/json'
          },
          maxContentLength: 10 * 1024 * 1024,
          maxBodyLength: 10 * 1024 * 1024
        }
      );

      // Save bot response
      const botMessage = await Message.create({
        conversationId: conversation.id,
        sender: 'bot',
        content: n8nResponse.data.response || n8nResponse.data.message || 'Lo siento, no pude procesar tu mensaje.',
        metadata: {
          model: n8nResponse.data.model,
          confidence: n8nResponse.data.confidence
        }
      });

      // Update conversation category if detected
      if (n8nResponse.data.category && conversation.category === 'general') {
        await conversation.update({ 
          category: n8nResponse.data.category 
        });
      }

      res.json({
        success: true,
        data: {
          conversation: {
            id: conversation.id,
            sessionId: conversation.sessionId,
            category: conversation.category
          },
          userMessage,
          botMessage
        }
      });

    } catch (n8nError) {
      console.error('n8n webhook error:', n8nError.message);
      
      // Save error message
      const errorMessage = await Message.create({
        conversationId: conversation.id,
        sender: 'bot',
        content: 'Disculpa, estoy teniendo problemas técnicos. Por favor, intenta de nuevo en unos momentos.',
        metadata: {
          error: true,
          errorMessage: n8nError.message
        }
      });

      res.status(503).json({
        success: false,
        message: 'Chat service temporarily unavailable',
        data: {
          conversation: {
            id: conversation.id
          },
          userMessage,
          botMessage: errorMessage
        }
      });
    }

  } catch (error) {
    console.error('Message error:', error);
    res.status(500).json({
      success: false,
      message: 'Error processing message'
    });
  }
});

// Get user's conversations
router.get('/conversations', authMiddleware, async (req, res) => {
  try {
    const { status, category, limit = 20, offset = 0 } = req.query;
    
    const where = { userId: req.userId };
    if (status) where.status = status;
    if (category) where.category = category;

    const conversations = await Conversation.findAll({
      where,
      order: [['updatedAt', 'DESC']],
      limit: parseInt(limit),
      offset: parseInt(offset),
      include: [{
        model: Message,
        as: 'messages',
        limit: 1,
        order: [['createdAt', 'DESC']],
        attributes: ['content', 'sender', 'createdAt']
      }]
    });

    const total = await Conversation.count({ where });

    res.json({
      success: true,
      data: {
        conversations,
        pagination: {
          total,
          limit: parseInt(limit),
          offset: parseInt(offset),
          hasMore: total > parseInt(offset) + parseInt(limit)
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

// Get single conversation with messages (INCLUDING images)
router.get('/conversation/:id', authMiddleware, async (req, res) => {
  try {
    const conversation = await Conversation.findOne({
      where: {
        id: req.params.id,
        userId: req.userId
      },
      include: [{
        model: Message,
        as: 'messages',
        order: [['createdAt', 'ASC']],
        attributes: ['id', 'sender', 'content', 'imageData', 'imageMimeType', 'createdAt', 'isRead']
      }]
    });

    if (!conversation) {
      return res.status(404).json({
        success: false,
        message: 'Conversation not found'
      });
    }

    // Mark messages as read
    await Message.update(
      { isRead: true },
      { 
        where: { 
          conversationId: conversation.id,
          sender: 'bot',
          isRead: false
        } 
      }
    );

    res.json({
      success: true,
      data: conversation
    });

  } catch (error) {
    console.error('Get conversation error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching conversation'
    });
  }
});

// Update conversation (rename)
router.patch('/conversation/:id', authMiddleware, [
  body('title').optional().trim().notEmpty(),
  body('category').optional().isIn(['comercial', 'meta-ads', 'gohighlevel', 'general'])
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        errors: errors.array()
      });
    }

    const conversation = await Conversation.findOne({
      where: {
        id: req.params.id,
        userId: req.userId
      }
    });

    if (!conversation) {
      return res.status(404).json({
        success: false,
        message: 'Conversation not found'
      });
    }

    const updates = {};
    if (req.body.title) updates.title = req.body.title;
    if (req.body.category) updates.category = req.body.category;

    await conversation.update(updates);

    res.json({
      success: true,
      message: 'Conversation updated',
      data: conversation
    });

  } catch (error) {
    console.error('Update conversation error:', error);
    res.status(500).json({
      success: false,
      message: 'Error updating conversation'
    });
  }
});

// Delete conversation
router.delete('/conversation/:id', authMiddleware, async (req, res) => {
  try {
    const conversation = await Conversation.findOne({
      where: {
        id: req.params.id,
        userId: req.userId
      }
    });

    if (!conversation) {
      return res.status(404).json({
        success: false,
        message: 'Conversation not found'
      });
    }

    // Delete all messages first
    await Message.destroy({
      where: { conversationId: conversation.id }
    });

    // Delete conversation
    await conversation.destroy();

    res.json({
      success: true,
      message: 'Conversation deleted'
    });

  } catch (error) {
    console.error('Delete conversation error:', error);
    res.status(500).json({
      success: false,
      message: 'Error deleting conversation'
    });
  }
});

// Update conversation status
router.patch('/conversation/:id/status', authMiddleware, [
  body('status').isIn(['active', 'resolved', 'pending', 'escalated'])
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        errors: errors.array()
      });
    }

    const conversation = await Conversation.findOne({
      where: {
        id: req.params.id,
        userId: req.userId
      }
    });

    if (!conversation) {
      return res.status(404).json({
        success: false,
        message: 'Conversation not found'
      });
    }

    const updates = { status: req.body.status };
    
    if (req.body.status === 'resolved') {
      updates.resolvedAt = new Date();
    } else if (req.body.status === 'escalated') {
      updates.escalatedAt = new Date();
      if (req.body.escalatedTo) {
        updates.escalatedTo = req.body.escalatedTo;
      }
    }

    await conversation.update(updates);

    res.json({
      success: true,
      message: 'Conversation status updated',
      data: conversation
    });

  } catch (error) {
    console.error('Update conversation status error:', error);
    res.status(500).json({
      success: false,
      message: 'Error updating conversation status'
    });
  }
});

// Rate conversation
router.post('/conversation/:id/rate', authMiddleware, [
  body('rating').isInt({ min: 1, max: 5 }),
  body('feedback').optional().trim()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        errors: errors.array()
      });
    }

    const conversation = await Conversation.findOne({
      where: {
        id: req.params.id,
        userId: req.userId
      }
    });

    if (!conversation) {
      return res.status(404).json({
        success: false,
        message: 'Conversation not found'
      });
    }

    await conversation.update({
      rating: req.body.rating,
      feedback: req.body.feedback
    });

    res.json({
      success: true,
      message: 'Thank you for your feedback',
      data: conversation
    });

  } catch (error) {
    console.error('Rate conversation error:', error);
    res.status(500).json({
      success: false,
      message: 'Error rating conversation'
    });
  }
});

// Search conversations
router.get('/search', authMiddleware, async (req, res) => {
  try {
    const { q, limit = 20 } = req.query;
    
    if (!q || q.length < 2) {
      return res.status(400).json({
        success: false,
        message: 'Search query must be at least 2 characters'
      });
    }

    const conversations = await Conversation.findAll({
      where: {
        userId: req.userId,
        [Op.or]: [
          { title: { [Op.iLike]: `%${q}%` } },
          { summary: { [Op.iLike]: `%${q}%` } }
        ]
      },
      include: [{
        model: Message,
        as: 'messages',
        where: {
          content: { [Op.iLike]: `%${q}%` }
        },
        required: false
      }],
      limit: parseInt(limit),
      order: [['updatedAt', 'DESC']]
    });

    res.json({
      success: true,
      data: conversations
    });

  } catch (error) {
    console.error('Search error:', error);
    res.status(500).json({
      success: false,
      message: 'Error searching conversations'
    });
  }
});

module.exports = router;
