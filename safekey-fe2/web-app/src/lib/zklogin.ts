
export type AuthProvider = 'google' | 'facebook' | 'twitch'

export interface ZkLoginSession {
  idToken: string
  address: string
  provider: AuthProvider
  createdAt: number
}

export function storeSession(session: ZkLoginSession): void {
  try {
    localStorage.setItem('safekey_session', JSON.stringify(session))
    console.log('[zkLogin] Session stored in localStorage')
  } catch (error) {
    console.error('[zkLogin] Failed to store session:', error)
  }
}

export function loadSession(): ZkLoginSession | null {
  try {
    const stored = localStorage.getItem('safekey_session')
    if (stored) {
      return JSON.parse(stored) as ZkLoginSession
    }
    return null
  } catch (error) {
    console.error('[zkLogin] Failed to load session:', error)
    return null
  }
}

export function clearSession(): void {
  try {
    localStorage.removeItem('safekey_session')
    console.log('[zkLogin] Session cleared')
  } catch (error) {
    console.error('[zkLogin] Failed to clear session:', error)
  }
}

