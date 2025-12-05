const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

// Import routes
const authRoutes = require('./routes/auth');
const chatRoutes = require('./routes/chat');
const adminRoutes = require('./routes/admin');
const recursosRoutes = require('./routes/recursos');

// Import database
const sequelize = require('./config/database');

const app = express();
app.set('trust proxy', 1);  // Para funcionar detrás de proxy/load balancer

const PORT = process.env.PORT || 3001;

// Security middleware
app.use(helmet());
app.use(cors({
  origin: process.env.FRONTEND_URL || 'https://soporte.growinginmobiliario.com',
  credentials: true
}));

// Rate limiting - solo para rutas públicas (auth y chat)
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100 // limit each IP to 100 requests per windowMs
});

// Body parsing middleware - aumentar límite para PDFs
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Routes con rate limit (públicas)
app.use('/api/auth', limiter, authRoutes);
app.use('/api/chat', limiter, chatRoutes);

// Routes sin rate limit (requieren autenticación admin)
app.use('/api/admin', adminRoutes);
app.use('/api/recursos', recursosRoutes);

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'OK',
    service: 'Growing Chat Backend',
    timestamp: new Date().toISOString()
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(err.status || 500).json({
    success: false,
    message: err.message || 'Internal server error',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: 'Route not found'
  });
});

// Database connection and server start
const startServer = async () => {
  try {
    // Test database connection
    await sequelize.authenticate();
    console.log('✅ Database connection established');
    
    // Sync database models (sin alter para no modificar columnas vector)
    await sequelize.sync();
    console.log('✅ Database models synchronized');
    
    // Start server
    app.listen(PORT, () => {
      console.log(`
🚀 Growing Chat Backend Server
📍 Port: ${PORT}
🌍 Environment: ${process.env.NODE_ENV || 'development'}
📊 Database: PostgreSQL
🔗 Health: http://localhost:${PORT}/health

API Endpoints:
- POST   /api/auth/register
- POST   /api/auth/login
- GET    /api/auth/profile
- POST   /api/chat/message
- GET    /api/chat/conversations
- GET    /api/chat/conversation/:id
- GET    /api/admin/users
- GET    /api/admin/analytics
- POST   /api/recursos/buscar
- GET    /api/recursos
- POST   /api/recursos
      `);
    });
  } catch (error) {
    console.error('❌ Unable to start server:', error);
    process.exit(1);
  }
};

startServer();
