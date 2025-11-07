/**
 * Example: How to use the crypto functions from src/lib/crypto.ts
 * This shows practical usage patterns for your SafeKey extension.
 */

import {
  generateSessionNonce,
  generateRandomKey,
  deriveKS,
  encrypt,
  decrypt,
  hashDomain,
  deriveKey,
} from '../crypto'

/**
 * EXAMPLE 1: Generate Master Key on First Setup
 */
export async function setupMasterKey(): Promise<string> {
  // Generate a random master key (256-bit = 32 bytes)
  const KM = generateRandomKey(32)
  console.log('Master key generated (base64):', KM)

  // Save this securely (use chrome.storage with encryption later)
  // For now, just log it
  return KM
}

/**
 * EXAMPLE 2: Derive Session Key from Master Key
 */
export async function setupSessionKey(KM: string): Promise<string> {
  // Generate a session nonce (unique for each session)
  const sessionNonce = generateSessionNonce()
  console.log('Session nonce:', sessionNonce)

  // Derive the session key from master key + nonce
  const KS = await deriveKS(KM, sessionNonce)
  console.log('Session key derived (base64):', KS)

  return KS
}

/**
 * EXAMPLE 3: Encrypt Sensitive Data (e.g., password, token)
 */
export async function encryptSensitiveData(
  data: string,
  sessionKey: string
): Promise<string> {
  // Encrypt using AES-256-GCM
  const encrypted = await encrypt(data, sessionKey)
  console.log('Encrypted:', encrypted)
  // Format: "iv.ciphertext" (both base64)

  return encrypted
}

/**
 * EXAMPLE 4: Decrypt Data
 */
export async function decryptSensitiveData(
  encryptedData: string,
  sessionKey: string
): Promise<string> {
  // Decrypt using AES-256-GCM
  const decrypted = await decrypt(encryptedData, sessionKey)
  console.log('Decrypted:', decrypted)

  return decrypted
}

/**
 * EXAMPLE 5: Hash Domain for Site-Specific Keys
 * Useful if you want each site to have a different derived password/key
 */
export async function generateDomainHash(
  domain: string,
  KM: string
): Promise<string> {
  // Hash domain with master key
  const domainHash = await hashDomain(domain, KM)
  console.log(`Domain hash for ${domain}:`, domainHash)

  return domainHash
}

/**
 * EXAMPLE 6: Full Workflow - Setup → Encrypt → Decrypt
 */
export async function fullWorkflowExample() {
  console.log('=== Full SafeKey Crypto Workflow ===\n')

  // 1. User sets up SafeKey and creates a master key
  const KM = generateRandomKey(32)
  console.log('1. Master Key (KM):', KM.substring(0, 20) + '...')

  // 2. Create a new session
  const sessionNonce = generateSessionNonce()
  const KS = await deriveKS(KM, sessionNonce)
  console.log('2. Session Key (KS) derived from KM + nonce')

  // 3. User wants to save a password for example.com
  const domain = 'example.com'
  const password = 'MySecretPassword123'

  // 4. Hash the domain
  const domainHash = await hashDomain(domain, KM)
  console.log(`3. Domain hash for ${domain} computed`)

  // 5. Encrypt the password using session key
  const encrypted = await encrypt(password, KS)
  console.log(`4. Password encrypted: ${encrypted.substring(0, 30)}...`)

  // 6. Store the encrypted password (along with domain hash and IV)
  // In real use: save to chrome.storage.local
  const vault = {
    domain,
    domainHash,
    encryptedPassword: encrypted,
    timestamp: new Date().toISOString(),
  }
  console.log('5. Vault entry created')

  // 7. Later: retrieve and decrypt
  const decrypted = await decrypt(vault.encryptedPassword, KS)
  console.log(`6. Password decrypted: ${decrypted}`)

  console.log('\n✅ Workflow complete!')
  return vault
}

/**
 * EXAMPLE 7: Derive Multiple Keys from Master Key (for different purposes)
 * Useful if you want separate keys for encryption, signing, etc.
 */
export async function deriveMultipleKeys(KM: string) {
  // Derive encryption key
  const encryptionKey = await deriveKey(KM, 'encryption')
  console.log('Encryption key:', encryptionKey.substring(0, 20) + '...')

  // Derive signing key
  const signingKey = await deriveKey(KM, 'signing')
  console.log('Signing key:', signingKey.substring(0, 20) + '...')

  // Derive auth key
  const authKey = await deriveKey(KM, 'auth')
  console.log('Auth key:', authKey.substring(0, 20) + '...')

  return { encryptionKey, signingKey, authKey }
}

/**
 * PRACTICAL: Store encrypted data in popup and background
 * This is how you'd integrate into your extension
 */
export async function extensionIntegrationExample() {
  // In popup.tsx:
  // 1. User enters master passphrase
  // 2. Derive KM from passphrase using Argon2 (or PBKDF2)
  // 3. Send KM to background worker
  // 4. Background derives session key and stores in memory

  // In background.ts:
  // 1. Receive KM from popup
  // 2. Generate session nonce
  // 3. Derive KS = deriveKS(KM, sessionNonce)
  // 4. For each domain: hashDomain(domain, KM)
  // 5. Encrypt passwords: encrypt(password, KS)
  // 6. Store: {domainHash, encryptedPassword, iv}

  // In content.ts:
  // 1. Detect current domain
  // 2. Send domain to background
  // 3. Background computes domainHash
  // 4. Background finds matching vault entry
  // 5. Background decrypts using KS
  // 6. Content fills the password field

  console.log('See comments for integration patterns')
}

// Quick test - uncomment to run
// (async () => {
//   await fullWorkflowExample()
// })()
