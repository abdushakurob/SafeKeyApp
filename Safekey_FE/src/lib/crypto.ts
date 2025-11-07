/**
 *  deriveKS, encrypt, decrypt, hashDomain, random nonce generation
 */

/**
 * Generate a random nonce (cryptographically secure)
 * @param length - Length of nonce in bytes (default: 12 for GCM IV)
 * @returns Base64-encoded nonce
 */
export function generateNonce(length: number = 12): string {
  const bytes = new Uint8Array(length)
  crypto.getRandomValues(bytes)
  return base64Encode(bytes)
}

/**
 * Generate a random session nonce
 * @returns Base64-encoded 16-byte nonce
 */
export function generateSessionNonce(): string {
  return generateNonce(16)
}

/**
 * Base64 encode Uint8Array
 */
function base64Encode(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
}

/**
 * Base64 decode to Uint8Array
 */
function base64Decode(str: string): Uint8Array {
  const binary = atob(str)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}

/**
 * Derive a session key from master key and session nonce
 * Uses HKDF-SHA256: KS = HKDF-Expand(KM, sessionNonce)
 * @param KM - Master key (base64-encoded)
 * @param sessionNonce - Session nonce (base64-encoded)
 * @returns Promise<string> - Session key (base64-encoded)
 */
export async function deriveKS(KM: string, sessionNonce: string): Promise<string> {
  try {
    const kmBytes = base64Decode(KM)
    const nonceBytes = base64Decode(sessionNonce)
    const kmKey = await crypto.subtle.importKey(
      'raw',
      kmBytes as any,
      { name: 'HKDF' },
      false,
      ['deriveBits', 'deriveKey']
    )
    const derivedBits = await crypto.subtle.deriveBits(
      {
        name: 'HKDF',
        hash: 'SHA-256',
        salt: new Uint8Array(0) as any,
        info: nonceBytes as any,
      },
      kmKey,
      256
    )
    const derivedBytes = new Uint8Array(derivedBits)
    return base64Encode(derivedBytes)
  } catch (error) {
    console.error('Error deriving session key:', error)
    throw new Error('Failed to derive session key')
  }
}

/**
 * Encrypt data using AES-256-GCM
 * @param data - Data to encrypt (base64-encoded string or string)
 * @param key - Encryption key (base64-encoded)
 * @returns Promise<string> - Encrypted data in format: "iv.ciphertext.tag" (all base64)
 */
export async function encrypt(data: string, key: string): Promise<string> {
  try {
    const keyBytes = base64Decode(key)
    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      keyBytes as any,
      { name: 'AES-GCM' },
      false,
      ['encrypt']
    )
    const iv = new Uint8Array(12)
    crypto.getRandomValues(iv)
    const dataBytes = new TextEncoder().encode(data)
    const encryptedData = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: iv as any },
      cryptoKey,
      dataBytes as any
    )
    const encryptedBytes = new Uint8Array(encryptedData)
    const encryptedB64 = base64Encode(encryptedBytes)
    const ivB64 = base64Encode(iv)
    return `${ivB64}.${encryptedB64}`
  } catch (error) {
    console.error('Error encrypting data:', error)
    throw new Error('Failed to encrypt data')
  }
}

/**
 * Decrypt data using AES-256-GCM
 * @param encryptedData - Encrypted data in format: "iv.ciphertext.tag" (all base64)
 * @param key - Decryption key (base64-encoded)
 * @returns Promise<string> - Decrypted data
 */
export async function decrypt(encryptedData: string, key: string): Promise<string> {
  try {
    const parts = encryptedData.split('.')
    if (parts.length !== 2) throw new Error('Invalid encrypted data format. Expected "iv.ciphertext"')
    const ivB64 = parts[0]
    const ciphertextB64 = parts[1]
    const iv = base64Decode(ivB64)
    const ciphertextBytes = base64Decode(ciphertextB64)
    const keyBytes = base64Decode(key)
    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      keyBytes as any,
      { name: 'AES-GCM' },
      false,
      ['decrypt']
    )
    const decryptedData = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: iv as any },
      cryptoKey,
      ciphertextBytes as any
    )
    return new TextDecoder().decode(decryptedData)
  } catch (error) {
    console.error('Error decrypting data:', error)
    throw new Error('Failed to decrypt data')
  }
}

/**
 * Hash a domain with master key using HMAC-SHA256
 * domain_hash = HMAC-SHA256(KM, domain)
 * @param domain - Domain to hash (e.g., "example.com")
 * @param KM - Master key (base64-encoded)
 * @returns Promise<string> - Domain hash (base64-encoded)
 */
export async function hashDomain(domain: string, KM: string): Promise<string> {
  try {
    const kmBytes = base64Decode(KM)
    const key = await crypto.subtle.importKey(
      'raw',
      kmBytes as any,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    )
    const domainBytes = new TextEncoder().encode(domain)
    const hashBuffer = await crypto.subtle.sign('HMAC', key, domainBytes as any)
    const hashBytes = new Uint8Array(hashBuffer)
    return base64Encode(hashBytes)
  } catch (error) {
    console.error('Error hashing domain:', error)
    throw new Error('Failed to hash domain')
  }
}

/**
 * Generate a random key (for master key or other uses)
 * @param length - Key length in bytes (default: 32 for 256-bit key)
 * @returns Base64-encoded random key
 */
export function generateRandomKey(length: number = 32): string {
  const bytes = new Uint8Array(length)
  crypto.getRandomValues(bytes)
  return base64Encode(bytes)
}

/**
 * Derive multiple keys from a master key using HKDF
 * Useful for deriving different keys for different purposes (encrypt, sign, etc.)
 * @param KM - Master key (base64-encoded)
 * @param salt - Optional salt
 * @param info - Context info (e.g., "encryption" or "signing")
 * @param length - Derived key length in bytes (default: 32)
 * @returns Promise<string> - Derived key (base64-encoded)
 */
export async function deriveKey(KM: string, info: string, salt?: string, length: number = 32): Promise<string> {
  try {
    const kmBytes = base64Decode(KM)
    const infoBytes = new TextEncoder().encode(info)
    const saltBytes = salt ? base64Decode(salt) : new Uint8Array(0)
    const kmKey = await crypto.subtle.importKey(
      'raw',
      kmBytes as any,
      { name: 'HKDF' },
      false,
      ['deriveBits']
    )
    const derivedBits = await crypto.subtle.deriveBits(
      { name: 'HKDF', hash: 'SHA-256', salt: saltBytes as any, info: infoBytes as any },
      kmKey,
      length * 8
    )
    const derivedBytes = new Uint8Array(derivedBits)
    return base64Encode(derivedBytes)
  } catch (error) {
    console.error('Error deriving key:', error)
    throw new Error('Failed to derive key')
  }
}

/**
 * Utility: Convert hex string to Uint8Array
 */
export function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2)
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substr(i, 2), 16)
  }
  return bytes
}

/**
 * Utility: Convert Uint8Array to hex string
 */
export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}
