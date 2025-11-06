// Content Script - injected into all web pages
console.log('[Content Script] Loaded on:', window.location.href)
console.log('[Content Script] Setting up message listener...')

// Listen for messages from web pages (e.g., OAuth callback page)
window.addEventListener('message', (event) => {
  console.log('[Content] Message received from window:', event.data?.type, 'Origin:', event.origin)
  
  // Only accept messages from the same origin
  if (event.origin !== window.location.origin) {
    console.log('[Content] ❌ Origin mismatch. Event origin:', event.origin, 'Window origin:', window.location.origin)
    return
  }

  // Check if this is a SafeKey OAuth callback message
  if (event.data && event.data.type === 'SAFEKEY_OAUTH_CALLBACK') {
    console.log('[Content] 🎯 OAuth callback detected! Relaying to background worker')
    console.log('[Content] Window location hash:', window.location.hash.substring(0, 100))
    
    // Relay the message to the background worker
    // Include the full window.location.hash from this page for Enoki to process
    chrome.runtime.sendMessage(
      {
        type: 'COMPLETE_ZKLOGIN',
        hash: window.location.hash,  // Use actual window.location.hash from content script context
        search: window.location.search,
        idToken: event.data.idToken,
      },
      (response) => {
        console.log('[Content] Background response:', response)
        
        // Send response back to the page using window.postMessage (not event.source)
        window.postMessage(
          {
            type: 'SAFEKEY_OAUTH_RESPONSE',
            success: response?.success || false,
            error: response?.error,
            address: response?.address,
          },
          window.location.origin,
        )
      },
    )
  }
})

// Also send a message to background when this page loads
chrome.runtime.sendMessage(
  { type: 'PAGE_LOADED', url: window.location.href },
  (response) => {
    if (response) {
      console.log('Content script response:', response)
    }
  },
)

// Listen for messages from background script
chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
  if (request.type === 'INJECT_UI') {
    // Inject UI elements or perform actions on the page
    console.log('Injecting UI...')
    sendResponse({ success: true })
  }
})


export {}
