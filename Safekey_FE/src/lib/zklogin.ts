import { registerEnokiWallets, isEnokiWallet, type EnokiWallet } from '@mysten/enoki'
import { SuiClient, getFullnodeUrl } from '@mysten/sui/client'
import type { AuthProvider } from '@mysten/enoki'
import { getWallets } from '@mysten/wallet-standard'
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'

export interface ZkLoginSession {
  address: string
  provider: AuthProvider
  createdAt: number
  sub?: string // OAuth provider's user ID
  idToken?: string // Google JWT
  ephemeralPrivateKey?: string // Ephemeral keypair for signing
  ephemeralPublicKey?: string
  nonce?: string
  randomness?: string
  maxEpoch?: number
  proofPoints?: string // ZK proof
  issBase64Details?: string
  headerBase64?: string
  addressSeed?: string
}

let zkLoginSession: ZkLoginSession | null = null
const walletRegistry = new Map<AuthProvider, EnokiWallet>()
let enokiApiKey: string = ''
let enokiNetwork: 'testnet' | 'mainnet' | 'devnet' = 'testnet'

const ENOKI_API_BASE = 'https://api.enoki.mystenlabs.com'

function parseJWT(token: string): Record<string, any> | null {
  try {
    const parts = token.split('.')
    if (parts.length !== 3) {
      console.error('[zkLogin] Invalid JWT format')
      return null
    }
    
    // Decode the payload (second part)
    const payload = parts[1]
    const decoded = atob(payload)
    return JSON.parse(decoded)
  } catch (error) {
    console.error('[zkLogin] Failed to parse JWT:', error)
    return null
  }
}

// Store configured providers for debugging
let configuredProviders: Record<string, { clientId: string }> = {}
let registeredClientIds: Record<string, string[]> = {} // Store client IDs registered with Enoki API

/**
 * Fetch registered authentication providers from Enoki API
 * This helps diagnose if a client ID is properly registered
 */
