const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const Chunk = sequelize.define('Chunk', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  recursoId: {
    type: DataTypes.UUID,
    allowNull: false,
    references: {
      model: 'Recursos',
      key: 'id'
    },
    onDelete: 'CASCADE'
  },
  chunkIndex: {
    type: DataTypes.INTEGER,
    allowNull: false,
    comment: 'Orden del chunk dentro del documento'
  },
  contenido: {
    type: DataTypes.TEXT,
    allowNull: false,
    comment: 'Fragmento de texto (~500-800 tokens)'
  },
  tokens: {
    type: DataTypes.INTEGER,
    allowNull: true,
    comment: 'Número aproximado de tokens en este chunk'
  },
  // embedding se maneja con SQL directo (tipo vector de pgvector)
  embeddingStatus: {
    type: DataTypes.ENUM('pending', 'processing', 'completed', 'error'),
    defaultValue: 'pending'
  }
}, {
  tableName: 'Chunks',
  timestamps: true,
  indexes: [
    {
      fields: ['recursoId']
    },
    {
      fields: ['recursoId', 'chunkIndex']
    }
  ]
});

module.exports = Chunk;
