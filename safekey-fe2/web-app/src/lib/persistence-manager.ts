/**
 * Secure Persistence Manager - Handles caching of sensitive data with strong encryption
 */

import { encrypt, decrypt } from './crypto'
import { SecurityValidator, SecureErrorHandler, ValidationError } from './security-utils'

interface PersistedSession {
  address: string
  idToken: string
  provider: string
  createdAt: number
  masterKey: string
  timestamp: number
  expiresAt: number
  sessionId: string
  integrity: string
}

interface PersistedCredentials {
  credentials: Array<{ domain: string; username: string; password?: string }>
  timestamp: number
  expiresAt: number
  sessionId: string
  integrity: string
}

interface StoredData {
  data: string
  salt: string
  iv: string
  iterations: number
  timestamp: number
  expiresAt: number
}

class SecurePersistenceManager {
  private readonly SESSION_KEY = 'safekey_session_encrypted'
  private readonly CREDENTIALS_KEY = 'safekey_credentials_encrypted'
  private readonly SESSION_TTL = 8 * 60 * 60 * 1000 // 8 hours (reduced from 24)
  private readonly CREDENTIALS_TTL = 5 * 60 * 1000 // 5 minutes (reduced from 10)
  private readonly PBKDF2_ITERATIONS = 600000 // OWASP recommended minimum
  private readonly KEY_LENGTH = 32 // 256-bit keys
  private readonly SALT_LENGTH = 16 // 128-bit salt
  private readonly IV_LENGTH = 12 // 96-bit IV for AES-GCM

  // Secure memory management for temporary keys
  private tempKeys = new Map<string, Uint8Array>()
  private cleanupTimers = new Map<string, NodeJS.Timeout>()

  /**
   * Generate cryptographically secure salt
   */
  private generateSalt(): Uint8Array {
    return crypto.getRandomValues(new Uint8Array(this.SALT_LENGTH))
  }

  /**
   * Generate cryptographically secure IV
   */
  private generateIV(): Uint8Array {
    return crypto.getRandomValues(new Uint8Array(this.IV_LENGTH))
  }

  /**
   * Generate strong session ID
   */
  private generateSessionId(): string {
    const randomBytes = crypto.getRandomValues(new Uint8Array(32))
    return Array.from(randomBytes, byte => byte.toString(16).padStart(2, '0')).join('')
  }

  /**
   * Derive encryption key using secure PBKDF2
   */
  private async deriveKey(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
    const encoder = new TextEncoder()
    const passwordBuffer = encoder.encode(password)
    
    try {
      const baseKey = await crypto.subtle.importKey(
        'raw',
        passwordBuffer,
        { name: 'PBKDF2' },
        false,
        ['deriveBits']
      )

      // Ensure we have an ArrayBuffer, not SharedArrayBuffer
      const saltBuffer = salt.buffer instanceof ArrayBuffer 
        ? salt.buffer.slice(salt.byteOffset, salt.byteOffset + salt.byteLength)
        : salt.slice().buffer

      const keyBits = await crypto.subtle.deriveBits(
        {
          name: 'PBKDF2',
          salt: saltBuffer,
          iterations: iterations,
          hash: 'SHA-256'
        },
        baseKey,
        this.KEY_LENGTH * 8
      )

      return new Uint8Array(keyBits)
    } finally {
      // Clear password from memory
      passwordBuffer.fill(0)
    }
  }

  /**
   * Generate secure encryption key from user data (deterministic for session restoration)
   */
  private async generateEncryptionKey(address: string, idToken: string, salt: Uint8Array): Promise<Uint8Array> {
    // Combine address and idToken (deterministic, no entropy for restoration)
    const combined = `${address}:${idToken}`
    
    return await this.deriveKey(combined, salt, this.PBKDF2_ITERATIONS)
  }

