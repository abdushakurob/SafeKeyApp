import { hashDomain, encrypt, decrypt, deriveKS, generateSessionNonce } from './crypto'
import {
  getOrCreateVault,
  checkCredentialExists,
  addCredential,
  updateCredential,
} from './vault'
import { storeBlob, retrieveBlobs } from './walrus'

export interface Credential {
  domain: string
  username: string
  password: string
}

export interface EncryptedCredential {
  domain: string
  domainHash: Uint8Array
  encryptedData: Uint8Array
  entryNonce: Uint8Array
  sessionNonce: Uint8Array
}

export async function deriveMasterKey(
  address: string,
  idToken: string,
  wallets?: any[],
  currentAccount?: any,
  signAndExecute?: (params: { transaction: any }) => Promise<any>
): Promise<string> {
  if (wallets && currentAccount) {
    const { deriveMasterKeyFromSeal } = await import('./seal')
    return await deriveMasterKeyFromSeal(address, idToken, wallets, currentAccount, signAndExecute!)
  }

  throw new Error('Cannot derive master key: SEAL requires wallets and currentAccount. Use stored master key from session instead.')
}

export async function saveCredential(
  credential: Credential,
  KM: string,
  address: string,
  signAndExecute: (params: { transaction: any }) => Promise<any>,
  wallets?: any[],
  currentAccount?: any
): Promise<string> {
  try {
    console.log('[Credentials] Starting save credential for domain:', credential.domain)
    
    const domainHashB64 = await hashDomain(credential.domain, KM)
    const domainHash = Uint8Array.from(atob(domainHashB64), c => c.charCodeAt(0))
    console.log('[Credentials] Domain hash (base64):', domainHashB64.substring(0, 16) + '...')

    console.log('[Credentials] Getting or creating vault...')
    const vaultId = await getOrCreateVault(address, signAndExecute)
    console.log('[Credentials] Vault ID:', vaultId)

    console.log('[Credentials] Checking if credential exists...')
    const exists = await checkCredentialExists(vaultId, domainHash, address)
    console.log('[Credentials] Credential exists:', exists)

    // For the new flow we create a new independent session nonce per credential
    // and store it in Walrus alongside the encrypted data. The on-chain
    // dynamic field `data` will contain blob IDs only; entryNonce/sessionNonce
    // on-chain will be left empty. This keeps credentials independent.
    const sessionNonce = generateSessionNonce()
    const sessionNonceBytes = Uint8Array.from(atob(sessionNonce), c => c.charCodeAt(0))
    console.log('[Credentials] Generated new session nonce for this credential')

    console.log('[Credentials] Deriving session key (KS) from KM...')
    const KS = await deriveKS(KM, sessionNonce)
    console.log('[Credentials] Session key (KS) derived')

    console.log('[Credentials] Encrypting credential data with KS...')
    const credentialData = JSON.stringify({
      domain: credential.domain,
      username: credential.username,
      password: credential.password,
    })
    const encryptedDataB64 = await encrypt(credentialData, KS)
    console.log('[Credentials] Credential data encrypted')

    const [ivB64, ciphertextB64] = encryptedDataB64.split('.')
    const encryptedData = Uint8Array.from(atob(ciphertextB64), c => c.charCodeAt(0))
    const entryNonce = Uint8Array.from(atob(ivB64), c => c.charCodeAt(0))

  // Store sessionNonce + IV + encrypted data together in blob (so we can
  // retrieve everything needed to decrypt from Walrus). Format:
  // [sessionNonceLen (1 byte)] [sessionNonce bytes] [ivLen (1 byte)] [iv bytes] [ciphertext bytes]
  const ivLength = entryNonce.length
  const snLength = sessionNonceBytes.length
  const blobData = new Uint8Array(1 + snLength + 1 + ivLength + encryptedData.length)
  let offset = 0
  blobData[offset++] = snLength
  blobData.set(sessionNonceBytes, offset)
  offset += snLength
  blobData[offset++] = ivLength
  blobData.set(entryNonce, offset)
  offset += ivLength
  blobData.set(encryptedData, offset)

    // Store encrypted data on Walrus
    console.log('[Credentials] Storing encrypted credential on Walrus...')
    
    // Create signer for Walrus (required for storing blobs)
    if (!wallets || !currentAccount) {
      throw new Error('Wallets and currentAccount are required for Walrus storage')
    }
    
    const { createEnokiSigner } = await import('./seal')
    const { isEnokiWallet } = await import('@mysten/enoki')
    const enokiWallet = wallets.find((w: any) => {
      return isEnokiWallet(w) && w.accounts.some((acc: any) => acc.address === address)
    })
    
    if (!enokiWallet) {
      throw new Error('Enoki wallet not found - required for Walrus storage')
    }
    
    const signer = await createEnokiSigner(enokiWallet, address, currentAccount)
  const blobId = await storeBlob(blobData, signer, 3)
    console.log('[Credentials] ✅ Credential stored on Walrus, blob ID:', blobId.substring(0, 32) + '...')

    // Get existing blob IDs if entry exists
    let blobIds: string[] = []
    if (exists) {
      const { getCredentialInfoFromDynamicField } = await import('./vault')
      const existingInfo = await getCredentialInfoFromDynamicField(vaultId, domainHash)
      if (existingInfo) {
        // Try to parse existing data as JSON array of blob IDs
        try {
          const existingDataStr = new TextDecoder().decode(existingInfo.data)
          blobIds = JSON.parse(existingDataStr)
          if (!Array.isArray(blobIds)) {
            // Old format - single encrypted credential, start fresh
            blobIds = []
          }
        } catch {
          // Old format - not JSON, start fresh
          blobIds = []
        }
      }
    }

    // Add new blob ID to array
    blobIds.push(blobId)
    console.log('[Credentials] Blob IDs array now has', blobIds.length, 'credential(s)')

  // Store JSON array of blob IDs in the data field. We intentionally store
  // sessionNonce and entryNonce on Walrus (inside the blob) and write
  // empty entry/session nonces on-chain for the dynamic field to avoid
  // leaking per-credential nonces on-chain.
  const blobIdsJson = JSON.stringify(blobIds)
  const blobIdsBytes = new TextEncoder().encode(blobIdsJson)

    console.log('[Credentials] Calling', exists ? 'update' : 'add', 'credential on blockchain...')
    if (exists) {
      const result = await updateCredential(
        vaultId,
        domainHash,
        blobIdsBytes, // Store blob IDs JSON instead of encrypted data
        new Uint8Array(0), // entryNonce left empty on-chain
        new Uint8Array(0), // sessionNonce left empty on-chain
        address,
        signAndExecute
      )
      console.log('[Credentials] Credential updated successfully')
      return result
    } else {
      const result = await addCredential(
        vaultId,
        domainHash,
        blobIdsBytes, // Store blob IDs JSON instead of encrypted data
        new Uint8Array(0), // entryNonce left empty on-chain
        new Uint8Array(0), // sessionNonce left empty on-chain
        address,
        signAndExecute
      )
      console.log('[Credentials] Credential added successfully')
      return result
    }
  } catch (error) {
    console.error('[Credentials] Error saving credential:', error)
    console.error('[Credentials] Error details:', {
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      credential: { domain: credential.domain, username: credential.username },
    })
    throw error
  }
}

