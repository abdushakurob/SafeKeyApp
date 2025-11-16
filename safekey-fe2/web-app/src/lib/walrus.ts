/**
 * Walrus Client Integration
 * Handles storing, retrieving, and deleting blobs on Walrus decentralized storage
 * Uses the official @mysten/walrus SDK
 * 
 * Documentation: https://sdk.mystenlabs.com/walrus
 */

import { getFullnodeUrl } from '@mysten/sui/client'
import { SuiJsonRpcClient } from '@mysten/sui/jsonRpc'
import { walrus } from '@mysten/walrus'
import type { Signer } from '@mysten/sui/cryptography'

function getRequiredEnvVar(key: string): string {
  let value: string | undefined
  
  if (typeof process !== 'undefined' && process.env) {
    value = process.env[key]
  } else if (typeof import.meta !== 'undefined' && import.meta.env) {
    value = (import.meta.env as any)[key]
  }
  
  if (!value) {
    throw new Error(`Required environment variable ${key} is not set. Please set it in your .env file.`)
  }
  
  return value
}

const NETWORK = getRequiredEnvVar('VITE_SUI_NETWORK') as 'testnet' | 'mainnet' | 'devnet'

// Create Walrus-enabled Sui client
let walrusClient: any | null = null

function createWalrusClient() {
  
  return new SuiJsonRpcClient({
    url: getFullnodeUrl(NETWORK),
    network: NETWORK,
  }).$extend(walrus() as any)
}

function getWalrusClient() {
  if (!walrusClient) {
    walrusClient = createWalrusClient()
  }
  return walrusClient
}

/**
 * Store encrypted data as a blob on Walrus
 * @param encryptedData - Encrypted data as Uint8Array
 * @param signer - Signer to sign and pay for the transaction/storage fees
 * @param epochs - Number of epochs to store the blob (default: 3)
 * @returns Blob ID (string) that can be used to retrieve the blob
 */
export async function storeBlob(
  encryptedData: Uint8Array,
  signer: Signer,
  epochs: number = 3
): Promise<string> {
  try {
    console.log('[Walrus] Storing blob, size:', encryptedData.length, 'bytes')
    
    //upload the blob.
    const uploadRelayHost =
      // Vite-style envs
      ((typeof import.meta !== 'undefined' && (import.meta as any).env && ((import.meta as any).env.VITE_PUBLISHER_URL || (import.meta as any).env.VITE_WALRUS_PUBLISHER_URL || (import.meta as any).env.VITE_WALRUS_UPLOAD_RELAY_HOST)) as string)
      // process.env fallback
      || (typeof process !== 'undefined' && process.env && (process.env.VITE_PUBLISHER_URL || process.env.VITE_WALRUS_PUBLISHER_URL || process.env.VITE_WALRUS_UPLOAD_RELAY_HOST))

    if (uploadRelayHost) {
      const host = String(uploadRelayHost).replace(/\/+$/, '')
      const url = `${host}/v1/blobs?epochs=${encodeURIComponent(String(epochs))}`
      console.log('[Walrus] Upload relay configured, sending blob to', url)

      // Send raw bytes as application/octet-stream. The publisher/relay will
      // perform the walrus encoding and return a blobId (or alreadyCertified).
      const resp = await fetch(url, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/octet-stream',
        },
        // Wrap Uint8Array in a Blob so TS/lib.dom accepts it as BodyInit
        body: new Blob([encryptedData as any]),
      })

      if (!resp.ok) {
        const text = await resp.text().catch(() => '')
        throw new Error(`Upload relay returned ${resp.status} ${resp.statusText}: ${text}`)
      }

      const json = await resp.json()
      const blobId = json?.newlyCreated?.blobObject?.blobId || json?.alreadyCertified?.blobId
      if (!blobId) {
        throw new Error(`Upload relay did not return a blobId: ${JSON.stringify(json)}`)
      }

      console.log('[Walrus] ✅ Blob stored via upload relay, blob ID:', String(blobId).substring(0, 32) + '...')
      return String(blobId)
    }

    // Fallback: use the Walrus SDK directly (may trigger wasm load in browser)
    const client = getWalrusClient()
    // The signer needs sufficient SUI for transactions and WAL tokens for storage
    const { blobId } = await client.walrus.writeBlob({
      blob: encryptedData,
      deletable: true, // Allow deletion later
      epochs: epochs, // Store for specified number of epochs
      signer: signer,
    })

    console.log('[Walrus] ✅ Blob stored successfully, blob ID:', blobId.substring(0, 32) + '...')
    return blobId
  } catch (error) {
    console.error('[Walrus] Error storing blob:', error)
    throw new Error(`Failed to store blob on Walrus: ${error instanceof Error ? error.message : String(error)}`)
  }
}

