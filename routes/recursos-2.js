const router = require('express').Router();
const { body, validationResult } = require('express-validator');
const { Recurso, Chunk, sequelize } = require('../models');
const { 
  generateEmbedding, 
  splitTextIntoChunks
} = require('../services/embeddingService');
const { authMiddleware, adminMiddleware } = require('../middleware/auth');

// Configuración de procesamiento LENTO para no saturar servidor
const DELAY_BETWEEN_CHUNKS_MS = 1000; // 1 segundo entre cada chunk

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

    // Buscar en chunks
    const embeddingStr = `[${queryEmbedding.join(',')}]`;
    
    let results = await sequelize.query(`
      SELECT 
        c.id as chunk_id,
        c."recursoId",
        c."chunkIndex",
        c.contenido as chunk_contenido,
        r.tipo,
        r.titulo,
        r.descripcion,
        r.url,
        r.categoria,
        1 - (c.embedding <=> :embedding::vector) as similarity
      FROM "Chunks" c
      INNER JOIN "Recursos" r ON r.id = c."recursoId"
      WHERE c.embedding IS NOT NULL 
        AND c."embeddingStatus" = 'completed'
        AND r.activo = true
      ORDER BY c.embedding <=> :embedding::vector
      LIMIT :limit
    `, {
      replacements: { embedding: embeddingStr, limit: limit * 2 },
      type: sequelize.QueryTypes.SELECT
    });

    // Filtrar por categoría si se especifica
    if (categoria && categoria !== 'general') {
      results = results.filter(r => r.categoria === categoria || r.categoria === 'general');
    }

    // Agrupar por recurso
    const resourceMap = new Map();
    for (const chunk of results) {
      const resourceId = chunk.recursoId;
      if (!resourceMap.has(resourceId)) {
        resourceMap.set(resourceId, {
          id: resourceId,
          tipo: chunk.tipo,
          titulo: chunk.titulo,
          descripcion: chunk.descripcion,
          url: chunk.url,
          categoria: chunk.categoria,
          similarity: chunk.similarity,
          contenido: chunk.chunk_contenido
        });
      }
    }

    res.json({
      success: true,
      data: Array.from(resourceMap.values()).slice(0, limit)
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
      offset: parseInt(offset),
      attributes: {
        include: [
          [sequelize.literal(`(SELECT COUNT(*) FROM "Chunks" WHERE "Chunks"."recursoId" = "Recurso"."id")`), 'chunkCount']
        ]
      }
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

// Obtener un recurso con sus chunks
router.get('/:id', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const recurso = await Recurso.findByPk(req.params.id, {
      include: [{
        model: Chunk,
        as: 'chunks',
        attributes: ['id', 'chunkIndex', 'tokens', 'embeddingStatus'],
        order: [['chunkIndex', 'ASC']]
      }]
    });
    
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

    // Calcular número de chunks para informar al frontend
    const fullText = [titulo, descripcion, contenido].filter(Boolean).join('\n\n');
    const chunks = splitTextIntoChunks(fullText);
    const estimatedTimeSeconds = chunks.length * (DELAY_BETWEEN_CHUNKS_MS / 1000 + 0.5); // +0.5s por API call

    // Generar chunks y embeddings en background
    processRecursoChunks(recurso.id);

    res.status(201).json({
      success: true,
      data: {
        ...recurso.toJSON(),
        estimatedChunks: chunks.length,
        estimatedTimeSeconds: Math.ceil(estimatedTimeSeconds)
      },
      message: 'Recurso creado. Los embeddings se están generando.'
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
    
    // Si cambia el contenido, regenerar chunks y embeddings
    const contenidoCambio = contenido !== undefined && contenido !== recurso.contenido;
    if (contenidoCambio) {
      updates.contenido = contenido;
      updates.embeddingStatus = 'pending';
    }

    await recurso.update(updates);

    let estimatedChunks = 0;
    let estimatedTimeSeconds = 0;

    // Regenerar chunks si cambió contenido
    if (contenidoCambio) {
      const fullText = [
        updates.titulo || recurso.titulo, 
        updates.descripcion || recurso.descripcion, 
        contenido
      ].filter(Boolean).join('\n\n');
      
      const chunks = splitTextIntoChunks(fullText);
      estimatedChunks = chunks.length;
      estimatedTimeSeconds = Math.ceil(chunks.length * (DELAY_BETWEEN_CHUNKS_MS / 1000 + 0.5));
      
      processRecursoChunks(recurso.id);
    }

    res.json({ 
      success: true, 
      data: {
        ...recurso.toJSON(),
        estimatedChunks,
        estimatedTimeSeconds
      },
      message: contenidoCambio ? 'Recurso actualizado. Los embeddings se están regenerando.' : 'Recurso actualizado.'
    });

  } catch (error) {
    console.error('Update recurso error:', error);
    res.status(500).json({ success: false, message: 'Error updating resource' });
  }
});

// Eliminar recurso (los chunks se eliminan en cascada)
router.delete('/:id', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const recurso = await Recurso.findByPk(req.params.id);
    if (!recurso) {
      return res.status(404).json({ success: false, message: 'Resource not found' });
    }

    // Eliminar chunks primero (por si CASCADE no funciona)
    await Chunk.destroy({ where: { recursoId: req.params.id } });
    
    await recurso.destroy();

    res.json({ success: true, message: 'Resource deleted' });

  } catch (error) {
    console.error('Delete recurso error:', error);
    res.status(500).json({ success: false, message: 'Error deleting resource' });
  }
});

