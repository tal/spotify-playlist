#!/usr/bin/env node

/**
 * Rollback: Remove liked songs cache tables
 * 
 * This rollback script removes the tables created by migration 001:
 * - liked_songs
 * - liked_songs_metadata
 * 
 * Run: npx ts-node src/migrations/rollback-001-liked-songs.ts
 */

import { 
  DeleteTableCommand,
  DescribeTableCommand,
  ListTablesCommand,
} from '@aws-sdk/client-dynamodb'
import { AWS } from '../aws'

const TABLES_TO_DELETE = ['liked_songs', 'liked_songs_metadata']

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

async function deleteTable(tableName: string): Promise<void> {
  // Check if table exists
  if (!(await tableExists(tableName))) {
    console.log(`⚠️  Table ${tableName} does not exist, skipping deletion`)
    return
  }
  
  console.log(`🗑️  Deleting table: ${tableName}`)
  
  try {
    await AWS.dynamo.send(new DeleteTableCommand({ TableName: tableName }))
    console.log(`✅ Table ${tableName} deletion initiated`)
    
    // Wait for table to be deleted
    console.log(`⏳ Waiting for table ${tableName} to be deleted...`)
    let attempts = 0
    const maxAttempts = 30
    
    while (attempts < maxAttempts) {
      await new Promise(resolve => setTimeout(resolve, 2000))
      
      if (!(await tableExists(tableName))) {
        console.log(`✅ Table ${tableName} has been deleted`)
        break
      }
      
      attempts++
    }
    
    if (attempts >= maxAttempts) {
      console.warn(`⚠️  Table ${tableName} deletion did not complete within timeout`)
    }
  } catch (error: any) {
    console.error(`❌ Failed to delete table ${tableName}:`, error.message)
    throw error
  }
}

async function confirmRollback(): Promise<boolean> {
  if (process.argv.includes('--force') || process.argv.includes('-f')) {
    return true
  }
  
  console.log('⚠️  WARNING: This will delete the following tables and ALL their data:')
  console.log(`   - ${TABLES_TO_DELETE.join('\n   - ')}`)
  console.log('')
  console.log('To confirm, run with --force flag:')
  console.log('npx ts-node src/migrations/rollback-001-liked-songs.ts --force')
  
  return false
}

async function main() {
  console.log('🔄 Starting rollback: Remove liked songs cache tables')
  console.log('================================================')
  
  // Check for confirmation
  if (!(await confirmRollback())) {
    console.log('Rollback cancelled')
    return
  }
  
  try {
    // List existing tables for reference
    const listResponse = await AWS.dynamo.send(new ListTablesCommand({}))
    console.log(`📋 Current tables: ${listResponse.TableNames?.join(', ') || 'none'}`)
    console.log('')
    
    // Delete each table
    for (const tableName of TABLES_TO_DELETE) {
      await deleteTable(tableName)
    }
    
    console.log('')
    console.log('✅ Rollback completed successfully!')
    console.log('================================================')
    console.log('The liked songs cache tables have been removed.')
    console.log('To recreate them, run: npx ts-node src/migrations/001-create-liked-songs-tables.ts')
    
  } catch (error: any) {
    console.error('❌ Rollback failed:', error.message)
    console.error('Some tables may have been partially deleted.')
    console.error('Check the AWS console or run list-tables to see current state.')
    process.exit(1)
  }
}

// Run rollback if this is the main module
if (require.main === module) {
  main().catch(error => {
    console.error('Fatal error:', error)
    process.exit(1)
  })
}

export { main as runRollback }