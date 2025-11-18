/**
 * Secure Session API Manager - Prevents duplicate session sync calls with rotation
 */

import { API_BASE_URL } from '../lib/api-config'

interface SessionSyncState {
  isSyncing: boolean
  promise: Promise<boolean> | null
  lastSyncKey: string | null
  sessionId: string | null
  createdAt: number | null
  rotationInterval: NodeJS.Timeout | null
}

interface SecureSessionData {
  address: string
  idToken: string
  provider: string
  createdAt: number
  masterKey: string
  sessionId: string
  entropy: string
  timestamp: number
}

class SecureSessionManager {
  private state: SessionSyncState = {
    isSyncing: false,
    promise: null,
    lastSyncKey: null,
    sessionId: null,
    createdAt: null,
    rotationInterval: null
  }

  private readonly ROTATION_INTERVAL = 30 * 60 * 1000 // 30 minutes
  private readonly MAX_SESSION_AGE = 8 * 60 * 60 * 1000 // 8 hours
  private readonly ENTROPY_LENGTH = 32 // 256-bit entropy

  /**
   * Generate cryptographically secure session ID
   */
  private generateSessionId(): string {
    const randomBytes = crypto.getRandomValues(new Uint8Array(32))
    return Array.from(randomBytes, byte => byte.toString(16).padStart(2, '0')).join('')
  }

  /**
   * Generate cryptographically secure entropy
   */
  private generateEntropy(): string {
    const randomBytes = crypto.getRandomValues(new Uint8Array(this.ENTROPY_LENGTH))
    return Array.from(randomBytes, byte => byte.toString(16).padStart(2, '0')).join('')
  }

  /**
   * Create secure session key with multiple factors
   */
  private createSecureSessionKey(sessionData: {
    address: string
    idToken: string
    provider: string
    createdAt: number
  }, sessionId: string, entropy: string): string {
    // Combine multiple factors for unique session identification
    const factors = [
      sessionData.address,
      sessionData.idToken ? sessionData.idToken.substring(0, 16) : 'no-token', // Safe substring with fallback
      sessionData.provider,
      sessionData.createdAt.toString(),
      sessionId,
      entropy,
      Date.now().toString()
    ]
    
    return factors.join(':')
  }

  /**
   * Check if session should be rotated
   */
  private shouldRotateSession(createdAt: number): boolean {
    const now = Date.now()
    const sessionAge = now - createdAt
    
    // Rotate if session is too old
    if (sessionAge > this.MAX_SESSION_AGE) {
      console.log('[SessionManager] Session too old, forcing rotation')
      return true
    }
    
    // Random rotation probability increases with age
    const ageRatio = sessionAge / this.MAX_SESSION_AGE
    const rotationProbability = Math.min(0.1 + (ageRatio * 0.3), 0.4) // 10-40% chance
    
    if (Math.random() < rotationProbability) {
      console.log('[SessionManager] Random session rotation triggered')
      return true
    }
    
    return false
  }

  /**
   * Start automatic session rotation
   */
  private startRotationTimer(): void {
    if (this.state.rotationInterval) {
      clearInterval(this.state.rotationInterval)
    }
    
    this.state.rotationInterval = setInterval(() => {
      if (this.state.createdAt && this.shouldRotateSession(this.state.createdAt)) {
        console.log('[SessionManager] Automatic rotation triggered')
        this.rotateSession()
      }
    }, this.ROTATION_INTERVAL)
  }

  /**
   * Rotate session by generating new IDs
   */
  private rotateSession(): void {
    this.state.sessionId = this.generateSessionId()
    this.state.createdAt = Date.now()
    this.state.lastSyncKey = null // Force new sync
    console.log('[SessionManager] Session rotated with new ID')
  }

  /**
   * Sync session to API server with enhanced security and deduplication
   */
  async syncSessionToAPI(sessionData: {
    address: string
    idToken: string
    provider: string
    createdAt: number
    masterKey: string
  }): Promise<boolean> {
    // Initialize or rotate session if needed
    if (!this.state.sessionId || this.shouldRotateSession(sessionData.createdAt)) {
      this.state.sessionId = this.generateSessionId()
      this.state.createdAt = Date.now()
      this.startRotationTimer()
    }

    // Generate fresh entropy for this sync
    const entropy = this.generateEntropy()
    
    // Create secure session key for deduplication
    const secureSessionKey = this.createSecureSessionKey(
      sessionData, 
      this.state.sessionId, 
      entropy
    )
    
    // If already syncing this exact session, return existing promise
    if (this.state.isSyncing && this.state.promise && this.state.lastSyncKey === secureSessionKey) {
      console.log('[SessionManager] Deduplicating - using existing sync promise')
      return this.state.promise
    }

    console.log('[SessionManager] Starting secure session sync to API')
    this.state.isSyncing = true
    this.state.lastSyncKey = secureSessionKey

    // Enhanced session data with security features
    const secureSessionData: SecureSessionData = {
      ...sessionData,
      sessionId: this.state.sessionId,
      entropy,
      timestamp: Date.now()
    }

    this.state.promise = fetch(`${API_BASE_URL}/sync-session`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'X-Session-ID': this.state.sessionId,
        'X-Request-Entropy': entropy
      },
      body: JSON.stringify(secureSessionData),
    })
      .then((response) => {
        if (response.ok) {
          console.log('[SessionManager] ✅ Secure session synced to API server')
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
        
        // On error, generate new session to prevent replay attacks
        this.rotateSession()
        return false
      })

    return this.state.promise
  }

  /**
   * Clear sync state with secure cleanup
   */
  clearState(): void {
    // Clear rotation timer
    if (this.state.rotationInterval) {
      clearInterval(this.state.rotationInterval)
      this.state.rotationInterval = null
    }

    // Reset state
    this.state.isSyncing = false
    this.state.promise = null
    this.state.lastSyncKey = null
    this.state.sessionId = null
    this.state.createdAt = null
    
    console.log('[SessionManager] State securely cleared')
  }

  /**
   * Force session rotation (call when security breach is suspected)
   */
  forceRotation(): void {
    console.log('[SessionManager] Forcing security rotation')
    this.rotateSession()
  }

  /**
   * Get current session information (for debugging)
   */
  getSessionInfo(): { sessionId: string | null; age: number | null; isActive: boolean } {
    return {
      sessionId: this.state.sessionId,
      age: this.state.createdAt ? Date.now() - this.state.createdAt : null,
      isActive: this.state.isSyncing
    }
  }

  /**
   * Cleanup on destroy
   */
  destroy(): void {
    this.clearState()
  }
}

export const sessionManager = new SecureSessionManager()

// Cleanup on page unload
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => {
    sessionManager.destroy()
  })
}