// Obtener estado de procesamiento de un recurso
router.get('/:id/status', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const recurso = await Recurso.findByPk(req.params.id, {
      attributes: ['id', 'titulo', 'embeddingStatus']
    });
    
    if (!recurso) {
      return res.status(404).json({ success: false, message: 'Resource not found' });
    }

    const chunkStats = await Chunk.findAll({
      where: { recursoId: req.params.id },
      attributes: [
        'embeddingStatus',
        [sequelize.fn('COUNT', sequelize.col('id')), 'count']
      ],
      group: ['embeddingStatus']
    });

    const stats = {
      total: 0,
      pending: 0,
      processing: 0,
      completed: 0,
      error: 0
    };

    chunkStats.forEach(s => {
      const count = parseInt(s.get('count'));
      stats[s.embeddingStatus] = count;
      stats.total += count;
    });

    // Calcular tiempo restante estimado
    const remaining = stats.pending + stats.processing;
    const estimatedSecondsRemaining = remaining * (DELAY_BETWEEN_CHUNKS_MS / 1000 + 0.5);

    res.json({
      success: true,
      data: {
        recurso: {
          id: recurso.id,
          titulo: recurso.titulo,
          status: recurso.embeddingStatus
        },
        chunks: stats,
        progress: stats.total > 0 ? Math.round((stats.completed / stats.total) * 100) : 0,
        estimatedSecondsRemaining: Math.ceil(estimatedSecondsRemaining)
      }
    });

  } catch (error) {
    console.error('Get status error:', error);
    res.status(500).json({ success: false, message: 'Error getting status' });
  }
});

// Reprocesar chunks de un recurso
router.post('/:id/reprocess', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const recurso = await Recurso.findByPk(req.params.id);
    if (!recurso) {
      return res.status(404).json({ success: false, message: 'Resource not found' });
    }

    await recurso.update({ embeddingStatus: 'pending' });
    
    // Eliminar chunks existentes y reprocesar
    await Chunk.destroy({ where: { recursoId: req.params.id } });
    
    const fullText = [recurso.titulo, recurso.descripcion, recurso.contenido].filter(Boolean).join('\n\n');
    const chunks = splitTextIntoChunks(fullText);
    
    processRecursoChunks(recurso.id);

    res.json({ 
      success: true, 
      message: 'Reprocesamiento iniciado',
      data: {
        estimatedChunks: chunks.length,
        estimatedTimeSeconds: Math.ceil(chunks.length * (DELAY_BETWEEN_CHUNKS_MS / 1000 + 0.5))
      }
    });

  } catch (error) {
    console.error('Reprocess error:', error);
    res.status(500).json({ success: false, message: 'Error reprocessing' });
  }
});

