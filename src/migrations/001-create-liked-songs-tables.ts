#!/usr/bin/env node

/**
 * Migration: Create liked songs cache tables
 * 
 * This migration creates two new DynamoDB tables:
 * - liked_songs: Stores individual liked songs with user partition
 * - liked_songs_metadata: Stores sync metadata per user
 * 
 * Run: npx ts-node src/migrations/001-create-liked-songs-tables.ts
 */

import { 
  CreateTableCommand, 
  CreateTableCommandInput,
  DescribeTableCommand,
  ListTablesCommand,
} from '@aws-sdk/client-dynamodb'
import { AWS } from '../aws'
import * as fs from 'fs'
import * as path from 'path'

const TABLE_DEFINITIONS_PATH = path.join(__dirname, '../../config/dynamo-tables')

async function tableExists(tableName: string): Promise<boolean> {
  try {
    await AWS.dynamo.send(new DescribeTableCommand({ TableName: tableName }))
    return true
  } catch (error: any) {
    if (error.name === 'ResourceNotFoundException') {
      return false
    }
    throw error
  }
}

async function createTable(definitionFile: string): Promise<void> {
  const definitionPath = path.join(TABLE_DEFINITIONS_PATH, definitionFile)
  const definition: CreateTableCommandInput = JSON.parse(
    fs.readFileSync(definitionPath, 'utf8')
  )
  
  const tableName = definition.TableName!
  
  // Check if table already exists
  if (await tableExists(tableName)) {
    console.log(`⚠️  Table ${tableName} already exists, skipping creation`)
    return
  }
  
  console.log(`📦 Creating table: ${tableName}`)
  
  try {
    await AWS.dynamo.send(new CreateTableCommand(definition))
    console.log(`✅ Table ${tableName} created successfully`)
    
    // Wait for table to become active
    console.log(`⏳ Waiting for table ${tableName} to become active...`)
    let attempts = 0
    const maxAttempts = 30
    
    while (attempts < maxAttempts) {
      await new Promise(resolve => setTimeout(resolve, 2000))
      
      const describeResponse = await AWS.dynamo.send(
        new DescribeTableCommand({ TableName: tableName })
      )
      
      if (describeResponse.Table?.TableStatus === 'ACTIVE') {
        console.log(`✅ Table ${tableName} is now active`)
        break
      }
      
      attempts++
    }
    
    if (attempts >= maxAttempts) {
      console.warn(`⚠️  Table ${tableName} did not become active within timeout`)
    }
  } catch (error: any) {
    console.error(`❌ Failed to create table ${tableName}:`, error.message)
    throw error
  }
}

async function main() {
  console.log('🚀 Starting migration: Create liked songs cache tables')
  console.log('================================================')
  
  try {
    // List existing tables for reference
    const listResponse = await AWS.dynamo.send(new ListTablesCommand({}))
    console.log(`📋 Existing tables: ${listResponse.TableNames?.join(', ') || 'none'}`)
    console.log('')
    
    // Create liked_songs table
    await createTable('liked-songs.json')
    
    // Create liked_songs_metadata table
    await createTable('liked-songs-metadata.json')
    
    console.log('')
    console.log('✅ Migration completed successfully!')
    console.log('================================================')
    console.log('Next steps:')
    console.log('1. Test the new tables with: yarn cli sync-liked-songs')
    console.log('2. To rollback, run: npx ts-node src/migrations/rollback-001-liked-songs.ts')
    
  } catch (error: any) {
    console.error('❌ Migration failed:', error.message)
    console.error('To rollback any partial changes, run:')
    console.error('npx ts-node src/migrations/rollback-001-liked-songs.ts')
    process.exit(1)
  }
}

// Run migration if this is the main module
if (require.main === module) {
  main().catch(error => {
    console.error('Fatal error:', error)
    process.exit(1)
  })
}

export { main as runMigration }