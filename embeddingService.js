const OpenAI = require('openai');

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// Configuración de chunking
const CHUNK_CONFIG = {
  maxTokens: 500,        // Tokens por chunk (aprox)
  overlapTokens: 50,     // Solapamiento entre chunks para contexto
  charsPerToken: 4       // Aproximación caracteres/token
};

/**
 * Generador que divide texto en chunks uno a uno (no carga todo en memoria)
 * @param {string} text - Texto completo a dividir
 * @param {number} maxTokens - Máximo de tokens por chunk
 * @param {number} overlapTokens - Tokens de solapamiento
 * @yields {{content: string, tokens: number, index: number}}
 */
function* chunkTextGenerator(text, maxTokens = CHUNK_CONFIG.maxTokens, overlapTokens = CHUNK_CONFIG.overlapTokens) {
  if (!text || text.trim().length === 0) {
    return;
  }

  const maxChars = maxTokens * CHUNK_CONFIG.charsPerToken;
  const overlapChars = overlapTokens * CHUNK_CONFIG.charsPerToken;
  
  // Limpiar texto (esto sí usa memoria pero es necesario una vez)
  const cleanText = text.replace(/\s+/g, ' ').trim();
  
  // Si el texto es corto, devolver como un solo chunk
  if (cleanText.length <= maxChars) {
    yield {
      content: cleanText,
      tokens: Math.ceil(cleanText.length / CHUNK_CONFIG.charsPerToken),
      index: 0
    };
    return;
  }

  let startIndex = 0;
  let chunkIndex = 0;
  let lastEndIndex = -1;

  while (startIndex < cleanText.length) {
    let endIndex = startIndex + maxChars;
    
    // No pasar del final del texto
    if (endIndex >= cleanText.length) {
      endIndex = cleanText.length;
    } else {
      // Buscar un punto de corte natural
      const searchStart = Math.max(startIndex + maxChars - 200, startIndex);
      const searchEnd = Math.min(startIndex + maxChars + 100, cleanText.length);
      const searchText = cleanText.substring(searchStart, searchEnd);
      
      // Priorizar cortes: doble salto > punto > coma > espacio
      const breakPoints = [
        { pattern: /\n\n/g, priority: 1 },
        { pattern: /\.\s/g, priority: 2 },
        { pattern: /[!?]\s/g, priority: 2 },
        { pattern: /,\s/g, priority: 3 },
        { pattern: /\s/g, priority: 4 }
      ];

      let bestBreak = -1;
      for (const bp of breakPoints) {
        const matches = [...searchText.matchAll(bp.pattern)];
        if (matches.length > 0) {
          const lastMatch = matches[matches.length - 1];
          bestBreak = searchStart + lastMatch.index + lastMatch[0].length;
          break;
        }
      }

      if (bestBreak > startIndex) {
        endIndex = bestBreak;
      }
    }

    const chunkContent = cleanText.substring(startIndex, endIndex).trim();
    
    if (chunkContent.length > 0) {
      yield {
        content: chunkContent,
        tokens: Math.ceil(chunkContent.length / CHUNK_CONFIG.charsPerToken),
        index: chunkIndex
      };
      chunkIndex++;
    }

    // Avanzar con solapamiento
    const newStart = endIndex - overlapChars;
    
    // Evitar bucle infinito
    if (newStart <= startIndex) {
      startIndex = endIndex;
    } else {
      startIndex = newStart;
    }
    
    // Seguridad extra contra bucle infinito
    if (endIndex === lastEndIndex) {
      break;
    }
    lastEndIndex = endIndex;
  }
}

/**
 * Cuenta chunks sin crearlos todos en memoria
 * @param {string} text 
 * @returns {number}
 */
function countChunks(text) {
  let count = 0;
  for (const _ of chunkTextGenerator(text)) {
    count++;
  }
  return count;
}

/**
 * Divide un texto largo en chunks (versión que devuelve array - usar solo para textos pequeños)
 * @param {string} text - Texto completo a dividir
 * @param {number} maxTokens - Máximo de tokens por chunk
 * @param {number} overlapTokens - Tokens de solapamiento
 * @returns {Array<{content: string, tokens: number, index: number}>}
 */
function splitTextIntoChunks(text, maxTokens = CHUNK_CONFIG.maxTokens, overlapTokens = CHUNK_CONFIG.overlapTokens) {
  return [...chunkTextGenerator(text, maxTokens, overlapTokens)];
}