/**
 * Retrieve a blob from Walrus by blob ID
 * @param blobId - Blob ID returned from storeBlob()
 * @returns Encrypted data as Uint8Array
 */
export async function retrieveBlob(blobId: string): Promise<Uint8Array> {
  try {
    console.log('[Walrus] Retrieving blob:', blobId.substring(0, 32) + '...')
    // Prefer aggregator/publisher HTTP endpoint if configured - this avoids
    // triggering the Walrus SDK wasm loader in-browser.
    const aggregatorHost =
      // Vite-style envs
      ((typeof import.meta !== 'undefined' && (import.meta as any).env && ((import.meta as any).env.VITE_AGGREGATOR_URL || (import.meta as any).env.VITE_PUBLISHER_URL || (import.meta as any).env.VITE_WALRUS_PUBLISHER_URL)) as string)
      // process.env fallback
      || (typeof process !== 'undefined' && process.env && (process.env.VITE_AGGREGATOR_URL || process.env.VITE_PUBLISHER_URL || process.env.VITE_WALRUS_PUBLISHER_URL))

    if (aggregatorHost) {
      const host = String(aggregatorHost).replace(/\/+$/, '')
      const url = `${host}/v1/blobs/${encodeURIComponent(blobId)}`
      console.log('[Walrus] Fetching blob from aggregator:', url)

      const resp = await fetch(url, { method: 'GET' })
      if (!resp.ok) {
        const text = await resp.text().catch(() => '')
        throw new Error(`Aggregator returned ${resp.status} ${resp.statusText}: ${text}`)
      }

      const ab = await resp.arrayBuffer()
      const arr = new Uint8Array(ab)
      console.log('[Walrus] ✅ Blob retrieved from aggregator, size:', arr.length, 'bytes')
      return arr
    }

    // Fallback to Walrus SDK read path (may load wasm in-browser)
    const client = getWalrusClient()
    const blob = await client.walrus.readBlob({ blobId })

    console.log('[Walrus] ✅ Blob retrieved successfully, size:', blob.length, 'bytes')
    return blob
  } catch (error) {
    console.error('[Walrus] Error retrieving blob:', error)
    throw new Error(`Failed to retrieve blob from Walrus: ${error instanceof Error ? error.message : String(error)}`)
  }
}

/**
 * Delete a blob from Walrus
 * Note: Deletion requires a transaction and signer - this is a placeholder
 * @param blobId - Blob ID to delete
 * @param signer - Signer to sign the deletion transaction
 */
export async function deleteBlob(blobId: string, signer: Signer): Promise<void> {
  try {
    console.log('[Walrus] Deleting blob:', blobId.substring(0, 32) + '...')
    // Avoid unused parameter lint error - signer will be used when deletion is implemented
    void signer
    
    // TODO: Implement blob deletion using Walrus SDK
    // This may require calling a delete method on the blob object or using a transaction
    // For now, we'll just log - blobs marked as deletable can be removed
    console.warn('[Walrus] Blob deletion not yet implemented - blob will remain until epoch expiration')
    
    // The blob will expire after the specified epochs, so deletion is optional
  } catch (error) {
    console.error('[Walrus] Error deleting blob:', error)
    // Don't throw - deletion is optional/cleanup
    console.warn('[Walrus] Warning: Failed to delete blob (this is non-critical):', error)
  }
}

/**
 * Retrieve multiple blobs in parallel
 * @param blobIds - Array of blob IDs to retrieve
 * @returns Map of blobId -> encrypted data
 */
export async function retrieveBlobs(blobIds: string[]): Promise<Map<string, Uint8Array>> {
  console.log('[Walrus] Retrieving', blobIds.length, 'blobs in parallel')
  
  const promises = blobIds.map(async (blobId) => {
    try {
      const data = await retrieveBlob(blobId)
      return { blobId, data }
    } catch (error) {
      console.error(`[Walrus] Failed to retrieve blob ${blobId}:`, error)
      return { blobId, data: null, error }
    }
  })

  const results = await Promise.all(promises)
  const blobMap = new Map<string, Uint8Array>()

  for (const result of results) {
    if (result.data) {
      blobMap.set(result.blobId, result.data)
    }
  }

  console.log('[Walrus] ✅ Retrieved', blobMap.size, 'out of', blobIds.length, 'blobs')
  return blobMap
}

