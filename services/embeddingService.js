const OpenAI = require('openai');

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

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

async function searchSimilar(queryEmbedding, limit = 5) {
  const { sequelize } = require('../models');
  
  // Convertir array a formato PostgreSQL
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
  searchSimilar
};
