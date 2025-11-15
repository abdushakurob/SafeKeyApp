// Background Service Worker for SafeKey Extension
import { encrypt, decrypt, hashDomain } from '../lib/crypto'
import {
  initializeEnokiFlow,
  completeZkLogin,
  logoutZkLogin,
  isZkLoginActive,
  getUserAddress,
  getProvider,
  saveZkLoginSessionSecurely,
  clearZkLoginFromStorage,
  loadZkLoginSessionFromStorage,
  processOAuthJWT,
} from '../lib/zklogin'
import { initializeSeal } from '../lib/seal'

// In-memory state for the session
let sessionState: {
  KM?: string // Master key
  sessionNonce?: string
  KS?: string // Session key
  isLocked: boolean
  enokiInitialized: boolean
} = {
  isLocked: true,
  enokiInitialized: false,
}

// Listen for messages from content scripts or popup
chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
  if (request.type === 'GET_STATUS') {
    sendResponse({ 
      status: sessionState.isLocked ? 'Locked' : 'Active',
      isLocked: sessionState.isLocked 
    })
  }

  // Initialize SafeKey with master key
  if (request.type === 'INIT_SESSION' && request.KM) {
    try {
      sessionState.KM = request.KM
      sessionState.isLocked = false
      sendResponse({ success: true, message: 'Session initialized' })
    } catch (error) {
      sendResponse({ success: false, error: String(error) })
    }
    return true
  }

  // Lock the session
  if (request.type === 'LOCK_SESSION') {
    sessionState.isLocked = true
    sessionState.KS = undefined
    sendResponse({ success: true })
    return true
  }

  // Encrypt data
  if (request.type === 'ENCRYPT' && request.data && sessionState.KS) {
    ;(async () => {
      try {
        const encrypted = await encrypt(request.data, sessionState.KS!)
        sendResponse({ success: true, encrypted })
      } catch (error) {
        sendResponse({ success: false, error: String(error) })
      }
    })()
    return true
  }

  // Decrypt data
  if (request.type === 'DECRYPT' && request.encrypted && sessionState.KS) {
    ;(async () => {
      try {
        const decrypted = await decrypt(request.encrypted, sessionState.KS!)
        sendResponse({ success: true, decrypted })
      } catch (error) {
        sendResponse({ success: false, error: String(error) })
      }
    })()
    return true
  }

  // Hash domain
  if (request.type === 'HASH_DOMAIN' && request.domain && sessionState.KM) {
    ;(async () => {
      try {
        const domainHash = await hashDomain(request.domain, sessionState.KM!)
        sendResponse({ success: true, domainHash })
      } catch (error) {
        sendResponse({ success: false, error: String(error) })
      }
    })()
    return true
  }

  // Initialize Enoki for zkLogin
  if (request.type === 'INIT_ENOKI' && request.apiKey) {
    try {
      initializeEnokiFlow(request.apiKey)
      sessionState.enokiInitialized = true
      sendResponse({ success: true, message: 'Enoki initialized' })
    } catch (error) {
      sendResponse({ success: false, error: String(error) })
    }
    return true
  }

  // Save zkLogin session (called from popup after connecting wallet)
  if (request.type === 'SAVE_ZKLOGIN_SESSION') {
    ;(async () => {
      try {
        // Load session from popup context (it's already complete from processOAuthJWT)
        // The session should already be in storage from popup, but we'll ensure it's saved
        await loadZkLoginSessionFromStorage()
        
        // If session exists and is complete, just save it
        // Otherwise, create minimal session (fallback)
        const address = request.address
        const provider = request.provider
        
        if (!address) {
          throw new Error('No address provided')
        }

        // Check if we already have a complete session
        const existingSession = await loadZkLoginSessionFromStorage()
        if (existingSession && existingSession.address === address && existingSession.provider === provider) {
          await saveZkLoginSessionSecurely()
        } else {
          // Fallback: create minimal session (shouldn't happen in normal flow)
          await completeZkLogin(address, provider)
          await saveZkLoginSessionSecurely()
        }
        
        sendResponse({ success: true, message: 'Session saved' })
      } catch (error) {
        console.error('[BG] Failed to save session:', error)
        sendResponse({ success: false, error: String(error) })
      }
    })()
    return true
  }

  // Get OAuth token (for popup to query)
  if (request.type === 'GET_OAUTH_TOKEN') {
    ;(async () => {
      try {
        // Try session storage first
        let data: any = {}
        if (chrome.storage.session) {
          try {
            data = await chrome.storage.session.get('oauth_id_token')
            if (data.oauth_id_token) {
              sendResponse({ success: true, id_token: data.oauth_id_token })
              return
            }
          } catch (sessionError) {
            // Continue to local storage
          }
        }
        
        // Fallback to local storage
        data = await chrome.storage.local.get('oauth_id_token')
        if (data.oauth_id_token) {
          sendResponse({ success: true, id_token: data.oauth_id_token })
        } else {
          sendResponse({ success: false, error: 'No token found' })
        }
      } catch (error) {
        console.error('[BG] Error getting OAuth token:', error)
        sendResponse({ success: false, error: String(error) })
      }
    })()
    return true
  }

  // OAuth callback from content script
  if (request.type === 'OAUTH_CALLBACK') {
    ;(async () => {
      try {
        if (request.id_token) {
          // Store in session storage if available (Chrome), otherwise local (Firefox)
          const storage = chrome.storage.session || chrome.storage.local
          
          await storage.set({ 
            oauth_id_token: request.id_token,
            oauth_access_token: request.access_token || ''
          })
          
          // Verify it was stored
          const verify = await storage.get('oauth_id_token')
          if (!verify.oauth_id_token) {
            // Try local storage as fallback
            await chrome.storage.local.set({
              oauth_id_token: request.id_token,
              oauth_access_token: request.access_token || ''
            })
          }
          
          // Automatically process the OAuth token and complete zkLogin flow
          try {
            const provider = request.provider || 'google'
            const address = await processOAuthJWT(request.id_token, provider as any)
            
            // Save the session
            await saveZkLoginSessionSecurely()
            
            // Notify any open popup windows that the session is ready
            try {
              chrome.runtime.sendMessage({
                type: 'ZKLOGIN_SESSION_READY',
                address,
                provider,
              }).catch(() => {
                // Ignore if no popup is open
              })
            } catch (notifyError) {
              // Ignore notification errors
            }
            
            sendResponse({ 
              success: true, 
              message: 'OAuth tokens stored and zkLogin session created',
              address,
            })
          } catch (processError) {
            console.error('[BG] Failed to process OAuth token automatically:', processError)
            sendResponse({ 
              success: true, 
              message: 'OAuth tokens stored (processing failed, will retry in popup)',
              error: String(processError)
            })
          }
        } else {
          console.error('[BG] No ID token in callback message')
          sendResponse({ success: false, error: 'No ID token in callback' })
        }
      } catch (error) {
        console.error('[BG] OAuth callback error:', error)
        sendResponse({ success: false, error: String(error) })
      }
    })()
    return true
  }


  // Get zkLogin status
  if (request.type === 'GET_ZKLOGIN_STATUS') {
    ;(async () => {
      try {
        // Load session from storage to ensure we have the latest state
        await loadZkLoginSessionFromStorage()
        sendResponse({
          success: true,
          isActive: isZkLoginActive(),
          address: getUserAddress(),
          provider: getProvider(),
        })
      } catch (error) {
        console.error('[BG] Error loading session for status check:', error)
        sendResponse({
          success: true,
          isActive: false,
          address: null,
          provider: null,
        })
      }
    })()
    return true
  }

  // Logout from zkLogin
  if (request.type === 'LOGOUT_ZKLOGIN') {
    ;(async () => {
      try {
        logoutZkLogin()
        await clearZkLoginFromStorage()
        sendResponse({ success: true, message: 'Logged out from zkLogin' })
      } catch (error) {
        sendResponse({ success: false, error: String(error) })
      }
    })()
    return true
  }
})

