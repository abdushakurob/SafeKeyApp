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
    for (const wallet of enokiWallets) {
      walletRegistry.set(wallet.provider, wallet)
    }
  } catch (error) {
    console.error('[zkLogin] Failed to populate wallet registry:', error)
  }
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
    
    // Use session storage if available (Chrome), otherwise local (Firefox)
    const storage = chrome.storage.session || chrome.storage.local
    await storage.set({ zklogin_session_prep: sessionData })
    
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
    // Use session storage if available (Chrome), otherwise local (Firefox)
    const prepStorage = chrome.storage.session || chrome.storage.local
    const sessionData = await prepStorage.get('zklogin_session_prep')
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
    // Use session storage if available (Chrome), otherwise local (Firefox)
    const cleanupStorage = chrome.storage.session || chrome.storage.local
    await cleanupStorage.remove('zklogin_session_prep')
    
    return address
  } catch (error) {
    console.error(`[zkLogin] Failed to process OAuth JWT:`, error)
    throw error
  }
}

/**
 * Store Enoki session from current context's localStorage to chrome.storage.local
 * This allows other extension contexts (dashboard, background) to access the session
 * Call this in the popup after successful login
 */
/**
 * Verify Enoki session is stored in chrome.storage.local
 * Enoki stores its session directly in chrome.storage.local (not localStorage)
 * Since chrome.storage.local is shared across contexts, we just need to verify it exists
 */
export async function storeEnokiSessionForSharing(): Promise<void> {
  try {
    console.log('[zkLogin] Verifying Enoki session in chrome.storage.local...')
    
    // Enoki stores its session directly in chrome.storage.local
    // Check if the session keys exist
    const allStorage = await chrome.storage.local.get(null)
    const enokiKeys = Object.keys(allStorage).filter(key => 
      key === 'key' || 
      key === 'isEnabled' ||
      key.includes('enoki') ||
      key.includes('Enoki') ||
      key.includes('wallet-standard') ||
      key.includes('@mysten')
    )
    
    if (enokiKeys.length > 0) {
      console.log(`[zkLogin] ✅ Found ${enokiKeys.length} Enoki-related keys in chrome.storage.local:`, enokiKeys)
      console.log('[zkLogin] Enoki session is already stored and accessible across contexts')
    } else {
      console.warn('[zkLogin] ⚠️ No Enoki session keys found in chrome.storage.local')
      console.warn('[zkLogin] Enoki might not have stored its session yet')
    }
  } catch (error) {
    console.error('[zkLogin] Failed to verify Enoki session in chrome.storage.local:', error)
  }
}

/**
 * Check if Enoki session exists in chrome.storage.local
 * Enoki stores its session directly in chrome.storage.local (not localStorage)
 * Since chrome.storage.local is shared across contexts, the session should be accessible
 * We just need to ensure Enoki wallet is initialized and can read it
 */
