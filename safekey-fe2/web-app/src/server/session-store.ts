/**
 * Session Store
 * Shared in-memory store for session data (accessible by both React app and API server)
 */

export interface SessionData {
  address: string
  idToken: string
  provider: 'google' | 'facebook' | 'twitch'
  createdAt: number
  masterKey?: string // SEAL-derived master key (KM) - stored temporarily in memory
}

// In-memory session store
let currentSession: SessionData | null = null

/**
 * Store session (called by React app)
 */
export function storeSession(session: SessionData): void {
  currentSession = session
  console.log('[Session Store] Session stored:', session.address)
}

/**
 * Get current session (called by API server)
 */
export function getSession(): SessionData | null {
  return currentSession
}

/**
 * Clear session
 */
export function clearSession(): void {
  currentSession = null
  console.log('[Session Store] Session cleared')
}

/**
 * Check if session exists and is valid
 */
export function hasValidSession(): boolean {
  if (!currentSession) return false
  
  // Check if session is not too old (e.g., 24 hours)
  const maxAge = 24 * 60 * 60 * 1000 // 24 hours
  const age = Date.now() - currentSession.createdAt
  return age < maxAge
}

