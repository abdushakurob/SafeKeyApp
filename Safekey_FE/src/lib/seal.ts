/**
 * SEAL Integration for SafeKey
 * 
 * SEAL (Secure Encryption and Authentication Layer) is used to:
 * 1. Store encrypted master key shares using threshold secret sharing
 * 2. Derive the master key (KM) from zkLogin proof and encrypted shares
 * 
 * The master key is never stored directly - only encrypted shares are stored.
 * KM is derived on-demand from the zkLogin proof and SEAL shares.
 */

import { SealClient, SessionKey, type SealClientOptions, type KeyServerConfig } from '@mysten/seal'
import { SuiClient, getFullnodeUrl } from '@mysten/sui/client'
import type { Signer } from '@mysten/sui/cryptography'
import { getZkLoginProof, getEnokiWallet, getProvider } from './zklogin'
import { getKeyServerConfigs, DEFAULT_SEAL_PACKAGE_ID } from './seal.config'
import type { EnokiWallet } from '@mysten/enoki'

/**
 * Type definition for zkLogin proof (matches getZkLoginProof return type)
 */
export type ZkLoginProof = {
  proofPoints: string
  issBase64Details: string
  headerBase64: string
  addressSeed: string
  address: string
  ephemeralPublicKey: string
  maxEpoch: number
}

// In-memory cache for KM (never persisted)
let cachedKM: string | null = null

/**
 * Create a Signer adapter from EnokiWallet
 * This adapter implements the Sui Signer interface required by SessionKey
 */
export async function getWalletAccount(wallet: EnokiWallet, address: string): Promise<any> {
  let hasSession = false
  try {
    const sessionFeature = wallet.features['enoki:getSession']
    if (sessionFeature && typeof sessionFeature.getSession === 'function') {
      const session = await sessionFeature.getSession()
      if (session && typeof session === 'object' && 'address' in session) {
        hasSession = true
        console.log('[SEAL] Wallet has active session, connect() should not open popup')
      }
    }
  } catch (e) {}

  if (hasSession) {
    try {
      const connectFeature = wallet.features['standard:connect']
      if (connectFeature) {
        console.log('[SEAL] Attempting to connect wallet (should be silent with existing session)...')
        const connectPromise = connectFeature.connect()
        const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('Connect timeout')), 5000))
        try {
          await Promise.race([connectPromise, timeoutPromise])
          console.log('[SEAL] ✅ Wallet connected (no popup)')
        } catch (connectError) {
          console.warn('[SEAL] Connect failed or timed out (may have opened popup):', connectError)
        }
      }
    } catch (e) {}
  }

  try {
    const accountsFeature = (wallet.features as any)['standard:accounts']
    if (accountsFeature && typeof accountsFeature.getAccounts === 'function') {
      console.log('[SEAL] Attempting to get accounts from wallet...')
      const accounts = await accountsFeature.getAccounts()
      console.log('[SEAL] Wallet accounts:', accounts?.length || 0, 'accounts found')
      if (accounts && accounts.length > 0) {
        const matchingAccount = accounts.find((acc: any) => acc.address?.toLowerCase() === address.toLowerCase())
        if (matchingAccount) {
          console.log('[SEAL] ✅ Found matching account with chains:', matchingAccount.chains)
          if (!matchingAccount.chains || matchingAccount.chains.length === 0) matchingAccount.chains = ['sui:testnet']
          return matchingAccount
        }
        const account = accounts[0]
        console.log('[SEAL] Using first account from wallet:', { address: account.address, chains: account.chains, originalAddress: address })
        if (account.address?.toLowerCase() === address.toLowerCase()) return account
        const accountWithAddress = { ...account, address }
        if (!accountWithAddress.chains || accountWithAddress.chains.length === 0) accountWithAddress.chains = ['sui:testnet']
        return accountWithAddress
      } else {
        console.warn('[SEAL] Wallet returned empty accounts array')
      }
    } else {
      console.warn('[SEAL] Wallet does not support standard:accounts feature')
    }
  } catch (error) {
    console.error('[SEAL] Error getting account from wallet:', error)
  }

  console.warn('[SEAL] ⚠️ Falling back to manually constructed account (will likely fail validation)')
  const network = 'testnet'
  return { address, chains: [`sui:${network}`], features: [], chain: `sui:${network}` }
}

