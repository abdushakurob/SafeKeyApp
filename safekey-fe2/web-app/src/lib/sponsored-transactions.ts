/**
 * Sponsored Transaction Helper
 * Handles building, sponsoring, and executing transactions with gas sponsorship
 */

import { Transaction } from '@mysten/sui/transactions'
import { SuiClient, getFullnodeUrl } from '@mysten/sui/client'
import { toBase64 } from '@mysten/sui/utils'
import { API_SERVER_URL } from './api-config'

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

/**
 * Get Sui client
 */
function getSuiClient(): SuiClient {
  return new SuiClient({ url: getFullnodeUrl(NETWORK) })
}

/**
 * Sponsor a transaction via backend API
 * Returns sponsored bytes (base64 string) and digest
 */
async function sponsorTransaction(
  transactionKindBytes: Uint8Array,
  sender: string
): Promise<{ bytes: string; digest: string }> {
  const response = await fetch(`${API_SERVER_URL}/api/sponsor`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      transactionKindBytes: toBase64(transactionKindBytes),
      sender,
    }),
  })

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Unknown error' }))
    throw new Error(`Failed to sponsor transaction: ${error.error || response.statusText}`)
  }

  const data = await response.json()
  
  // Following Sui docs pattern: returns { bytes, digest }
  return {
    bytes: data.bytes,
    digest: data.digest,
  }
}

/**
 * Execute a sponsored transaction via backend API
 * Sends digest and signature to backend (following Sui docs pattern)
 */
async function executeTransaction(
  digest: string, 
  signature: string
): Promise<{ digest: string }> {
  const response = await fetch(`${API_SERVER_URL}/api/execute`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      digest,
      signature,
    }),
  })

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Unknown error' }))
    throw new Error(`Failed to execute transaction: ${error.error || response.statusText}`)
  }

  return await response.json()
}

/**
 * Sign and execute a sponsored transaction
 * Following the Sui docs pattern: https://docs.sui.io/guides/developer/app-examples/plinko
 * 
 * @param transaction - The transaction to execute (will be built with onlyTransactionKind: true)
 * @param signTransaction - Function to sign the transaction (from wallet) - expects base64 string
 * @param sender - The sender address
 * @returns Transaction execution result
 */
export async function signAndExecuteSponsoredTransaction(
  transaction: Transaction,
  signTransaction: (transaction: string) => Promise<string>,
  sender: string
): Promise<{ digest: string; effects?: unknown; events?: unknown; objectChanges?: unknown }> {
  console.log('[Sponsored] Building transaction kind bytes...')
  
  // Build transaction without gas (only transaction kind)
  const suiClient = getSuiClient()
  const kindBytes = await transaction.build({
    client: suiClient,
    onlyTransactionKind: true,
  })

  console.log('[Sponsored] Requesting sponsorship from backend...')
  
  // Step 1: Get sponsored transaction from backend
  // Returns { bytes: string (base64), digest: string }
  const { bytes: sponsoredBytes, digest: sponsoredDigest } = await sponsorTransaction(kindBytes, sender)

  console.log('[Sponsored] User signing sponsored transaction...')
  
  // Step 2: User signs the sponsored transaction bytes (base64 string)
  // Following Sui docs: signTransaction({ transaction: sponsoredBytes })
  // where sponsoredBytes is a base64 string, not a Transaction object
  const signature = await signTransaction(sponsoredBytes)

  if (!signature || signature.length === 0) {
    throw new Error('User signature is empty')
  }

  console.log('[Sponsored] Executing transaction via backend...')
  
  // Step 3: Execute the sponsored + signed transaction via backend
  // Backend handles the execution with both user and sponsor signatures
  // Following Sui docs pattern: only send digest and signature
  const result = await executeTransaction(sponsoredDigest, signature)

  console.log('[Sponsored] Transaction executed successfully:', result.digest)

  // Get full transaction details
  const txDetails = await suiClient.getTransactionBlock({
    digest: result.digest,
    options: {
      showEffects: true,
      showEvents: true,
      showObjectChanges: true,
    },
  })

  return {
    digest: result.digest,
    effects: txDetails.effects,
    events: txDetails.events,
    objectChanges: txDetails.objectChanges,
  }
}

