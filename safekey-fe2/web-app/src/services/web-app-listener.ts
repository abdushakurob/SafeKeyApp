/**
 * Web App Message Listener
 * Listens for messages from extension and processes blockchain requests
 */

import { setupExtensionListener } from './extension-bridge'

let listenerSetup = false

/**
 * Set up message listener for extension communication
 * This should be called when the Dashboard component mounts
 */
export function setupWebAppListener(
  address: string,
  idToken: string,
  signAndExecute: (params: { transaction: any }) => Promise<any>
) {
  if (listenerSetup) {
    return
  }

  // Set up extension bridge listener (handles chrome.runtime messages)
  setupExtensionListener(address, idToken, signAndExecute)

  // Also listen for messages from extension tabs (content scripts)
  if (typeof chrome !== 'undefined' && chrome.runtime) {
    // This handles messages sent via chrome.tabs.sendMessage
    // We need to inject a script into the page to receive these
    const script = document.createElement('script')
    script.textContent = `
      (function() {
        if (window.safekeyMessageListener) return;
        
        window.safekeyMessageListener = function(message) {
          if (message.type === 'BLOCKCHAIN_REQUEST') {
            // Forward to React app via custom event
            window.dispatchEvent(new CustomEvent('safekey-blockchain-request', {
              detail: message.request
            }));
          }
        };
      })();
    `
    document.documentElement.appendChild(script)
    script.remove()
  }

  listenerSetup = true
}