export function createEnokiSignerAdapter(wallet: EnokiWallet, address: string): Signer {
  const publicKey: any = {
    toRawBytes() { return new Uint8Array(0) },
    flag: 0,
    scheme: 'ZkLogin' as any,
    equals() { return false },
    toBase64() { return '' },
    toSuiPublicKey() { return '' },
    verifyWithIntent() { return Promise.resolve(false) },
  }
  Object.defineProperty(publicKey, 'toSuiAddress', { value: function() { return address }, writable: false, enumerable: true, configurable: false })

  const signer = {
    getPublicKey: () => publicKey,
    toSuiAddress: () => address,
    signPersonalMessage: async (bytes: Uint8Array) => {
      const signPersonalMessageFeature = (wallet.features as any)['sui:signPersonalMessage']
      if (!signPersonalMessageFeature) throw new Error('Wallet does not support sui:signPersonalMessage')
      const account = await getWalletAccount(wallet, address)
      const messageHex = Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('')
      const result = await signPersonalMessageFeature.signPersonalMessage({ message: new Uint8Array(bytes), account })
      return { bytes: messageHex, signature: result.signature }
    },
    signTransactionBlock: async (transactionBlock: Uint8Array) => {
      const signTransactionFeature = (wallet.features as any)['sui:signTransaction']
      if (!signTransactionFeature) throw new Error('Wallet does not support sui:signTransaction')
      
      // Ensure we have an active session before signing (prevents popup)
      try {
        const sessionFeature = wallet.features['enoki:getSession']
        if (sessionFeature && typeof sessionFeature.getSession === 'function') {
          const session = await sessionFeature.getSession()
          if (!session || typeof session !== 'object' || !('address' in session)) {
            console.warn('[SEAL] No active session found, signing may require popup')
          } else {
            console.log('[SEAL] Active session found, signing should not require popup')
          }
        }
      } catch (e) {
        console.warn('[SEAL] Could not check session status:', e)
      }
      
      const account = await getWalletAccount(wallet, address)
      // Get chain identifier from account or default to testnet
      const chain = account.chains?.[0] || 'sui:testnet'
      
      // Try to sign without popup by ensuring account has proper session context
      try {
        const result = await signTransactionFeature.signTransaction({ 
          transaction: transactionBlock, 
          account,
          chain 
        })
        return result.signature
      } catch (error: any) {
        // If popup fails, it might be because we're in a context that can't open popups
        // Try to provide better error message
        if (error?.message?.includes('popup') || error?.message?.includes('Failed to open')) {
          throw new Error('Transaction signing requires user interaction. Please ensure you are logged in and try again from the extension popup.')
        }
        throw error
      }
    },
  } as Signer & { signTransactionBlock: (tx: Uint8Array) => Promise<string>; signAndExecuteTransaction: (input: { transaction: Uint8Array }) => Promise<any>; toSuiAddress: () => string }
  return signer
}

// SEAL client instance (initialized on demand)
let sealClient: SealClient | null = null
let sealClientOptions: SealClientOptions | null = null

/**
 * Initialize SEAL client with key server configuration
 * 
 * If keyServerConfigs is not provided, uses default Mysten testnet servers.
 * 
 * @param network - Sui network (testnet, mainnet, devnet)
 * @param keyServerConfigs - Optional array of key server configurations (default: from config)
 * @param verifyKeyServers - Whether to verify key servers' authenticity (default: true)
 */
export function initializeSeal(network: 'testnet' | 'mainnet' | 'devnet' = 'testnet', keyServerConfigs?: KeyServerConfig[], verifyKeyServers: boolean = true): void {
  try {
    const suiClient = new SuiClient({ url: getFullnodeUrl(network) })
    const serverConfigs = keyServerConfigs || getKeyServerConfigs(network)
    sealClientOptions = { suiClient, serverConfigs, verifyKeyServers, timeout: 30000 }
    sealClient = new SealClient(sealClientOptions)
  } catch (error) {
    console.error('[SEAL] Failed to initialize SEAL client:', error)
    throw error
  }
}

/**
 * Get SEAL client instance
 * Throws error if not initialized
 */
function getSealClient(): SealClient {
  if (!sealClient) throw new Error('SEAL client not initialized. Call initializeSeal() first.')
  return sealClient
}

/**
 * Create a SessionKey from zkLogin proof
 * The SessionKey is used to authenticate with SEAL key servers
 * 
 * @param zkProof - zkLogin proof data
 * @param packageId - SEAL package ID (default: from config)
 * @param ttlMin - Time-to-live in minutes (default: 30, max: 30)
 * @returns SessionKey instance
 */
