/**
 * Vault operations using popup-based transaction signing
 * HACKATHON WORKAROUND: All transactions are signed via popup
 */

import { Transaction } from '@mysten/sui/transactions'
import { SuiClient, getFullnodeUrl } from '@mysten/sui/client'
import { signAndExecuteTransactionViaPopup } from './transaction-signer'
import { getUserAddress } from './zklogin'

// TODO: Replace with your deployed package ID
export const SAFEKEY_PACKAGE_ID = import.meta.env.VITE_SAFEKEY_PACKAGE_ID || '0xd7cad3ae47268c69e8fd843ed59c8daa428efdc06a954fca98fc45770334b4be'
const NETWORK: 'testnet' | 'mainnet' | 'devnet' = 'testnet'

let suiClient: SuiClient | null = null

function getSuiClient(): SuiClient {
  if (!suiClient) {
    suiClient = new SuiClient({ url: getFullnodeUrl(NETWORK) })
  }
  return suiClient
}

/**
 * Get or create a user vault
 * Returns the vault object ID
 */
export async function getOrCreateVault(): Promise<string> {
  const address = getUserAddress()
  if (!address) {
    throw new Error('No user address available. Please login first.')
  }

  // Check if vault already exists
  const client = getSuiClient()
  const ownedObjects = await client.getOwnedObjects({
    owner: address,
    filter: {
      StructType: `${SAFEKEY_PACKAGE_ID}::vault::UserVault`,
    },
    options: {
      showContent: true,
    },
  })

  if (ownedObjects.data && ownedObjects.data.length > 0) {
    const vaultId = ownedObjects.data[0].data?.objectId
    if (vaultId) {
      console.log('[Vault] Found existing vault:', vaultId)
      return vaultId
    }
  }

  // Create new vault
  console.log('[Vault] No vault found, creating new vault...')
  const tx = new Transaction()
  tx.setSender(address)
  
  tx.moveCall({
    target: `${SAFEKEY_PACKAGE_ID}::vault::create_vault`,
    arguments: [],
  })

  // Sign and execute via popup (HACKATHON WORKAROUND)
  const result = await signAndExecuteTransactionViaPopup(tx, NETWORK)

  // Extract vault ID from transaction effects
  const effects = result.effects as { created?: Array<{ reference: { objectId: string } }> } | undefined
  if (effects?.created && effects.created.length > 0) {
    const vaultId = effects.created[0].reference.objectId
    console.log('[Vault] ✅ Vault created:', vaultId)
    return vaultId
  }

  throw new Error('Failed to create vault: No vault object in transaction effects')
}

/**
 * Add a credential entry to the vault
 */
export async function addCredential(
  vaultId: string,
  domainHash: Uint8Array,
  encryptedData: Uint8Array,
  entryNonce: Uint8Array,
  sessionNonce: Uint8Array
): Promise<string> {
  const address = getUserAddress()
  if (!address) {
    throw new Error('No user address available. Please login first.')
  }

  const tx = new Transaction()
  tx.setSender(address)

  tx.moveCall({
    target: `${SAFEKEY_PACKAGE_ID}::vault::add_entry`,
    arguments: [
      tx.object(vaultId),
      tx.pure.vector('u8', Array.from(domainHash)),
      tx.pure.vector('u8', Array.from(encryptedData)),
      tx.pure.vector('u8', Array.from(entryNonce)),
      tx.pure.vector('u8', Array.from(sessionNonce)),
      tx.object('0x6'), // Clock object
    ],
  })

  const result = await signAndExecuteTransactionViaPopup(tx, NETWORK)
  console.log('[Vault] ✅ Credential added:', result.digest)
  return result.digest
}

/**
 * Get credential entry info (read-only, uses devInspect)
 */
export async function getCredentialInfo(
  vaultId: string,
  domainHash: Uint8Array
): Promise<{
  owner: string
  domainHash: Uint8Array
  data: Uint8Array
  entryNonce: Uint8Array
  sessionNonce: Uint8Array
  createdAt: number
}> {
  const address = getUserAddress()
  if (!address) {
    throw new Error('No user address available. Please login first.')
  }

  const client = getSuiClient()
  const tx = new Transaction()
  tx.setSender(address)

  tx.moveCall({
    target: `${SAFEKEY_PACKAGE_ID}::vault::get_entry_info`,
    arguments: [
      tx.object(vaultId),
      tx.pure.vector('u8', Array.from(domainHash)),
    ],
  })

  // Use devInspect for read-only operations (no signing needed)
  const result = await client.devInspectTransactionBlock({
    sender: address,
    transactionBlock: await tx.build({ client }),
  })

  if (result.results && result.results[0]?.returnValues) {
    const returnValues = result.results[0].returnValues[0]
    const data = returnValues[0]
    const dataBytes = Uint8Array.from(data as number[])

    // Parse return values: (address, vector<u8>, vector<u8>, vector<u8>, vector<u8>, u64)
    // This is a simplified parser - you may need to adjust based on actual return format
    return {
      owner: address, // First value is owner address
      domainHash,
      data: dataBytes.slice(0, 32), // Adjust based on actual format
      entryNonce: dataBytes.slice(32, 56),
      sessionNonce: dataBytes.slice(56, 80),
      createdAt: 0, // Parse from last u64 value
    }
  }

  throw new Error('Failed to get credential info')
}

