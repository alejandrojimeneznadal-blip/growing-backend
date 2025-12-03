const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const Recurso = sequelize.define('Recurso', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  tipo: {
    type: DataTypes.ENUM('video', 'pdf', 'articulo'),
    allowNull: false
  },
  titulo: {
    type: DataTypes.STRING(255),
    allowNull: false
  },
  descripcion: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  url: {
    type: DataTypes.STRING(500),
    allowNull: true
  },
  contenido: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  // embedding se maneja con SQL directo (tipo vector de pgvector)
  embeddingStatus: {
    type: DataTypes.ENUM('pending', 'processing', 'completed', 'error'),
    defaultValue: 'pending'
  },
  categoria: {
    type: DataTypes.ENUM('comercial', 'meta-ads', 'gohighlevel', 'general'),
    defaultValue: 'general'
  },
  activo: {
    type: DataTypes.BOOLEAN,
    defaultValue: true
  }
}, {
  tableName: 'Recursos',
  timestamps: true
});

module.exports = Recurso;