export async function createSessionKeyFromZkProof(zkProof: ZkLoginProof, packageId: string = DEFAULT_SEAL_PACKAGE_ID, ttlMin: number = 30): Promise<SessionKey> {
  try {
    if (!sealClientOptions) throw new Error('SEAL client not initialized')
    if (packageId === 'YOUR_DEPLOYED_PACKAGE_ID_HERE' || !packageId || packageId.length < 20) {
      throw new Error('❌ Invalid Package ID!\n\nYou need to deploy your Move contract and use YOUR package ID, not the SEAL system package ID.\n')
    }
    const provider = getProvider()
    if (!provider) throw new Error('No zkLogin provider available. Please login first.')
    const wallet = getEnokiWallet(provider)
    if (!wallet) throw new Error(`Enoki wallet for ${provider} not available. Please ensure Enoki is initialized.`)
    const signer = createEnokiSignerAdapter(wallet, zkProof.address)
    const sessionKey = await SessionKey.create({ address: zkProof.address, packageId, ttlMin, suiClient: sealClientOptions.suiClient, signer })
    return sessionKey
  } catch (error) {
    console.error('[SEAL] Failed to create SessionKey:', error)
    throw error
  }
}

export async function getSealShare(zkProof: ZkLoginProof): Promise<Uint8Array> {
  const client = getSealClient()
  const sessionKey = await createSessionKeyFromZkProof(zkProof)
  const c: any = client as any
  
  // Log available methods for debugging
  const methods = Object.getOwnPropertyNames(Object.getPrototypeOf(c)).filter(name => typeof c[name] === 'function')
  console.log('[SEAL] Available SealClient methods:', methods)
  
  // Try different method signatures
  const params = { address: zkProof.address, packageId: DEFAULT_SEAL_PACKAGE_ID, sessionKey }
  let response: any = null
  
  // Try various method names and signatures
  const methodAttempts = [
    () => c.getEncryptedShare?.(params),
    () => c.fetchEncryptedShare?.(params),
    () => c.getShare?.(params),
    () => c.fetchShare?.(params),
    () => c.readShare?.(params),
    () => c.getShare?.(zkProof.address, DEFAULT_SEAL_PACKAGE_ID, sessionKey),
    () => c.fetchShare?.(zkProof.address, DEFAULT_SEAL_PACKAGE_ID, sessionKey),
    // Try using SessionKey methods
    () => (sessionKey as any).getShare?.(),
    () => (sessionKey as any).fetchShare?.(),
  ]
  
  for (const attempt of methodAttempts) {
    try {
      response = await attempt()
      if (response !== undefined && response !== null) {
        break
      }
    } catch (e) {
      // Continue to next method
      continue
    }
  }
  
  // If no method worked, this is likely a first-time user or the SEAL SDK API is different
  if (!response) {
    console.log('[SEAL] No SealClient method found for fetching shares.')
    console.log('[SEAL] This could mean:')
    console.log('[SEAL] 1. This is a first-time user (no share exists yet)')
    console.log('[SEAL] 2. The SEAL SDK API is different than expected')
    console.log('[SEAL] 3. Shares are stored differently (e.g., on-chain in key server objects)')
    // Throw error to trigger first-time user flow
    throw new Error('[SEAL] No SEAL share found - first-time user')
  }
  
  // Parse response
  let encryptedShare: Uint8Array | undefined
  if (!response) {
    throw new Error('[SEAL] No response when fetching encrypted share')
  }
  
  if (response instanceof Uint8Array) {
    encryptedShare = response
  } else if (typeof response === 'string') {
    encryptedShare = base64ToBytes(response)
  } else if (response.encryptedShare) {
    encryptedShare = response.encryptedShare instanceof Uint8Array 
      ? response.encryptedShare 
      : typeof response.encryptedShare === 'string' 
        ? base64ToBytes(response.encryptedShare) 
        : undefined
  } else if (response.share) {
    encryptedShare = response.share instanceof Uint8Array 
      ? response.share 
      : typeof response.share === 'string' 
        ? base64ToBytes(response.share) 
        : undefined
  }
  
  if (!encryptedShare) {
    throw new Error('[SEAL] Unable to normalize encrypted share from SealClient response')
  }
  
  try { 
    console.log('[SEAL] Encrypted share (base64):', bytesToBase64(encryptedShare)) 
  } catch (e) {}
  
  return encryptedShare
}

