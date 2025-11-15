/**
 * Blockchain Service for Extension
 * Communicates with web app to perform blockchain operations
 */

export interface Credential {
  domain: string
  username: string
  password: string
}

export interface BlockchainRequest {
  type: 'CHECK_CREDENTIAL' | 'SAVE_CREDENTIAL' | 'GET_CREDENTIAL'
  domain?: string
  credential?: Credential
}

export interface BlockchainResponse {
  success: boolean
  exists?: boolean
  credential?: Credential
  error?: string
}

import { API_BASE_URL_WITH_API } from '../shared/constants'

const API_BASE_URL = API_BASE_URL_WITH_API

/**
 * Check if API server is running
 */
async function checkApiServer(): Promise<boolean> {
  try {
    console.log('[Blockchain] Checking API server health...')
    const response = await fetch('http://localhost:3001/api/health', {
      method: 'GET',
      signal: AbortSignal.timeout(2000), // 2 second timeout
    })
    const isOk = response.ok
    console.log('[Blockchain] API server health check:', isOk ? 'OK' : 'FAILED', response.status)
    return isOk
  } catch (error) {
    console.warn('[Blockchain] API server health check failed:', error)
    return false
  }
}

/**
 * Check if credential exists for a domain
 * Calls web app API (which queries blockchain)
 * Returns object with success status, exists flag, and error message
 */
export async function checkCredentialExists(domain: string): Promise<{ success: boolean; exists: boolean; error?: string }> {
  try {
    console.log('[Blockchain] Checking credential for domain:', domain)
    
    // First check if API server is running
    const serverRunning = await checkApiServer()
    if (!serverRunning) {
      const errorMsg = 'Web app API server is not running. Please start the web app first.'
      console.warn('[Blockchain]', errorMsg)
      return { success: false, exists: false, error: errorMsg }
    }
    
    const url = `${API_BASE_URL}/check-credential?domain=${encodeURIComponent(domain)}`
    console.log('[Blockchain] Fetching:', url)
    
    const response = await fetch(url, {
      method: 'GET',
      signal: AbortSignal.timeout(10000), // 10 second timeout (increased for slow API responses)
    })
    
    console.log('[Blockchain] Response status:', response.status, response.statusText)
    
    if (!response.ok) {
      if (response.status === 401) {
        const errorMsg = 'Not authenticated. Please login to the web app first.'
        console.warn('[Blockchain]', errorMsg)
        return { success: false, exists: false, error: errorMsg }
      }
      const errorText = await response.text()
      let errorMessage = `HTTP ${response.status}: ${response.statusText}`
      try {
        const errorData = JSON.parse(errorText)
        errorMessage = errorData.error || errorMessage
      } catch {
        errorMessage = errorText || errorMessage
      }
      console.error('[Blockchain] API error response:', errorMessage)
      return { success: false, exists: false, error: errorMessage }
    }
    
    const data = await response.json()
    console.log('[Blockchain] Check response:', data)
    
    if (data.success) {
      return { success: true, exists: data.exists === true }
    } else {
      const errorMessage = data.error || 'Unknown error'
      console.error('[Blockchain] Check failed:', errorMessage)
      return { success: false, exists: false, error: errorMessage }
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    console.error('[Blockchain] Error checking credential:', error)
    
    // Check if it's a network error
    if (error instanceof TypeError && (error.message.includes('fetch') || error.message.includes('Failed to fetch'))) {
      return { 
        success: false, 
        exists: false,
        error: 'Cannot connect to web app. Make sure the web app is running (npm run dev:all in web-app folder).' 
      }
    }
    
    // Check if it's a timeout
    if (error instanceof Error && error.name === 'AbortError') {
      return {
        success: false,
        exists: false,
        error: 'Request timeout. The web app may be slow to respond.'
      }
    }
    
    return { success: false, exists: false, error: errorMessage }
  }
}

/**
 * Save credential to blockchain
 * Calls web app API (which queues for signing)
 * Returns object with success status and error message
 */
export async function saveCredential(credential: Credential): Promise<{ success: boolean; error?: string }> {
  try {
    console.log('[Blockchain] Saving credential for domain:', credential.domain)
    
    // First check if API server is running
    const serverRunning = await checkApiServer()
    if (!serverRunning) {
      const errorMsg = 'Web app API server is not running. Please start the web app first.'
      console.error('[Blockchain]', errorMsg)
      return { success: false, error: errorMsg }
    }
    
    const url = `${API_BASE_URL}/save-credential`
    console.log('[Blockchain] POST to:', url, 'Body:', { domain: credential.domain, username: credential.username })
    
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(credential),
      signal: AbortSignal.timeout(10000), // 10 second timeout
    })
    
    console.log('[Blockchain] Save response status:', response.status, response.statusText)
    
    if (!response.ok) {
      const errorText = await response.text()
      let errorMessage = `HTTP ${response.status}: ${response.statusText}`
      try {
        const errorData = JSON.parse(errorText)
        errorMessage = errorData.error || errorMessage
      } catch {
        errorMessage = errorText || errorMessage
      }
      console.error('[Blockchain] API error response:', errorMessage)
      return { success: false, error: errorMessage }
    }
    
    const data = await response.json()
    console.log('[Blockchain] Save response:', data)
    
    if (data.success) {
      console.log('[Blockchain] Credential queued successfully')
      return { success: true }
    } else {
      const errorMessage = data.error || 'Unknown error'
      console.error('[Blockchain] Save failed:', errorMessage)
      return { success: false, error: errorMessage }
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    console.error('[Blockchain] Error saving credential:', error)
    console.error('[Blockchain] Error details:', {
      message: errorMessage,
      stack: error instanceof Error ? error.stack : undefined,
      credential: { domain: credential.domain, username: credential.username },
    })
    
    // Check if it's a network error
    if (error instanceof TypeError && (error.message.includes('fetch') || error.message.includes('Failed to fetch'))) {
      return { 
        success: false, 
        error: 'Cannot connect to web app. Make sure the web app is running (npm run dev:all in web-app folder).' 
      }
    }
    
    return { success: false, error: errorMessage }
  }
}

