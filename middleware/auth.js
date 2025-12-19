const jwt = require('jsonwebtoken');
const { User } = require('../models');

const authMiddleware = async (req, res, next) => {
  try {
    // Get token from header
    const token = req.header('Authorization')?.replace('Bearer ', '');

    if (!token) {
      console.log('Auth failed: No token provided');
      return res.status(401).json({
        success: false,
        message: 'No token provided'
      });
    }

    // Verify token
    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key-change-this');
    } catch (jwtError) {
      console.log('Auth failed: JWT verification error -', jwtError.message);
      return res.status(401).json({
        success: false,
        message: jwtError.name === 'TokenExpiredError' ? 'Token expired' : 'Invalid token'
      });
    }

    // Find user
    const user = await User.findByPk(decoded.id, {
      attributes: { exclude: ['password'] }
    });

    if (!user) {
      console.log('Auth failed: User not found for id', decoded.id);
      return res.status(401).json({
        success: false,
        message: 'User not found'
      });
    }

    if (!user.isActive) {
      console.log('Auth failed: User is not active', user.email);
      return res.status(401).json({
        success: false,
        message: 'User account is deactivated'
      });
    }

    // Attach user to request
    req.user = user;
    req.userId = user.id;
    req.token = token;

    next();
  } catch (error) {
    console.error('Auth middleware unexpected error:', error);
    res.status(401).json({
      success: false,
      message: 'Authentication failed'
    });
  }
};

const adminMiddleware = async (req, res, next) => {
  try {
    if (req.user.role !== 'admin') {
      throw new Error();
    }
    next();
  } catch (error) {
    res.status(403).json({
      success: false,
      message: 'Access denied. Admin only.'
    });
  }
};

const optionalAuth = async (req, res, next) => {
  try {
    const token = req.header('Authorization')?.replace('Bearer ', '');
    
    if (token) {
      const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key-change-this');
      const user = await User.findByPk(decoded.id, {
        attributes: { exclude: ['password'] }
      });
      
      if (user && user.isActive) {
        req.user = user;
        req.userId = user.id;
      }
    }
  } catch (error) {
    // Silent fail - user is optional
  }
  
  next();
};

module.exports = {
  authMiddleware,
  adminMiddleware,
  optionalAuth
};
