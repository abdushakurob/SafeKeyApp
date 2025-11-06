// Background Service Worker for SafeKey Extension
import { encrypt, decrypt, hashDomain } from '../lib/crypto'
import {
  initializeEnokiFlow,
  getGoogleOAuthUrl,
  getFacebookOAuthUrl,
  completeZkLogin,
  logoutZkLogin,
  isZkLoginActive,
  getUserAddress,
  getProvider,
  saveZkLoginSessionSecurely,
  clearZkLoginFromStorage,
} from '../lib/zklogin'

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
      console.log('[BG] Session initialized')
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
    console.log('[BG] Session locked')
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

  // Get zkLogin auth URL
  if (request.type === 'GET_ZKLOGIN_AUTH_URL') {
    ;(async () => {
      try {
        if (!sessionState.enokiInitialized) {
          throw new Error('Enoki not initialized')
        }
        const authUrl =
          request.provider === 'google'
            ? getGoogleOAuthUrl(request.clientId, request.redirectUrl)
            : getFacebookOAuthUrl(request.clientId, request.redirectUrl)
        sendResponse({ success: true, authUrl })
      } catch (error) {
        sendResponse({ success: false, error: String(error) })
      }
    })()
    return true
  }

  // Get OAuth URL (new unified handler)
  if (request.type === 'GET_OAUTH_URL') {
    try {
      const authUrl =
        request.provider === 'google'
          ? getGoogleOAuthUrl(request.clientId, request.redirectUrl)
          : getFacebookOAuthUrl(request.clientId, request.redirectUrl)
      sendResponse({ success: true, authUrl })
    } catch (error) {
      sendResponse({ success: false, error: String(error) })
    }
    return true
  }

  // Complete zkLogin after OAuth redirect
  if (request.type === 'COMPLETE_ZKLOGIN') {
    ;(async () => {
      try {
        if (!sessionState.enokiInitialized) {
          throw new Error('Enoki not initialized')
        }
        console.log('[BG] Processing zkLogin completion...')
        console.log('[BG] Hash provided:', request.hash?.substring(0, 150) || 'none')
        console.log('[BG] Search provided:', request.search?.substring(0, 150) || 'none')
        console.log('[BG] idToken length:', request.idToken?.length || 0)
        
        const session = await completeZkLogin(request.hash || request.search, request.idToken)
        await saveZkLoginSessionSecurely()
        console.log('[BG] zkLogin successful, user address:', session.address)
        sendResponse({ 
          success: true, 
          message: 'zkLogin completed',
          address: session.address,
          provider: session.provider,
        })
      } catch (error) {
        console.error('[BG] zkLogin completion failed:', error)
        sendResponse({ success: false, error: String(error) })
      }
    })()
    return true
  }

  // Get zkLogin status
  if (request.type === 'GET_ZKLOGIN_STATUS') {
    sendResponse({
      success: true,
      isActive: isZkLoginActive(),
      address: getUserAddress(),
      provider: getProvider(),
    })
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
  console.log('SafeKey extension installed')
  chrome.storage.local.set({
    isEnabled: true,
    lastActive: new Date().toISOString(),
  })
})

// Listen for tab updates
chrome.tabs.onUpdated.addListener((_tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete') {
    console.log('Tab loaded:', tab.url)
  }
})

// Initialize Enoki on service worker startup
;(() => {
  try {
    const enokiApiKey = import.meta.env.VITE_ENOKI_API_KEY
    const googleClientId = import.meta.env.VITE_OAUTH_CLIENT_ID
    
    if (!enokiApiKey) {
      throw new Error('VITE_ENOKI_API_KEY not set in environment')
    }
    
    // Pass provider configuration to Enoki so it knows what clientIds to expect
    const providers: Record<string, { clientId: string }> = {}
    if (googleClientId) {
      providers.google = { clientId: googleClientId }
    }
    
    initializeEnokiFlow(enokiApiKey, providers || undefined)
    sessionState.enokiInitialized = true
    console.log('[BG] Enoki initialized on service worker startup with providers:', Object.keys(providers))
  } catch (error) {
    console.error('[BG] Failed to initialize Enoki:', error)
  }
})()

// Monitor for OAuth callback data from web page via chrome.storage
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === 'local' && changes.safekey_oauth_callback) {
    const callbackData = changes.safekey_oauth_callback.newValue
    if (callbackData) {
      console.log('[BG] OAuth callback data detected in storage')
      ;(async () => {
        try {
          if (!sessionState.enokiInitialized) {
            console.error('[BG] Enoki not initialized when processing OAuth')
            chrome.storage.local.remove('safekey_oauth_callback')
            return
          }
          console.log('[BG] Processing zkLogin with hash from storage')
          const session = await completeZkLogin(callbackData.hash)
          await saveZkLoginSessionSecurely()
          console.log('[BG] ✅ zkLogin completed successfully')
          console.log('[BG] User logged in:', session.address)
          chrome.storage.local.remove('safekey_oauth_callback')
        } catch (error) {
          console.error('[BG] Failed to complete zkLogin from storage callback:', error)
          chrome.storage.local.remove('safekey_oauth_callback')
        }
      })()
    }
  }
})