// Install event - set up initial state
chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.set({
    isEnabled: true,
    lastActive: new Date().toISOString(),
  })
})

// Initialize Enoki on service worker startup
;(async () => {
  try {
    const enokiApiKey = import.meta.env.VITE_ENOKI_API_KEY
    const googleClientId = import.meta.env.VITE_OAUTH_CLIENT_ID
    
    if (!enokiApiKey) {
      throw new Error('VITE_ENOKI_API_KEY not set in environment')
    }
    
    if (!googleClientId) {
      console.warn('[BG] VITE_OAUTH_CLIENT_ID not set in environment')
    }
    
    // Pass provider configuration to Enoki
    const providers: Record<string, { clientId: string }> = {}
    if (googleClientId) {
      providers.google = { clientId: googleClientId }
    }
    
    initializeEnokiFlow(enokiApiKey, providers || undefined)
    sessionState.enokiInitialized = true
    
    // Initialize SEAL (Walrus removed from this build)
    try {
      const network = 'testnet' // TODO: Make this configurable
      initializeSeal(network)
      console.log('[BG] ✅ SEAL initialized')
    } catch (error) {
      console.error('[BG] Failed to initialize SEAL:', error)
    }
    
    // Load existing zkLogin session from storage
    try {
      await loadZkLoginSessionFromStorage()
    } catch (error) {
      console.error('[BG] Failed to load session on startup:', error)
    }
  } catch (error) {
    console.error('[BG] Failed to initialize Enoki:', error)
  }
})()
