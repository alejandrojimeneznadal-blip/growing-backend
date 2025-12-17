const router = require('express').Router();
const { body, validationResult } = require('express-validator');
const { Recurso, Chunk, sequelize } = require('../models');
const { 
  generateEmbedding, 
  chunkTextGenerator,
  countChunks
} = require('../services/embeddingService');
const { authMiddleware, adminMiddleware } = require('../middleware/auth');

// Configuración de procesamiento MUY LENTO para no saturar servidor
const DELAY_BETWEEN_CHUNKS_MS = 2000; // 2 segundos entre cada chunk

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
  body('categoria').optional().isIn(['comercial', 'meta-ads', 'gohighlevel', 'direccion', 'general'])
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, errors: errors.array() });
    }

    const { tipo, titulo, descripcion, url, contenido, categoria } = req.body;

    // Calcular número de chunks (sin crear el array completo)
    const fullText = [titulo, descripcion, contenido].filter(Boolean).join('\n\n');
    const numChunks = countChunks(fullText);
    const estimatedTimeSeconds = numChunks * (DELAY_BETWEEN_CHUNKS_MS / 1000 + 0.5);

    // Crear recurso SIN el contenido completo (se guarda en chunks)
    // Solo guardar primeros 500 chars como preview
    const contentPreview = contenido ? contenido.substring(0, 500) + (contenido.length > 500 ? '...' : '') : null;
    
    const recurso = await Recurso.create({
      tipo,
      titulo,
      descripcion,
      url,
      contenido: contentPreview,
      categoria: categoria || 'general',
      embeddingStatus: 'pending'
    });

    // Generar chunks y embeddings en background
    processRecursoChunksWithContent(recurso.id, fullText);

    // Limpiar referencia al contenido grande
    req.body.contenido = null;

    res.status(201).json({
      success: true,
      data: {
        id: recurso.id,
        tipo: recurso.tipo,
        titulo: recurso.titulo,
        categoria: recurso.categoria,
        embeddingStatus: recurso.embeddingStatus,
        estimatedChunks: numChunks,
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
  body('categoria').optional().isIn(['comercial', 'meta-ads', 'gohighlevel', 'direccion', 'general'])
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
    
    let estimatedChunks = 0;
    let estimatedTimeSeconds = 0;
    let fullTextForProcessing = null;

    if (contenidoCambio) {
      // Solo guardar preview del contenido
      updates.contenido = contenido ? contenido.substring(0, 500) + (contenido.length > 500 ? '...' : '') : null;
      updates.embeddingStatus = 'pending';
      
      // Preparar texto completo para procesamiento
      fullTextForProcessing = [
        updates.titulo || recurso.titulo, 
        updates.descripcion || recurso.descripcion, 
        contenido
      ].filter(Boolean).join('\n\n');
      
      estimatedChunks = countChunks(fullTextForProcessing);
      estimatedTimeSeconds = Math.ceil(estimatedChunks * (DELAY_BETWEEN_CHUNKS_MS / 1000 + 0.5));
    }

    await recurso.update(updates);

    // Regenerar chunks si cambió contenido
    if (contenidoCambio && fullTextForProcessing) {
      processRecursoChunksWithContent(recurso.id, fullTextForProcessing);
    }

    // Limpiar referencia
    req.body.contenido = null;

    res.json({ 
      success: true, 
      data: {
        id: recurso.id,
        tipo: recurso.tipo,
        titulo: recurso.titulo,
        categoria: recurso.categoria,
        embeddingStatus: recurso.embeddingStatus,
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
    const numChunks = countChunks(fullText);
    
    processRecursoChunks(recurso.id);

    res.json({ 
      success: true, 
      message: 'Reprocesamiento iniciado',
      data: {
        estimatedChunks: numChunks,
        estimatedTimeSeconds: Math.ceil(numChunks * (DELAY_BETWEEN_CHUNKS_MS / 1000 + 0.5))
      }
    });

  } catch (error) {
    console.error('Reprocess error:', error);
    res.status(500).json({ success: false, message: 'Error reprocessing' });
  }
});

/**
 * Procesa chunks con el contenido pasado directamente usando GENERADOR (no carga todo en memoria)
 * @param {string} recursoId 
 * @param {string} fullText - Texto completo a procesar
 */
async function processRecursoChunksWithContent(recursoId, fullText) {
  try {
    await Recurso.update(
      { embeddingStatus: 'processing' },
      { where: { id: recursoId } }
    );

    if (!fullText || !fullText.trim()) {
      await Recurso.update({ embeddingStatus: 'error' }, { where: { id: recursoId } });
      console.error(`[Recurso ${recursoId}] No tiene contenido para procesar`);
      return;
    }

    // Eliminar chunks anteriores
    await Chunk.destroy({ where: { recursoId } });

    // Contar total para logs (usa generador, no crea array)
    const totalChunks = countChunks(fullText);
    console.log(`[Recurso ${recursoId}] Iniciando: ${totalChunks} chunks`);

    if (totalChunks === 0) {
      await Recurso.update({ embeddingStatus: 'error' }, { where: { id: recursoId } });
      return;
    }

    let completedCount = 0;
    let errorCount = 0;
    let currentIndex = 0;

    // Procesar usando GENERADOR - solo un chunk en memoria a la vez
    for (const chunkData of chunkTextGenerator(fullText)) {
      currentIndex++;
      
      try {
        // Crear chunk en BD
        const chunk = await Chunk.create({
          recursoId,
          chunkIndex: chunkData.index,
          contenido: chunkData.content,
          tokens: chunkData.tokens,
          embeddingStatus: 'processing'
        });

        // Generar embedding
        const embedding = await generateEmbedding(chunkData.content);
        const embeddingStr = `[${embedding.join(',')}]`;

        // Guardar embedding
        await sequelize.query(`
          UPDATE "Chunks" 
          SET embedding = :embedding::vector, "embeddingStatus" = 'completed', "updatedAt" = NOW()
          WHERE id = :id
        `, {
          replacements: { embedding: embeddingStr, id: chunk.id }
        });

        completedCount++;
        
        if (currentIndex % 10 === 0 || currentIndex === totalChunks) {
          console.log(`[Recurso ${recursoId}] ${currentIndex}/${totalChunks} (${completedCount} OK, ${errorCount} err)`);
        }

      } catch (chunkError) {
        console.error(`[Recurso ${recursoId}] Error chunk ${currentIndex}:`, chunkError.message);
        
        // Intentar guardar el chunk con error
        try {
          await Chunk.create({
            recursoId,
            chunkIndex: chunkData.index,
            contenido: chunkData.content.substring(0, 1000),
            tokens: chunkData.tokens,
            embeddingStatus: 'error'
          });
        } catch (e) {}
        
        errorCount++;
      }

      // PAUSA entre chunks para liberar memoria
      await new Promise(resolve => setTimeout(resolve, DELAY_BETWEEN_CHUNKS_MS));
    }

    // Actualizar estado final
    const finalStatus = errorCount === 0 ? 'completed' : (completedCount > 0 ? 'completed' : 'error');
    await Recurso.update({ embeddingStatus: finalStatus }, { where: { id: recursoId } });

    console.log(`[Recurso ${recursoId}] DONE: ${completedCount} OK, ${errorCount} errors`);

  } catch (error) {
    console.error(`[Recurso ${recursoId}] Fatal:`, error.message);
    await Recurso.update({ embeddingStatus: 'error' }, { where: { id: recursoId } }).catch(() => {});
  }
}

/**
 * Procesa un recurso existente (para reprocess)
 */
async function processRecursoChunks(recursoId) {
  const recurso = await Recurso.findByPk(recursoId, {
    attributes: ['id', 'titulo', 'descripcion', 'contenido']
  });
  
  if (!recurso) return;
  
  const fullText = [recurso.titulo, recurso.descripcion, recurso.contenido].filter(Boolean).join('\n\n');
  await processRecursoChunksWithContent(recursoId, fullText);
}

module.exports = router;
