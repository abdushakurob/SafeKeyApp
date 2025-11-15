/**
 * 
 * Since Enoki session is only active in popup context, we route all
 * transaction signing through the popup where the session is available.
 */

import { Transaction } from '@mysten/sui/transactions'
import { SuiClient, getFullnodeUrl } from '@mysten/sui/client'
import { getUserAddress, getEnokiWallet, getProvider } from './zklogin'
import { createEnokiSignerAdapter } from './seal'

/**
 * Sign and execute a transaction using popup-based signing
 * This works around the Enoki session issue by signing in popup context
 */
export async function signAndExecuteTransactionViaPopup(
  transaction: Transaction,
  network: 'testnet' | 'mainnet' | 'devnet' = 'testnet'
): Promise<{ digest: string; effects?: unknown }> {
  const client = new SuiClient({ url: getFullnodeUrl(network) })
  const address = getUserAddress()
  
  if (!address) {
    throw new Error('No user address available. Please login first.')
  }

  // Set sender
  transaction.setSender(address)

  // Build transaction
  const txBytes = await transaction.build({ client })

  // Check if we're in popup context
  const isPopup = typeof window !== 'undefined' && (
    window.location.pathname.includes('popup.html') || 
    window.location.pathname.includes('popup')
  )

  if (isPopup) {
    // Sign directly in popup (session is active here)
    console.log('[TxSigner] Signing in popup context (session active)')
    
    const provider = getProvider()
    if (!provider) throw new Error('No provider available')
    
    const wallet = getEnokiWallet(provider)
    if (!wallet) throw new Error('Enoki wallet not available')

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const signer = createEnokiSignerAdapter(wallet, address) as any
    const signature = await signer.signTransactionBlock(txBytes)
    
    // Execute
    const result = await client.executeTransactionBlock({
      transactionBlock: txBytes,
      signature,
      options: {
        showEffects: true,
        showObjectChanges: true,
      },
    })
    
    return {
      digest: result.digest,
      effects: result.effects,
    }
  } else {
    // Dashboard/background context - open popup and route through it for signing
    console.log('[TxSigner] Opening extension popup for transaction signing...')
    
    // Convert txBytes to base64 for message passing
    const txBytesBase64 = btoa(String.fromCharCode(...txBytes))
    
    // Open extension popup programmatically
    return new Promise((resolve, reject) => {
      // Create a unique request ID
      const requestId = `sign-tx-${Date.now()}-${Math.random()}`
      
      // Set up message listener FIRST (before opening popup)
      // This ensures we don't miss the response
      const messageListener = (message: { type: string; requestId?: string; error?: string; signature?: string }) => {
        console.log('[TxSigner] Received message:', message.type, message.requestId === requestId ? '(matches)' : '(different)')
        
        if (message.type === 'SIGN_TRANSACTION_RESPONSE' && message.requestId === requestId) {
          console.log('[TxSigner] ✅ Received matching response from popup')
          chrome.runtime.onMessage.removeListener(messageListener)
          
          if (message.error) {
            reject(new Error(message.error))
          } else if (message.signature) {
            console.log('[TxSigner] Executing transaction with signature from popup...')
            // Execute transaction with signature from popup
            client.executeTransactionBlock({
              transactionBlock: txBytes,
              signature: message.signature,
              options: {
                showEffects: true,
                showObjectChanges: true,
              },
            }).then(result => {
              console.log('[TxSigner] ✅ Transaction executed successfully')
              resolve({
                digest: result.digest,
                effects: result.effects,
              })
            }).catch(reject)
          } else {
            reject(new Error('No signature received from popup'))
          }
        }
      }
      
      // Register listener BEFORE opening popup
      chrome.runtime.onMessage.addListener(messageListener)
      console.log('[TxSigner] Message listener registered, waiting for response...')
      
      // Function to open popup and send signing request
      const openPopupAndSign = async () => {
        try {
          const popupUrl = chrome.runtime.getURL('src/popup/popup.html')
          
          // Try to open popup using chrome.action (Chrome) or chrome.windows (Firefox)
          try {
            // Chrome: Use chrome.action.openPopup() if available
            if (chrome.action && chrome.action.openPopup) {
              await chrome.action.openPopup()
            } else {
              // Firefox/fallback: Open as a new window
              await chrome.windows.create({
                url: popupUrl,
                type: 'popup',
                width: 400,
                height: 600,
                focused: true,
              })
            }
          } catch (openError) {
            // If we can't open programmatically, try to find existing popup window
            const windows = await chrome.windows.getAll({ populate: true })
            const popupWindow = windows.find(w => {
              if (w.type !== 'popup') return false
              // Check tabs for popup URL
              const tabs = w.tabs || []
              return tabs.some(tab => tab.url?.includes('popup.html'))
            })
            
            if (!popupWindow) {
              // Last resort: Open as new window
              await chrome.windows.create({
                url: popupUrl,
                type: 'popup',
                width: 400,
                height: 600,
                focused: true,
              })
            } else {
              // Focus existing popup
              await chrome.windows.update(popupWindow.id!, { focused: true })
            }
          }
          
          // Wait a bit for popup to initialize
          console.log('[TxSigner] Waiting for popup to initialize...')
          await new Promise(resolve => setTimeout(resolve, 1500))
          
          // Send signing request to popup
          console.log('[TxSigner] Sending signing request to popup...', { requestId, address, network })
          chrome.runtime.sendMessage({
            type: 'SIGN_TRANSACTION_REQUEST',
            requestId,
            txBytes: txBytesBase64,
            address,
            network,
          }).then(() => {
            console.log('[TxSigner] ✅ Signing request sent to popup')
          }).catch((error) => {
            console.error('[TxSigner] ❌ Failed to send signing request:', error)
            chrome.runtime.onMessage.removeListener(messageListener)
            reject(new Error(`Failed to send signing request to popup: ${error.message}`))
          })
        } catch (error: any) {
          console.error('[TxSigner] ❌ Failed to open popup:', error)
          chrome.runtime.onMessage.removeListener(messageListener)
          reject(new Error(`Failed to open popup: ${error.message}`))
        }
      }
      
      // Open popup and send request
      openPopupAndSign()
      
      // Timeout after 60 seconds (user needs time to review and sign)
      setTimeout(() => {
        chrome.runtime.onMessage.removeListener(messageListener)
        reject(new Error('Transaction signing request timed out. Please sign the transaction in the popup.'))
      }, 60000)
    })
  }
  
  // OLD APPROACH (removed - didn't work)
  /* else {
    // Fallback: Route through popup for signing (if direct signing fails)
    console.log('[TxSigner] ⚠️ Direct signing failed, routing through popup as fallback...')
    
    // Convert txBytes to base64 for message passing
    const txBytesBase64 = btoa(String.fromCharCode(...txBytes))
    
    // Send to popup for signing
    return new Promise((resolve, reject) => {
      // Create a unique request ID
      const requestId = `sign-tx-${Date.now()}-${Math.random()}`
      
      // Listen for response
      const messageListener = (message: { type: string; requestId?: string; error?: string; signature?: string }) => {
        if (message.type === 'SIGN_TRANSACTION_RESPONSE' && message.requestId === requestId) {
          chrome.runtime.onMessage.removeListener(messageListener)
          
          if (message.error) {
            reject(new Error(message.error))
          } else if (message.signature) {
            // Execute transaction with signature from popup
            client.executeTransactionBlock({
              transactionBlock: txBytes,
              signature: message.signature,
              options: {
                showEffects: true,
                showObjectChanges: true,
              },
            }).then(result => {
              resolve({
                digest: result.digest,
                effects: result.effects,
              })
            }).catch(reject)
          } else {
            reject(new Error('No signature received from popup'))
          }
        }
      }
      
      chrome.runtime.onMessage.addListener(messageListener)
      
      // Send signing request to popup
      chrome.runtime.sendMessage({
        type: 'SIGN_TRANSACTION_REQUEST',
        requestId,
        txBytes: txBytesBase64,
        address,
        network,
      }).catch((error) => {
        chrome.runtime.onMessage.removeListener(messageListener)
        reject(new Error(`Failed to send signing request to popup: ${error.message}`))
      })
      
      // Timeout after 30 seconds
      setTimeout(() => {
        chrome.runtime.onMessage.removeListener(messageListener)
        reject(new Error('Transaction signing request timed out. Please ensure popup is open.'))
      }, 30000)
    })
  } */
}

