/**
 * Secure Master Key Manager - Prevents duplicate derivation calls with secure memory handling
 * Single source of truth for master key with request deduplication and memory security
 */

import { deriveMasterKey } from './credentials'

interface SecureMasterKeyState {
  masterKey: Uint8Array | null
  isLoading: boolean
  promise: Promise<string> | null
  lastAddress: string | null
  createdAt: number | null
  accessCount: number
  lastAccessTime: number | null
  clearanceTimer: NodeJS.Timeout | null
}

class SecureMasterKeyManager {
  private state: SecureMasterKeyState = {
    masterKey: null,
    isLoading: false,
    promise: null,
    lastAddress: null,
    createdAt: null,
    accessCount: 0,
    lastAccessTime: null,
    clearanceTimer: null
  }

  private readonly MAX_KEY_AGE = 8 * 60 * 60 * 1000 // 8 hours
  private readonly IDLE_TIMEOUT = 30 * 60 * 1000 // 30 minutes
  private readonly MAX_ACCESS_COUNT = 1000 // Prevent excessive use

  /**
   * Convert string to secure Uint8Array
   */
  private stringToSecureArray(str: string): Uint8Array {
    const encoder = new TextEncoder()
    return encoder.encode(str)
  }

  /**
   * Convert secure Uint8Array back to string
   */
  private secureArrayToString(array: Uint8Array): string {
    const decoder = new TextDecoder()
    return decoder.decode(array)
  }

  /**
   * Securely clear key from memory
   */
  private secureClearKey(): void {
    if (this.state.masterKey) {
      // Zero out the key array
      this.state.masterKey.fill(0)
      this.state.masterKey = null
    }
    
    if (this.state.clearanceTimer) {
      clearTimeout(this.state.clearanceTimer)
      this.state.clearanceTimer = null
    }
    
    console.log('[MasterKeyManager] Key securely cleared from memory')
  }

  /**
   * Check if key should be cleared due to age, idle time, or access count
   */
  private shouldClearKey(): boolean {
    if (!this.state.masterKey || !this.state.createdAt) {
      return false
    }

    const now = Date.now()
    const age = now - this.state.createdAt
    const timeSinceAccess = this.state.lastAccessTime ? now - this.state.lastAccessTime : Infinity

    // Clear if too old
    if (age > this.MAX_KEY_AGE) {
      console.log('[MasterKeyManager] Key expired due to age')
      return true
    }

    // Clear if idle too long
    if (timeSinceAccess > this.IDLE_TIMEOUT) {
      console.log('[MasterKeyManager] Key expired due to inactivity')
      return true
    }

    // Clear if accessed too many times (prevent key wearing)
    if (this.state.accessCount > this.MAX_ACCESS_COUNT) {
      console.log('[MasterKeyManager] Key expired due to excessive access')
      return true
    }

    return false
  }

  /**
   * Set up automatic key clearance timer
   */
  private setupClearanceTimer(): void {
    if (this.state.clearanceTimer) {
      clearTimeout(this.state.clearanceTimer)
    }

    this.state.clearanceTimer = setTimeout(() => {
      if (this.shouldClearKey()) {
        this.clearCache()
      } else {
        // Check again later
        this.setupClearanceTimer()
      }
    }, Math.min(this.IDLE_TIMEOUT, this.MAX_KEY_AGE) / 4) // Check every quarter of the timeout
  }

  /**
   * Record key access and update security metrics
   */
  private recordAccess(): void {
    this.state.accessCount++
    this.state.lastAccessTime = Date.now()
    
    // Check if we should clear due to excessive access
    if (this.shouldClearKey()) {
      setTimeout(() => this.clearCache(), 0) // Clear on next tick
    }
  }

