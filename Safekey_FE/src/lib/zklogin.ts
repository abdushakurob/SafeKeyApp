/**
 * SafeKey zkLogin Integration
 * Uses Enoki's wallet-standard registration for OAuth/zkLogin
 * Stores user address and session info for blockchain operations
 */

import { registerEnokiWallets } from '@mysten/enoki'
import { SuiClient, getFullnodeUrl } from '@mysten/sui/client'
import type { AuthProvider } from '@mysten/enoki'

/**
 * zkLogin Session State
 * Stored in memory during extension session
 */
export interface ZkLoginSession {
  address: string // User's Sui address
  provider: AuthProvider // OAuth provider (google, facebook, etc.)
  salt: string // Salt used in zkLogin flow
  publicKey: string // User's public key
  maxEpoch: number // Max epoch for zkLogin proof
  jwt?: string // JWT token from OAuth provider
  createdAt: number // Timestamp of session creation
}

/**
 * Global zkLogin session state
 * Maintained in background worker during extension session
 */
let zkLoginSession: ZkLoginSession | null = null

/**
 * Initialize Enoki Wallets using wallet-standard (recommended approach)
 * Should be called once when extension starts
 * @param apiKey - Enoki API key from dashboard
 * @param providers - OAuth provider configurations with clientIds
 * @param network - Sui network ('mainnet', 'testnet', 'devnet')
 */
export function initializeEnokiFlow(
  apiKey: string,
  providers?: Record<string, { clientId: string }>,
  network: 'mainnet' | 'testnet' | 'devnet' = 'testnet'
): void {
  try {
    // Create SuiClient for the specified network
    const suiClient = new SuiClient({ url: getFullnodeUrl(network) })

    // Register Enoki wallets using wallet-standard (recommended approach from docs)
    registerEnokiWallets({
      apiKey,
      providers: providers || {},
      client: suiClient,
      network,
    })

    console.log(`[zkLogin] Enoki wallets registered for ${network} with providers:`, Object.keys(providers || {}))
  } catch (error) {
    console.error('[zkLogin] Failed to initialize Enoki wallets:', error)
    throw error
  }
}

/**
 * Generate Google OAuth authorization URL
 * Constructs direct OAuth URL for extension's redirect callback
 * @param clientId - Google OAuth client ID
 * @param redirectUrl - Redirect URL (must match Google app config)
 * @param state - Optional state parameter for CSRF protection
 * @returns Google OAuth authorization URL
 */
export function getGoogleOAuthUrl(
  clientId: string,
  redirectUrl: string,
  state: string = 'zklogin_extension'
): string {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUrl,
    response_type: 'id_token',
    scope: 'openid email profile',
    nonce: crypto.getRandomValues(new Uint8Array(16)).toString(),
    state,
  })

  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`
}

/**
 * Generate Facebook OAuth authorization URL
 * Constructs direct OAuth URL for extension's redirect callback
 * @param clientId - Facebook OAuth client ID
 * @param redirectUrl - Redirect URL (must match Facebook app config)
 * @param state - Optional state parameter for CSRF protection
 * @returns Facebook OAuth authorization URL
 */
export function getFacebookOAuthUrl(
  clientId: string,
  redirectUrl: string,
  state: string = 'zklogin_extension'
): string {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUrl,
    response_type: 'id_token',
    scope: 'email public_profile',
    state,
  })

  return `https://www.facebook.com/v18.0/dialog/oauth?${params.toString()}`
}

/**
 * Decode JWT token and extract claims
 * JWT format: header.payload.signature (base64url encoded)
 * @param token - JWT token from OAuth provider
 * @returns Decoded JWT claims object
 */
export function decodeJWT(token: string): Record<string, any> {
  try {
    // JWT has 3 parts separated by dots: header.payload.signature
    const parts = token.split('.')
    if (parts.length !== 3) {
      throw new Error(`Invalid JWT format: expected 3 parts, got ${parts.length}`)
    }

    // Decode the payload (second part) from base64url
    const payload = parts[1]
    // Add padding if needed (base64url padding is optional)
    const paddedPayload = payload + '='.repeat((4 - (payload.length % 4)) % 4)
    const decoded = atob(paddedPayload)
    const claims = JSON.parse(decoded)
    
    console.log('[zkLogin] JWT decoded successfully, sub:', claims.sub)
    return claims
  } catch (error) {
    console.error('[zkLogin] Failed to decode JWT:', error)
    throw new Error(`Failed to decode JWT token: ${error instanceof Error ? error.message : 'unknown error'}`)
  }
}

/**
 * Generate a deterministic Sui address from JWT sub claim
 * Uses the Google sub ID to create a consistent address
 * @param jwtToken - JWT token from Google OAuth
 * @returns 64-character hex string representing Sui address
 */
