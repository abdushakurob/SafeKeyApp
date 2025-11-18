import { Transaction } from '@mysten/sui/transactions'
import { SuiClient, getFullnodeUrl } from '@mysten/sui/client'

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

export const SAFEKEY_PACKAGE_ID = getRequiredEnvVar('VITE_SAFEKEY_PACKAGE_ID')
const NETWORK = getRequiredEnvVar('VITE_SUI_NETWORK') as 'testnet' | 'mainnet' | 'devnet'

let suiClient: SuiClient | null = null

export function getSuiClient(): SuiClient {
  if (!suiClient) {
    suiClient = new SuiClient({ url: getFullnodeUrl(NETWORK) })
  }
  return suiClient
}

export async function getUserVaultId(address: string): Promise<string | null> {
  const client = getSuiClient()
  const expectedType = `${SAFEKEY_PACKAGE_ID}::vault::UserVault`
  
  console.log(`[Vault] Looking for vault with type: ${expectedType}`)
  console.log(`[Vault] Package ID: ${SAFEKEY_PACKAGE_ID}`)
  
  try {
    const ownedObjects = await client.getOwnedObjects({
      owner: address,
      filter: {
        StructType: expectedType,
      },
      options: {
        showContent: true,
        showType: true,
      },
    })

    console.log(`[Vault] Query returned ${ownedObjects.data?.length || 0} objects`)
    
    if (ownedObjects.data && ownedObjects.data.length > 0) {
      for (const obj of ownedObjects.data) {
        console.log(`[Vault] Found object:`, {
          objectId: obj.data?.objectId,
          type: obj.data?.type,
          matches: obj.data?.type?.includes('vault::UserVault'),
        })
      }
      
      const vault = ownedObjects.data.find(obj => 
        obj.data?.type === expectedType || obj.data?.type?.includes('vault::UserVault')
      )
      
      if (vault?.data?.objectId) {
        console.log(`[Vault] Found vault:`, vault.data.objectId)
        return vault.data.objectId
      }
      
      throw new Error(`Vault type check failed: Found ${ownedObjects.data.length} objects but none match expected type ${expectedType}`)
    }

    return null
  } catch (error) {
    console.error(`[Vault] Error getting vault:`, error)
    throw error
  }
}

export async function createVault(
  address: string,
  signAndExecute: (params: { transaction: Transaction }) => Promise<any>
): Promise<string> {
  const tx = new Transaction()
  tx.setSender(address)

  tx.moveCall({
    target: `${SAFEKEY_PACKAGE_ID}::vault::create_vault`,
    arguments: [],
  })

  const result = await signAndExecute({ transaction: tx })

  console.log('[Vault] Transaction executed, digest:', result.digest)

  if (!result.objectChanges) {
    throw new Error(`Failed to create vault: Transaction executed (digest: ${result.digest}) but objectChanges not available. Ensure useSignAndExecuteTransaction is configured with showObjectChanges: true.`)
  }

  const objectChanges = result.objectChanges as Array<{
    type: string
    objectId?: string
    objectType?: string
    sender?: string
  }>
  
  console.log('[Vault] Object changes:', objectChanges)
  
  const createdVault = objectChanges.find(
    (change) =>
      change.type === 'created' &&
      change.objectType?.includes('vault::UserVault')
  )
  
  if (!createdVault?.objectId) {
    throw new Error(`Failed to create vault: Transaction executed (digest: ${result.digest}) but vault object not found in objectChanges. Check transaction on Sui Explorer.`)
  }

  console.log('[Vault] Vault ID extracted from objectChanges:', createdVault.objectId)
  return createdVault.objectId
}

export async function getOrCreateVault(
  address: string,
  signAndExecute: (params: { transaction: Transaction }) => Promise<any>
): Promise<string> {
  const existingVault = await getUserVaultId(address)
  if (existingVault) {
    return existingVault
  }

  return createVault(address, signAndExecute)
}