  /**
   * Get master key with deduplication and enhanced security
   */
  async getMasterKey(
    address: string,
    idToken: string,
    wallets: any[],
    currentAccount: any,
    signAndExecute: (params: { transaction: any }) => Promise<any>
  ): Promise<string> {
    // Check if key should be cleared
    if (this.shouldClearKey()) {
      this.clearCache()
    }

    // If we have a cached key for this address, return it
    if (this.state.masterKey && this.state.lastAddress === address) {
      console.log('[MasterKeyManager] Using cached master key (securely)')
      this.recordAccess()
      return this.secureArrayToString(this.state.masterKey)
    }

    // If already loading for this address, return the existing promise
    if (this.state.isLoading && this.state.lastAddress === address && this.state.promise) {
      console.log('[MasterKeyManager] Deduplicating - using existing derivation promise')
      return this.state.promise
    }

    // If address changed, clear cache
    if (this.state.lastAddress !== address) {
      this.clearCache()
    }

    // Start new derivation
    console.log('[MasterKeyManager] Starting new secure master key derivation')
    this.state.isLoading = true
    this.state.lastAddress = address

    this.state.promise = deriveMasterKey(address, idToken, wallets, currentAccount, signAndExecute)
      .then((masterKey) => {
        console.log('[MasterKeyManager] Master key derived and securely cached')
        
        // Store as secure Uint8Array
        this.state.masterKey = this.stringToSecureArray(masterKey)
        this.state.isLoading = false
        this.state.createdAt = Date.now()
        this.state.accessCount = 0
        this.state.lastAccessTime = Date.now()
        
        // Set up automatic clearance
        this.setupClearanceTimer()
        
        this.recordAccess()
        return masterKey
      })
      .catch((error) => {
        console.error('[MasterKeyManager] Master key derivation failed:', error)
        this.state.isLoading = false
        this.state.promise = null
        throw error
      })

    return this.state.promise
  }

  /**
   * Clear cached master key with secure memory cleanup
   */
  clearCache(): void {
    console.log('[MasterKeyManager] Securely clearing master key cache')
    
    this.secureClearKey()
    
    this.state.isLoading = false
    this.state.promise = null
    this.state.lastAddress = null
    this.state.createdAt = null
    this.state.accessCount = 0
    this.state.lastAccessTime = null
  }

  /**
   * Get cached master key without derivation (if available)
   */
  getCachedMasterKey(): string | null {
    if (this.shouldClearKey()) {
      this.clearCache()
      return null
    }
    
    if (this.state.masterKey) {
      this.recordAccess()
      return this.secureArrayToString(this.state.masterKey)
    }
    
    return null
  }

  /**
   * Set cached master key (for restoring from persistence)
   */
  setMasterKey(address: string, masterKey: string): void {
    // Clear existing key first
    this.secureClearKey()
    
    // Set new key securely
    this.state.masterKey = this.stringToSecureArray(masterKey)
    this.state.lastAddress = address
    this.state.createdAt = Date.now()
    this.state.accessCount = 0
    this.state.lastAccessTime = Date.now()
    
    // Set up automatic clearance
    this.setupClearanceTimer()
    
    console.log('[MasterKeyManager] Master key securely set from persistence')
  }

  /**
   * Check if currently deriving master key
   */
  isLoading(): boolean {
    return this.state.isLoading
  }

  /**
   * Force immediate cache clearance (call on security events)
   */
  forceSecureClearance(): void {
    console.log('[MasterKeyManager] Force security clearance triggered')
    this.clearCache()
  }

  /**
   * Get security status for monitoring
   */
  getSecurityStatus(): {
    hasKey: boolean
    age: number | null
    accessCount: number
    timeSinceAccess: number | null
  } {
    const now = Date.now()
    return {
      hasKey: this.state.masterKey !== null,
      age: this.state.createdAt ? now - this.state.createdAt : null,
      accessCount: this.state.accessCount,
      timeSinceAccess: this.state.lastAccessTime ? now - this.state.lastAccessTime : null
    }
  }

  /**
   * Cleanup method for destruction
   */
  destroy(): void {
    this.clearCache()
  }
}

// Singleton instance
export const masterKeyManager = new SecureMasterKeyManager()

// Cleanup on page unload
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => {
    masterKeyManager.destroy()
  })
}