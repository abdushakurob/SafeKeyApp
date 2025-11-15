/**
 * Extension Communication Module
 * Handles communication between web app and browser extension
 */

export interface ExtensionMessage {
  type: string
  [key: string]: any
}

export interface SessionData {
  idToken: string
  address: string
  provider: string
  createdAt: number
}

/**
 * Get extension ID from window object (injected by extension)
 */
function getExtensionId(): string | null {
  try {
    if (typeof window === 'undefined') {
      return null
    }
    
    // Check if extension ID was injected by the extension's web-app-bridge
    if ((window as any).__SAFEKEY_EXTENSION_ID__) {
      return (window as any).__SAFEKEY_EXTENSION_ID__
    }
    
    // Fallback: check document attribute (set by web-app-bridge)
    if (typeof document !== 'undefined') {
      const idFromAttr = document.documentElement.getAttribute('data-safekey-extension-id')
      if (idFromAttr) {
        // Also set it on window for future use
        ;(window as any).__SAFEKEY_EXTENSION_ID__ = idFromAttr
        return idFromAttr
      }
    }
    
    return null
  } catch (error) {
    console.log('[Extension] Error getting extension ID:', error)
    return null
  }
}

/**
 * Check if extension is installed and available
 * Uses extension ID injected by web-app-bridge
 * Retries multiple times to account for timing issues
 */
export async function isExtensionInstalled(): Promise<boolean> {
  try {
    // Check if chrome API is available
    if (typeof chrome === 'undefined' || !chrome.runtime) {
      return false
    }
    
    // Retry mechanism: wait for web-app-bridge to inject extension ID
    // Try up to 3 times with increasing delays
    for (let attempt = 0; attempt < 3; attempt++) {
      // Get extension ID from window object (injected by extension)
      let extensionId = getExtensionId()
      
      // If not found on first attempt, wait a bit for web-app-bridge to load
      if (!extensionId && attempt < 2) {
        await new Promise(resolve => setTimeout(resolve, 200 * (attempt + 1)))
        extensionId = getExtensionId()
      }
      
      if (!extensionId) {
        // Extension ID still not found after retries
        continue
      }
      
      // Try to send a ping message to the extension
      const response = await new Promise<any>((resolve) => {
        try {
          // Use a timeout to avoid hanging
          const timeout = setTimeout(() => {
            resolve(null)
          }, 1000)
          
          chrome.runtime.sendMessage(extensionId, { type: 'PING' }, (response) => {
            clearTimeout(timeout)
            if (chrome.runtime.lastError) {
              // Extension might not be installed or not responding
              console.log('[Extension] PING failed:', chrome.runtime.lastError.message)
              resolve(null)
            } else {
              resolve(response)
            }
          })
        } catch (error) {
          console.log('[Extension] PING error:', error)
          resolve(null)
        }
      })
      
      if (response?.success === true) {
        return true
      }
    }
    
    return false
  } catch (error) {
    console.log('[Extension] Detection error:', error)
    return false
  }
}

/**
 * Sync session data to extension
 */
export async function syncSessionToExtension(session: SessionData): Promise<boolean> {
  try {
    if (typeof chrome === 'undefined' || !chrome.runtime) {
      return false
    }
    
    // Get extension ID from window object (injected by extension)
    const extensionId = getExtensionId()
    if (!extensionId) {
      console.warn('[Extension] Extension ID not found, cannot sync session')
      return false
    }
    
    const response = await new Promise<any>((resolve) => {
      chrome.runtime.sendMessage(extensionId, { type: 'SYNC_SESSION', session }, (response) => {
        if (chrome.runtime.lastError) {
          console.error('[Extension] Chrome runtime error:', chrome.runtime.lastError)
          resolve(null)
        } else {
          resolve(response)
        }
      })
    })
    return response?.success === true
  } catch (error) {
    console.error('[Extension] Failed to sync session:', error)
    return false
  }
}

/**
 * Get session from extension
 */
export async function getSessionFromExtension(): Promise<SessionData | null> {
  try {
    if (typeof chrome === 'undefined' || !chrome.runtime) {
      return null
    }
    
    // Get extension ID from window object (injected by extension)
    const extensionId = getExtensionId()
    if (!extensionId) {
      return null
    }
    
    const response = await new Promise<any>((resolve) => {
      chrome.runtime.sendMessage(extensionId, { type: 'GET_SESSION' }, (response) => {
        if (chrome.runtime.lastError) {
          console.error('[Extension] Chrome runtime error:', chrome.runtime.lastError)
          resolve(null)
        } else {
          resolve(response)
        }
      })
    })
    if (response?.success && response.session) {
      return response.session
    }
    return null
  } catch (error) {
    console.error('[Extension] Failed to get session:', error)
    return null
  }
}

/**
 * Clear session in extension
 */
export async function clearExtensionSession(): Promise<boolean> {
  try {
    if (typeof chrome === 'undefined' || !chrome.runtime) {
      // Chrome API not available (not in extension context)
      return false
    }
    
    // Get extension ID from window object (injected by extension)
    const extensionId = getExtensionId()
    if (!extensionId) {
      return false
    }
    
    const response = await new Promise<any>((resolve) => {
      chrome.runtime.sendMessage(extensionId, { type: 'CLEAR_SESSION' }, (response) => {
        if (chrome.runtime.lastError) {
          resolve(null)
        } else {
          resolve(response)
        }
      })
    })
    return response?.success === true
  } catch (error) {
    // Silently fail if extension is not available
    return false
  }
}