export async function checkCredentialExists(
  vaultId: string,
  domainHash: Uint8Array,
  address: string
): Promise<boolean> {
  const client = getSuiClient()
  
  try {
    await client.getObject({ id: vaultId })
  } catch (error) {
    console.log('[Vault] Vault does not exist:', vaultId)
    return false
  }
  
  const tx = new Transaction()
  tx.setSender(address)

  tx.moveCall({
    target: `${SAFEKEY_PACKAGE_ID}::vault::entry_exists`,
    arguments: [
      tx.object(vaultId),
      tx.pure.vector('u8', Array.from(domainHash)),
    ],
  })

  try {
    // Build with onlyTransactionKind: true to avoid needing gas coins
    // This is a read-only operation using devInspectTransactionBlock
    const builtTx = await tx.build({ 
      client,
      onlyTransactionKind: true 
    })
    const result = await client.devInspectTransactionBlock({
      sender: address,
      transactionBlock: builtTx,
    })

    if (result.error) {
      return false
    }

    if (!result.results || !result.results[0]?.returnValues) {
      return false
    }

    const returnValues = result.results[0].returnValues
    
    if (!returnValues || returnValues.length === 0) {
      return false
    }

    const returnValue = returnValues[0]
    
    if (!Array.isArray(returnValue) || returnValue.length < 2) {
      throw new Error(`Invalid return value format: expected array with [bcsBytes, type], got ${JSON.stringify(returnValue)}`)
    }

    const [bcsBytes, type] = returnValue
    
    if (type !== 'bool' && (typeof type !== 'string' || !type.includes('bool'))) {
      throw new Error(`Invalid return type: expected bool, got ${type}`)
    }

    if (Array.isArray(bcsBytes)) {
      if (bcsBytes.length === 0) {
        throw new Error('Invalid BCS bytes: empty array')
      }
      if (typeof bcsBytes[0] !== 'number') {
        throw new Error(`Invalid BCS bytes: expected number, got ${typeof bcsBytes[0]}`)
      }
      return bcsBytes[0] === 1
    } else if (typeof bcsBytes === 'number') {
      return bcsBytes === 1
    } else if (typeof bcsBytes === 'boolean') {
      return bcsBytes
    } else if (typeof bcsBytes === 'string') {
      const decoded = Uint8Array.from(atob(bcsBytes), c => c.charCodeAt(0))
      if (decoded.length === 0) {
        throw new Error('Invalid BCS bytes: decoded string is empty')
      }
      return decoded[0] === 1
    } else {
      throw new Error(`Invalid BCS bytes format: expected array, number, boolean, or base64 string, got ${typeof bcsBytes}`)
    }
  } catch (error: any) {
    if (error?.code === -32602 || error?.message?.includes('Deserialization error')) {
      return false
    }
    console.error('[Vault] Error checking credential existence:', error)
    return false
  }

  return false
}