async function checkEnokiSessionInStorage(): Promise<{ exists: boolean; keys: string[]; data?: any }> {
  try {
    console.log('[zkLogin] Checking for Enoki session in chrome.storage.local...')
    
    // Check for Enoki session keys in chrome.storage.local
    // Based on user feedback, Enoki stores: 'key', 'isEnabled', 'oauth_access_token', 'oauth_id_access_token', etc.
    const allStorage = await chrome.storage.local.get(null) // Get all keys
    console.log('[zkLogin] All keys in chrome.storage.local:', Object.keys(allStorage))
    
    const enokiKeys = Object.keys(allStorage).filter(key => 
      key === 'key' || 
      key === 'isEnabled' ||
      key === 'oauth_access_token' ||
      key === 'oauth_id_token' ||
      key === 'oauth_id_access_token' ||
      key.includes('enoki') ||
      key.includes('Enoki') ||
      key.includes('wallet-standard') ||
      key.includes('@mysten') ||
      key.includes('wallet')
    )
    
    if (enokiKeys.length > 0) {
      console.log(`[zkLogin] Found ${enokiKeys.length} Enoki-related keys in chrome.storage.local:`, enokiKeys)
      
      // Log the actual values for debugging
      const enokiData: Record<string, any> = {}
      for (const key of enokiKeys) {
        enokiData[key] = allStorage[key]
        console.log(`[zkLogin] Key "${key}":`, typeof allStorage[key] === 'string' ? 
          `${allStorage[key].substring(0, 50)}...` : allStorage[key])
      }
      
      // Check if 'key' exists (this is likely Enoki's session key)
      if (allStorage.key) {
        console.log('[zkLogin] ✅ Found Enoki session key in chrome.storage.local')
        return { exists: true, keys: enokiKeys, data: enokiData }
      }
      
      // Check if 'isEnabled' exists (indicates Enoki is active)
      if (allStorage.isEnabled) {
        console.log('[zkLogin] ✅ Found Enoki isEnabled flag in chrome.storage.local')
        return { exists: true, keys: enokiKeys, data: enokiData }
      }
      
      return { exists: true, keys: enokiKeys, data: enokiData }
    } else {
      console.log('[zkLogin] No Enoki-related keys found in chrome.storage.local')
    }
    
    return { exists: false, keys: [] }
  } catch (error) {
    console.warn('[zkLogin] Failed to check Enoki session in chrome.storage.local:', error)
    return { exists: false, keys: [] }
  }
}

/**
 * Restore Enoki session from stored idToken without opening OAuth popup
 * 
 * IMPORTANT: Enoki wallets store sessions in browser localStorage, which is NOT shared
 * across Chrome extension contexts (popup, dashboard, background). 
 * 
 * Strategy:
 * 1. Try to copy Enoki session from popup's localStorage (via chrome.storage)
 * 2. If that fails, verify idToken is valid
 * 3. Note: We cannot directly restore Enoki's session from idToken alone
 *    because Enoki's internal session structure is not exposed
 */