  /**
   * Calculate integrity hash for data validation
   */
  private async calculateIntegrity(data: string, key: Uint8Array): Promise<string> {
    const encoder = new TextEncoder()
    const dataBuffer = encoder.encode(data)
    const combinedBuffer = new Uint8Array(dataBuffer.length + key.length)
    combinedBuffer.set(dataBuffer)
    combinedBuffer.set(key, dataBuffer.length)
    
    try {
      const hashBuffer = await crypto.subtle.digest('SHA-256', combinedBuffer)
      return Array.from(new Uint8Array(hashBuffer), byte => byte.toString(16).padStart(2, '0')).join('')
    } finally {
      // Clear sensitive buffers
      combinedBuffer.fill(0)
      dataBuffer.fill(0)
    }
  }

  /**
   * Securely clear key from memory
   */
  private clearKey(keyId: string): void {
    const key = this.tempKeys.get(keyId)
    if (key) {
      key.fill(0) // Zero out the key
      this.tempKeys.delete(keyId)
    }
    
    const timer = this.cleanupTimers.get(keyId)
    if (timer) {
      clearTimeout(timer)
      this.cleanupTimers.delete(keyId)
    }
  }

  /**
   * Store session data encrypted in localStorage with strong security
   */
  async storeSession(sessionData: {
    address: string
    idToken: string
    provider: string
    createdAt: number
    masterKey: string
  }): Promise<void> {
    try {
      // Validate input data
      SecurityValidator.validateSessionData(sessionData)
      
      const now = Date.now()
      const expiresAt = now + this.SESSION_TTL
      const sessionId = this.generateSessionId()
      const salt = this.generateSalt()
      
      // Generate encryption key
      const encryptionKey = await this.generateEncryptionKey(
        sessionData.address, 
        sessionData.idToken, 
        salt
      )
      
      const persistedSession: PersistedSession = {
        ...sessionData,
        timestamp: now,
        expiresAt,
        sessionId,
        integrity: '' // Will be calculated after JSON.stringify
      }

      const dataToEncrypt = JSON.stringify(persistedSession)
      const integrity = await this.calculateIntegrity(dataToEncrypt, encryptionKey)
      persistedSession.integrity = integrity

      // Use our crypto functions with base64 encoding for compatibility
      const encryptionKeyBase64 = btoa(String.fromCharCode(...encryptionKey))
      const encryptedData = await encrypt(JSON.stringify(persistedSession), encryptionKeyBase64)
      
      const storedData: StoredData = {
        data: encryptedData,
        salt: btoa(String.fromCharCode(...salt)),
        iv: btoa(String.fromCharCode(...this.generateIV())),
        iterations: this.PBKDF2_ITERATIONS,
        timestamp: now,
        expiresAt
      }
      
      localStorage.setItem(this.SESSION_KEY, JSON.stringify(storedData))
      
      // Clear encryption key from memory
      encryptionKey.fill(0)
      
      console.log('[Persistence] Session stored with strong encryption')
    } catch (error) {
      SecureErrorHandler.logError(error, 'PersistenceManager.storeSession')
      
      if (error instanceof ValidationError) {
        throw error // Re-throw validation errors
      }
      
      throw new Error('Failed to store session securely')
    }
  }

  /**
   * Retrieve session data if it matches current session and is valid
   */
  async getSessionIfValid(currentAddress: string, currentIdToken: string): Promise<PersistedSession | null> {
    try {
      // Validate inputs
      SecurityValidator.validateSuiAddress(currentAddress)
      SecurityValidator.validateJWT(currentIdToken)
      
      const storedDataStr = localStorage.getItem(this.SESSION_KEY)
      if (!storedDataStr) {
        return null
      }

      const storedData: StoredData = JSON.parse(storedDataStr)
      const now = Date.now()

      // Check expiration
      if (now > storedData.expiresAt) {
        console.log('[Persistence] Session expired, removing')
        this.clearSession()
        return null
      }

      // Recreate encryption key
      const salt = new Uint8Array(atob(storedData.salt).split('').map(c => c.charCodeAt(0)))
      const encryptionKey = await this.generateEncryptionKey(currentAddress, currentIdToken, salt)
      const encryptionKeyBase64 = btoa(String.fromCharCode(...encryptionKey))

      try {
        const decryptedData = await decrypt(storedData.data, encryptionKeyBase64)
        const session: PersistedSession = JSON.parse(decryptedData)

        // Validate session matches current user
        if (session.address !== currentAddress || session.idToken !== currentIdToken) {
          console.log('[Persistence] Session mismatch, removing')
          this.clearSession()
          return null
        }

        // Verify data integrity
        const expectedIntegrity = await this.calculateIntegrity(
          JSON.stringify({...session, integrity: ''}), 
          encryptionKey
        )
        
        if (session.integrity !== expectedIntegrity) {
          SecureErrorHandler.logError('Session integrity check failed', 'PersistenceManager.getSessionIfValid')
          this.clearSession()
          return null
        }

        console.log('[Persistence] Valid session found and verified')
        return session
      } finally {
        // Clear encryption key from memory
        encryptionKey.fill(0)
      }
    } catch (error) {
      SecureErrorHandler.logError(error, 'PersistenceManager.getSessionIfValid')
      
      // On any error, clear session for security
      this.clearSession()
      
      if (error instanceof ValidationError) {
        return null // Don't throw validation errors, just return null
      }
      
      return null
    }
  }

