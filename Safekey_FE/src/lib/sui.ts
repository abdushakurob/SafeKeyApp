/**
 * Sui Blockchain Integration for SafeKey
 * 
 * Handles all interactions with the SafeKey Vault smart contract on Sui blockchain.
 * Functions for creating vaults, storing/retrieving encrypted credentials.
 */

import { SuiClient, getFullnodeUrl } from '@mysten/sui/client'
import { Transaction } from '@mysten/sui/transactions'
import { getUserAddress, getEnokiWallet, getProvider } from './zklogin'
import { createEnokiSignerAdapter } from './seal'

// Package ID for the deployed SafeKey Vault contract
export const SAFEKEY_PACKAGE_ID = '0xd7cad3ae47268c69e8fd843ed59c8daa428efdc06a954fca98fc45770334b4be'

// Clock object ID (shared Sui system object)
const CLOCK_OBJECT_ID = '0x6'

// Sui client instance
let suiClient: SuiClient | null = null

/**
 * Initialize Sui client
 * @param network - Sui network (testnet, mainnet, devnet)
 */
export function initializeSuiClient(network: 'testnet' | 'mainnet' | 'devnet' = 'testnet'): void {
  try {
    suiClient = new SuiClient({ url: getFullnodeUrl(network) })
    console.log('[Sui] Client initialized for', network)
  } catch (error) {
    console.error('[Sui] Failed to initialize client:', error)
    throw error
  }
}

/**
 * Get Sui client instance
 */
function getSuiClient(): SuiClient {
  if (!suiClient) {
    initializeSuiClient('testnet') // Default to testnet
  }
  return suiClient!
}

/**
 * Get user's vault object ID from their address
 * Searches for UserVault object owned by the address
 */
export async function getUserVaultId(address: string): Promise<string | null> {
  try {
    const client = getSuiClient()
    const objects = await client.getOwnedObjects({
      owner: address,
      filter: {
        StructType: `${SAFEKEY_PACKAGE_ID}::vault::UserVault`,
      },
      options: {
        showType: true,
        showOwner: true,
      },
    })
    
    if (objects.data.length > 0) {
      return objects.data[0].data?.objectId || null
    }
    
    return null
  } catch (error) {
    console.error('[Sui] Failed to get vault ID:', error)
    return null
  }
}

/**
 * Create a new user vault on-chain
 * @returns Vault object ID
 */
export async function createVault(): Promise<string> {
  try {
    const address = getUserAddress()
    if (!address) {
      throw new Error('No user address available. Please login first.')
    }
    
    const provider = getProvider()
    if (!provider) {
      throw new Error('No zkLogin provider available')
    }
    
    const wallet = getEnokiWallet(provider)
    if (!wallet) {
      throw new Error('Enoki wallet not available')
    }
    
    const client = getSuiClient()
    const tx = new Transaction()
    
    // Set the sender address
    tx.setSender(address)
    
    tx.moveCall({
      target: `${SAFEKEY_PACKAGE_ID}::vault::create_vault`,
      arguments: [],
    })
    
    // Use Enoki signer adapter (doesn't require standard:accounts)
    const signer = createEnokiSignerAdapter(wallet, address) as any
    
    // Build and sign transaction
    const txBytes = await tx.build({ client })
    const signature = await signer.signTransactionBlock(txBytes)
    
    // Execute transaction
    const executeResult = await client.executeTransactionBlock({
      transactionBlock: txBytes,
      signature: signature,
      options: {
        showEffects: true,
        showObjectChanges: true,
      },
    })
    
    // Extract vault object ID from created objects
    if (executeResult.objectChanges) {
      for (const change of executeResult.objectChanges) {
        if (change.type === 'created' && change.objectType?.includes('UserVault')) {
          console.log('[Sui] ✅ Vault created:', change.objectId)
          return change.objectId
        }
      }
    }
    
    throw new Error('Vault created but object ID not found in transaction result')
  } catch (error) {
    console.error('[Sui] Failed to create vault:', error)
    throw error
  }
}

