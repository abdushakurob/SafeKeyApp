/**
 * SafeKey Dashboard Page
 * Displays all saved credentials and allows management
 */

import { getCredentials, deleteCredentials, getAllDomainHashes } from '../lib/sui'
import { isZkLoginActive, loadZkLoginSessionFromStorage, initializeEnokiFlow, ensureWalletRegistryPopulated } from '../lib/zklogin'
import { getOrDeriveKM, initializeSeal } from '../lib/seal'
import { generateSessionNonce, deriveKS, decrypt } from '../lib/crypto'
import { initializeSuiClient } from '../lib/sui'

interface Credential {
  domain: string
  domainHash: string
  username: string
  password: string
}

// Initialize dashboard
async function initDashboard(): Promise<void> {
  const credentialsList = document.getElementById('credentialsList')
  if (!credentialsList) return

  try {
    console.log('[Dashboard] Initializing...')
    
    // Initialize Enoki (required for SEAL)
    try {
      const apiKey = import.meta.env.VITE_ENOKI_API_KEY
      const clientId = import.meta.env.VITE_OAUTH_CLIENT_ID
      
      if (!apiKey || !clientId) {
        console.error('[Dashboard] Missing Enoki config')
        throw new Error('Missing Enoki configuration')
      }
      
      console.log('[Dashboard] Initializing Enoki...')
      initializeEnokiFlow(apiKey, { google: { clientId } }, 'testnet')
      
      // Ensure wallet registry is populated (wallets might not be available immediately)
      await ensureWalletRegistryPopulated()
      
      console.log('[Dashboard] ✅ Enoki initialized')
    } catch (error) {
      console.error('[Dashboard] ❌ Failed to initialize Enoki:', error)
      throw error
    }
    
    // Initialize SEAL and Sui clients
    console.log('[Dashboard] Initializing SEAL and Sui clients...')
    initializeSeal('testnet')
    initializeSuiClient('testnet')
    
    // Load session from storage (dashboard runs in separate context)
    console.log('[Dashboard] Loading session from storage...')
    const session = await loadZkLoginSessionFromStorage()
    console.log('[Dashboard] Session loaded:', session ? 'Found' : 'Not found')
    
    // Check if user is logged in
    const isLoggedIn = isZkLoginActive()
    console.log('[Dashboard] Login status:', isLoggedIn)
    
    if (!isLoggedIn) {
      credentialsList.innerHTML = `
        <div class="empty-state">
          <h2>Please Login</h2>
          <p>You need to login with zkLogin to view your credentials.</p>
          <p>Open the SafeKey extension popup to login.</p>
        </div>
      `
      return
    }

    // Get KM
    console.log('[Dashboard] Deriving master key...')
    const km = await getOrDeriveKM()
    if (!km) {
      throw new Error('Failed to get master key')
    }
    console.log('[Dashboard] Master key derived successfully')

    // Initialize session in background script with KM
    console.log('[Dashboard] Initializing background session with KM...')
    const initResponse = await new Promise<{ success: boolean; error?: string }>((resolve) => {
      chrome.runtime.sendMessage({ type: 'INIT_SESSION', KM: km }, (response) => {
        resolve(response || { success: false, error: 'No response from background script' })
      })
    })
    
    if (!initResponse.success) {
      throw new Error(initResponse.error || 'Failed to initialize background session')
    }
    console.log('[Dashboard] ✅ Background session initialized')

    // Get or create vault via background script (handles wallet interactions better)
    console.log('[Dashboard] Requesting vault from background script...')
    const vaultResponse = await new Promise<{ success: boolean; vaultId?: string; error?: string }>((resolve) => {
      chrome.runtime.sendMessage({ type: 'GET_OR_CREATE_VAULT' }, (response) => {
        resolve(response || { success: false, error: 'No response from background script' })
      })
    })
    
    if (!vaultResponse.success || !vaultResponse.vaultId) {
      throw new Error(vaultResponse.error || 'Failed to get or create vault')
    }
    
    const vaultId = vaultResponse.vaultId
    console.log('[Dashboard] ✅ Vault ID:', vaultId)
    
    // Get all domain hashes
    const domainHashes = await getAllDomainHashes(vaultId)

    if (domainHashes.length === 0) {
      credentialsList.innerHTML = `
        <div class="empty-state">
          <h2>No Credentials Saved</h2>
          <p>Start saving credentials by using the autofill feature on login forms.</p>
        </div>
      `
      return
    }

    // Load credentials
    const credentials: Credential[] = []
    const sessionNonce = generateSessionNonce()
    const sessionKey = await deriveKS(km, sessionNonce)

    for (const domainHashBytes of domainHashes) {
      try {
        const creds = await getCredentials(vaultId, domainHashBytes)
        if (creds) {
          // Decrypt
          const encryptedData = btoa(String.fromCharCode(...creds.data))
          const decrypted = await decrypt(encryptedData, sessionKey)
          
          let credData
          try {
            credData = JSON.parse(decrypted)
          } catch {
            credData = { password: decrypted }
          }

          // Try to reverse hash domain (we'll store domain in metadata)
          // For now, use domain hash as identifier
          credentials.push({
            domain: `Domain ${credentials.length + 1}`, // TODO: Store domain with hash
            domainHash: btoa(String.fromCharCode(...domainHashBytes)),
            username: credData.username || '',
            password: credData.password || decrypted,
          })
        }
      } catch (error) {
        console.error('[Dashboard] Failed to load credential:', error)
      }
    }

    // Render credentials
    if (credentials.length === 0) {
      credentialsList.innerHTML = `
        <div class="empty-state">
          <h2>No Credentials Found</h2>
          <p>Unable to load credentials. They may have been deleted.</p>
        </div>
      `
      return
    }

    credentialsList.innerHTML = credentials.map((cred, index) => `
      <div class="credential-item">
        <div class="credential-info">
          <div class="credential-domain">${cred.domain}</div>
          <div class="credential-username">${cred.username || 'No username'}</div>
        </div>
        <div class="credential-actions">
          <button class="btn btn-view" onclick="viewCredential(${index})">View</button>
          <button class="btn btn-delete" onclick="deleteCredential('${cred.domainHash}')">Delete</button>
        </div>
      </div>
    `).join('')

    // Store credentials in window for access
    ;(window as any).dashboardCredentials = credentials

  } catch (error) {
    console.error('[Dashboard] Init error:', error)
    credentialsList.innerHTML = `
      <div class="empty-state">
        <h2>Error</h2>
        <p>${error instanceof Error ? error.message : String(error)}</p>
      </div>
    `
  }
}

