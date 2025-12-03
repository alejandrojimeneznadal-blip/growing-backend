const router = require('express').Router();
const { body, validationResult } = require('express-validator');
const { Recurso } = require('../models');
const { generateEmbedding, searchSimilar } = require('../services/embeddingService');
const { authMiddleware, adminMiddleware } = require('../middleware/auth');
const pdfParse = require('pdf-parse');

// Buscar recursos (público para el chat)
router.post('/buscar', async (req, res) => {
  try {
    const { query, limit = 5, categoria } = req.body;

    if (!query) {
      return res.status(400).json({
        success: false,
        message: 'Query is required'
      });
    }

    // Generar embedding de la consulta
    const queryEmbedding = await generateEmbedding(query);

    // Buscar similares
    let results = await searchSimilar(queryEmbedding, limit);

    // Filtrar por categoría si se especifica
    if (categoria && categoria !== 'general') {
      results = results.filter(r => r.categoria === categoria || r.categoria === 'general');
    }

    res.json({
      success: true,
      data: results
    });

  } catch (error) {
    console.error('Search error:', error);
    res.status(500).json({
      success: false,
      message: 'Error searching resources'
    });
  }
});

// --- CRUD (Solo admin) ---

// Listar recursos
router.get('/', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { tipo, categoria, limit = 50, offset = 0 } = req.query;
    
    const where = {};
    if (tipo) where.tipo = tipo;
    if (categoria) where.categoria = categoria;

    const recursos = await Recurso.findAll({
      where,
      order: [['createdAt', 'DESC']],
      limit: parseInt(limit),
      offset: parseInt(offset)
    });

    const total = await Recurso.count({ where });

    res.json({
      success: true,
      data: {
        recursos,
        pagination: { total, limit: parseInt(limit), offset: parseInt(offset) }
      }
    });

  } catch (error) {
    console.error('List recursos error:', error);
    res.status(500).json({ success: false, message: 'Error listing resources' });
  }
});

// Obtener un recurso
router.get('/:id', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const recurso = await Recurso.findByPk(req.params.id);
    
    if (!recurso) {
      return res.status(404).json({ success: false, message: 'Resource not found' });
    }

    res.json({ success: true, data: recurso });

  } catch (error) {
    console.error('Get recurso error:', error);
    res.status(500).json({ success: false, message: 'Error getting resource' });
  }
});

// Crear recurso
router.post('/', authMiddleware, adminMiddleware, [
  body('tipo').isIn(['video', 'pdf', 'articulo']),
  body('titulo').notEmpty().trim(),
  body('categoria').optional().isIn(['comercial', 'meta-ads', 'gohighlevel', 'general'])
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, errors: errors.array() });
    }

    const { tipo, titulo, descripcion, url, contenido, categoria } = req.body;

    // Crear recurso
    const recurso = await Recurso.create({
      tipo,
      titulo,
      descripcion,
      url,
      contenido,
      categoria: categoria || 'general',
      embeddingStatus: 'pending'
    });

    // Generar embedding en background
    generateEmbeddingForRecurso(recurso.id);

    res.status(201).json({
      success: true,
      data: recurso
    });

  } catch (error) {
    console.error('Create recurso error:', error);
    res.status(500).json({ success: false, message: 'Error creating resource' });
  }
});

// Actualizar recurso
router.put('/:id', authMiddleware, adminMiddleware, [
  body('tipo').optional().isIn(['video', 'pdf', 'articulo']),
  body('titulo').optional().notEmpty().trim(),
  body('categoria').optional().isIn(['comercial', 'meta-ads', 'gohighlevel', 'general'])
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, errors: errors.array() });
    }

    const recurso = await Recurso.findByPk(req.params.id);
    if (!recurso) {
      return res.status(404).json({ success: false, message: 'Resource not found' });
    }

    const { tipo, titulo, descripcion, url, contenido, categoria, activo } = req.body;
    
    const updates = {};
    if (tipo !== undefined) updates.tipo = tipo;
    if (titulo !== undefined) updates.titulo = titulo;
    if (descripcion !== undefined) updates.descripcion = descripcion;
    if (url !== undefined) updates.url = url;
    if (categoria !== undefined) updates.categoria = categoria;
    if (activo !== undefined) updates.activo = activo;
    
    // Si cambia el contenido, regenerar embedding
    const contenidoCambio = contenido !== undefined && contenido !== recurso.contenido;
    if (contenidoCambio) {
      updates.contenido = contenido;
      updates.embeddingStatus = 'pending';
    }

    await recurso.update(updates);

    // Regenerar embedding si cambió contenido
    if (contenidoCambio) {
      generateEmbeddingForRecurso(recurso.id);
    }

    res.json({ success: true, data: recurso });

  } catch (error) {
    console.error('Update recurso error:', error);
    res.status(500).json({ success: false, message: 'Error updating resource' });
  }
});

// Eliminar recurso
router.delete('/:id', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const recurso = await Recurso.findByPk(req.params.id);
    if (!recurso) {
      return res.status(404).json({ success: false, message: 'Resource not found' });
    }

    await recurso.destroy();

    res.json({ success: true, message: 'Resource deleted' });

  } catch (error) {
    console.error('Delete recurso error:', error);
    res.status(500).json({ success: false, message: 'Error deleting resource' });
  }
});

// Subir PDF y extraer texto
router.post('/upload-pdf', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    if (!req.body.pdfBase64) {
      return res.status(400).json({ success: false, message: 'PDF data required' });
    }

    const pdfBuffer = Buffer.from(req.body.pdfBase64, 'base64');
    const pdfData = await pdfParse(pdfBuffer);

    res.json({
      success: true,
      data: {
        text: pdfData.text,
        pages: pdfData.numpages
      }
    });

  } catch (error) {
    console.error('PDF parse error:', error);
    res.status(500).json({ success: false, message: 'Error parsing PDF' });
  }
});

// Función auxiliar para generar embedding en background
async function generateEmbeddingForRecurso(recursoId) {
  try {
    const recurso = await Recurso.findByPk(recursoId);
    if (!recurso) return;

    await recurso.update({ embeddingStatus: 'processing' });

    // Combinar título + descripción + contenido para el embedding
    const textForEmbedding = [
      recurso.titulo,
      recurso.descripcion,
      recurso.contenido
    ].filter(Boolean).join('\n\n');

    if (!textForEmbedding.trim()) {
      await recurso.update({ embeddingStatus: 'error' });
      return;
    }

    const embedding = await generateEmbedding(textForEmbedding);
    
    // Guardar con SQL directo para el tipo vector
    const { sequelize } = require('../models');
    const embeddingStr = `[${embedding.join(',')}]`;
    
    await sequelize.query(`
      UPDATE "Recursos" 
      SET embedding = :embedding::vector, "embeddingStatus" = 'completed', "updatedAt" = NOW()
      WHERE id = :id
    `, {
      replacements: { embedding: embeddingStr, id: recursoId }
    });

    console.log(`Embedding generated for recurso ${recursoId}`);

  } catch (error) {
    console.error(`Error generating embedding for ${recursoId}:`, error);
    const recurso = await Recurso.findByPk(recursoId);
    if (recurso) {
      await recurso.update({ embeddingStatus: 'error' });
    }
  }
}

module.exports = router;