export async function getCredentialInfo(
  vaultId: string,
  domainHash: Uint8Array,
  address: string
): Promise<{
  owner: string
  domainHash: Uint8Array
  data: Uint8Array
  entryNonce: Uint8Array
  sessionNonce: Uint8Array
  createdAt: number
} | null> {
  const client = getSuiClient()
  const tx = new Transaction()
  tx.setSender(address)

  console.log('[Vault] Getting credential info for domain hash:', {
    vaultId,
    domainHashLength: domainHash.length,
    domainHashHex: Array.from(domainHash).map(b => b.toString(16).padStart(2, '0')).join('').substring(0, 32) + '...',
    address,
  })

  tx.moveCall({
    target: `${SAFEKEY_PACKAGE_ID}::vault::get_entry_info`,
    arguments: [
      tx.object(vaultId),
      tx.pure.vector('u8', Array.from(domainHash)),
    ],
  })

  try {
    // Build with onlyTransactionKind: true to avoid needing gas coins
    // This is a read-only operation using devInspectTransactionBlock
    const builtTx = await tx.build({ 
      client,
      onlyTransactionKind: true 
    })
    const result = await client.devInspectTransactionBlock({
      sender: address,
      transactionBlock: builtTx,
    })

    if (result.error) {
      console.error('[Vault] Transaction error in get_entry_info:', result.error)
      return null
    }
    
    console.log('[Vault] devInspectTransactionBlock succeeded, checking results...')

    if (!result.results || !result.results[0]?.returnValues) {
      throw new Error('No return values found in transaction result')
    }

    const returnValues = result.results[0].returnValues
    
    if (returnValues.length < 6) {
      throw new Error(`Invalid return values: expected 6 values, got ${returnValues.length}`)
    }
    
    console.log('[Vault] Return values structure:', {
      length: returnValues.length,
      types: returnValues.map((rv: any) => ({
        isArray: Array.isArray(rv),
        length: Array.isArray(rv) ? rv.length : undefined,
        firstElement: Array.isArray(rv) && rv.length > 0 ? (Array.isArray(rv[0]) ? `array[${rv[0].length}]` : typeof rv[0]) : undefined,
      })),
    })
    
    if (!Array.isArray(returnValues[0]) || returnValues[0].length < 1) {
      throw new Error('Invalid owner return value')
    }
    const owner = returnValues[0][0]
    if (typeof owner !== 'string') {
      throw new Error(`Invalid owner type: expected string, got ${typeof owner}`)
    }
    
    if (!Array.isArray(returnValues[1]) || returnValues[1].length < 1) {
      throw new Error('Invalid domainHash return value')
    }
    const domainHashBytes = Uint8Array.from(returnValues[1][0])
    
    if (!Array.isArray(returnValues[2]) || returnValues[2].length < 1) {
      throw new Error('Invalid data return value')
    }
    const data = Uint8Array.from(returnValues[2][0])
    
    if (!Array.isArray(returnValues[3]) || returnValues[3].length < 1) {
      throw new Error('Invalid entryNonce return value')
    }
    const entryNonce = Uint8Array.from(returnValues[3][0])
    
    if (!Array.isArray(returnValues[4]) || returnValues[4].length < 1) {
      throw new Error('Invalid sessionNonce return value')
    }
    const sessionNonce = Uint8Array.from(returnValues[4][0])
    
    console.log('[Vault] Parsed values:', {
      owner: typeof owner,
      domainHashLength: domainHashBytes.length,
      dataLength: data.length,
      entryNonceLength: entryNonce.length,
      sessionNonceLength: sessionNonce.length,
    })
    
    if (!Array.isArray(returnValues[5]) || returnValues[5].length < 1) {
      throw new Error('Invalid createdAt return value')
    }
    const createdAtBytes = returnValues[5][0]
    if (!Array.isArray(createdAtBytes) || createdAtBytes.length < 8) {
      throw new Error(`Invalid createdAt bytes: expected array with at least 8 elements, got ${createdAtBytes.length}`)
    }
    
    const createdAt = Number(
      BigInt(createdAtBytes[0]) |
      (BigInt(createdAtBytes[1]) << 8n) |
      (BigInt(createdAtBytes[2]) << 16n) |
      (BigInt(createdAtBytes[3]) << 24n) |
      (BigInt(createdAtBytes[4]) << 32n) |
      (BigInt(createdAtBytes[5]) << 40n) |
      (BigInt(createdAtBytes[6]) << 48n) |
      (BigInt(createdAtBytes[7]) << 56n)
    )

    return {
      owner,
      domainHash: domainHashBytes,
      data,
      entryNonce,
      sessionNonce,
      createdAt,
    }
  } catch (error: any) {
    if (error?.code === -32602 || 
        error?.message?.includes('Deserialization error') ||
        error?.message?.includes('variant index')) {
      console.warn('[Vault] Deserialization error (entry may not exist):', error.message)
      return null
    }
    console.error('[Vault] Unexpected error getting credential info:', error)
    console.error('[Vault] Error details:', {
      message: error?.message,
      code: error?.code,
      stack: error?.stack,
    })
  }

  console.warn('[Vault] Returning null - could not retrieve credential info')
  return null
}

export async function getAllDomainHashes(vaultId: string): Promise<Uint8Array[]> {
  try {
    const client = getSuiClient()
    
    const dynamicFields = await client.getDynamicFields({
      parentId: vaultId,
    })

    console.log('[Vault] Found', dynamicFields.data.length, 'dynamic fields')

    const domainHashes: Uint8Array[] = []
    
    for (const field of dynamicFields.data) {
      try {
        let hashBytes: number[] | null = null
        
        if (field.name && typeof field.name === 'object' && 'value' in field.name && Array.isArray((field.name as any).value)) {
          hashBytes = (field.name as any).value
        } else if (Array.isArray(field.name)) {
          hashBytes = field.name
        }
        
        if (hashBytes && hashBytes.length > 0) {
          domainHashes.push(Uint8Array.from(hashBytes))
        }
      } catch (error) {
        console.error('[Vault] Error parsing dynamic field:', error)
      }
    }

    console.log('[Vault] Extracted', domainHashes.length, 'domain hashes')
    return domainHashes
  } catch (error) {
    console.error('[Vault] Error getting all domain hashes:', error)
    return []
  }
}

