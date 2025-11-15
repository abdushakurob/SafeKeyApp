
console.log('[Web App Bridge] Content script loaded')

if (typeof window !== 'undefined' && chrome.runtime && chrome.runtime.id) {
  const extensionId = chrome.runtime.id
  ;(window as any).__SAFEKEY_EXTENSION_ID__ = extensionId
  console.log('[Web App Bridge] Extension ID exposed:', extensionId)
  
  document.documentElement.setAttribute('data-safekey-extension-id', extensionId)
  
  window.dispatchEvent(new CustomEvent('safekey-extension-ready', { 
    detail: { extensionId } 
  }))
} else {
  console.warn('[Web App Bridge] Failed to get extension ID - chrome.runtime.id not available')
}

chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
  if (request.type === 'BLOCKCHAIN_REQUEST') {
    console.log('[Web App Bridge] Received blockchain request:', request.request)
    
    window.dispatchEvent(
      new CustomEvent('safekey-blockchain-request', {
        detail: request.request,
      })
    )

    const handleResponse = (event: CustomEvent) => {
      window.removeEventListener('safekey-blockchain-response', handleResponse as EventListener)
      sendResponse(event.detail)
    }

    window.addEventListener('safekey-blockchain-response', handleResponse as EventListener)

    setTimeout(() => {
      window.removeEventListener('safekey-blockchain-response', handleResponse as EventListener)
      if (!sendResponse) return
      sendResponse({ success: false, error: 'Request timeout' })
    }, 30000)

    return true
  }

  return false
})

window.addEventListener('safekey-blockchain-response', ((event: CustomEvent) => {
  console.log('[Web App Bridge] Response received from web app:', event.detail)
}) as EventListener)

