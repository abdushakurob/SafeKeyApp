export function base64Encode(bytes: Uint8Array): string {
  if (bytes.length > 8192) {
    let binary = ''
    for (let i = 0; i < bytes.length; i += 8192) {
      const chunk = bytes.slice(i, Math.min(i + 8192, bytes.length))
      binary += String.fromCharCode(...chunk)
    }
    return btoa(binary)
  }
  return btoa(String.fromCharCode(...bytes))
}

function base64Decode(str: string): Uint8Array {
  const binary = atob(str)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}

export function generateNonce(length: number = 12): string {
  const bytes = new Uint8Array(length)
  crypto.getRandomValues(bytes)
  return base64Encode(bytes)
}

export function generateSessionNonce(): string {
  return generateNonce(16)
}

export async function hashDomain(domain: string, KM: string): Promise<string> {
  try {
    const kmBytes = base64Decode(KM)
    const key = await crypto.subtle.importKey(
      'raw',
      kmBytes.buffer as ArrayBuffer,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    )
    const domainBytes = new TextEncoder().encode(domain.toLowerCase().trim())
    const hashBuffer = await crypto.subtle.sign('HMAC', key, domainBytes.buffer as ArrayBuffer)
    const hashBytes = new Uint8Array(hashBuffer)
    return base64Encode(hashBytes)
  } catch (error) {
    console.error('Error hashing domain:', error)
    throw new Error('Failed to hash domain')
  }
}

export async function deriveKS(KM: string, sessionNonce: string): Promise<string> {
  try {
    const kmBytes = base64Decode(KM)
    const nonceBytes = base64Decode(sessionNonce)
    const kmKey = await crypto.subtle.importKey(
      'raw',
      kmBytes.buffer as ArrayBuffer,
      { name: 'HKDF' },
      false,
      ['deriveBits', 'deriveKey']
    )
    const derivedBits = await crypto.subtle.deriveBits(
      {
        name: 'HKDF',
        hash: 'SHA-256',
        salt: new Uint8Array(0).buffer as ArrayBuffer,
        info: nonceBytes.buffer as ArrayBuffer,
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

export async function encrypt(data: string, key: string): Promise<string> {
  try {
    const keyBytes = base64Decode(key)
    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      keyBytes.buffer as ArrayBuffer,
      { name: 'AES-GCM' },
      false,
      ['encrypt']
    )
    const iv = new Uint8Array(12)
    crypto.getRandomValues(iv)
    const dataBytes = new TextEncoder().encode(data)
    const encryptedData = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: iv.buffer as ArrayBuffer },
      cryptoKey,
      dataBytes.buffer as ArrayBuffer
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

export async function decrypt(encryptedData: string, key: string): Promise<string> {
  try {
    const parts = encryptedData.split('.')
    if (parts.length !== 2) {
      throw new Error(`Invalid encrypted data format. Expected "iv.ciphertext", got ${parts.length} parts`)
    }
    const ivB64 = parts[0]
    const ciphertextB64 = parts[1]
    const iv = base64Decode(ivB64)
    const ciphertextBytes = base64Decode(ciphertextB64)
    const keyBytes = base64Decode(key)
    
    console.log('[Crypto] Decrypting with:', {
      ivLength: iv.length,
      ciphertextLength: ciphertextBytes.length,
      keyLength: keyBytes.length,
      expectedMinCiphertext: 16,
    })
    
    if (iv.length !== 12) {
      throw new Error(`Invalid IV length: expected 12 bytes, got ${iv.length}`)
    }
    
    if (ciphertextBytes.length < 16) {
      throw new Error(`Ciphertext too short: expected at least 16 bytes (for auth tag), got ${ciphertextBytes.length}`)
    }
    
    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      keyBytes.buffer as ArrayBuffer,
      { name: 'AES-GCM' },
      false,
      ['decrypt']
    )
    const decryptedData = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: iv.buffer as ArrayBuffer },
      cryptoKey,
      ciphertextBytes.buffer as ArrayBuffer
    )
    return new TextDecoder().decode(decryptedData)
  } catch (error) {
    console.error('Error decrypting data:', error)
    if (error instanceof Error) {
      console.error('Error details:', {
        message: error.message,
        name: error.name,
        cause: (error as any).cause,
      })
    }
    throw new Error(`Failed to decrypt data: ${error instanceof Error ? error.message : String(error)}`)
  }
}

export async function deriveSessionKey(
  masterKey: Uint8Array | string,
  sessionNonce: Uint8Array | string
): Promise<string> {
  const KM = typeof masterKey === 'string' ? masterKey : base64Encode(masterKey)
  const nonce = typeof sessionNonce === 'string' ? sessionNonce : base64Encode(sessionNonce)
  return deriveKS(KM, nonce)
}

