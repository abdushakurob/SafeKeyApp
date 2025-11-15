
import express from 'express'
import cors from 'cors'
import { getSession, hasValidSession, storeSession, clearSession as clearSessionStore } from './session-store'
import { credentialExists, getCredential } from '../lib/credentials'
import { queueSave, getPendingSaves, removeFromQueue } from './save-queue'
import { EnokiClient } from '@mysten/enoki'

const app = express()
const PORT = 3001

// Extension heartbeat tracking
// Stores the last heartbeat timestamp for each extension instance
// Extension is considered "installed" if it has pinged within the last 30 seconds
const extensionHeartbeats = new Map<string, number>()
const EXTENSION_HEARTBEAT_TIMEOUT = 30000 // 30 seconds

// Initialize Enoki client for sponsored transactions
// Following Sui docs pattern: https://docs.sui.io/guides/developer/app-examples/plinko
// NOTE: Backend operations require a PRIVATE API key, not the public VITE_ENOKI_API_KEY
// Get your private API key from: https://enoki.mystenlabs.com/developer
function getEnokiClient(): EnokiClient {
  // For backend, we need ENOKI_PRIVATE_API_KEY (not VITE_ENOKI_API_KEY which is public)
  const apiKey = process.env.ENOKI_PRIVATE_API_KEY || process.env.ENOKI_API_KEY
  if (!apiKey) {
    throw new Error(
      'ENOKI_PRIVATE_API_KEY environment variable is required for backend sponsored transactions. ' +
      'Get your private API key from https://enoki.mystenlabs.com/developer'
    )
  }
  
  return new EnokiClient({
    apiKey,
  })
}

const enokiClient = getEnokiClient()
console.log(`[API] Enoki client initialized for network: ${process.env.VITE_SUI_NETWORK || 'testnet'}`)

// Middleware - CORS configuration
// In development, allow all origins for extension compatibility
// Content scripts run in web page context, so they use the page's origin, not extension origin
const isDevelopment = process.env.NODE_ENV !== 'production'

