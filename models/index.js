const sequelize = require('../config/database');
const User = require('./User');
const Conversation = require('./Conversation');
const Message = require('./Message');
const Recurso = require('./Recurso');

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

module.exports = {
  sequelize,
  User,
  Conversation,
  Message,
  Recurso
};