/**
 * Get or create user vault
 * @returns Vault object ID
 */
export async function getOrCreateVault(): Promise<string> {
  try {
    const address = getUserAddress()
    if (!address) {
      throw new Error('No user address available. Please login first.')
    }
    
    // Try to get existing vault
    let vaultId = await getUserVaultId(address)
    
    if (!vaultId) {
      // Create new vault
      console.log('[Sui] No vault found, creating new vault...')
      vaultId = await createVault()
      
      // Store vault ID in local storage
      await chrome.storage.local.set({ safekey_vault_id: vaultId })
    } else {
      // Store vault ID in local storage for faster access
      await chrome.storage.local.set({ safekey_vault_id: vaultId })
    }
    
    return vaultId
  } catch (error) {
    console.error('[Sui] Failed to get or create vault:', error)
    throw error
  }
}

/**
 * Check if a credential entry exists for a domain
 * @param vaultId - Vault object ID
 * @param domainHash - SHA-256 hash of the domain (as Uint8Array)
 */
export async function entryExists(vaultId: string, domainHash: Uint8Array): Promise<boolean> {
  try {
    const client = getSuiClient()
    const address = getUserAddress()
    if (!address) {
      throw new Error('No user address available')
    }
    
    const tx = new Transaction()
    tx.moveCall({
      target: `${SAFEKEY_PACKAGE_ID}::vault::entry_exists`,
      arguments: [
        tx.object(vaultId),
        tx.pure.vector('u8', Array.from(domainHash)),
      ],
    })
    
    // Use devInspectTransactionBlock for read-only operations
    const result = await client.devInspectTransactionBlock({
      sender: address,
      transactionBlock: await tx.build({ client }),
    })
    
    if (result.results && result.results.length > 0 && result.results[0].returnValues) {
      const returnValue = result.results[0].returnValues[0]
      if (returnValue && returnValue[0]) {
        // Parse boolean from return value
        return returnValue[0][0] === 1 || returnValue[0][0] === 0x01
      }
    }
    
    return false
  } catch (error) {
    console.error('[Sui] Failed to check entry existence:', error)
    return false
  }
}

/**
 * Get encrypted credential entry from vault
 * @param vaultId - Vault object ID
 * @param domainHash - SHA-256 hash of the domain (as Uint8Array)
 * @returns Encrypted credential data and nonces
 */
