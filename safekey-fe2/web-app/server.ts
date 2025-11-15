/**
 * Standalone API Server
 * Run this separately: npm run server
 */

import dotenv from 'dotenv'
import { fileURLToPath } from 'url'
import { dirname, join, resolve } from 'path'
import { existsSync } from 'fs'

// Get the directory of the current module
const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// Try multiple possible .env file locations
const possibleEnvPaths = [
  join(__dirname, '.env'),
  resolve(process.cwd(), '.env'),
  join(process.cwd(), '.env'),
]

let envLoaded = false
for (const envPath of possibleEnvPaths) {
  if (existsSync(envPath)) {
    const result = dotenv.config({ path: envPath })
    if (!result.error) {
      console.log(`✅ Loaded .env file from: ${envPath}`)
      envLoaded = true
      break
    }
  }
}

if (!envLoaded) {
  console.warn('⚠️  No .env file found. Tried:', possibleEnvPaths)
  console.warn('   Attempting to load from default location...')
  dotenv.config()
}

// Verify required env vars are loaded
const requiredVars = [
  'VITE_SAFEKEY_PACKAGE_ID',
  'VITE_SEAL_PACKAGE_ID',
  'VITE_SUI_NETWORK',
  'VITE_SUI_CHAIN',
  'SPONSOR_PRIVATE_KEY',
  'SPONSOR_ADDRESS'
]

const missingVars: string[] = []
for (const varName of requiredVars) {
  if (!process.env[varName]) {
    missingVars.push(varName)
  }
}

if (missingVars.length > 0) {
  console.error('❌ Missing required environment variables:')
  for (const varName of missingVars) {
    console.error(`   - ${varName}`)
  }
  console.error(`\n   Please add them to your .env file.`)
  console.error(`   Tried loading from: ${possibleEnvPaths.join(', ')}`)
  console.error(`   Current working directory: ${process.cwd()}`)
  process.exit(1)
}

console.log('✅ All required environment variables loaded successfully')

// Use dynamic import to ensure dotenv.config() runs first
const { startApiServer } = await import('./src/server/api-server.js')

startApiServer()

