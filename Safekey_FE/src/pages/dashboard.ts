/**
 * Dashboard page for SafeKey extension
 * Displays and manages encrypted credentials stored on Sui blockchain
 */

import { getOrCreateVault, getCredentialInfo } from '../lib/vault'
import { isZkLoginActive, loadZkLoginSessionFromStorage, initializeEnokiFlow } from '../lib/zklogin'
import { getOrDeriveKM, initializeSeal } from '../lib/seal'
import { initializeSuiClient } from '../lib/sui'
import { decrypt, deriveKS, generateSessionNonce } from '../lib/crypto'

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

      // IMPORTANT: Do NOT call connectEnokiWallet in dashboard context!
      // Enoki sessions only work in popup context. The dashboard should just verify
      // that a session exists in storage. All signing will be routed through popup.
      const session = await loadZkLoginSessionFromStorage()
      if (session && session.provider) {
        console.log('[Dashboard] ✅ Session found in storage - signing will route through popup')
        // Don't try to connect here - it will trigger OAuth popup which Google blocks
        // The session is active in popup context, and signing requests will be routed there
      } else {
        console.warn('[Dashboard] ⚠️ No session found - user needs to login via popup first')
      }

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

    // Get or create vault - uses popup-based signing (HACKATHON WORKAROUND)
    console.log('[Dashboard] Getting or creating vault (signing via popup)...')
    const vaultId = await getOrCreateVault()
    console.log('[Dashboard] ✅ Vault ID:', vaultId)

    // TODO: Implement getAllDomainHashes - for now, show empty state
    const domainHashes: Uint8Array[] = []

    if (domainHashes.length === 0) {
      credentialsList.innerHTML = `
        <div class="empty-state">
          <h2>No Credentials Yet</h2>
          <p>You haven't saved any credentials yet.</p>
          <p>Use the extension to save passwords on websites.</p>
        </div>
      `
      return
    }

    // Load and display credentials
    const credentials = await Promise.all(
      domainHashes.map(async (domainHash) => {
        try {
          const info = await getCredentialInfo(vaultId, domainHash)
          if (!info) return null

          // Decrypt credential data
          const sessionNonce = generateSessionNonce() // Returns base64 string
          const ks = await deriveKS(km, sessionNonce)
          const dataBase64 = btoa(String.fromCharCode(...info.data))
          const decrypted = await decrypt(dataBase64, ks)

          // Parse decrypted data (assuming JSON format: {username, password, domain})
          // decrypt returns base64 string, decode it
          let credentialData: { username?: string; password?: string; domain?: string }
          try {
            const decryptedBytes = Uint8Array.from(atob(decrypted), c => c.charCodeAt(0))
            credentialData = JSON.parse(new TextDecoder().decode(decryptedBytes))
          } catch {
            credentialData = { username: 'Unknown', domain: 'Unknown' }
          }

          return {
            domainHash,
            domain: credentialData.domain || 'Unknown',
            username: credentialData.username || 'Unknown',
            createdAt: info.createdAt,
          }
        } catch (error) {
          console.error('[Dashboard] Failed to load credential:', error)
          return null
        }
      })
    )

    const validCredentials = credentials.filter((c): c is NonNullable<typeof c> => c !== null)

    if (validCredentials.length === 0) {
      credentialsList.innerHTML = `
        <div class="empty-state">
          <h2>No Credentials Found</h2>
          <p>Unable to load credentials. Please try again.</p>
        </div>
      `
      return
    }

    // Render credentials list
    credentialsList.innerHTML = `
      <div class="credentials-list">
        ${validCredentials
          .map(
            (cred) => `
          <div class="credential-item">
            <div class="credential-info">
              <div class="credential-domain">${escapeHtml(cred.domain)}</div>
              <div class="credential-username">${escapeHtml(cred.username)}</div>
            </div>
            <div class="credential-actions">
              <button class="btn btn-danger" onclick="deleteCredential('${btoa(String.fromCharCode(...cred.domainHash))}')">
                Delete
              </button>
            </div>
          </div>
        `
          )
          .join('')}
      </div>
    `
  } catch (error) {
    console.error('[Dashboard] Init error:', error)
    credentialsList.innerHTML = `
      <div class="error">
        <h2>Error Loading Dashboard</h2>
        <p>Failed to load credentials: ${error instanceof Error ? error.message : String(error)}</p>
        <p>Please try logging in again or contact support.</p>
      </div>
    `
  }
}

// generateSessionNonce is imported from crypto.ts

// Helper function to escape HTML
function escapeHtml(text: string): string {
  const div = document.createElement('div')
  div.textContent = text
  return div.innerHTML
}

// Delete credential function (exposed to window for onclick)
;(window as any).deleteCredential = async (_domainHashBase64: string) => {
  try {
    // TODO: Implement delete functionality
    alert('Delete functionality not yet implemented')
  } catch (error) {
    console.error('[Dashboard] Failed to delete credential:', error)
    alert('Failed to delete credential')
  }
}

// Initialize dashboard when page loads
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initDashboard)
} else {
  initDashboard()
}