  /**
   * Store credentials encrypted in sessionStorage with strong security
   */
  async storeCredentials(
    credentials: Array<{ domain: string; username: string; password?: string }>,
    masterKey: string
  ): Promise<void> {
    try {
      // Validate inputs
      if (!Array.isArray(credentials)) {
        throw new ValidationError('credentials', 'Credentials must be an array')
      }
      
      if (!masterKey || typeof masterKey !== 'string') {
        throw new ValidationError('masterKey', 'Master key is required and must be a string')
      }
      
      // Validate each credential
      for (let i = 0; i < credentials.length; i++) {
        try {
          SecurityValidator.validateCredentialData(credentials[i])
        } catch (error) {
          throw new ValidationError(`credentials[${i}]`, error instanceof Error ? error.message : 'Invalid credential')
        }
      }
      
      const now = Date.now()
      const expiresAt = now + this.CREDENTIALS_TTL
      const sessionId = this.generateSessionId()
      const salt = this.generateSalt()
      
      // Use master key as password for PBKDF2
      const encryptionKey = await this.deriveKey(masterKey, salt, this.PBKDF2_ITERATIONS)
      
      const persistedCredentials: PersistedCredentials = {
        credentials,
        timestamp: now,
        expiresAt,
        sessionId,
        integrity: '' // Will be calculated after JSON.stringify
      }

      const dataToEncrypt = JSON.stringify(persistedCredentials)
      const integrity = await this.calculateIntegrity(dataToEncrypt, encryptionKey)
      persistedCredentials.integrity = integrity

      const encryptionKeyBase64 = btoa(String.fromCharCode(...encryptionKey))
      const encryptedData = await encrypt(JSON.stringify(persistedCredentials), encryptionKeyBase64)
      
      const storedData: StoredData = {
        data: encryptedData,
        salt: btoa(String.fromCharCode(...salt)),
        iv: btoa(String.fromCharCode(...this.generateIV())),
        iterations: this.PBKDF2_ITERATIONS,
        timestamp: now,
        expiresAt
      }

      sessionStorage.setItem(this.CREDENTIALS_KEY, JSON.stringify(storedData))
      
      // Clear encryption key from memory
      encryptionKey.fill(0)
      
      console.log('[Persistence] Credentials cached with strong encryption')
    } catch (error) {
      SecureErrorHandler.logError(error, 'PersistenceManager.storeCredentials')
      
      if (error instanceof ValidationError) {
        throw error // Re-throw validation errors
      }
      
      throw new Error('Failed to store credentials securely')
    }
  }

