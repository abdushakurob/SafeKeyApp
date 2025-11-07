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
      const account = await getWalletAccount(wallet, address)
      const result = await signTransactionFeature.signTransaction({ transaction: transactionBlock, account })
      return result.signature
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
  const params = { address: zkProof.address, packageId: DEFAULT_SEAL_PACKAGE_ID, sessionKey }
  let response: any = null
  if (typeof c.getEncryptedShare === 'function') response = await c.getEncryptedShare(params)
  else if (typeof c.fetchEncryptedShare === 'function') response = await c.fetchEncryptedShare(params)
  else if (typeof c.getShare === 'function') response = await c.getShare(params)
  else if (typeof c.fetchShare === 'function') response = await c.fetchShare(params)
  else if (typeof c.readShare === 'function') response = await c.readShare(params)
  else throw new Error('[SEAL] SealClient does not expose a share-fetch method; check your @mysten/seal SDK version')
  let encryptedShare: Uint8Array | undefined
  if (!response) throw new Error('[SEAL] No response when fetching encrypted share')
  if (response instanceof Uint8Array) encryptedShare = response
  else if (typeof response === 'string') encryptedShare = base64ToBytes(response)
  else if (response.encryptedShare) encryptedShare = response.encryptedShare instanceof Uint8Array ? response.encryptedShare : typeof response.encryptedShare === 'string' ? base64ToBytes(response.encryptedShare) : undefined
  else if (response.share) encryptedShare = response.share instanceof Uint8Array ? response.share : typeof response.share === 'string' ? base64ToBytes(response.share) : undefined
  if (!encryptedShare) throw new Error('[SEAL] Unable to normalize encrypted share from SealClient response')
  try { console.log('[SEAL] Encrypted share (base64):', bytesToBase64(encryptedShare)) } catch (e) {}
  return encryptedShare
}

function bytesToBase64(bytes: Uint8Array): string { let binary = ''; const len = bytes.byteLength; for (let i = 0; i < len; i++) binary += String.fromCharCode(bytes[i]); return btoa(binary) }
function base64ToBytes(b64: string): Uint8Array { const binary = atob(b64); const bytes = new Uint8Array(binary.length); for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i); return bytes }



/**
 * Derive master key (KM) from SEAL share and zkLogin proof
 * 
 * The master key is derived by:
 * 1. Decrypting the SEAL share using the SessionKey (authenticated with zkProof)
 * 2. Combining the decrypted share with the zkProof to reconstruct KM
 * 
 * @param sealShare - Encrypted SEAL share (from getSealShare)
 * @param zkProof - zkLogin proof data
 * @returns Master key (KM) as base64-encoded string
 */
export async function deriveKM(sealShare: Uint8Array, zkProof: ZkLoginProof): Promise<string> {
  try {
    getSealClient()
    await createSessionKeyFromZkProof(zkProof)
    void sealShare
    throw new Error('deriveKM not implemented: SEAL decryption must be implemented to derive KM securely.')
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
    if (cachedKM) return cachedKM
    if (!zkProof) {
      const proof = getZkLoginProof()
      if (!proof) throw new Error('No zkLogin proof available. Please login first.')
      zkProof = proof
    }
    const dummySealShare = new Uint8Array(0)
    const km = await deriveKM(dummySealShare, zkProof)
    cachedKM = km
    return km
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
 * Encrypt and store master key share using SEAL
 * This is called during initial setup to store the encrypted share in remote storage
 * 
 * @param km - Master key to encrypt and store
 * @param zkProof - zkLogin proof data
 * @param identity - Identity string (default: zkLogin address)
 * @param threshold - Threshold for TSS encryption (default: 1)
 * @returns blob ID (reference to stored encrypted share)
 */
export { testSealSessionKey } from './seal.test'

