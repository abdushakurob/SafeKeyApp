/**
 * Master Key Manager - Prevents duplicate derivation calls
 * Single source of truth for master key with request deduplication
 */

import { deriveMasterKey } from './credentials'

interface MasterKeyState {
  masterKey: string | null
  isLoading: boolean
  promise: Promise<string> | null
  lastAddress: string | null
}

class MasterKeyManager {
  private state: MasterKeyState = {
    masterKey: null,
    isLoading: false,
    promise: null,
    lastAddress: null
  }

  /**
   * Get master key with deduplication - prevents multiple simultaneous calls
   */
  async getMasterKey(
    address: string,
    idToken: string,
    wallets: any[],
    currentAccount: any,
    signAndExecute: (params: { transaction: any }) => Promise<any>
  ): Promise<string> {
    // If we have a cached key for this address, return it
    if (this.state.masterKey && this.state.lastAddress === address) {
      console.log('[MasterKeyManager] Using cached master key')
      return this.state.masterKey
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
    console.log('[MasterKeyManager] Starting new master key derivation')
    this.state.isLoading = true
    this.state.lastAddress = address

    this.state.promise = deriveMasterKey(address, idToken, wallets, currentAccount, signAndExecute)
      .then((masterKey) => {
        console.log('[MasterKeyManager] Master key derived and cached')
        this.state.masterKey = masterKey
        this.state.isLoading = false
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
   * Clear cached master key (call when user logs out or switches accounts)
   */
  clearCache(): void {
    console.log('[MasterKeyManager] Clearing master key cache')
    this.state.masterKey = null
    this.state.isLoading = false
    this.state.promise = null
    this.state.lastAddress = null
  }

  /**
   * Get cached master key without derivation (if available)
   */
  getCachedMasterKey(): string | null {
    return this.state.masterKey
  }

  /**
   * Check if currently deriving master key
   */
  isLoading(): boolean {
    return this.state.isLoading
  }
}

// Singleton instance
export const masterKeyManager = new MasterKeyManager()