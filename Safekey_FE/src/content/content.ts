// Content Script - injected into all web pages

// Check if this is an OAuth callback page (localhost:3000/callback)
if (window.location.href.includes('localhost:3000/callback') || window.location.href.includes('localhost:3000/oauth')) {
  // Extract tokens from URL fragment or query params
  const fragmentParams = new URLSearchParams(window.location.hash.substring(1))
  const queryParams = new URLSearchParams(window.location.search)
  
  const id_token = fragmentParams.get('id_token') || queryParams.get('id_token')
  const access_token = fragmentParams.get('access_token') || queryParams.get('access_token')
  const code = fragmentParams.get('code') || queryParams.get('code')
  
  if (id_token || access_token || code) {
    // Store tokens - use session storage if available (Chrome), otherwise use local (Firefox)
    if (id_token) {
      const storage = chrome.storage.session || chrome.storage.local
      storage.set({
        oauth_id_token: id_token,
        oauth_access_token: access_token || '',
      })
    }
    
    // Send to background worker
    chrome.runtime.sendMessage(
      {
        type: 'OAUTH_CALLBACK',
        id_token,
        access_token,
        code,
        hash: window.location.hash,
        search: window.location.search,
      },
      (response) => {
        if (!response || !response.success) {
          console.error('[Content] Background failed to process callback:', response)
        }
      }
    )
  }
}

// Listen for messages from web pages (e.g., OAuth callback page)
window.addEventListener('message', (event) => {
  // Only accept messages from the same origin
  if (event.origin !== window.location.origin) {
    return
  }

  // Check if this is a SafeKey OAuth callback message
  if (event.data && event.data.type === 'SAFEKEY_OAUTH_CALLBACK') {
    const fragmentParams = new URLSearchParams(window.location.hash.substring(1))
    const idToken = fragmentParams.get('id_token')
    
    if (idToken) {
      // Try to get address from storage if available
      chrome.storage.local.get('safekey_zklogin_session', (data) => {
        const session = data.safekey_zklogin_session
        const address = session?.address || null
        
        // Send success response back to the callback page
        window.postMessage(
          {
            type: 'SAFEKEY_OAUTH_RESPONSE',
            success: true,
            message: 'Tokens stored successfully',
            address: address,
          },
          window.location.origin,
        )
      })
    } else {
      console.error('[Content] No id_token found in URL hash')
      window.postMessage(
        {
          type: 'SAFEKEY_OAUTH_RESPONSE',
          success: false,
          error: 'No ID token found in callback URL',
        },
        window.location.origin,
      )
    }
  }
})

// Listen for messages from background script
chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
  if (request.type === 'INJECT_UI') {
    sendResponse({ success: true })
  }
})


export {}
