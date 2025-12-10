const sequelize = require('../config/database');
const User = require('./User');
const Conversation = require('./Conversation');
const Message = require('./Message');
const Recurso = require('./Recurso');
const Chunk = require('./Chunk');
const Feedback = require('./Feedback');
const Blocklist = require('./Blocklist');

// Define relationships
User.hasMany(Conversation, {
  foreignKey: 'userId',
  as: 'conversations'
});
Conversation.belongsTo(User, {
  foreignKey: 'userId',
  as: 'user'
});
Conversation.hasMany(Message, {
  foreignKey: 'conversationId',
  as: 'messages'
});
Message.belongsTo(Conversation, {
  foreignKey: 'conversationId',
  as: 'conversation'
});

// Recurso - Chunk
Recurso.hasMany(Chunk, {
  foreignKey: 'recursoId',
  as: 'chunks',
  onDelete: 'CASCADE'
});
Chunk.belongsTo(Recurso, {
  foreignKey: 'recursoId',
  as: 'recurso'
});

// Feedback relationships
Feedback.belongsTo(Conversation, {
  foreignKey: 'conversationId',
  as: 'conversation'
});
Feedback.belongsTo(User, {
  foreignKey: 'userId',
  as: 'user'
});
Conversation.hasMany(Feedback, {
  foreignKey: 'conversationId',
  as: 'feedbacks'
});
User.hasMany(Feedback, {
  foreignKey: 'userId',
  as: 'feedbacks'
});

module.exports = {
  sequelize,
  User,
  Conversation,
  Message,
  Recurso,
  Chunk,
  Feedback,
  Blocklist
};