export async function getCredentials(
  vaultId: string,
  domainHash: Uint8Array
): Promise<{
  owner: string
  domainHash: Uint8Array
  data: Uint8Array
  entryNonce: Uint8Array
  sessionNonce: Uint8Array
  createdAt: number
} | null> {
  try {
    const client = getSuiClient()
    const address = getUserAddress()
    if (!address) {
      throw new Error('No user address available')
    }
    
    const tx = new Transaction()
    tx.moveCall({
      target: `${SAFEKEY_PACKAGE_ID}::vault::get_entry_info`,
      arguments: [
        tx.object(vaultId),
        tx.pure.vector('u8', Array.from(domainHash)),
      ],
    })
    
    // Use devInspectTransactionBlock for read-only operations
    const result = await client.devInspectTransactionBlock({
      sender: address,
      transactionBlock: await tx.build({ client }),
    })
    
    if (!result.results || result.results.length === 0 || !result.results[0].returnValues) {
      return null
    }
    
    const returnValues = result.results[0].returnValues
    
    // Parse return values: (address, vector<u8>, vector<u8>, vector<u8>, vector<u8>, u64)
    // Index 0: owner (address)
    // Index 1: domain_hash (vector<u8>)
    // Index 2: data (vector<u8>)
    // Index 3: entry_nonce (vector<u8>)
    // Index 4: session_nonce (vector<u8>)
    // Index 5: created_at (u64)
    
    if (returnValues.length < 6) {
      throw new Error('Invalid return values from get_entry_info')
    }
    
    // Return values format: [value, type] tuples
    // For address: [addressString, 'address']
    // For vector<u8>: [base64String, 'vector<u8>'] or [number[], 'vector<u8>']
    // For u64: [number, 'u64'] or [base64String, 'u64']
    
    const ownerTuple = returnValues[0]
    const owner = Array.isArray(ownerTuple) && ownerTuple.length >= 1 
      ? (typeof ownerTuple[0] === 'string' ? ownerTuple[0] : String(ownerTuple[0]))
      : ''
    
    // Parse vector<u8> values
    const parseVectorU8 = (tuple: any): Uint8Array => {
      if (!Array.isArray(tuple) || tuple.length < 1) {
        return new Uint8Array(0)
      }
      const value = tuple[0]
      if (typeof value === 'string') {
        // Base64 string
        return Uint8Array.from(atob(value), c => c.charCodeAt(0))
      } else if (Array.isArray(value)) {
        // Number array
        return new Uint8Array(value)
      } else {
        return new Uint8Array(0)
      }
    }
    
    const domainHashBytes = parseVectorU8(returnValues[1])
    const dataBytes = parseVectorU8(returnValues[2])
    const entryNonceBytes = parseVectorU8(returnValues[3])
    const sessionNonceBytes = parseVectorU8(returnValues[4])
    
    // Parse u64 timestamp
    const createdAtTuple = returnValues[5]
    let createdAt = 0
    if (Array.isArray(createdAtTuple) && createdAtTuple.length >= 1) {
      const value = createdAtTuple[0]
      if (typeof value === 'number') {
        createdAt = value
      } else if (typeof value === 'string') {
        // Base64 encoded u64
        const bytes = Uint8Array.from(atob(value), c => c.charCodeAt(0))
        for (let i = 0; i < Math.min(8, bytes.length); i++) {
          createdAt += bytes[i] * Math.pow(256, i)
        }
      } else if (Array.isArray(value)) {
        // Number array (little-endian)
        for (let i = 0; i < Math.min(8, value.length); i++) {
          createdAt += (value[i] || 0) * Math.pow(256, i)
        }
      }
    }
    
    return {
      owner,
      domainHash: domainHashBytes,
      data: dataBytes,
      entryNonce: entryNonceBytes,
      sessionNonce: sessionNonceBytes,
      createdAt,
    }
  } catch (error) {
    console.error('[Sui] Failed to get credentials:', error)
    return null
  }
}

/**
 * Save encrypted credentials to vault
 * @param vaultId - Vault object ID
 * @param domainHash - SHA-256 hash of the domain (as Uint8Array)
 * @param encryptedData - Encrypted credential data (as Uint8Array)
 * @param entryNonce - Entry-level nonce (as Uint8Array)
 * @param sessionNonce - Session-level nonce (as Uint8Array)
 */
