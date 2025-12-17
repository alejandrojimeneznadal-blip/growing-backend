/**
 * Migration: Add 'direccion' to category ENUMs
 *
 * Run this script once to update the PostgreSQL ENUMs
 * Usage: node migrations/add-direccion-category.js
 */

require('dotenv').config();
const sequelize = require('../config/database');

async function migrate() {
  try {
    console.log('🔄 Starting migration: Add direccion category...');

    // Connect to database
    await sequelize.authenticate();
    console.log('✅ Database connected');

    // Add 'direccion' to Conversations category ENUM
    // PostgreSQL requires ALTER TYPE to add new enum values
    await sequelize.query(`
      DO $$
      BEGIN
        -- Add 'direccion' to enum_Conversations_category if it doesn't exist
        IF NOT EXISTS (
          SELECT 1 FROM pg_enum
          WHERE enumlabel = 'direccion'
          AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'enum_Conversations_category')
        ) THEN
          ALTER TYPE "enum_Conversations_category" ADD VALUE 'direccion';
          RAISE NOTICE 'Added direccion to enum_Conversations_category';
        ELSE
          RAISE NOTICE 'direccion already exists in enum_Conversations_category';
        END IF;
      END
      $$;
    `);
    console.log('✅ Updated Conversations category ENUM');

    // Add 'direccion' to Recursos categoria ENUM
    await sequelize.query(`
      DO $$
      BEGIN
        -- Add 'direccion' to enum_Recursos_categoria if it doesn't exist
        IF NOT EXISTS (
          SELECT 1 FROM pg_enum
          WHERE enumlabel = 'direccion'
          AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'enum_Recursos_categoria')
        ) THEN
          ALTER TYPE "enum_Recursos_categoria" ADD VALUE 'direccion';
          RAISE NOTICE 'Added direccion to enum_Recursos_categoria';
        ELSE
          RAISE NOTICE 'direccion already exists in enum_Recursos_categoria';
        END IF;
      END
      $$;
    `);
    console.log('✅ Updated Recursos categoria ENUM');

    console.log('🎉 Migration completed successfully!');
    process.exit(0);
  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  }
}

migrate();