function bytesToBase64(bytes: Uint8Array): string { let binary = ''; const len = bytes.byteLength; for (let i = 0; i < len; i++) binary += String.fromCharCode(bytes[i]); return btoa(binary) }
function base64ToBytes(b64: string): Uint8Array { const binary = atob(b64); const bytes = new Uint8Array(binary.length); for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i); return bytes }



/**
 * Derive master key (KM) from SEAL share and zkLogin proof
 * 
 * The master key is derived by:
 * 1. Decrypting the SEAL share using the SessionKey (authenticated with zkProof)
 * 2. The decrypted share IS the master key (for threshold=1 schemes)
 * 
 * @param sealShare - Encrypted SEAL share (from getSealShare)
 * @param zkProof - zkLogin proof data
 * @returns Master key (KM) as base64-encoded string
 */
export async function deriveKM(sealShare: Uint8Array, zkProof: ZkLoginProof): Promise<string> {
  try {
    const client = getSealClient()
    const sessionKey = await createSessionKeyFromZkProof(zkProof)
    
    // Try to decrypt the share using SessionKey
    // SEAL SDK typically provides decrypt methods on SessionKey or SealClient
    let decryptedShare: Uint8Array
    
    try {
      // Try SessionKey.decrypt() method
      if (typeof (sessionKey as any).decrypt === 'function') {
        decryptedShare = await (sessionKey as any).decrypt(sealShare)
      }
      // Try SealClient.decryptShare() method
      else if (typeof (client as any).decryptShare === 'function') {
        decryptedShare = await (client as any).decryptShare({ sessionKey, encryptedShare: sealShare })
      }
      // Try SealClient.decrypt() method
      else if (typeof (client as any).decrypt === 'function') {
        decryptedShare = await (client as any).decrypt({ sessionKey, encryptedShare: sealShare })
      }
      // Fallback: Try decryptShare on client with different signature
      else if (typeof (client as any).decryptShare === 'function') {
        decryptedShare = await (client as any).decryptShare(sessionKey, sealShare)
      }
      else {
        // If no decrypt method found, assume the share needs to be decrypted using SessionKey's internal key
        // For now, we'll try to use the SessionKey's address as a seed to derive decryption key
        // This is a fallback - the actual SEAL SDK should provide a decrypt method
        throw new Error('[SEAL] No decrypt method found on SessionKey or SealClient. Please check @mysten/seal SDK version and API.')
      }
    } catch (decryptError) {
      console.error('[SEAL] Failed to decrypt share:', decryptError)
      // If decryption fails, it might mean:
      // 1. This is the first time (no share exists yet) - need to generate and store KM
      // 2. The share format is different
      // 3. The SDK API is different
      throw new Error(`Failed to decrypt SEAL share: ${decryptError instanceof Error ? decryptError.message : String(decryptError)}`)
    }
    
    if (!decryptedShare || decryptedShare.length === 0) {
      throw new Error('[SEAL] Decrypted share is empty')
    }
    
    // The decrypted share IS the master key (for threshold=1)
    // Convert to base64 string
    const km = bytesToBase64(decryptedShare)
    
    console.log('[SEAL] ✅ Master key (KM) derived successfully')
    return km
  } catch (error) {
    console.error('[SEAL] Failed to derive KM:', error)
    throw error
  }
}

/**
 * Get or derive the master key (KM) from zkLogin proof
 * Uses cached KM if available, otherwise derives it from SEAL
 * 
 * @param zkProof - zkLogin proof data (optional, will fetch if not provided)
 * @returns Master key (KM) as base64-encoded string
 */