// View credential (show password)
function viewCredential(index: number): void {
  const creds = (window as any).dashboardCredentials as Credential[]
  if (!creds || !creds[index]) return

  const cred = creds[index]
  const password = cred.password

  // Show password in alert (or better: modal)
  alert(`Domain: ${cred.domain}\nUsername: ${cred.username}\nPassword: ${password}`)
}

// Delete credential
async function deleteCredential(domainHashB64: string): Promise<void> {
  if (!confirm('Are you sure you want to delete this credential?')) {
    return
  }

  try {
    const km = await getOrDeriveKM()
    if (!km) {
      throw new Error('Failed to get master key')
    }

    const domainHashBytes = Uint8Array.from(atob(domainHashB64), c => c.charCodeAt(0))
    
    // Get vault ID from background script
    const vaultResponse = await new Promise<{ success: boolean; vaultId?: string; error?: string }>((resolve) => {
      chrome.runtime.sendMessage({ type: 'GET_OR_CREATE_VAULT' }, (response) => {
        resolve(response || { success: false, error: 'No response from background script' })
      })
    })
    
    if (!vaultResponse.success || !vaultResponse.vaultId) {
      throw new Error(vaultResponse.error || 'Failed to get vault')
    }
    
    const vaultId = vaultResponse.vaultId
    await deleteCredentials(vaultId, domainHashBytes)

    // Remove from local storage tracking
    const stored = await chrome.storage.local.get('safekey_domains')
    const domains = stored.safekey_domains || []
    const domainHash = btoa(String.fromCharCode(...domainHashBytes))
    const updatedDomains = domains.filter((d: string) => d !== domainHash)
    await chrome.storage.local.set({ safekey_domains: updatedDomains })

    // Reload dashboard
    await initDashboard()
  } catch (error) {
    console.error('[Dashboard] Delete error:', error)
    alert('Failed to delete credential: ' + (error instanceof Error ? error.message : String(error)))
  }
}

// Expose functions to window
;(window as any).viewCredential = viewCredential
;(window as any).deleteCredential = deleteCredential

// Initialize on load
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initDashboard)
} else {
  initDashboard()
}

export {}