  /**
   * Retrieve cached credentials with integrity verification
   */
  async getCredentials(masterKey: string): Promise<Array<{ domain: string; username: string; password?: string }> | null> {
    try {
      const storedDataStr = sessionStorage.getItem(this.CREDENTIALS_KEY)
      if (!storedDataStr) {
        return null
      }

      const storedData: StoredData = JSON.parse(storedDataStr)
      const now = Date.now()

      // Check expiration
      if (now > storedData.expiresAt) {
        console.log('[Persistence] Credentials cache expired')
        this.clearCredentials()
        return null
      }

      // Recreate encryption key
      const salt = new Uint8Array(atob(storedData.salt).split('').map(c => c.charCodeAt(0)))
      const encryptionKey = await this.deriveKey(masterKey, salt, storedData.iterations)
      const encryptionKeyBase64 = btoa(String.fromCharCode(...encryptionKey))

      try {
        const decryptedData = await decrypt(storedData.data, encryptionKeyBase64)
        const cached: PersistedCredentials = JSON.parse(decryptedData)

        // Verify data integrity
        const expectedIntegrity = await this.calculateIntegrity(
          JSON.stringify({...cached, integrity: ''}), 
          encryptionKey
        )
        
        if (cached.integrity !== expectedIntegrity) {
          console.error('[Persistence] Credentials integrity check failed')
          this.clearCredentials()
          return null
        }

        console.log('[Persistence] Using cached credentials (verified)')
        return cached.credentials
      } finally {
        // Clear encryption key from memory
        encryptionKey.fill(0)
      }
    } catch (error) {
      console.error('[Persistence] Failed to decrypt/validate credentials:', error)
      this.clearCredentials()
      return null
    }
  }

  /**
   * Clear stored session with secure deletion
   */
  clearSession(): void {
    try {
      const storedDataStr = localStorage.getItem(this.SESSION_KEY)
      if (storedDataStr) {
        // Overwrite with random data before removal (best effort)
        const randomData = crypto.getRandomValues(new Uint8Array(storedDataStr.length))
        const randomString = btoa(String.fromCharCode(...randomData))
        localStorage.setItem(this.SESSION_KEY, randomString)
      }
    } catch (error) {
      console.warn('[Persistence] Error during secure session deletion:', error)
    } finally {
      localStorage.removeItem(this.SESSION_KEY)
      console.log('[Persistence] Session securely cleared')
    }
  }

  /**
   * Clear cached credentials with secure deletion
   */
  clearCredentials(): void {
    try {
      const storedDataStr = sessionStorage.getItem(this.CREDENTIALS_KEY)
      if (storedDataStr) {
        // Overwrite with random data before removal (best effort)
        const randomData = crypto.getRandomValues(new Uint8Array(storedDataStr.length))
        const randomString = btoa(String.fromCharCode(...randomData))
        sessionStorage.setItem(this.CREDENTIALS_KEY, randomString)
      }
    } catch (error) {
      console.warn('[Persistence] Error during secure credentials deletion:', error)
    } finally {
      sessionStorage.removeItem(this.CREDENTIALS_KEY)
      console.log('[Persistence] Credentials securely cleared')
    }
  }

  /**
   * Clear all persisted data with secure deletion
   */
  clearAll(): void {
    this.clearSession()
    this.clearCredentials()
    
    // Clear any temporary keys
    for (const keyId of this.tempKeys.keys()) {
      this.clearKey(keyId)
    }
    
    console.log('[Persistence] All persisted data securely cleared')
  }

  /**
   * Check if session exists (without decrypting)
   */
  hasSession(): boolean {
    try {
      const storedDataStr = localStorage.getItem(this.SESSION_KEY)
      if (!storedDataStr) return false
      
      const storedData: StoredData = JSON.parse(storedDataStr)
      return Date.now() <= storedData.expiresAt
    } catch {
      return false
    }
  }

  /**
   * Check if credentials are cached (without decrypting)
   */
  hasCredentials(): boolean {
    try {
      const storedDataStr = sessionStorage.getItem(this.CREDENTIALS_KEY)
      if (!storedDataStr) return false
      
      const storedData: StoredData = JSON.parse(storedDataStr)
      return Date.now() <= storedData.expiresAt
    } catch {
      return false
    }
  }

  /**
   * Cleanup method to be called on app shutdown
   */
  destroy(): void {
    // Clear all temporary keys
    for (const keyId of this.tempKeys.keys()) {
      this.clearKey(keyId)
    }
    
    // Clear all timers
    for (const timer of this.cleanupTimers.values()) {
      clearTimeout(timer)
    }
    this.cleanupTimers.clear()
  }
}

// Singleton instance
export const persistenceManager = new SecurePersistenceManager()

// Cleanup on page unload
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => {
    persistenceManager.destroy()
  })
}