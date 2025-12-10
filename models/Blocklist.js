const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const Blocklist = sequelize.define('Blocklist', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  type: {
    type: DataTypes.ENUM('email', 'ip'),
    allowNull: false
  },
  value: {
    type: DataTypes.STRING,
    allowNull: false
  },
  reason: {
    type: DataTypes.STRING,
    allowNull: true,
    comment: 'Razón del bloqueo'
  },
  blockedUserId: {
    type: DataTypes.UUID,
    allowNull: true,
    comment: 'ID del usuario que fue bloqueado (referencia)'
  },
  blockedByUserId: {
    type: DataTypes.UUID,
    allowNull: true,
    comment: 'ID del admin que realizó el bloqueo'
  }
}, {
  timestamps: true,
  indexes: [
    { fields: ['type', 'value'], unique: true },
    { fields: ['value'] }
  ]
});

// Método para verificar si un email o IP está bloqueado
Blocklist.isBlocked = async function(email, ip) {
  const blocked = await this.findOne({
    where: {
      [require('sequelize').Op.or]: [
        { type: 'email', value: email },
        ...(ip ? [{ type: 'ip', value: ip }] : [])
      ]
    }
  });
  return !!blocked;
};

// Método para bloquear email e IP
Blocklist.blockUser = async function(email, ip, blockedUserId, blockedByUserId, reason = 'Bloqueado por administrador') {
  const entries = [];

  // Bloquear email
  if (email) {
    const [emailEntry] = await this.findOrCreate({
      where: { type: 'email', value: email.toLowerCase() },
      defaults: { reason, blockedUserId, blockedByUserId }
    });
    entries.push(emailEntry);
  }

  // Bloquear IP
  if (ip) {
    const [ipEntry] = await this.findOrCreate({
      where: { type: 'ip', value: ip },
      defaults: { reason, blockedUserId, blockedByUserId }
    });
    entries.push(ipEntry);
  }

  return entries;
};

// Método para desbloquear email e IP
Blocklist.unblockUser = async function(email, ip) {
  const conditions = [];
  if (email) conditions.push({ type: 'email', value: email.toLowerCase() });
  if (ip) conditions.push({ type: 'ip', value: ip });

  if (conditions.length > 0) {
    await this.destroy({
      where: {
        [require('sequelize').Op.or]: conditions
      }
    });
  }
};

module.exports = Blocklist;