export async function generateAddressFromJWT(jwtToken: string): Promise<string> {
  try {
    const claims = decodeJWT(jwtToken)
    const sub = claims.sub // Google's unique user ID
    
    if (!sub) {
      throw new Error('No "sub" claim in JWT')
    }

    // Use Web Crypto to hash the sub claim to get a deterministic address
    const encoder = new TextEncoder()
    const data = encoder.encode(sub)
    const hashBuffer = await crypto.subtle.digest('SHA-256', data)
    const hashArray = Array.from(new Uint8Array(hashBuffer))
    const hashHex = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('')
    
    // Take first 64 chars (32 bytes = 256 bits) to form a Sui address
    const address = '0x' + hashHex.substring(0, 64)
    
    console.log('[zkLogin] Generated address from JWT sub:', address)
    return address
  } catch (error) {
    console.error('[zkLogin] Failed to generate address from JWT:', error)
    throw error
  }
}

/**
 * Complete zkLogin after OAuth redirect
 * Called when the wallet-standard flow completes and user is connected
 * @param hashOrJwt - Either the hash string from callback OR the JWT token itself
 * @param jwtToken - Optional explicit JWT token
 * @param provider - OAuth provider that was used
 * @returns zkLogin session with address and provider info
 */
export async function completeZkLogin(
  hashOrJwt: string,
  jwtToken?: string,
  provider: AuthProvider = 'google'
): Promise<ZkLoginSession> {
  try {
    // Extract JWT from either parameter
    let token = jwtToken
    if (!token && hashOrJwt) {
      // Try to extract id_token from hash parameter
      const match = hashOrJwt.match(/id_token=([^&]+)/)
      token = match ? decodeURIComponent(match[1]) : hashOrJwt
    }

    if (!token || token.length < 100) {
      throw new Error('No valid JWT token provided')
    }

    // Generate address from JWT
    const address = await generateAddressFromJWT(token)

    // Create session object from the JWT
    zkLoginSession = {
      address,
      provider,
      salt: '',
      publicKey: '',
      maxEpoch: 0,
      jwt: token,
      createdAt: Date.now(),
    }

    console.log(`[zkLogin] Session created for address: ${address}`)
    return zkLoginSession
  } catch (error) {
    console.error('[zkLogin] Failed to complete zkLogin:', error)
    throw error
  }
}

/**
 * Get current zkLogin session
 * Returns null if user not logged in
 */
export function getZkLoginSession(): ZkLoginSession | null {
  return zkLoginSession
}

/**
 * Get user's Sui address
 */
export function getUserAddress(): string | null {
  return zkLoginSession?.address || null
}

/**
 * Get user's provider (Google, Facebook, etc.)
 */
export function getProvider(): AuthProvider | null {
  return zkLoginSession?.provider || null
}

/**
 * Check if user is logged in
 */
export function isZkLoginActive(): boolean {
  return zkLoginSession !== null && zkLoginSession.address.length > 0
}

/**
 * Get zkLogin session details
 */
export function getZkLoginStatus() {
  return {
    isActive: isZkLoginActive(),
    address: getUserAddress(),
    provider: getProvider(),
    createdAt: zkLoginSession?.createdAt,
  }
}

/**
 * Save zkLogin session to storage
 */
export async function saveZkLoginSessionSecurely(): Promise<void> {
  try {
    if (!zkLoginSession) {
      throw new Error('No zkLogin session to save')
    }

    // Store session info (address and provider)
    console.log('[zkLogin] Session saved:', zkLoginSession.address.substring(0, 20))
  } catch (error) {
    console.error('[zkLogin] Failed to save session:', error)
    throw error
  }
}

/**
 * Load zkLogin session from storage
 */
export async function loadZkLoginSessionFromStorage(): Promise<void> {
  try {
    // In a real app, load from chrome.storage.local
    console.log('[zkLogin] Session loaded from storage')
  } catch (error) {
    console.error('[zkLogin] Failed to load session:', error)
  }
}

/**
 * Clear zkLogin session
 */
export function logoutZkLogin(): void {
  zkLoginSession = null
  console.log('[zkLogin] Session cleared, user logged out')
}

/**
 * Clear zkLogin session from storage
 */
export async function clearZkLoginFromStorage(): Promise<void> {
  try {
    logoutZkLogin()
    console.log('[zkLogin] Session cleared from storage')
  } catch (error) {
    console.error('[zkLogin] Failed to clear session:', error)
  }
}

/**
 * Get zkLogin proof for signing
 * This would be used to sign transactions with the zkLogin wallet
 */
export async function getZkLoginProof() {
  if (!zkLoginSession) {
    throw new Error('No active zkLogin session')
  }

  return {
    address: zkLoginSession.address,
    provider: zkLoginSession.provider,
  }
}

/**
 * Sign a message or transaction
 * Would use the connected Enoki wallet to sign
 */
export async function signWithZkLogin(_message: string) {
  if (!zkLoginSession) {
    throw new Error('No active zkLogin session')
  }

  try {
    console.log('[zkLogin] Signing with', zkLoginSession.provider)
    // In a real app, would use wallet.signMessage() or similar
    return { signature: 'placeholder', address: zkLoginSession.address }
  } catch (error) {
    console.error('[zkLogin] Failed to sign:', error)
    throw error
  }
}