export async function getCredential(
  domain: string,
  KM: string,
  address: string
): Promise<Credential[] | null> {
  console.log('[Credentials] getCredential called for domain:', domain, 'address:', address)
  
  const domainHashB64 = await hashDomain(domain, KM)
  const domainHash = Uint8Array.from(atob(domainHashB64), c => c.charCodeAt(0))
  console.log('[Credentials] Domain hash calculated, length:', domainHash.length)

  const { getUserVaultId } = await import('./vault')
  const vaultId = await getUserVaultId(address)
  if (!vaultId) {
    console.log('[Credentials] ❌ No vault found for address:', address)
    return null
  }
  console.log('[Credentials] ✅ Vault found:', vaultId)

  const exists = await checkCredentialExists(vaultId, domainHash, address)
  if (!exists) {
    console.log('[Credentials] ❌ Credential does not exist (checkCredentialExists returned false)')
    return null
  }
  console.log('[Credentials] ✅ Credential exists check passed')

  // Use getCredentialInfoFromDynamicField instead of getCredentialInfo
  // This directly queries the dynamic field object, which is more reliable
  const { getCredentialInfoFromDynamicField } = await import('./vault')
  const info = await getCredentialInfoFromDynamicField(vaultId, domainHash)
  if (!info) {
    console.log('[Credentials] ❌ getCredentialInfoFromDynamicField returned null - cannot retrieve credential data')
    return null
  }
  console.log('[Credentials] ✅ Credential info retrieved from dynamic field, data length:', info.data.length)
  // Detect whether this entry uses Walrus (new format) or stores encrypted bytes on-chain (old format)
  const onChainNoncesEmpty = info.entryNonce.length === 0 && info.sessionNonce.length === 0
  const dataPreview = new TextDecoder().decode(info.data).slice(0, 200)
  console.log('[Credentials] On-chain nonces empty?', onChainNoncesEmpty, 'data preview:', dataPreview)

  // Try to parse data as JSON array of blob IDs (new format)
  let blobIds: string[] = []
  try {
    const dataStr = new TextDecoder().decode(info.data)
    const parsed = JSON.parse(dataStr)
    const isBlobArray = Array.isArray(parsed) && parsed.every((x: any) => typeof x === 'string' && x.length > 0)
    if (!isBlobArray) {
      throw new Error('Data is not a blob-id array')
    }
    blobIds = parsed
    console.log('[Credentials] ✅ Parsed', blobIds.length, 'blob ID(s) from chain (new format)')
  } catch (error) {
    // Not a walrus blob-id array. If the on-chain nonces are empty this is suspicious
    // (data looked non-JSON but nonces are empty) — log that for debugging and fall
    // back to the legacy on-chain decryption path below.
    console.log('[Credentials] ⚠️ Not a walrus blob-id array. Falling back to on-chain decrypt (old format).', {
      onChainNoncesEmpty,
      parseError: error instanceof Error ? error.message : String(error),
      dataPreview,
    })
    const sessionNonceB64 = btoa(String.fromCharCode(...info.sessionNonce))
    const entryNonceB64 = btoa(String.fromCharCode(...info.entryNonce))
    const encryptedDataB64 = btoa(String.fromCharCode(...info.data))

    console.log('[Credentials] Deriving session key (KS)...')
    const KS = await deriveKS(KM, sessionNonceB64)
    console.log('[Credentials] Session key derived')

    const encryptedData = `${entryNonceB64}.${encryptedDataB64}`
    console.log('[Credentials] Decrypting credential data...')

    const decryptedData = await decrypt(encryptedData, KS)
    console.log('[Credentials] ✅ Data decrypted successfully, length:', decryptedData.length)
    
    let credentialData: { username: string; password: string; domain: string }
    try {
      credentialData = JSON.parse(decryptedData)
      console.log('[Credentials] ✅ Credential data parsed (old format)')
      
      if (!credentialData.username || typeof credentialData.username !== 'string') {
        throw new Error('Invalid credential data: username is required')
      }
      if (!credentialData.password || typeof credentialData.password !== 'string') {
        throw new Error('Invalid credential data: password is required')
      }
      
      return [{
        domain,
        username: credentialData.username,
        password: credentialData.password,
      }]
    } catch (error) {
      console.error('[Credentials] ❌ Failed to parse decrypted data:', error)
      throw new Error(`Failed to parse decrypted credential data: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  // New format - fetch blobs from Walrus
  if (blobIds.length === 0) {
    console.log('[Credentials] ❌ No blob IDs found')
    return null
  }

  console.log('[Credentials] Fetching', blobIds.length, 'blob(s) from Walrus...')
  const blobMap = await retrieveBlobs(blobIds)
  
  if (blobMap.size === 0) {
    console.log('[Credentials] ❌ No blobs retrieved from Walrus')
    return null
  }

  // Decrypt each blob. New blob format stores the per-credential sessionNonce
  // inside the blob payload, so we derive KS per-blob from KM + sessionNonce.
  const credentials: Credential[] = []

  for (const [blobId, blobData] of blobMap.entries()) {
    try {
      // New blob format: [sessionNonceLen(1)] [sessionNonce] [ivLen(1)] [iv] [ciphertext]
      if (blobData.length < 3) {
        console.warn('[Credentials] ⚠️ Blob too short:', blobId)
        continue
      }
      let offset = 0
      const snLen = blobData[offset++]
      if (blobData.length < 1 + snLen + 1) {
        console.warn('[Credentials] ⚠️ Blob too short for sessionNonce:', blobId)
        continue
      }
      const sessionNonceBytes = blobData.slice(offset, offset + snLen)
      offset += snLen
      const ivLength = blobData[offset++]
      if (blobData.length < offset + ivLength) {
        console.warn('[Credentials] ⚠️ Blob too short for IV:', blobId)
        continue
      }
      const entryNonce = blobData.slice(offset, offset + ivLength)
      offset += ivLength
      const encryptedDataBytes = blobData.slice(offset)

      const sessionNonceB64 = btoa(String.fromCharCode(...sessionNonceBytes))
      console.log('[Credentials] Deriving session key (KS) for blob:', blobId.substring(0, 12) + '...')
      const KS = await deriveKS(KM, sessionNonceB64)

      const entryNonceB64 = btoa(String.fromCharCode(...entryNonce))
      const encryptedDataB64 = btoa(String.fromCharCode(...encryptedDataBytes))
      const encryptedData = `${entryNonceB64}.${encryptedDataB64}`

      console.log('[Credentials] Decrypting blob:', blobId.substring(0, 32) + '...')
      const decryptedData = await decrypt(encryptedData, KS)
      
      const credentialData = JSON.parse(decryptedData)
      
      if (!credentialData.username || typeof credentialData.username !== 'string') {
        console.warn('[Credentials] ⚠️ Invalid credential data in blob:', blobId)
        continue
      }
      if (!credentialData.password || typeof credentialData.password !== 'string') {
        console.warn('[Credentials] ⚠️ Invalid credential data in blob:', blobId)
        continue
      }

      credentials.push({
        domain,
        username: credentialData.username,
        password: credentialData.password,
      })
      console.log('[Credentials] ✅ Decrypted credential:', credentialData.username)
    } catch (error) {
      console.error(`[Credentials] ❌ Failed to decrypt blob ${blobId}:`, error)
      // Continue with other blobs
    }
  }

  if (credentials.length === 0) {
    console.log('[Credentials] ❌ No valid credentials decrypted')
    return null
  }

  console.log('[Credentials] ✅ Returning', credentials.length, 'credential(s) for domain:', domain)
  return credentials
}

export async function getCredentialByDomainHash(
  domainHashB64: string,
  KM: string,
  address: string
): Promise<Credential[] | null> {
  // This variant works when you have the domain hash (as base64 string from the API)
  // instead of the domain string. It's useful for batch retrieval of all credentials.
  
  console.log('[Credentials] getCredentialByDomainHash called, hash:', domainHashB64.substring(0, 16) + '...')
  
  const domainHash = Uint8Array.from(atob(domainHashB64), c => c.charCodeAt(0))
  const { getUserVaultId } = await import('./vault')
  const vaultId = await getUserVaultId(address)
  
  if (!vaultId) {
    console.log('[Credentials] ❌ No vault found for address:', address)
    return null
  }
  console.log('[Credentials] ✅ Vault found:', vaultId)

  const exists = await checkCredentialExists(vaultId, domainHash, address)
  if (!exists) {
    console.log('[Credentials] ❌ Credential does not exist for this hash')
    return null
  }
  console.log('[Credentials] ✅ Credential exists check passed')

  const { getCredentialInfoFromDynamicField } = await import('./vault')
  const info = await getCredentialInfoFromDynamicField(vaultId, domainHash)
  if (!info) {
    console.log('[Credentials] ❌ getCredentialInfoFromDynamicField returned null')
    return null
  }
  console.log('[Credentials] ✅ Credential info retrieved from dynamic field')

  // Detect format: new (Walrus blob IDs) or old (on-chain encrypted)
  const onChainNoncesEmpty = info.entryNonce.length === 0 && info.sessionNonce.length === 0
  console.log('[Credentials] On-chain nonces empty?', onChainNoncesEmpty)

  // Try to parse data as JSON array of blob IDs (new format)
  let blobIds: string[] = []
  try {
    const dataStr = new TextDecoder().decode(info.data)
    const parsed = JSON.parse(dataStr)
    const isBlobArray = Array.isArray(parsed) && parsed.every((x: any) => typeof x === 'string' && x.length > 0)
    if (!isBlobArray) {
      throw new Error('Data is not a blob-id array')
    }
    blobIds = parsed
    console.log('[Credentials] ✅ Parsed', blobIds.length, 'blob ID(s) from chain (NEW FORMAT)')
  } catch (error) {
    // Not a walrus blob-id array. Fall back to on-chain decrypt (old format)
    console.log('[Credentials] ⚠️ Not a walrus blob-id array, using old-format on-chain decrypt')
    
    const sessionNonceB64 = btoa(String.fromCharCode(...info.sessionNonce))
    const entryNonceB64 = btoa(String.fromCharCode(...info.entryNonce))
    const encryptedDataB64 = btoa(String.fromCharCode(...info.data))

    console.log('[Credentials] Deriving session key (KS) for old-format...')
    const KS = await deriveKS(KM, sessionNonceB64)

    const encryptedData = `${entryNonceB64}.${encryptedDataB64}`
    console.log('[Credentials] Decrypting old-format credential data...')

    try {
      const decryptedData = await decrypt(encryptedData, KS)
      const credentialData = JSON.parse(decryptedData)
      
      if (!credentialData.username || typeof credentialData.username !== 'string') {
        throw new Error('Invalid credential data: username is required')
      }
      if (!credentialData.password || typeof credentialData.password !== 'string') {
        throw new Error('Invalid credential data: password is required')
      }
      
      return [{
        domain: credentialData.domain || 'unknown',
        username: credentialData.username,
        password: credentialData.password,
      }]
    } catch (decryptError) {
      console.error('[Credentials] ❌ Failed to decrypt old-format credential:', decryptError)
      throw decryptError
    }
  }

  // New format: fetch blobs from Walrus
  if (blobIds.length === 0) {
    console.log('[Credentials] ❌ No blob IDs found')
    return null
  }

  console.log('[Credentials] Fetching', blobIds.length, 'blob(s) from Walrus...')
  const blobMap = await retrieveBlobs(blobIds)
  
  if (blobMap.size === 0) {
    console.log('[Credentials] ❌ No blobs retrieved from Walrus')
    return null
  }

  // Decrypt each blob
  const credentials: Credential[] = []

  for (const [blobId, blobData] of blobMap.entries()) {
    try {
      // Blob format: [sessionNonceLen(1)] [sessionNonce] [ivLen(1)] [iv] [ciphertext]
      if (blobData.length < 3) {
        console.warn('[Credentials] ⚠️ Blob too short:', blobId)
        continue
      }
      let offset = 0
      const snLen = blobData[offset++]
      if (blobData.length < 1 + snLen + 1) {
        console.warn('[Credentials] ⚠️ Blob too short for sessionNonce:', blobId)
        continue
      }
      const sessionNonceBytes = blobData.slice(offset, offset + snLen)
      offset += snLen
      const ivLength = blobData[offset++]
      if (blobData.length < offset + ivLength) {
        console.warn('[Credentials] ⚠️ Blob too short for IV:', blobId)
        continue
      }
      const entryNonce = blobData.slice(offset, offset + ivLength)
      offset += ivLength
      const encryptedDataBytes = blobData.slice(offset)

      const sessionNonceB64 = btoa(String.fromCharCode(...sessionNonceBytes))
      console.log('[Credentials] Deriving session key (KS) for blob:', blobId.substring(0, 12) + '...')
      const KS = await deriveKS(KM, sessionNonceB64)

      const entryNonceB64 = btoa(String.fromCharCode(...entryNonce))
      const encryptedDataB64 = btoa(String.fromCharCode(...encryptedDataBytes))
      const encryptedData = `${entryNonceB64}.${encryptedDataB64}`

      console.log('[Credentials] Decrypting blob:', blobId.substring(0, 32) + '...')
      const decryptedData = await decrypt(encryptedData, KS)
      
      const credentialData = JSON.parse(decryptedData)
      
      if (!credentialData.username || typeof credentialData.username !== 'string') {
        console.warn('[Credentials] ⚠️ Invalid credential data in blob:', blobId)
        continue
      }
      if (!credentialData.password || typeof credentialData.password !== 'string') {
        console.warn('[Credentials] ⚠️ Invalid credential data in blob:', blobId)
        continue
      }

      credentials.push({
        domain: credentialData.domain || 'unknown',
        username: credentialData.username,
        password: credentialData.password,
      })
      console.log('[Credentials] ✅ Decrypted credential:', credentialData.domain)
    } catch (error) {
      console.error(`[Credentials] ❌ Failed to decrypt blob ${blobId}:`, error)
      // Continue with other blobs
    }
  }

  if (credentials.length === 0) {
    console.log('[Credentials] ❌ No valid credentials decrypted')
    return null
  }

  console.log('[Credentials] ✅ Returning', credentials.length, 'credential(s)')
  return credentials
}

export async function credentialExists(
  domain: string,
  address: string,
  KM?: string
): Promise<boolean> {
  const { getUserVaultId } = await import('./vault')
  const vaultId = await getUserVaultId(address)
  if (!vaultId) {
    return false
  }

  if (KM) {
    const domainHashB64 = await hashDomain(domain, KM)
    const domainHash = Uint8Array.from(atob(domainHashB64), c => c.charCodeAt(0))
    return checkCredentialExists(vaultId, domainHash, address)
  }

  return false
}

/**
 * Delete a credential from the vault
 */
export async function deleteCredential(
  domain: string,
  KM: string,
  address: string,
  signAndExecute: (params: { transaction: any }) => Promise<any>
): Promise<string> {
  try {
    console.log('[Credentials] Starting delete credential for domain:', domain)
    
    // Get domain hash
    const domainHashB64 = await hashDomain(domain, KM)
    const domainHash = Uint8Array.from(atob(domainHashB64), c => c.charCodeAt(0))
    
    // Get or create vault 
    const vaultId = await getOrCreateVault(address, signAndExecute)
    console.log('[Credentials] Using vault ID:', vaultId)
    
    // Check if credential exists
    const exists = await checkCredentialExists(vaultId, domainHash, address)
    if (!exists) {
      throw new Error(`No credential found for domain: ${domain}`)
    }
    
    // Import delete function from vault
    const { deleteCredential: deleteFromVault } = await import('./vault')
    
    // Delete from vault
    console.log('[Credentials] Deleting from vault...')
    const txHash = await deleteFromVault(vaultId, domainHash, signAndExecute)
    
    console.log('[Credentials] ✅ Credential deleted successfully')
    console.log('[Credentials] Transaction hash:', txHash)
    
    return txHash
  } catch (error) {
    console.error('[Credentials] Error deleting credential:', error)
    console.error('[Credentials] Error details:', {
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      domain,
      address,
    })
    throw error
  }
}