export async function saveCredentials(
  vaultId: string,
  domainHash: Uint8Array,
  encryptedData: Uint8Array,
  entryNonce: Uint8Array,
  sessionNonce: Uint8Array
): Promise<void> {
  try {
    const provider = getProvider()
    if (!provider) {
      throw new Error('No zkLogin provider available')
    }
    
    const wallet = getEnokiWallet(provider)
    if (!wallet) {
      throw new Error('Enoki wallet not available')
    }
    
    const address = getUserAddress()
    if (!address) {
      throw new Error('No user address available')
    }
    
    const client = getSuiClient()
    const tx = new Transaction()
    
    // Set the sender address
    tx.setSender(address)
    
    // Check if entry already exists
    const exists = await entryExists(vaultId, domainHash)
    
    if (exists) {
      // Update existing entry
      tx.moveCall({
        target: `${SAFEKEY_PACKAGE_ID}::vault::update_entry`,
        arguments: [
          tx.object(vaultId),
          tx.pure.vector('u8', Array.from(domainHash)),
          tx.pure.vector('u8', Array.from(encryptedData)),
          tx.pure.vector('u8', Array.from(entryNonce)),
          tx.pure.vector('u8', Array.from(sessionNonce)),
          tx.object(CLOCK_OBJECT_ID),
        ],
      })
    } else {
      // Add new entry
      tx.moveCall({
        target: `${SAFEKEY_PACKAGE_ID}::vault::add_entry`,
        arguments: [
          tx.object(vaultId),
          tx.pure.vector('u8', Array.from(domainHash)),
          tx.pure.vector('u8', Array.from(encryptedData)),
          tx.pure.vector('u8', Array.from(entryNonce)),
          tx.pure.vector('u8', Array.from(sessionNonce)),
          tx.object(CLOCK_OBJECT_ID),
        ],
      })
    }
    
    // Use Enoki signer adapter (doesn't require standard:accounts)
    const signer = createEnokiSignerAdapter(wallet, address) as any
    
    // Build and sign transaction
    const txBytes = await tx.build({ client })
    const signature = await signer.signTransactionBlock(txBytes)
    
    // Execute transaction
    await client.executeTransactionBlock({
      transactionBlock: txBytes,
      signature: signature,
      options: {
        showEffects: true,
      },
    })
    
    console.log('[Sui] ✅ Credentials saved to vault')
  } catch (error) {
    console.error('[Sui] Failed to save credentials:', error)
    throw error
  }
}

/**
 * Delete a credential entry from vault
 * @param vaultId - Vault object ID
 * @param domainHash - SHA-256 hash of the domain (as Uint8Array)
 */
export async function deleteCredentials(
  vaultId: string,
  domainHash: Uint8Array
): Promise<void> {
  try {
    const provider = getProvider()
    if (!provider) {
      throw new Error('No zkLogin provider available')
    }
    
    const wallet = getEnokiWallet(provider)
    if (!wallet) {
      throw new Error('Enoki wallet not available')
    }
    
    const address = getUserAddress()
    if (!address) {
      throw new Error('No user address available')
    }
    
    const client = getSuiClient()
    const tx = new Transaction()
    
    // Set the sender address
    tx.setSender(address)
    
    tx.moveCall({
      target: `${SAFEKEY_PACKAGE_ID}::vault::delete_entry`,
      arguments: [
        tx.object(vaultId),
        tx.pure.vector('u8', Array.from(domainHash)),
      ],
    })
    
    // Use Enoki signer adapter (doesn't require standard:accounts)
    const signer = createEnokiSignerAdapter(wallet, address) as any
    
    // Build and sign transaction
    const txBytes = await tx.build({ client })
    const signature = await signer.signTransactionBlock(txBytes)
    
    // Execute transaction
    await client.executeTransactionBlock({
      transactionBlock: txBytes,
      signature: signature,
      options: {
        showEffects: true,
      },
    })
    
    console.log('[Sui] ✅ Credential deleted from vault')
  } catch (error) {
    console.error('[Sui] Failed to delete credentials:', error)
    throw error
  }
}

/**
 * Get all domain hashes for a user's vault
 * Note: This requires querying dynamic fields, which may be limited
 * For now, we'll need to track domains client-side or use a different approach
 */
export async function getAllDomainHashes(_vaultId: string): Promise<Uint8Array[]> {
  try {
    // Note: Sui doesn't have a direct way to list all dynamic fields
    // We'll need to track domains client-side in storage
    // For now, return empty array - this will be enhanced later
    const stored = await chrome.storage.local.get('safekey_domains')
    if (stored.safekey_domains && Array.isArray(stored.safekey_domains)) {
      return stored.safekey_domains.map((d: string) => 
        Uint8Array.from(atob(d), c => c.charCodeAt(0))
      )
    }
    return []
  } catch (error) {
    console.error('[Sui] Failed to get all domain hashes:', error)
    return []
  }
}