app.use(cors({
  origin: (origin, callback) => {
    // In development, allow all origins (needed for extension content scripts)
    // Only log CORS errors, not every successful request
    if (isDevelopment) {
      return callback(null, true)
    }
    
    // Production mode: strict origin checking
    // Allow requests with no origin (like mobile apps, Postman, or extension background scripts)
    if (!origin) {
      return callback(null, true)
    }
    
    // Allow localhost origins
    if (origin.startsWith('http://localhost:') || origin.startsWith('http://127.0.0.1:')) {
      return callback(null, true)
    }
    // Allow extension origins (case-insensitive check)
    const lowerOrigin = origin.toLowerCase()
    if (lowerOrigin.startsWith('chrome-extension://') || lowerOrigin.startsWith('moz-extension://')) {
      return callback(null, true)
    }
    // Reject other origins
    console.warn('[CORS] Rejecting origin:', origin)
    callback(new Error(`Not allowed by CORS: ${origin}`))
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}))
app.use(express.json())

// Log only important requests (skip polling endpoints)
app.use((req, _res, next) => {
  // Skip logging for polling endpoints
  if (req.path === '/api/pending-saves' || req.path === '/api/health' || req.path === '/api/extension-ping') {
    return next()
  }
  console.log(`[API] ${req.method} ${req.path}`, req.body || req.query)
  next()
})

/**
 * Check if credential exists for a domain
 * GET /api/check-credential?domain=example.com
 */
app.get('/api/check-credential', async (req, res) => {
  try {
    const { domain } = req.query

    if (!domain || typeof domain !== 'string') {
      return res.status(400).json({ success: false, error: 'Domain is required' })
    }

    // Check session
    if (!hasValidSession()) {
      return res.status(401).json({ success: false, error: 'No valid session' })
    }

    const session = getSession()
    if (!session) {
      return res.status(401).json({ success: false, error: 'Session not found' })
    }

    // Use stored SEAL-derived master key from session
    if (!session.masterKey) {
      return res.status(401).json({ success: false, error: 'Master key not available. Please login again.' })
    }
    const KM = session.masterKey

    // Query blockchain (read-only, no signing needed)
    const exists = await credentialExists(domain, session.address, KM)

    res.json({ success: true, exists })
  } catch (error) {
    console.error('[API] Error checking credential:', error)
    res.status(500).json({ success: false, error: String(error) })
  }
})

/**
 * Get credential for a domain
 * GET /api/get-credential?domain=example.com
 */
app.get('/api/get-credential', async (req, res) => {
  try {
    console.log('[API] GET /api/get-credential called with domain:', req.query.domain)
    const { domain } = req.query

    if (!domain || typeof domain !== 'string') {
      console.log('[API] Missing or invalid domain parameter')
      return res.status(400).json({ success: false, error: 'Domain is required' })
    }

    // Check session
    if (!hasValidSession()) {
      console.log('[API] No valid session for get-credential')
      return res.status(401).json({ success: false, error: 'No valid session' })
    }

    const session = getSession()
    if (!session) {
      console.log('[API] Session not found for get-credential')
      return res.status(401).json({ success: false, error: 'Session not found' })
    }

    // Use stored SEAL-derived master key from session
    if (!session.masterKey) {
      console.log('[API] No master key in session for get-credential')
      return res.status(401).json({ success: false, error: 'Master key not available. Please login again.' })
    }
    const masterKey = session.masterKey

    console.log('[API] Getting credential for domain:', domain, 'address:', session.address)
    console.log('[API] Master key length:', masterKey?.length || 0)
    
    // Get credential
    let credential
    try {
      credential = await getCredential(domain, masterKey, session.address)
      console.log('[API] getCredential returned:', credential ? 'credential object' : 'null')
      if (credential) {
        console.log('[API] Credential details:', {
          domain: credential.domain,
          username: credential.username,
          passwordLength: credential.password?.length || 0
        })
      }
    } catch (error) {
      console.error('[API] Error in getCredential function:', error)
      console.error('[API] Error stack:', error instanceof Error ? error.stack : 'No stack')
      // Don't throw - return null credential instead
      credential = null
    }

    console.log('[API] Credential result:', credential ? 'found' : 'not found')
    if (!credential) {
      // Return success with null credential (not an error, just doesn't exist)
      console.log('[API] ⚠️ Returning success with null credential - credential may not exist or failed to decrypt')
      return res.json({ success: true, credential: null })
    }

    console.log('[API] ✅ Returning credential for domain:', domain)
    res.json({ success: true, credential })
  } catch (error) {
    console.error('[API] Error getting credential:', error)
    res.status(500).json({ success: false, error: String(error) })
  }
})

/**
 * Save credential (queues for processing by React app)
 * POST /api/save-credential
 * Body: { domain: string, username: string, password: string }
 * Note: This queues the save. The Dashboard will process it and sign the transaction.
 */
app.post('/api/save-credential', async (req, res) => {
  try {
    const { domain, username, password } = req.body

    if (!domain || !username || !password) {
      return res.status(400).json({ success: false, error: 'Domain, username, and password are required' })
    }

    // Check session
    if (!hasValidSession()) {
      return res.status(401).json({ success: false, error: 'No valid session' })
    }

    // Queue the save request (React app will process it)
    const queueId = queueSave({ domain, username, password })

    res.json({ success: true, queueId, message: 'Credential queued for saving' })
  } catch (error) {
    console.error('[API] Error queuing save:', error)
    res.status(500).json({ success: false, error: String(error) })
  }
})

/**
 * Update credential (queues for processing by React app)
 * POST /api/update-credential
 * Body: { domain: string, username: string, password: string }
 * Note: This queues the update. The Dashboard will process it and sign the transaction.
 */
app.post('/api/update-credential', async (req, res) => {
  try {
    const { domain, username, password } = req.body

    if (!domain || !username || !password) {
      return res.status(400).json({ success: false, error: 'Domain, username, and password are required' })
    }

    // Check session
    if (!hasValidSession()) {
      return res.status(401).json({ success: false, error: 'No valid session' })
    }

    // Queue the update request (same as save - saveCredential handles updates automatically)
    const queueId = queueSave({ domain, username, password })

    res.json({ success: true, queueId, message: 'Credential queued for update' })
  } catch (error) {
    console.error('[API] Error queuing update:', error)
    res.status(500).json({ success: false, error: String(error) })
  }
})

/**
 * Get pending saves (for React app to poll)
 * GET /api/pending-saves
 */
app.get('/api/pending-saves', (_req, res) => {
  const pending = getPendingSaves()
  // Only log if there are pending saves
  if (pending.length > 0) {
    console.log(`[API] GET /api/pending-saves - ${pending.length} pending`)
  }
  res.json({ success: true, pending })
})

/**
 * Mark save as processed
 * POST /api/pending-saves/:id/complete
 */
app.post('/api/pending-saves/:id/complete', (req, res) => {
  const { id } = req.params
  const removed = removeFromQueue(id)
  if (removed) {
    res.json({ success: true })
  } else {
    res.status(404).json({ success: false, error: 'Queue item not found' })
  }
})

/**
 * Sync session from React app
 * POST /api/sync-session
 * Body: { address: string, idToken: string, provider: string, createdAt: number }
 */
app.post('/api/sync-session', (req, res) => {
  try {
    const { address, idToken, provider, createdAt, masterKey } = req.body

    if (!address || !idToken || !provider) {
      return res.status(400).json({ success: false, error: 'Missing required fields' })
    }

    if (!masterKey) {
      return res.status(400).json({ success: false, error: 'Master key is required (SEAL-derived)' })
    }

    storeSession({
      address,
      idToken,
      provider,
      createdAt: createdAt || Date.now(),
      masterKey, // Store SEAL-derived master key
    })

    res.json({ success: true, message: 'Session synced' })
  } catch (error) {
    console.error('[API] Error syncing session:', error)
    res.status(500).json({ success: false, error: String(error) })
  }
})

/**
 * Clear session
 * POST /api/clear-session
 */
app.post('/api/clear-session', (_req, res) => {
  try {
    clearSessionStore()
    res.json({ success: true, message: 'Session cleared' })
  } catch (error) {
    console.error('[API] Error clearing session:', error)
    res.status(500).json({ success: false, error: String(error) })
  }
})

/**
 * Get all credentials (for dashboard)
 * GET /api/all-credentials
 */
app.get('/api/all-credentials', async (_req, res) => {
  try {
    console.log('[API] /api/all-credentials called')
    
    // Check session
    const hasSession = hasValidSession()
    console.log('[API] Has valid session:', hasSession)
    
    if (!hasSession) {
      console.log('[API] No valid session, returning 401')
      return res.status(401).json({ success: false, error: 'No valid session' })
    }

    const session = getSession()
    console.log('[API] Session retrieved:', session ? { address: session.address, hasMasterKey: !!session.masterKey } : 'null')
    
    if (!session) {
      console.log('[API] Session is null, returning 401')
      return res.status(401).json({ success: false, error: 'Session not found' })
    }

    // Use stored SEAL-derived master key from session
    // SEAL-derived KM is stored when the session is synced from the Dashboard
    if (!session.masterKey) {
      console.log('[API] No master key in session, returning 401')
      return res.status(401).json({ success: false, error: 'Master key not available. Please login again.' })
    }
    const KM = session.masterKey
    console.log('[API] Using master key from session (length:', KM.length, ')')

    // Get all domains from vault
    const { getUserVaultId, getAllDomainHashes } = await import('../lib/vault')
    const { deriveKS, decrypt, base64Encode } = await import('../lib/crypto')
    
    console.log('[API] Looking up vault for address:', session.address)
    const vaultId = await getUserVaultId(session.address)
    
    if (!vaultId) {
      console.log('[API] No vault found for address after retries:', session.address)
      console.log('[API] This might mean the vault has not been created yet, or there was an indexing delay')
      return res.json({ success: true, credentials: [] })
    }

    console.log('[API] Found vault:', vaultId)
    
    // Get all domain hashes from vault
    const domainHashes = await getAllDomainHashes(vaultId)
    
    console.log('[API] Found', domainHashes.length, 'domain hashes in vault')
    
    if (domainHashes.length === 0) {
      console.log('[API] No domain hashes found, returning empty credentials')
      return res.json({ success: true, credentials: [] })
    }

    // For each domain hash, we need to:
    // 1. Get the credential info (which includes the domain hash)
    // 2. Try to reverse-lookup the domain by hashing known domains
    // Since we can't reverse the hash, we'll return domain hashes and let the client decrypt
    
    // Actually, we need to get credential info to decrypt and get the domain
    // But we don't have the domain to hash... This is a problem.
    // For now, let's return the domain hashes and let the client try to match them
    // OR: We can store domain in the encrypted data itself
    
    // Better approach: Get credential info directly from dynamic field objects
    const credentials = []
    
    console.log(`[API] Processing ${domainHashes.length} domain hashes...`)
    
    // Helper function for base64 decoding in Node.js (atob is not available)
    const decodeBase64 = (str: string): Uint8Array => {
      if (typeof Buffer !== 'undefined') {
        return new Uint8Array(Buffer.from(str, 'base64'))
      } else {
        // Browser fallback
        const binary = atob(str)
        return Uint8Array.from(binary, c => c.charCodeAt(0))
      }
    }
    
    // Import the new function
    const { getCredentialInfoFromDynamicField } = await import('../lib/vault')
    
    for (const domainHash of domainHashes) {
      try {
        const info = await getCredentialInfoFromDynamicField(vaultId, domainHash)
        
        if (!info) {
          console.warn('[API] Could not retrieve credential info for domain hash')
          continue
        }
        
        console.log('[API] Retrieved credential info, decrypting...')
        console.log('[API] Data lengths:', {
          data: info.data.length,
          entryNonce: info.entryNonce.length,
          sessionNonce: info.sessionNonce.length,
        })
        
        // Check if data is empty
        if (info.data.length === 0) {
          console.warn('[API] Data is empty, skipping credential')
          continue
        }
        
        // Handle different storage formats:
        // - New format: raw bytes (12 bytes for IV, 16 bytes for session nonce)
        // - Old format: base64 strings stored as bytes (24 bytes for 16-byte data, 16 bytes for 12-byte data)
        let sessionNonceB64: string
        let entryNonceB64: string
        
        // Check if sessionNonce is base64 string stored as bytes (24 bytes = 16 bytes base64-encoded)
        if (info.sessionNonce.length === 24) {
          // Decode as base64 string
          try {
            const decoded = new TextDecoder().decode(info.sessionNonce)
            if (/^[A-Za-z0-9+/=]+$/.test(decoded)) {
              sessionNonceB64 = decoded
              console.log('[API] Session nonce is base64 string (24 bytes)')
            } else {
              // Not a valid base64 string, treat as raw bytes
              sessionNonceB64 = base64Encode(info.sessionNonce)
            }
          } catch {
            sessionNonceB64 = base64Encode(info.sessionNonce)
          }
        } else if (info.sessionNonce.length === 16) {
          // Raw 16-byte session nonce, encode to base64
          sessionNonceB64 = base64Encode(info.sessionNonce)
        } else {
          // Unknown format, try to encode
          sessionNonceB64 = base64Encode(info.sessionNonce)
        }
        
        // Check if entryNonce is base64 string stored as bytes (16 bytes = 12 bytes base64-encoded)
        if (info.entryNonce.length === 16) {
          // Might be base64 string (12 bytes base64-encoded = 16 bytes)
          try {
            const decoded = new TextDecoder().decode(info.entryNonce)
            if (/^[A-Za-z0-9+/=]+$/.test(decoded)) {
              // Verify it decodes to 12 bytes
              const decodedBytes = decodeBase64(decoded)
              if (decodedBytes.length === 12) {
                entryNonceB64 = decoded
                console.log('[API] Entry nonce is base64 string (16 bytes)')
              } else {
                // Not 12 bytes when decoded, treat as raw bytes
                entryNonceB64 = base64Encode(info.entryNonce)
              }
            } else {
              entryNonceB64 = base64Encode(info.entryNonce)
            }
          } catch {
            entryNonceB64 = base64Encode(info.entryNonce)
          }
        } else if (info.entryNonce.length === 12) {
          // Raw 12-byte IV, encode to base64
          entryNonceB64 = base64Encode(info.entryNonce)
        } else if (info.entryNonce.length === 24) {
          // 24 bytes = might be base64 string for 18 bytes, but we expect 12
          // Try decoding as base64
          try {
            const decoded = new TextDecoder().decode(info.entryNonce)
            if (/^[A-Za-z0-9+/=]+$/.test(decoded)) {
              const decodedBytes = decodeBase64(decoded)
              if (decodedBytes.length === 12) {
                entryNonceB64 = decoded
                console.log('[API] Entry nonce is base64 string (24 bytes, decodes to 12)')
              } else {
                // Take first 12 bytes after decoding
                entryNonceB64 = base64Encode(decodedBytes.slice(0, 12))
              }
            } else {
              // Take first 12 bytes
              entryNonceB64 = base64Encode(info.entryNonce.slice(0, 12))
            }
          } catch {
            // Take first 12 bytes
            entryNonceB64 = base64Encode(info.entryNonce.slice(0, 12))
          }
        } else {
          // Unknown format, try to encode
          entryNonceB64 = base64Encode(info.entryNonce)
        }
        
        const encryptedDataB64 = base64Encode(info.data)
        
        console.log('[API] Derived base64 values, deriving session key...')
        console.log('[API] Base64 lengths:', {
          sessionNonce: sessionNonceB64.length,
          entryNonce: entryNonceB64.length,
          encryptedData: encryptedDataB64.length,
        })
        console.log('[API] Master key (KM) length:', KM.length)
        
        // Derive session key
        const KS = await deriveKS(KM, sessionNonceB64)
        
        console.log('[API] Session key derived, decrypting data...')
        
        // Decrypt: reconstruct "iv.ciphertext" format
        const encryptedData = `${entryNonceB64}.${encryptedDataB64}`
        console.log('[API] Encrypted data format length:', encryptedData.length)
        const decryptedData = await decrypt(encryptedData, KS)
        
        console.log('[API] Data decrypted, parsing JSON...')
        
        // Parse JSON
        const credentialData = JSON.parse(decryptedData)
        
        console.log('[API] Successfully decrypted credential for domain:', credentialData.domain)
        
        if (!credentialData.domain || typeof credentialData.domain !== 'string') {
          throw new Error('Invalid credential data: domain is required')
        }
        if (!credentialData.username || typeof credentialData.username !== 'string') {
          throw new Error('Invalid credential data: username is required')
        }
        if (!credentialData.password || typeof credentialData.password !== 'string') {
          throw new Error('Invalid credential data: password is required')
        }
        
        credentials.push({
          domain: credentialData.domain,
          username: credentialData.username,
          password: credentialData.password, // Include password in response
          createdAt: info.createdAt,
        })
      } catch (error) {
        // Silently skip credentials that fail to decrypt (likely old test data with different keys)
        // Only log if it's a new credential (created after we fixed the key derivation)
        let createdAt = 0
        try {
          // Try to get createdAt from the info variable if it exists
          const info = await getCredentialInfoFromDynamicField(vaultId, domainHash).catch(() => null)
          if (info?.createdAt) {
            createdAt = info.createdAt
          }
        } catch {
          // Ignore if info is not accessible
        }
        const isRecent = createdAt > Date.now() - 3600000 // Last hour
        if (isRecent) {
          console.error('[API] Error processing recent credential:', error)
          console.error('[API] Error details:', {
            message: error instanceof Error ? error.message : String(error),
            createdAt,
          })
        }
        // Skip this credential but continue with others
      }
    }
    
    console.log(`[API] Successfully processed ${credentials.length} credentials out of ${domainHashes.length} domain hashes`)

    res.json({ success: true, credentials })
  } catch (error) {
    console.error('[API] Error getting all credentials:', error)
    console.error('[API] Error details:', {
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      name: error instanceof Error ? error.name : undefined,
    })
    res.status(500).json({ 
      success: false, 
      error: error instanceof Error ? error.message : String(error) 
    })
  }
})

/**
 * Delete credential
 * DELETE /api/delete-credential?domain=example.com
 */
app.delete('/api/delete-credential', async (req, res) => {
  try {
    const { domain } = req.query

    if (!domain || typeof domain !== 'string') {
      return res.status(400).json({ success: false, error: 'Domain is required' })
    }

    // Check session
    if (!hasValidSession()) {
      return res.status(401).json({ success: false, error: 'No valid session' })
    }

    const session = getSession()
    if (!session) {
      return res.status(401).json({ success: false, error: 'Session not found' })
    }

    // Delete requires signing, so queue it for React app to process
    // For now, return error (would need to implement delete queue)
    res.status(501).json({ success: false, error: 'Delete not yet implemented via API. Use dashboard.' })
  } catch (error) {
    console.error('[API] Error deleting credential:', error)
    res.status(500).json({ success: false, error: String(error) })
  }
})

/**
 * Get all domains (hashed)
 * GET /api/all-domains
 */
app.get('/api/all-domains', async (_req, res) => {
  try {
    // Check session
    if (!hasValidSession()) {
      return res.status(401).json({ success: false, error: 'No valid session' })
    }

    const session = getSession()
    if (!session) {
      return res.status(401).json({ success: false, error: 'Session not found' })
    }

    // Get vault ID
    const { getUserVaultId } = await import('../lib/vault')
    const vaultId = await getUserVaultId(session.address)
    
    if (!vaultId) {
      return res.json({ success: true, domains: [] })
    }

    // TODO: Implement getAllDomains in vault.ts
    // This requires querying all dynamic fields on the vault
    res.json({ success: true, domains: [] })
  } catch (error) {
    console.error('[API] Error getting all domains:', error)
    res.status(500).json({ success: false, error: String(error) })
  }
})

/**
 * Check if domain exists (optimized endpoint)
 * GET /api/check-domain?domain=example.com
 * Alias for /api/check-credential
 */
app.get('/api/check-domain', async (req, res) => {
  // Redirect to check-credential endpoint
  req.url = '/api/check-credential'
  return app._router.handle(req, res)
})

/**
 * Health check
 * GET /api/health
 */
app.get('/api/health', (_req, res) => {
  res.json({ success: true, message: 'API server is running' })
})

/**
 * Extension heartbeat - called by extension to announce it's installed
 * POST /api/extension-ping
 * Body: { extensionId: string (optional) }
 * Returns: { success: true }
 */
app.post('/api/extension-ping', (req, res) => {
  try {
    const { extensionId } = req.body
    // Use extensionId if provided, otherwise use a default identifier
    const id = extensionId || 'default'
    const now = Date.now()
    
    extensionHeartbeats.set(id, now)
    
    // Clean up old heartbeats (older than timeout)
    for (const [key, timestamp] of extensionHeartbeats.entries()) {
      if (now - timestamp > EXTENSION_HEARTBEAT_TIMEOUT * 2) {
        extensionHeartbeats.delete(key)
      }
    }
    
    res.json({ success: true })
  } catch (error) {
    console.error('[API] Error processing extension ping:', error)
    res.status(500).json({ success: false, error: String(error) })
  }
})

/**
 * Check if extension is installed (for dashboard)
 * GET /api/extension-status
 * Returns: { installed: boolean, lastPing?: number }
 */
app.get('/api/extension-status', (_req, res) => {
  try {
    const now = Date.now()
    let installed = false
    let lastPing: number | undefined
    
    // Check if any extension has pinged recently
    for (const [, timestamp] of extensionHeartbeats.entries()) {
      const age = now - timestamp
      if (age < EXTENSION_HEARTBEAT_TIMEOUT) {
        installed = true
        // Use the most recent ping
        if (!lastPing || timestamp > lastPing) {
          lastPing = timestamp
        }
      }
    }
    
    res.json({ 
      installed,
      lastPing: lastPing || null,
    })
  } catch (error) {
    console.error('[API] Error checking extension status:', error)
    res.status(500).json({ success: false, error: String(error) })
  }
})

/**
 * Sponsor a transaction
 * POST /api/sponsor
 * Body: { transactionKindBytes: string (base64), sender: string }
 * Returns: { bytes: string (base64), digest: string }
 * Following Sui docs pattern: https://docs.sui.io/guides/developer/app-examples/plinko
 */
app.post('/api/sponsor', async (req, res) => {
  try {
    const { transactionKindBytes, sender } = req.body

    if (!transactionKindBytes || !sender) {
      return res.status(400).json({ 
        error: 'transactionKindBytes and sender are required' 
      })
    }

    console.log('[API] Sponsoring transaction for sender:', sender)

    // Use Enoki client to create sponsored transaction
    // This handles all the complexity of adding gas, signing, etc.
    const network = (process.env.VITE_SUI_NETWORK || 'testnet') as 'mainnet' | 'testnet' | 'devnet'
    
    const sponsored = await enokiClient.createSponsoredTransaction({
      network,
      transactionKindBytes,
      sender,
      allowedAddresses: [sender],
    })

    console.log('[API] Transaction sponsored successfully, digest:', sponsored.digest)

    // Return bytes and digest (following Sui docs pattern)
    return res.json({
      bytes: sponsored.bytes,
      digest: sponsored.digest,
    })
  } catch (error) {
    console.error('[API] Error sponsoring transaction:', error)
    return res.status(500).json({
      error: error instanceof Error ? error.message : String(error),
    })
  }
})

/**
 * Execute a sponsored transaction
 * POST /api/execute
 * Body: { digest: string, signature: string (base64) }
 * Returns: { digest: string }
 */
app.post('/api/execute', async (req, res) => {
  try {
    const { digest, signature } = req.body

    if (!digest || !signature) {
      return res.status(400).json({ 
        error: 'digest and signature are required' 
      })
    }

    console.log('[API] Executing sponsored transaction, digest:', digest)

    // Use Enoki client to execute sponsored transaction
    // This handles combining user signature with sponsor signature
    const executionResult = await enokiClient.executeSponsoredTransaction({
      digest,
      signature,
    })

    console.log('[API] Transaction executed successfully:', executionResult.digest)

    return res.json({
      digest: executionResult.digest,
    })
  } catch (error) {
    console.error('[API] Error executing transaction:', error)
    return res.status(500).json({
      error: error instanceof Error ? error.message : String(error),
    })
  }
})

/**
 * Start server
 */
export function startApiServer(): void {
  app.listen(PORT, () => {
    console.log(`[API Server] Running on http://localhost:${PORT}`)
  })
}

// If running directly (not imported)
if (import.meta.url === `file://${process.argv[1]}`) {
  startApiServer()
}

