import { sendHeartbeat } from '../shared/heartbeat'

console.log('[SafeKey Extension] Background script loaded')

sendHeartbeat()
setInterval(sendHeartbeat, 20000)

chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
  console.log('[Background] Received message:', request.type)

  // Ping - check if extension is available
  if (request.type === 'PING') {
    sendResponse({ success: true })
    return true
  }

  // Sync session from web app
  if (request.type === 'SYNC_SESSION') {
    chrome.storage.local
      .set({ session: request.session })
      .then(() => {
        console.log('[Background] Session synced from web app')
        sendResponse({ success: true })
      })
      .catch((error) => {
        console.error('[Background] Failed to sync session:', error)
        sendResponse({ success: false, error: String(error) })
      })
    return true
  }

  // Get stored session
  if (request.type === 'GET_SESSION') {
    chrome.storage.local
      .get('session')
      .then((result) => {
        console.log('[Background] Session retrieved:', result.session ? 'exists' : 'null')
        sendResponse({ success: true, session: result.session || null })
      })
      .catch((error) => {
        console.error('[Background] Failed to get session:', error)
        sendResponse({ success: false, error: String(error) })
      })
    return true // Keep channel open for async response
  }

  // Clear session
  if (request.type === 'CLEAR_SESSION') {
    chrome.storage.local
      .remove('session')
      .then(() => {
        console.log('[Background] Session cleared')
        sendResponse({ success: true })
      })
      .catch((error) => {
        console.error('[Background] Failed to clear session:', error)
        sendResponse({ success: false, error: String(error) })
      })
    return true
  }

  // Log error from content script
  if (request.type === 'LOG_ERROR') {
    console.error('[Background] Error from content script:', request.message, request.error)
    sendResponse({ success: true })
    return true
  }

  // Blockchain request from content script
  // Forward to web app (if open) or queue it
  if (request.type === 'BLOCKCHAIN_REQUEST') {
    console.log('[Background] Blockchain request received:', request.request)
    
    // Try to find web app tab
    chrome.tabs.query({ url: 'http://localhost:3000/*' }, async (tabs) => {
      let webAppTab = tabs[0]
      
      // If web app is not open, don't open it automatically (user can open manually)
      if (!webAppTab) {
        console.log('[Background] Web app not open. User needs to open it manually.')
        sendResponse({
          success: false,
          error: 'Web app is not open. Please open http://localhost:3000/dashboard',
        })
        return
      }
      
      // Inject content script if needed and send message
      try {
        // Try to send message (content script should be injected)
        const response = await chrome.tabs.sendMessage(webAppTab.id!, {
          type: 'BLOCKCHAIN_REQUEST',
          request: request.request,
        })
        
        // Forward response back to content script
        sendResponse(response)
      } catch (error) {
        // If content script not injected, inject it first
        console.log('[Background] Injecting content script into web app...')
        try {
          await chrome.scripting.executeScript({
            target: { tabId: webAppTab.id! },
            files: ['web-app-bridge.js'],
          })

          // Wait a bit for script to initialize
          await new Promise((resolve) => setTimeout(resolve, 500))

          // Try sending message again
          const response = await chrome.tabs.sendMessage(webAppTab.id!, {
            type: 'BLOCKCHAIN_REQUEST',
            request: request.request,
          })

          sendResponse(response)
        } catch (injectError) {
          console.error('[Background] Error injecting script or sending message:', injectError)
          sendResponse({
            success: false,
            error: 'Failed to communicate with web app. Make sure the web app is loaded.',
          })
        }
      }
    })
    
    return true // Keep channel open for async response
  }

  return false
})