export async function checkRegisteredClientIds(): Promise<Record<string, string[]>> {
  try {
    if (!enokiApiKey) {
      console.warn('[zkLogin] Cannot check registered client IDs - API key not set')
      return {}
    }

    const appResponse = await fetch(`${ENOKI_API_BASE}/v1/app`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${enokiApiKey}`,
      },
    })

    if (!appResponse.ok) {
      const errorText = await appResponse.text()
      console.error(`[zkLogin] Failed to fetch app metadata: ${appResponse.status} ${errorText}`)
      return {}
    }

    const appData = await appResponse.json()

    const registered: Record<string, string[]> = {}
    if (appData.data?.authenticationProviders) {
      for (const provider of appData.data.authenticationProviders) {
        const providerType = provider.providerType
        if (!registered[providerType]) {
          registered[providerType] = []
        }
        if (provider.clientId) {
          registered[providerType].push(provider.clientId)
        }
      }
    }

    registeredClientIds = registered
    return registered
  } catch (error) {
    console.error('[zkLogin] ❌ Error checking registered client IDs:', error)
    return {}
  }
}

export function initializeEnokiFlow(
  apiKey: string,
  providers?: Record<string, { clientId: string }>,
  network: 'mainnet' | 'testnet' | 'devnet' = 'testnet'
): void {
  try {
    enokiApiKey = apiKey
    enokiNetwork = network as any
    
    configuredProviders = providers || {}
    const suiClient = new SuiClient({ url: getFullnodeUrl(network) })
    registerEnokiWallets({
      apiKey,
      providers: providers || {},
      client: suiClient,
      network,
    })
    populateWalletRegistry()

    // Check registered client IDs asynchronously (don't block initialization)
    checkRegisteredClientIds().then(registered => {
      // Validate configured client IDs against registered ones
      for (const [provider, config] of Object.entries(configuredProviders || {})) {
        const registeredForProvider = registered[provider] || []
        const isRegistered = registeredForProvider.some(id => id === config.clientId)
        if (!isRegistered) {
          console.error(`[zkLogin] ${provider} client ID is NOT registered with Enoki!`)
          console.error(`[zkLogin] Configured: ${config.clientId}`)
          console.error(`[zkLogin] Registered: ${registeredForProvider.length > 0 ? registeredForProvider.join(', ') : 'NONE'}`)
          console.error(`[zkLogin] ACTION REQUIRED: Register this client ID in Enoki Developer Portal`)
        }
      }
    }).catch(err => {
      console.warn('[zkLogin] ⚠️ Could not validate client IDs:', err)
    })
  } catch (error) {
    console.error('[zkLogin] Failed to initialize Enoki wallets:', error)
    throw error
  }
}

function populateWalletRegistry(): void {
  try {
    const wallets = getWallets().get()
    const enokiWallets = wallets.filter(isEnokiWallet)
    console.log('[zkLogin] Found', enokiWallets.length, 'Enoki wallet(s)')
    for (const wallet of enokiWallets) {
      walletRegistry.set(wallet.provider, wallet)
      console.log('[zkLogin] Registered wallet for provider:', wallet.provider)
    }
  } catch (error) {
    console.error('[zkLogin] Failed to populate wallet registry:', error)
  }
}

// Retry populating wallet registry (wallets might not be available immediately)
export async function ensureWalletRegistryPopulated(maxRetries: number = 5, delayMs: number = 200): Promise<void> {
  for (let i = 0; i < maxRetries; i++) {
    populateWalletRegistry()
    const wallets = getWallets().get()
    const enokiWallets = wallets.filter(isEnokiWallet)
    if (enokiWallets.length > 0) {
      console.log('[zkLogin] ✅ Wallet registry populated with', enokiWallets.length, 'wallet(s)')
      return
    }
    if (i < maxRetries - 1) {
      console.log(`[zkLogin] No wallets found, retrying in ${delayMs}ms... (${i + 1}/${maxRetries})`)
      await new Promise(resolve => setTimeout(resolve, delayMs))
    }
  }
  console.warn('[zkLogin] ⚠️ Wallet registry still empty after', maxRetries, 'retries')
}

export function getEnokiWallet(provider: AuthProvider): EnokiWallet | undefined {
  return walletRegistry.get(provider)
}

/**
 * Prepare zkLogin session by getting nonce from Enoki
 * This must be called BEFORE starting the OAuth flow
 * Returns the nonce that should be used in the OAuth request
 */
export async function prepareZkLoginSession(_provider: AuthProvider = 'google'): Promise<{
  nonce: string
  ephemeralPublicKey: string
  ephemeralPrivateKey: string
  randomness: string
  maxEpoch: number
}> {
  try {
    // Step 1: Create ephemeral keypair
    const ephemeralKeypair = new Ed25519Keypair()
    const publicKeyObj = ephemeralKeypair.getPublicKey()
    
    // Format ephemeral public key in Sui format (33 bytes with scheme prefix)
    const rawKeyBytes = publicKeyObj.toRawBytes()
    const ed25519SchemePrefix = new Uint8Array([0])
    const fullSuiFormat = new Uint8Array(ed25519SchemePrefix.length + rawKeyBytes.length)
    fullSuiFormat.set(ed25519SchemePrefix, 0)
    fullSuiFormat.set(rawKeyBytes, 1)
    const fullSuiFormatBinary = Array.from(fullSuiFormat).map(b => String.fromCharCode(b)).join('')
    const ephemeralPublicKey = btoa(fullSuiFormatBinary)
    
    // Step 2: Get nonce from Enoki API
    const nonceResponse = await fetch(`${ENOKI_API_BASE}/v1/zklogin/nonce`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${enokiApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        ephemeralPublicKey,
        network: enokiNetwork,
        additionalEpochs: 2,
      }),
    })
    
    if (!nonceResponse.ok) {
      const errorText = await nonceResponse.text()
      throw new Error(`Failed to get nonce: ${nonceResponse.status} ${errorText}`)
    }
    
    const nonceData = await nonceResponse.json()
    const nonce = nonceData.data.nonce
    const randomness = nonceData.data.randomness
    const maxEpoch = nonceData.data.maxEpoch
    
    // Store the ephemeral keypair and nonce data temporarily for use after OAuth
    const sessionData = {
      ephemeralPublicKey,
      ephemeralPrivateKey: ephemeralKeypair.getSecretKey(),
      nonce,
      randomness,
      maxEpoch,
      createdAt: Date.now(),
    }
    
    await chrome.storage.session.set({ zklogin_session_prep: sessionData })
    
    return {
      nonce,
      ephemeralPublicKey,
      ephemeralPrivateKey: ephemeralKeypair.getSecretKey(),
      randomness,
      maxEpoch,
    }
  } catch (error) {
    console.error(`[zkLogin] Failed to prepare zkLogin session:`, error)
    throw error
  }
}

// Process OAuth JWT and derive full zkLogin session
export async function processOAuthJWT(idToken: string, provider: AuthProvider = 'google'): Promise<string> {
  try {
    // Parse the JWT to extract claims
    const payload = parseJWT(idToken)
    if (!payload) {
      throw new Error('Failed to parse JWT')
    }
    
    // Extract client ID from JWT (aud field)
    const jwtClientId = payload.aud
    
    if (!payload.sub) {
      throw new Error('No sub claim in JWT')
    }
    
    if (!jwtClientId) {
      console.warn(`[zkLogin] No 'aud' (client ID) field in JWT payload`)
    }
    
    // Retrieve the session preparation data (nonce, ephemeral keypair, etc.)
    const sessionData = await chrome.storage.session.get('zklogin_session_prep')
    if (!sessionData.zklogin_session_prep) {
      throw new Error('Session preparation data not found. Please start the zkLogin flow from the beginning.')
    }
    
    const prep = sessionData.zklogin_session_prep
    const ephemeralPublicKey = prep.ephemeralPublicKey
    const ephemeralPrivateKey = prep.ephemeralPrivateKey
    const nonce = prep.nonce
    const randomness = prep.randomness
    const maxEpoch = prep.maxEpoch
    
    // Verify the nonce in the JWT matches what we sent to Google
    const jwtNonce = payload.nonce
    if (jwtNonce && jwtNonce !== nonce) {
      console.error(`[zkLogin] Nonce mismatch! Expected: ${nonce}, Got: ${jwtNonce}`)
      throw new Error('Nonce in JWT does not match the nonce used in OAuth request')
    } else if (!jwtNonce) {
      console.warn(`[zkLogin] No nonce found in JWT payload`)
    }
    
    let proofPoints: string, issBase64Details: string, headerBase64: string, addressSeed: string, address: string
    
    // Validate client ID registration before making ZKP request
    const configuredGoogleClientId = configuredProviders.google?.clientId
    let registeredGoogleClientIds = registeredClientIds.google || []
    
    if (configuredGoogleClientId && jwtClientId) {
      const match = configuredGoogleClientId === jwtClientId
      
      if (!match) {
        console.error(`[zkLogin] JWT client ID does not match configured Enoki client ID`)
      }

      // Check registration status with Enoki API if needed
      if (registeredGoogleClientIds.length === 0 || !registeredGoogleClientIds.includes(jwtClientId)) {
        try {
          const freshRegistered = await checkRegisteredClientIds()
          registeredGoogleClientIds = freshRegistered.google || []
          registeredClientIds = freshRegistered
        } catch (checkError) {
          console.warn(`[zkLogin] Could not verify registration status:`, checkError)
        }
      }

      // Check if client ID is registered with Enoki
      const isRegistered = registeredGoogleClientIds.includes(jwtClientId)
      if (!isRegistered) {
        console.error(`[zkLogin] JWT client ID is NOT registered with Enoki API`)
        console.error(`[zkLogin] JWT Client ID: ${jwtClientId}`)
        console.error(`[zkLogin] Registered Client IDs: ${registeredGoogleClientIds.length > 0 ? registeredGoogleClientIds.join(', ') : 'NONE'}`)
        throw new Error(`Invalid client ID: The Google OAuth Client ID "${jwtClientId}" is not registered with your Enoki API key. Please register it in the Enoki Developer Portal: https://portal.enoki.mystenlabs.com`)
      }
    }
    
    const zkpResponse = await fetch(`${ENOKI_API_BASE}/v1/zklogin/zkp`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${enokiApiKey}`,
        'zklogin-jwt': idToken,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        ephemeralPublicKey,
        maxEpoch,
        randomness,
        network: enokiNetwork,
      }),
    })
    
    if (!zkpResponse.ok) {
      const errorText = await zkpResponse.text()
      console.error(`[zkLogin] ZKP error response:`, errorText)
      
      // Parse error for better diagnostics
      try {
        const errorJson = JSON.parse(errorText)
        if (errorJson.errors && Array.isArray(errorJson.errors)) {
          for (const err of errorJson.errors) {
            if (err.code === 'invalid_client_id') {
              // Get fresh registration data for better error reporting
              let currentRegisteredIds: string[] = []
              try {
                const freshRegistered = await checkRegisteredClientIds()
                currentRegisteredIds = freshRegistered.google || []
              } catch (checkErr) {
                currentRegisteredIds = registeredClientIds.google || []
              }

              console.error(`[zkLogin] INVALID CLIENT ID ERROR`)
              console.error(`[zkLogin] The Google OAuth Client ID in your JWT is not registered with Enoki API`)
              console.error(`[zkLogin] JWT Client ID: ${jwtClientId}`)
              console.error(`[zkLogin] Registered Client IDs: ${currentRegisteredIds.length > 0 ? currentRegisteredIds.join(', ') : 'NONE'}`)
              console.error(`[zkLogin] Register at: https://portal.enoki.mystenlabs.com`)
              
              throw new Error(`Invalid client ID: The Google OAuth Client ID "${jwtClientId}" is not registered with your Enoki API key. Please register it in the Enoki Developer Portal: https://portal.enoki.mystenlabs.com`)
            }
          }
        }
      } catch (parseErr) {
        // Not JSON, just throw original error
      }
      
      throw new Error(`Failed to create ZK proof: ${zkpResponse.status} ${errorText}`)
    }
    
    const zkpData = await zkpResponse.json()
    proofPoints = zkpData.data.proofPoints
    issBase64Details = zkpData.data.issBase64Details
    headerBase64 = zkpData.data.headerBase64
    addressSeed = zkpData.data.addressSeed
    
    // Get Sui address from Enoki API
    const addressResponse = await fetch(`${ENOKI_API_BASE}/v1/zklogin`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${enokiApiKey}`,
        'zklogin-jwt': idToken,
      },
    })
    
    if (!addressResponse.ok) {
      const errorText = await addressResponse.text()
      console.error(`[zkLogin] Address error response:`, errorText)
      throw new Error(`Failed to get address: ${addressResponse.status} ${errorText}`)
    }
    
    const addressData = await addressResponse.json()
    address = addressData.data.address
    
    // Step 4: Store full session and clean up preparation data
    zkLoginSession = {
      address,
      provider,
      createdAt: Date.now(),
      sub: payload.sub,
      idToken,
      ephemeralPrivateKey,
      ephemeralPublicKey,
      nonce,
      randomness,
      maxEpoch,
      proofPoints,
      issBase64Details,
      headerBase64,
      addressSeed,
    }
    
    // Clean up the temporary preparation data
    await chrome.storage.session.remove('zklogin_session_prep')
    
    return address
  } catch (error) {
    console.error(`[zkLogin] Failed to process OAuth JWT:`, error)
    throw error
  }
}

export async function connectEnokiWallet(provider: AuthProvider): Promise<string> {
  try {
    const wallet = getEnokiWallet(provider)
    if (!wallet) {
      throw new Error(`Enoki wallet for ${provider} not found`)
    }
    
    // Try enoki:getSession first
    try {
      const sessionFeature = wallet.features['enoki:getSession']
      if (sessionFeature && typeof sessionFeature.getSession === 'function') {
        const session = await sessionFeature.getSession()
        if (session && typeof session === 'object' && 'address' in session) {
          const sessionAddress = (session as Record<string, any>).address
          if (sessionAddress) {
            return sessionAddress as string
          }
        }
      }
    } catch (e) {
      // Continue to next method
    }
    
    // Try standard:connect
    try {
      const connectFeature = wallet.features['standard:connect']
      if (!connectFeature) {
        throw new Error(`${provider} wallet does not support standard:connect`)
      }
      
      const connectPromise = connectFeature.connect()
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('wallet.connect() timed out after 30s')), 30000)
      )
      
      await Promise.race([connectPromise, timeoutPromise])
    } catch (connectError) {
      // Continue to next method
    }
    
    // Try getting metadata
    try {
      const metadataFeature = wallet.features['enoki:getMetadata']
      if (metadataFeature && typeof metadataFeature.getMetadata === 'function') {
        const metadata = await metadataFeature.getMetadata()
        if (metadata && typeof metadata === 'object' && 'address' in metadata) {
          const metadataAddress = (metadata as Record<string, any>).address
          if (metadataAddress) {
            return metadataAddress as string
          }
        }
      }
    } catch (e) {
      // Continue to fallback
    }
    
    // Fallback
    const fallbackAddress = `0x${provider.padEnd(64, '0')}`
    return fallbackAddress
  } catch (error) {
    console.error(`[zkLogin] Failed to connect ${provider} wallet:`, error)
    throw error
  }
}

export async function completeZkLogin(
  address: string,
  provider: AuthProvider = 'google'
): Promise<ZkLoginSession> {
  try {
    zkLoginSession = {
      address,
      provider,
      createdAt: Date.now(),
    }
    return zkLoginSession
  } catch (error) {
    console.error('[zkLogin] Failed to complete zkLogin:', error)
    throw error
  }
}

export function getZkLoginSession(): ZkLoginSession | null {
  return zkLoginSession
}

export function getUserAddress(): string | null {
  return zkLoginSession?.address || null
}

export function getProvider(): AuthProvider | null {
  return zkLoginSession?.provider || null
}

export function isZkLoginActive(): boolean {
  return zkLoginSession !== null && zkLoginSession.address !== null
}

/**
 * Get zkLogin proof data for SEAL integration (Phase 3)
 * Returns the zkLogin proof that SEAL will use to derive the master key
 */
export function getZkLoginProof(): {
  proofPoints: string
  issBase64Details: string
  headerBase64: string
  addressSeed: string
  address: string
  ephemeralPublicKey: string
  maxEpoch: number
} | null {
  if (!zkLoginSession) {
    return null
  }
  
  if (!zkLoginSession.proofPoints || !zkLoginSession.issBase64Details || !zkLoginSession.headerBase64) {
    console.error('[zkLogin] Session missing required proof data')
    return null
  }
  
  return {
    proofPoints: zkLoginSession.proofPoints,
    issBase64Details: zkLoginSession.issBase64Details,
    headerBase64: zkLoginSession.headerBase64,
    addressSeed: zkLoginSession.addressSeed || '',
    address: zkLoginSession.address,
    ephemeralPublicKey: zkLoginSession.ephemeralPublicKey || '',
    maxEpoch: zkLoginSession.maxEpoch || 0,
  }
}

export async function saveZkLoginSessionSecurely(): Promise<void> {
  try {
    if (!zkLoginSession) {
      throw new Error('No zkLogin session to save')
    }
    
    await chrome.storage.local.set({
      safekey_zklogin_session: zkLoginSession,
    })
  } catch (error) {
    console.error('[zkLogin] Failed to save session:', error)
    throw error
  }
}

export async function loadZkLoginSessionFromStorage(): Promise<ZkLoginSession | null> {
  try {
    const data = await chrome.storage.local.get('safekey_zklogin_session')
    if (data.safekey_zklogin_session) {
      const session = data.safekey_zklogin_session
      
      // Validate session structure
      if (typeof session === 'object' && session !== null && 'address' in session) {
        zkLoginSession = session as ZkLoginSession
        return zkLoginSession
      } else {
        // Corrupted session
        console.warn('[zkLogin] Corrupted session detected, clearing')
        await clearZkLoginFromStorage()
        return null
      }
    }
    return null
  } catch (error) {
    console.error('[zkLogin] Failed to load session:', error)
    return null
  }
}

export function logoutZkLogin(): void {
  zkLoginSession = null
}

export async function clearZkLoginFromStorage(): Promise<void> {
  try {
    await chrome.storage.local.remove('safekey_zklogin_session')
  } catch (error) {
    console.error('[zkLogin] Failed to clear session:', error)
  }
}

/**
 * Diagnostic function to check Enoki configuration and client ID registration
 * Can be called from browser console for debugging: await diagnoseEnokiSetup()
 */
export async function diagnoseEnokiSetup(): Promise<void> {
  console.log('[zkLogin] DIAGNOSTIC: Checking Enoki setup...')
  
  const apiKey = enokiApiKey
  const configuredGoogleClientId = configuredProviders.google?.clientId
  console.log('API Key:', apiKey ? `${apiKey.substring(0, 20)}...` : 'NOT SET')
  console.log('Google Client ID:', configuredGoogleClientId || 'NOT SET')
  
  try {
    const registered = await checkRegisteredClientIds()
    if (registered.google && registered.google.length > 0) {
      console.log('Google Client IDs registered:', registered.google)
    } else {
      console.log('NO Google Client IDs registered')
    }
    
    if (configuredGoogleClientId) {
      const isRegistered = registered.google?.includes(configuredGoogleClientId) || false
      if (!isRegistered) {
        console.error('Configured client ID is NOT registered with Enoki')
        console.error('Client ID to register:', configuredGoogleClientId)
        console.error('Portal: https://portal.enoki.mystenlabs.com')
      }
    }
  } catch (error) {
    console.error('Failed to check registration:', error)
  }
}

// Expose diagnostic function to window for easy console access in development
if (typeof window !== 'undefined') {
  (window as any).diagnoseEnokiSetup = diagnoseEnokiSetup
}