/**
 * Genera embedding para un texto
 * @param {string} text - Texto para generar embedding
 * @returns {Promise<number[]>} - Vector de embedding
 */
async function generateEmbedding(text) {
  if (!text || text.trim().length === 0) {
    throw new Error('Text is required for embedding generation');
  }

  // Limitar texto a ~8000 tokens aprox (32000 chars)
  const truncatedText = text.substring(0, 32000);

  const response = await openai.embeddings.create({
    model: 'text-embedding-3-small',
    input: truncatedText
  });

  return response.data[0].embedding;
}

/**
 * Genera embeddings para múltiples textos en batch
 * @param {string[]} texts - Array de textos
 * @returns {Promise<number[][]>} - Array de embeddings
 */
async function generateEmbeddingsBatch(texts) {
  if (!texts || texts.length === 0) {
    return [];
  }

  // Filtrar textos vacíos y truncar
  const validTexts = texts
    .map(t => (t || '').trim())
    .filter(t => t.length > 0)
    .map(t => t.substring(0, 32000));

  if (validTexts.length === 0) {
    return [];
  }

  // OpenAI permite hasta 2048 inputs en batch
  const batchSize = 100;
  const allEmbeddings = [];

  for (let i = 0; i < validTexts.length; i += batchSize) {
    const batch = validTexts.slice(i, i + batchSize);
    
    const response = await openai.embeddings.create({
      model: 'text-embedding-3-small',
      input: batch
    });

    const batchEmbeddings = response.data.map(d => d.embedding);
    allEmbeddings.push(...batchEmbeddings);
  }

  return allEmbeddings;
}

/**
 * Busca chunks similares a una consulta
 * @param {number[]} queryEmbedding - Embedding de la consulta
 * @param {number} limit - Número de resultados
 * @returns {Promise<Array>} - Chunks similares con info del recurso padre
 */
async function searchSimilarChunks(queryEmbedding, limit = 5) {
  const { sequelize } = require('../models');
  
  const embeddingStr = `[${queryEmbedding.join(',')}]`;
  
  const results = await sequelize.query(`
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
    replacements: { embedding: embeddingStr, limit },
    type: sequelize.QueryTypes.SELECT
  });

  return results;
}

/**
 * Busca recursos similares (método original para compatibilidad)
 * @param {number[]} queryEmbedding - Embedding de la consulta
 * @param {number} limit - Número de resultados
 * @returns {Promise<Array>} - Recursos similares
 */
async function searchSimilar(queryEmbedding, limit = 5) {
  // Primero buscar en chunks
  const chunkResults = await searchSimilarChunks(queryEmbedding, limit * 2);
  
  if (chunkResults.length > 0) {
    // Agrupar por recurso y tomar los chunks más relevantes
    const resourceMap = new Map();
    
    for (const chunk of chunkResults) {
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
          contenido: chunk.chunk_contenido,
          chunks: [chunk.chunk_contenido]
        });
      } else {
        // Añadir contenido de chunks adicionales del mismo recurso
        const resource = resourceMap.get(resourceId);
        if (resource.chunks.length < 3) { // Máximo 3 chunks por recurso
          resource.chunks.push(chunk.chunk_contenido);
          resource.contenido = resource.chunks.join('\n\n---\n\n');
        }
        // Mantener la mejor similaridad
        if (chunk.similarity > resource.similarity) {
          resource.similarity = chunk.similarity;
        }
      }
    }
    
    // Convertir a array y ordenar por similaridad
    const results = Array.from(resourceMap.values())
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, limit);
    
    return results;
  }
  
  // Fallback: buscar en la tabla Recursos directamente (recursos sin chunks)
  const { sequelize } = require('../models');
  const embeddingStr = `[${queryEmbedding.join(',')}]`;
  
  const results = await sequelize.query(`
    SELECT 
      id, tipo, titulo, descripcion, url, contenido, categoria,
      1 - (embedding <=> :embedding::vector) as similarity
    FROM "Recursos"
    WHERE embedding IS NOT NULL 
      AND activo = true
    ORDER BY embedding <=> :embedding::vector
    LIMIT :limit
  `, {
    replacements: { embedding: embeddingStr, limit },
    type: sequelize.QueryTypes.SELECT
  });

  return results;
}

module.exports = {
  generateEmbedding,
  generateEmbeddingsBatch,
  splitTextIntoChunks,
  chunkTextGenerator,
  countChunks,
  searchSimilar,
  searchSimilarChunks,
  CHUNK_CONFIG
};