export async function getCredentialInfoFromDynamicField(
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
    
    const dynamicFields = await client.getDynamicFields({
      parentId: vaultId,
    })
    
    let matchingField: any = null
    for (const field of dynamicFields.data) {
      let hashBytes: number[] | null = null
      if (field.name && typeof field.name === 'object' && 'value' in field.name && Array.isArray((field.name as any).value)) {
        hashBytes = (field.name as any).value
      } else if (Array.isArray(field.name)) {
        hashBytes = field.name
      }
      
      if (hashBytes && hashBytes.length === domainHash.length) {
        const fieldHash = Uint8Array.from(hashBytes)
        if (fieldHash.every((b, i) => b === domainHash[i])) {
          matchingField = field
          break
        }
      }
    }
    
    if (!matchingField || !matchingField.objectId) {
      console.warn('[Vault] No matching dynamic field found for domain hash')
      return null
    }
    
    const object = await client.getObject({
      id: matchingField.objectId,
      options: {
        showContent: true,
        showType: true,
      },
    })
    
    if (!object.data || !('content' in object.data)) {
      console.warn('[Vault] Could not get object content')
      return null
    }
    
    const content = (object.data as any).content
    if (!content || content.dataType !== 'moveObject') {
      console.warn('[Vault] Object is not a move object')
      return null
    }
    
    const fields = content.fields
    if (!fields) {
      console.warn('[Vault] Object has no fields')
      return null
    }
    
    const vaultEntryFields = (fields as any).value?.fields
    if (!vaultEntryFields) {
      console.warn('[Vault] No VaultEntry fields found in value.fields')
      return null
    }
    
    if (!vaultEntryFields.owner || typeof vaultEntryFields.owner !== 'string') {
      throw new Error('Invalid owner field in VaultEntry')
    }
    const owner = vaultEntryFields.owner
    
    if (!vaultEntryFields.domain_hash) {
      throw new Error('Missing domain_hash field in VaultEntry')
    }
    const domainHashBytes = Uint8Array.from(vaultEntryFields.domain_hash)
    
    const decodeBase64 = (str: string): Uint8Array => {
      if (typeof Buffer !== 'undefined') {
        return new Uint8Array(Buffer.from(str, 'base64'))
      } else {
        return Uint8Array.from(atob(str), c => c.charCodeAt(0))
      }
    }
    
    let data: Uint8Array
    if (Array.isArray(vaultEntryFields.data)) {
      data = Uint8Array.from(vaultEntryFields.data)
    } else if (typeof vaultEntryFields.data === 'string') {
      data = decodeBase64(vaultEntryFields.data)
    } else {
      data = new Uint8Array(0)
    }
    
    let entryNonce: Uint8Array
    if (Array.isArray(vaultEntryFields.entry_nonce)) {
      entryNonce = Uint8Array.from(vaultEntryFields.entry_nonce)
    } else if (typeof vaultEntryFields.entry_nonce === 'string') {
      entryNonce = decodeBase64(vaultEntryFields.entry_nonce)
    } else {
      entryNonce = new Uint8Array(0)
    }
    
    let sessionNonce: Uint8Array
    if (Array.isArray(vaultEntryFields.session_nonce)) {
      sessionNonce = Uint8Array.from(vaultEntryFields.session_nonce)
    } else if (typeof vaultEntryFields.session_nonce === 'string') {
      sessionNonce = decodeBase64(vaultEntryFields.session_nonce)
    } else {
      sessionNonce = new Uint8Array(0)
    }
    
    if (!vaultEntryFields.created_at) {
      throw new Error('Missing created_at field in VaultEntry')
    }
    const createdAt = Number(vaultEntryFields.created_at)
    if (isNaN(createdAt)) {
      throw new Error(`Invalid created_at value: ${vaultEntryFields.created_at}`)
    }
    
    console.log('[Vault] Successfully retrieved credential info from dynamic field object')
    console.log('[Vault] Parsed field lengths:', {
      data: data.length,
      entryNonce: entryNonce.length,
      sessionNonce: sessionNonce.length,
      createdAt,
    })
    
    return {
      owner,
      domainHash: domainHashBytes,
      data,
      entryNonce,
      sessionNonce,
      createdAt,
    }
  } catch (error) {
    console.error('[Vault] Error getting credential info from dynamic field:', error)
    return null
  }
}