/**
 * Procesa un recurso: divide en chunks y genera embeddings UNO A UNO con pausas
 * Diseñado para no saturar memoria ni CPU
 */
async function processRecursoChunks(recursoId) {
  try {
    const recurso = await Recurso.findByPk(recursoId);
    if (!recurso) return;

    await recurso.update({ embeddingStatus: 'processing' });

    // Combinar título + descripción + contenido
    const fullText = [
      recurso.titulo,
      recurso.descripcion,
      recurso.contenido
    ].filter(Boolean).join('\n\n');

    if (!fullText.trim()) {
      await recurso.update({ embeddingStatus: 'error' });
      console.error(`Recurso ${recursoId} no tiene contenido para procesar`);
      return;
    }

    // Eliminar chunks anteriores
    await Chunk.destroy({ where: { recursoId } });

    // Dividir en chunks
    const chunks = splitTextIntoChunks(fullText);
    console.log(`[Recurso ${recursoId}] Iniciando procesamiento: ${chunks.length} chunks`);

    if (chunks.length === 0) {
      await recurso.update({ embeddingStatus: 'error' });
      return;
    }

    // Crear chunks en BD (sin embeddings aún)
    const chunkRecords = await Chunk.bulkCreate(
      chunks.map(c => ({
        recursoId,
        chunkIndex: c.index,
        contenido: c.content,
        tokens: c.tokens,
        embeddingStatus: 'pending'
      }))
    );

    let completedCount = 0;
    let errorCount = 0;

    // Procesar UN CHUNK A LA VEZ con pausa entre cada uno
    for (let i = 0; i < chunkRecords.length; i++) {
      const chunk = chunkRecords[i];
      const chunkData = chunks[i];

      try {
        // Marcar como processing
        await chunk.update({ embeddingStatus: 'processing' });

        // Generar embedding
        const embedding = await generateEmbedding(chunkData.content);
        const embeddingStr = `[${embedding.join(',')}]`;

        // Guardar en BD
        await sequelize.query(`
          UPDATE "Chunks" 
          SET embedding = :embedding::vector, "embeddingStatus" = 'completed', "updatedAt" = NOW()
          WHERE id = :id
        `, {
          replacements: { embedding: embeddingStr, id: chunk.id }
        });

        completedCount++;
        
        // Log cada 10 chunks o al final
        if ((i + 1) % 10 === 0 || i === chunkRecords.length - 1) {
          console.log(`[Recurso ${recursoId}] Progreso: ${i + 1}/${chunkRecords.length} (${completedCount} OK, ${errorCount} errores)`);
        }

      } catch (chunkError) {
        console.error(`[Recurso ${recursoId}] Error en chunk ${i + 1}:`, chunkError.message);
        await chunk.update({ embeddingStatus: 'error' });
        errorCount++;
      }

      // PAUSA LARGA entre chunks para liberar memoria y no saturar CPU
      if (i < chunkRecords.length - 1) {
        await new Promise(resolve => setTimeout(resolve, DELAY_BETWEEN_CHUNKS_MS));
      }
    }

    // Actualizar estado del recurso
    const finalStatus = errorCount === 0 ? 'completed' : (completedCount > 0 ? 'completed' : 'error');
    await recurso.update({ embeddingStatus: finalStatus });

    console.log(`[Recurso ${recursoId}] COMPLETADO: ${completedCount} OK, ${errorCount} errores`);

  } catch (error) {
    console.error(`[Recurso ${recursoId}] Error fatal:`, error);
    
    try {
      const recurso = await Recurso.findByPk(recursoId);
      if (recurso) {
        await recurso.update({ embeddingStatus: 'error' });
      }
    } catch (e) {
      console.error('Error actualizando estado:', e);
    }
  }
}

module.exports = router;