/**
 * Get credential from blockchain
 * Calls web app API (which queries blockchain)
 * Returns object with success status, credential, and error message
 */
export async function getCredential(domain: string): Promise<{ success: boolean; credential: Credential | null; error?: string }> {
  try {
    console.log('[Blockchain] Getting credential for domain:', domain)
    
    // First check if API server is running
    const serverRunning = await checkApiServer()
    if (!serverRunning) {
      const errorMsg = 'Web app API server is not running. Please start the web app first.'
      console.warn('[Blockchain]', errorMsg)
      return { success: false, credential: null, error: errorMsg }
    }
    
    const url = `${API_BASE_URL}/get-credential?domain=${encodeURIComponent(domain)}`
    console.log('[Blockchain] Fetching:', url)
    
    const response = await fetch(url, {
      method: 'GET',
      signal: AbortSignal.timeout(10000), // 10 second timeout (increased for slow API responses)
    })
    
    console.log('[Blockchain] Get response status:', response.status, response.statusText)
    
    if (!response.ok) {
      if (response.status === 401) {
        const errorMsg = 'Not authenticated. Please login to the web app first.'
        console.warn('[Blockchain]', errorMsg)
        return { success: false, credential: null, error: errorMsg }
      }
      const errorText = await response.text()
      let errorMessage = `HTTP ${response.status}: ${response.statusText}`
      try {
        const errorData = JSON.parse(errorText)
        errorMessage = errorData.error || errorMessage
      } catch {
        errorMessage = errorText || errorMessage
      }
      console.error('[Blockchain] API error response:', errorMessage)
      return { success: false, credential: null, error: errorMessage }
    }
    
    const data = await response.json()
    console.log('[Blockchain] Get response:', data)
    
    if (data.success && data.credential) {
      return { success: true, credential: data.credential }
    } else {
      const errorMessage = data.error || 'Credential not found'
      console.log('[Blockchain] Credential not found:', errorMessage)
      return { success: true, credential: null } // Not an error, just doesn't exist
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    console.error('[Blockchain] Error getting credential:', error)
    
    // Check if it's a network error
    if (error instanceof TypeError && (error.message.includes('fetch') || error.message.includes('Failed to fetch'))) {
      return { 
        success: false, 
        credential: null,
        error: 'Cannot connect to web app. Make sure the web app is running (npm run dev:all in web-app folder).' 
      }
    }
    
    // Check if it's a timeout
    if (error instanceof Error && error.name === 'AbortError') {
      return {
        success: false,
        credential: null,
        error: 'Request timeout. The web app may be slow to respond.'
      }
    }
    
    return { success: false, credential: null, error: errorMessage }
  }
}

