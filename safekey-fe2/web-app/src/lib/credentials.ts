import { hashDomain, encrypt, decrypt, deriveKS, generateSessionNonce } from './crypto'
import {
  getOrCreateVault,
  checkCredentialExists,
  addCredential,
  updateCredential,
} from './vault'

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
    return await deriveMasterKeyFromSeal(address, idToken, wallets, currentAccount, signAndExecute)
  }

  throw new Error('Cannot derive master key: SEAL requires wallets and currentAccount. Use stored master key from session instead.')
}

export async function saveCredential(
  credential: Credential,
  KM: string,
  address: string,
  signAndExecute: (params: { transaction: any }) => Promise<any>
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

    const sessionNonce = generateSessionNonce()
    console.log('[Credentials] Generated session nonce')

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
    const sessionNonceBytes = Uint8Array.from(atob(sessionNonce), c => c.charCodeAt(0))

    console.log('[Credentials] Calling', exists ? 'update' : 'add', 'credential on blockchain...')
    if (exists) {
      const result = await updateCredential(
        vaultId,
        domainHash,
        encryptedData,
        entryNonce,
        sessionNonceBytes,
        address,
        signAndExecute
      )
      console.log('[Credentials] Credential updated successfully')
      return result
    } else {
      const result = await addCredential(
        vaultId,
        domainHash,
        encryptedData,
        entryNonce,
        sessionNonceBytes,
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
): Promise<Credential | null> {
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
    console.log('[Credentials] ✅ Credential data parsed:', {
      domain: credentialData.domain,
      username: credentialData.username,
      hasPassword: !!credentialData.password
    })
  } catch (error) {
    console.error('[Credentials] ❌ Failed to parse decrypted data:', error)
    throw new Error(`Failed to parse decrypted credential data: ${error instanceof Error ? error.message : String(error)}`)
  }

  if (!credentialData.username || typeof credentialData.username !== 'string') {
    throw new Error('Invalid credential data: username is required')
  }
  if (!credentialData.password || typeof credentialData.password !== 'string') {
    throw new Error('Invalid credential data: password is required')
  }
  if (!credentialData.domain || typeof credentialData.domain !== 'string') {
    throw new Error('Invalid credential data: domain is required')
  }

  console.log('[Credentials] ✅ Returning credential for domain:', domain)
  return {
    domain,
    username: credentialData.username,
    password: credentialData.password,
  }
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

