const sequelize = require('./database');
const { User, Conversation, Message } = require('../models');
require('dotenv').config();

async function migrate() {
  try {
    console.log('🔄 Starting database migration...');
    
    // Test connection
    await sequelize.authenticate();
    console.log('✅ Database connection established');
    
    // Sync all models
    await sequelize.sync({ alter: true });
    console.log('✅ Database models synchronized');
    
    // Create admin user if it doesn't exist
    const adminEmail = process.env.ADMIN_EMAIL || 'admin@growing-inmobiliario.com';
    const adminPassword = process.env.ADMIN_PASSWORD || 'Admin123!';
    
    const existingAdmin = await User.findOne({ where: { email: adminEmail } });
    
    if (!existingAdmin) {
      const admin = await User.create({
        email: adminEmail,
        password: adminPassword,
        name: 'Administrator',
        company: 'Growing Inmobiliario',
        role: 'admin'
      });
      
      console.log(`✅ Admin user created: ${adminEmail}`);
      console.log(`⚠️  Please change the admin password immediately!`);
    } else {
      console.log(`ℹ️  Admin user already exists: ${adminEmail}`);
    }
    
    // Create sample data in development
    if (process.env.NODE_ENV === 'development') {
      console.log('🔄 Creating sample data for development...');
      
      // Create a sample user
      const sampleUser = await User.findOrCreate({
        where: { email: 'demo@example.com' },
        defaults: {
          email: 'demo@example.com',
          password: 'Demo123!',
          name: 'Demo User',
          company: 'Demo Company'
        }
      });
      
      if (sampleUser[1]) {
        console.log('✅ Sample user created: demo@example.com');
        
        // Create sample conversation
        const conversation = await Conversation.create({
          userId: sampleUser[0].id,
          sessionId: `${sampleUser[0].id}_sample`,
          title: 'Consulta sobre Meta Ads',
          category: 'meta-ads',
          status: 'resolved'
        });
        
        // Create sample messages
        await Message.bulkCreate([
          {
            conversationId: conversation.id,
            sender: 'user',
            content: '¿Cómo puedo optimizar mi presupuesto en Meta Ads?'
          },
          {
            conversationId: conversation.id,
            sender: 'bot',
            content: 'Para optimizar tu presupuesto en Meta Ads, te recomiendo: 1) Segmentar mejor tu audiencia, 2) Usar píxeles de conversión, 3) Probar diferentes creatividades.'
          }
        ]);
        
        console.log('✅ Sample conversation and messages created');
      }
    }
    
    console.log('✅ Migration completed successfully');
    process.exit(0);
  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  }
}

// Run migration if this file is executed directly
if (require.main === module) {
  migrate();
}

module.exports = migrate;