export async function addCredential(
  vaultId: string,
  domainHash: Uint8Array,
  encryptedData: Uint8Array,
  entryNonce: Uint8Array,
  sessionNonce: Uint8Array,
  address: string,
  signAndExecute: (params: { transaction: Transaction }) => Promise<any>
): Promise<string> {
  try {
    console.log('[Vault] Preparing add_entry transaction...')
    console.log('[Vault] Parameters:', {
      vaultId,
      domainHashLength: domainHash.length,
      encryptedDataLength: encryptedData.length,
      entryNonceLength: entryNonce.length,
      sessionNonceLength: sessionNonce.length,
      address,
      packageId: SAFEKEY_PACKAGE_ID,
    })

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
        tx.object('0x6'),
      ],
    })

    console.log('[Vault] Transaction built, signing and executing...')
    const result = await signAndExecute({ transaction: tx })
    
    console.log('[Vault] Credential added successfully')
    console.log('[Vault] Transaction digest:', result.digest)
    console.log('[Vault] Transaction result:', {
      digest: result.digest,
      effects: result.effects,
      events: result.events,
    })
    
    return result.digest
  } catch (error) {
    console.error('[Vault] Error adding credential:', error)
    console.error('[Vault] Error details:', {
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    })
    throw error
  }
}

export async function updateCredential(
  vaultId: string,
  domainHash: Uint8Array,
  newEncryptedData: Uint8Array,
  newEntryNonce: Uint8Array,
  newSessionNonce: Uint8Array,
  address: string,
  signAndExecute: (params: { transaction: Transaction }) => Promise<any>
): Promise<string> {
  try {
    console.log('[Vault] Preparing update_entry transaction...')
    console.log('[Vault] Parameters:', {
      vaultId,
      domainHashLength: domainHash.length,
      encryptedDataLength: newEncryptedData.length,
      entryNonceLength: newEntryNonce.length,
      sessionNonceLength: newSessionNonce.length,
      address,
      packageId: SAFEKEY_PACKAGE_ID,
    })

    const tx = new Transaction()
    tx.setSender(address)

    tx.moveCall({
      target: `${SAFEKEY_PACKAGE_ID}::vault::update_entry`,
      arguments: [
        tx.object(vaultId),
        tx.pure.vector('u8', Array.from(domainHash)),
        tx.pure.vector('u8', Array.from(newEncryptedData)),
        tx.pure.vector('u8', Array.from(newEntryNonce)),
        tx.pure.vector('u8', Array.from(newSessionNonce)),
        tx.object('0x6'),
      ],
    })

    console.log('[Vault] Transaction built, signing and executing...')
    const result = await signAndExecute({ transaction: tx })
    
    console.log('[Vault] Credential updated successfully')
    console.log('[Vault] Transaction digest:', result.digest)
    console.log('[Vault] Transaction result:', {
      digest: result.digest,
      effects: result.effects,
      events: result.events,
    })
    
    return result.digest
  } catch (error) {
    console.error('[Vault] Error updating credential:', error)
    console.error('[Vault] Error details:', {
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    })
    throw error
  }
}

/**
 * Delete a credential entry from the vault
 */
export async function deleteCredential(
  vaultId: string,
  domainHash: Uint8Array,
  signAndExecute: (params: { transaction: any }) => Promise<any>
): Promise<string> {
  try {
    console.log('[Vault] Deleting credential from vault:', vaultId)
    console.log('[Vault] Domain hash length:', domainHash.length)
    
    const tx = new Transaction()
    
    // Add the delete entry call
    tx.moveCall({
      target: `${SAFEKEY_PACKAGE_ID}::vault::delete_entry`,
      arguments: [
        tx.object(vaultId),
        tx.pure.vector('u8', Array.from(domainHash))
      ]
    })
    
    console.log('[Vault] Executing delete credential transaction...')
    const result = await signAndExecute({
      transaction: tx,
    })
    
    console.log('[Vault] ✅ Credential deleted successfully')
    console.log('[Vault] Transaction digest:', result.digest)
    
    return result.digest
  } catch (error) {
    console.error('[Vault] Error deleting credential:', error)
    console.error('[Vault] Error details:', {
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    })
    throw error
  }
}