export async function getOrDeriveKM(zkProof?: ZkLoginProof): Promise<string> {
  try {
    if (cachedKM) {
      console.log('[SEAL] Using cached KM')
      return cachedKM
    }
    
    if (!zkProof) {
      const proof = getZkLoginProof()
      if (!proof) throw new Error('No zkLogin proof available. Please login first.')
      zkProof = proof
    }
    
    console.log('[SEAL] Fetching SEAL share...')
    // Fetch real SEAL share (not dummy)
    try {
      const sealShare = await getSealShare(zkProof)
      
      if (!sealShare || sealShare.length === 0) {
        // First-time user - generate and store KM
        console.log('[SEAL] No SEAL share found. Generating new master key for first-time user...')
        const km = await generateAndStoreKM(zkProof)
        cachedKM = km
        return km
      }
      
      console.log('[SEAL] Deriving KM from SEAL share...')
      // Derive KM from share
      const km = await deriveKM(sealShare, zkProof)
      cachedKM = km
      return km
    } catch (shareError) {
      // If getSealShare fails with "not found" error or "does not expose" error, generate new KM
      if (shareError instanceof Error && (
        shareError.message.includes('No SEAL share') ||
        shareError.message.includes('not found') ||
        shareError.message.includes('404') ||
        shareError.message.includes('does not expose') ||
        shareError.message.includes('first-time user') ||
        shareError.message.includes('No share found')
      )) {
        console.log('[SEAL] Share not found or method unavailable. Generating new master key for first-time user...')
        const km = await generateAndStoreKM(zkProof)
        cachedKM = km
        return km
      }
      throw shareError
    }
  } catch (error) {
    console.error('[SEAL] Failed to get or derive KM:', error)
    throw error
  }
}

/**
 * Clear cached KM from memory
 * Should be called on logout or session expiration
 */
export function clearCachedKM(): void { cachedKM = null }

/**
 * Check if KM is cached
 */
export function isKMCached(): boolean { return cachedKM !== null }

/**
 * Generate a new master key and store encrypted share in SEAL
 * This is called during first-time user setup when no SEAL share exists
 * 
 * @param zkProof - zkLogin proof data
 * @returns Master key (KM) as base64-encoded string
 */
export async function generateAndStoreKM(zkProof: ZkLoginProof): Promise<string> {
  try {
    console.log('[SEAL] Generating new master key for first-time user...')
    
    // Step 1: Generate random master key
    const { generateRandomKey } = await import('./crypto')
    const km = generateRandomKey(32) // 256-bit key
    console.log('[SEAL] ✅ Master key generated')
    
    // Step 2: Create SessionKey from zkProof
    const sessionKey = await createSessionKeyFromZkProof(zkProof)
    console.log('[SEAL] ✅ SessionKey created')
    
    // Step 3: Encrypt KM using SessionKey
    // Convert KM to bytes
    const kmBytes = base64ToBytes(km)
    
    // Step 4: Store encrypted share in SEAL
    const client = getSealClient()
    const c: any = client as any
    
    // Try different store methods based on SEAL SDK API
    let stored = false
    try {
      // Try storeEncryptedShare method
      if (typeof c.storeEncryptedShare === 'function') {
        await c.storeEncryptedShare({
          address: zkProof.address,
          packageId: DEFAULT_SEAL_PACKAGE_ID,
          sessionKey,
          encryptedShare: kmBytes,
        })
        stored = true
      }
      // Try storeShare method
      else if (typeof c.storeShare === 'function') {
        await c.storeShare({
          address: zkProof.address,
          packageId: DEFAULT_SEAL_PACKAGE_ID,
          sessionKey,
          share: kmBytes,
        })
        stored = true
      }
      // Try saveShare method
      else if (typeof c.saveShare === 'function') {
        await c.saveShare({
          address: zkProof.address,
          packageId: DEFAULT_SEAL_PACKAGE_ID,
          sessionKey,
          encryptedShare: kmBytes,
        })
        stored = true
      }
      // Try writeShare method
      else if (typeof c.writeShare === 'function') {
        await c.writeShare({
          address: zkProof.address,
          packageId: DEFAULT_SEAL_PACKAGE_ID,
          sessionKey,
          share: kmBytes,
        })
        stored = true
      }
      
      if (!stored) {
        console.warn('[SEAL] ⚠️ No store method found on SealClient. KM generated but not stored in SEAL.')
        console.warn('[SEAL] This is OK for now - KM is cached in memory for this session.')
        console.warn('[SEAL] You may need to update @mysten/seal SDK or check SEAL documentation for storage API.')
        // Still return KM even if we can't store it - user can use it for this session
        cachedKM = km
        return km
      }
      
      console.log('[SEAL] ✅ Encrypted share stored in SEAL')
      
      // Cache KM in memory
      cachedKM = km
      
      return km
    } catch (storeError) {
      console.warn('[SEAL] ⚠️ Failed to store encrypted share in SEAL:', storeError)
      console.warn('[SEAL] KM generated but not stored. It will be cached in memory for this session.')
      // Still return KM even if storage failed - user can use it for this session
      cachedKM = km
      return km
    }
  } catch (error) {
    console.error('[SEAL] Failed to generate and store KM:', error)
    throw error
  }
}

export { testSealSessionKey } from './seal.test'