async function restoreEnokiSessionFromIdToken(
  wallet: EnokiWallet,
  provider: AuthProvider,
  idToken: string
): Promise<boolean> {
  try {
    console.log(`[zkLogin] Attempting to restore Enoki session from stored idToken for ${provider}...`)
    
    // Step 1: Check if Enoki session exists in chrome.storage.local
    // Enoki stores its session directly in chrome.storage.local (shared across contexts)
    const sessionCheck = await checkEnokiSessionInStorage()
    if (sessionCheck.exists) {
      // Session exists in storage, try to get it from wallet
      // The wallet should be able to read it since chrome.storage.local is shared
      // But we might need to trigger the wallet to read from storage
      try {
        // Try calling getSession - this should trigger Enoki to read from chrome.storage.local
        const sessionFeature = wallet.features['enoki:getSession']
        if (sessionFeature?.getSession) {
          const session = await sessionFeature.getSession()
          if (session && typeof session === 'object' && 'address' in session) {
            const sessionAddress = (session as Record<string, any>).address
            if (sessionAddress) {
              console.log('[zkLogin] ✅ Session found in chrome.storage.local and accessible via wallet')
              return true
            }
          }
        }
        
        // If getSession didn't work, try using standard:accounts
        // This might work if Enoki exposes accounts via wallet-standard
        console.log('[zkLogin] Session exists in storage but getSession returned nothing')
        console.log('[zkLogin] Trying standard:accounts to get account from wallet...')
        
        try {
          const accountsFeature = (wallet.features as any)['standard:accounts']
          if (accountsFeature?.getAccounts) {
            const accounts = await accountsFeature.getAccounts()
            console.log('[zkLogin] standard:accounts returned:', accounts)
            if (accounts && accounts.length > 0) {
              const account = accounts[0]
              if (account && account.address) {
                console.log('[zkLogin] ✅ Found account via standard:accounts:', account.address)
                // Account found - session is active
                return true
              }
            } else {
              console.log('[zkLogin] standard:accounts returned empty array')
            }
          } else {
            console.log('[zkLogin] Wallet does not support standard:accounts feature')
          }
        } catch (accountsError) {
          console.warn('[zkLogin] standard:accounts failed:', accountsError)
        }
        
        // Try to manually trigger Enoki to read from storage
        // Enoki might need to be re-initialized or the wallet instance needs to be refreshed
        console.log('[zkLogin] Attempting to manually trigger Enoki to read from storage...')
        const walletAny = wallet as any
        
        // Check if wallet has internal methods to load from storage
        if (walletAny._loadFromStorage || walletAny.loadFromStorage || walletAny._initialize) {
          try {
            console.log('[zkLogin] Found internal load methods, attempting to call...')
            await walletAny._loadFromStorage?.() || walletAny.loadFromStorage?.() || walletAny._initialize?.()
            
            // Wait a bit for async operations
            await new Promise(resolve => setTimeout(resolve, 500))
            
            // Check session again
            const sessionFeature2 = wallet.features['enoki:getSession']
            if (sessionFeature2?.getSession) {
              const session2 = await sessionFeature2.getSession()
              if (session2 && typeof session2 === 'object' && 'address' in session2) {
                const sessionAddress2 = (session2 as Record<string, any>).address
                if (sessionAddress2) {
                  console.log('[zkLogin] ✅ Session restored after manual load')
                  return true
                }
              }
            }
          } catch (loadError) {
            console.warn('[zkLogin] Manual load failed:', loadError)
          }
        }
        
        // Try to access wallet's internal state or trigger a refresh
        // Note: This is a workaround - Enoki SDK might not expose this
        
        // Check if wallet has any methods to refresh/restore session
        if (walletAny._refreshSession || walletAny.refreshSession) {
          try {
            console.log('[zkLogin] Trying to refresh wallet session...')
            await walletAny._refreshSession?.() || walletAny.refreshSession?.()
            
            // Check session again
            const sessionFeature2 = wallet.features['enoki:getSession']
            if (sessionFeature2?.getSession) {
              const session2 = await sessionFeature2.getSession()
              if (session2 && typeof session2 === 'object' && 'address' in session2) {
                const sessionAddress2 = (session2 as Record<string, any>).address
                if (sessionAddress2) {
                  console.log('[zkLogin] ✅ Session restored after refresh')
                  return true
                }
              }
            }
          } catch (refreshError) {
            console.warn('[zkLogin] Refresh failed:', refreshError)
          }
        }
        
        // If nothing worked, the session might not be accessible
        // This is a limitation - Enoki might need to be initialized in the same context
        console.warn('[zkLogin] ⚠️ Cannot restore session - Enoki wallet might need to be initialized in popup context')
      } catch (e) {
        console.warn('[zkLogin] Session exists in storage but wallet cannot access it:', e)
        // Continue to next step
      }
    }
    
    // Step 2: Verify idToken is still valid
    try {
      const addressResponse = await fetch(`${ENOKI_API_BASE}/v1/zklogin`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${enokiApiKey}`,
          'zklogin-jwt': idToken,
        },
      })
      
      if (!addressResponse.ok) {
        console.warn(`[zkLogin] idToken validation failed: ${addressResponse.status}`)
        return false
      }
      
      const addressData = await addressResponse.json()
      const address = addressData.data?.address
      
      if (!address) {
        console.warn('[zkLogin] No address returned from Enoki API')
        return false
      }
      
      console.log(`[zkLogin] ✅ idToken is valid, address: ${address}`)
      // Note: We have a valid idToken, but we cannot restore Enoki's session from it
      // because Enoki's internal session structure is not exposed by the SDK
      // The session must be restored in the same context where it was created
      
      return false
    } catch (apiError) {
      console.warn('[zkLogin] Failed to validate idToken with Enoki API:', apiError)
      return false
    }
  } catch (error) {
    console.error('[zkLogin] Failed to restore Enoki session:', error)
    return false
  }
}

export async function connectEnokiWallet(
  provider: AuthProvider,
  idToken?: string
): Promise<string> {
  try {
    const wallet = getEnokiWallet(provider)
    if (!wallet) {
      throw new Error(`Enoki wallet for ${provider} not found`)
    }
    
    // Step 1: Check if session already exists (no popup needed)
    // Try multiple methods to check for active session
    try {
      // Method 1: Try enoki:getSession
      const sessionFeature = wallet.features['enoki:getSession']
      if (sessionFeature && typeof sessionFeature.getSession === 'function') {
        const session = await sessionFeature.getSession()
        if (session && typeof session === 'object' && 'address' in session) {
          const sessionAddress = (session as Record<string, any>).address
          if (sessionAddress) {
            console.log('[zkLogin] ✅ Session already active (via enoki:getSession), no popup needed')
            return sessionAddress as string
          }
        }
      }
    } catch (e) {
      // Continue to next method
    }
    
    // Method 2: Try standard:accounts (wallet-standard)
    try {
      const accountsFeature = (wallet.features as any)['standard:accounts']
      if (accountsFeature && typeof accountsFeature.getAccounts === 'function') {
        const accounts = await accountsFeature.getAccounts()
        if (accounts && accounts.length > 0) {
          const account = accounts[0]
          if (account && account.address) {
            console.log('[zkLogin] ✅ Session already active (via standard:accounts), no popup needed')
            return account.address
          }
        }
      }
    } catch (e) {
      // Continue to restoration
    }
    
    // Step 2: If no session but idToken provided, try to restore silently
    if (idToken) {
      console.log('[zkLogin] No active session found, attempting to restore from stored idToken...')
      const restored = await restoreEnokiSessionFromIdToken(wallet, provider, idToken)
      
      if (restored) {
        // Check session again after restoration
        try {
          const sessionFeature = wallet.features['enoki:getSession']
          if (sessionFeature?.getSession) {
            const session = await sessionFeature.getSession()
            if (session && typeof session === 'object' && 'address' in session) {
              const sessionAddress = (session as Record<string, any>).address
              if (sessionAddress) {
                console.log('[zkLogin] ✅ Session restored successfully, no popup needed')
                return sessionAddress as string
              }
            }
          }
        } catch (e) {
          // Continue to connect
        }
      }
    }
    
    // Step 3: If no idToken provided, try loading from storage
    if (!idToken) {
      try {
        const storedSession = await loadZkLoginSessionFromStorage()
        if (storedSession?.idToken && storedSession.provider === provider) {
          console.log('[zkLogin] Found stored session, attempting to restore...')
          const restored = await restoreEnokiSessionFromIdToken(wallet, provider, storedSession.idToken)
          
          if (restored) {
            try {
              const sessionFeature = wallet.features['enoki:getSession']
              if (sessionFeature?.getSession) {
                const session = await sessionFeature.getSession()
                if (session && typeof session === 'object' && 'address' in session) {
                  const sessionAddress = (session as Record<string, any>).address
                  if (sessionAddress) {
                    console.log('[zkLogin] ✅ Session restored from storage, no popup needed')
                    return sessionAddress as string
                  }
                }
              }
            } catch (e) {
              // Continue to connect
            }
          }
        }
      } catch (e) {
        console.warn('[zkLogin] Could not load session from storage:', e)
      }
    }
    
    // Step 4: Only if no session exists and restoration failed
    // IMPORTANT: We should NEVER call standard:connect from dashboard/background contexts
    // because it will open an OAuth popup, which Google blocks for extensions (localhost redirect URI)
    
    // Check if we're in popup context (where OAuth is allowed)
    const isPopupContext = typeof window !== 'undefined' && (
      window.location.pathname.includes('popup.html') ||
      window.location.pathname.includes('popup') ||
      window.location.href.includes('popup')
    )
    
    // Check if we have a stored session (meaning user is logged in)
    const storedSession = await loadZkLoginSessionFromStorage()
    const hasStoredSession = idToken || storedSession?.idToken
    
    // Check if Enoki session exists in chrome.storage.local
    const sessionCheck = await checkEnokiSessionInStorage()
    const hasEnokiSessionInStorage = sessionCheck.exists
    
    // CRITICAL: standard:connect ALWAYS opens a popup, even if session exists in storage.
    // Enoki wallet instances in different contexts (popup vs dashboard) don't share session state.
    // The session exists in chrome.storage.local, but the wallet instance can't read it.
    // 
    // SOLUTION: We need to manually restore the session by setting Enoki's internal state
    // using the stored oauth_id_token and oauth_access_token.
    
    if (hasStoredSession || hasEnokiSessionInStorage) {
      // Session exists in storage - try to manually restore it
      console.log('[zkLogin] Session exists in storage, attempting manual restoration...')
      
      // Get the stored tokens from chrome.storage.local
      const allStorage = await chrome.storage.local.get(null)
      const oauthIdToken = allStorage.oauth_id_token
      const oauthAccessToken = allStorage.oauth_access_token
      
      if (oauthIdToken) {
        console.log('[zkLogin] Found oauth_id_token in storage, attempting to restore session...')
        
        // Try to manually set Enoki's internal session state
        // Enoki wallet might have internal methods to restore from tokens
        const walletAny = wallet as any
        
        // Check if wallet has methods to restore session from tokens
        if (walletAny._restoreSession || walletAny.restoreSession || walletAny._setSession) {
          try {
            console.log('[zkLogin] Found restore methods, attempting to restore...')
            if (walletAny._restoreSession) {
              await walletAny._restoreSession({ idToken: oauthIdToken, accessToken: oauthAccessToken })
            } else if (walletAny.restoreSession) {
              await walletAny.restoreSession({ idToken: oauthIdToken, accessToken: oauthAccessToken })
            } else if (walletAny._setSession) {
              await walletAny._setSession({ idToken: oauthIdToken, accessToken: oauthAccessToken })
            }
            
            // Wait a bit for session to be restored
            await new Promise(resolve => setTimeout(resolve, 500))
            
            // Check if session is now available
            const sessionFeature = wallet.features['enoki:getSession']
            if (sessionFeature?.getSession) {
              const session = await sessionFeature.getSession()
              if (session && typeof session === 'object' && 'address' in session) {
                const sessionAddress = (session as Record<string, any>).address
                if (sessionAddress) {
                  console.log('[zkLogin] ✅ Session restored manually from stored tokens')
                  return sessionAddress as string
                }
              }
            }
          } catch (restoreError) {
            console.warn('[zkLogin] Manual restore failed:', restoreError)
          }
        }
        
        // If manual restore didn't work, we need to use the stored idToken
        // to get the address and construct a minimal session
        // But Enoki needs the full session structure, not just the address
        console.warn('[zkLogin] ⚠️ Cannot restore Enoki session - wallet does not expose restore methods')
        console.warn('[zkLogin] Session exists in storage but wallet cannot access it in this context')
        throw new Error(
          'Enoki session exists in storage but cannot be restored in dashboard context. ' +
          'Please perform this action from the extension popup where the session is active.'
        )
      }
    }
    
    // No session in storage - only allow connect in popup context
    if (!isPopupContext) {
      throw new Error(
        'No Enoki session found. Please login from the extension popup first. ' +
        'OAuth popups cannot be opened from dashboard/background contexts due to Google security restrictions.'
      )
    }
    
    console.warn('[zkLogin] ⚠️ No session found. Opening OAuth popup for first login...')
    console.warn('[zkLogin] This should only happen on first login in popup context.')
    
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
      
      // After connect, check session again
      const sessionFeature = wallet.features['enoki:getSession']
      if (sessionFeature?.getSession) {
        const session = await sessionFeature.getSession()
        if (session && typeof session === 'object' && 'address' in session) {
          const sessionAddress = (session as Record<string, any>).address
          if (sessionAddress) {
            return sessionAddress as string
          }
        }
      }
    } catch (connectError) {
      console.error('[zkLogin] Failed to connect wallet:', connectError)
      throw new Error(`Failed to connect ${provider} wallet: ${connectError instanceof Error ? connectError.message : String(connectError)}`)
    }
    
    // Fallback: Try getting metadata
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
    
    // Final fallback
    throw new Error(`Failed to connect ${provider} wallet: No session or address available`)
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
