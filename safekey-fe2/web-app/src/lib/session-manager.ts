/**
 * Session API Manager - Prevents duplicate session sync calls
 */

import { API_BASE_URL } from '../lib/api-config'

interface SessionSyncState {
  isSyncing: boolean
  promise: Promise<boolean> | null
  lastSyncAddress: string | null // Now stores "address-idToken" for more precise deduplication
}

class SessionManager {
  private state: SessionSyncState = {
    isSyncing: false,
    promise: null,
    lastSyncAddress: null
  }

  /**
   * Sync session to API server with deduplication
   */
  async syncSessionToAPI(sessionData: {
    address: string
    idToken: string
    provider: string
    createdAt: number
    masterKey: string
  }): Promise<boolean> {
    // Create a unique key for this sync operation
    const syncKey = `${sessionData.address}-${sessionData.idToken}`
    
    // If already syncing this exact session, return existing promise
    if (this.state.isSyncing && this.state.promise && this.state.lastSyncAddress === syncKey) {
      console.log('[SessionManager] Deduplicating - using existing sync promise')
      return this.state.promise
    }

    console.log('[SessionManager] Starting session sync to API')
    this.state.isSyncing = true
    this.state.lastSyncAddress = syncKey

    this.state.promise = fetch(`${API_BASE_URL}/sync-session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(sessionData),
    })
      .then((response) => {
        if (response.ok) {
          console.log('[SessionManager] ✅ Session synced to API server')
          this.state.isSyncing = false
          return true
        } else {
          throw new Error(`HTTP ${response.status}`)
        }
      })
      .catch((error) => {
        console.error('[SessionManager] ❌ Failed to sync session:', error)
        this.state.isSyncing = false
        this.state.promise = null
        return false
      })

    return this.state.promise
  }

  /**
   * Clear sync state (call when switching accounts or sessions)
   */
  clearState(): void {
    this.state.isSyncing = false
    this.state.promise = null
    this.state.lastSyncAddress = null
  }
}

export const sessionManager = new SessionManager()