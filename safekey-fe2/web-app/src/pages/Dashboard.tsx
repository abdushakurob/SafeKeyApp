import { useCurrentAccount, useWallets } from '@mysten/dapp-kit'
import { useNavigate } from 'react-router-dom'
import { useEffect, useState, useCallback, useRef, useMemo } from 'react'
import { clearSession, loadSession } from '../lib/zklogin'
import { clearExtensionSession, syncSessionToExtension } from '../lib/extension'
import { saveCredential, deleteCredential } from '../lib/credentials'
import { clearSession as clearSessionInStore } from '../server/session-store'
import { signAndExecuteSponsoredTransaction } from '../lib/sponsored-transactions'
import { API_BASE_URL } from '../lib/api-config'
import { masterKeyManager } from '../lib/master-key-manager'
import { sessionManager } from '../lib/session-manager'
import { persistenceManager } from '../lib/persistence-manager'
import './Dashboard.css'
import logoLight from '../assets/logo_light.png'
import userIcon from '../assets/user icon.png'

// --- Icons ---
const Icons = {
  Dashboard: () => (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="7"></rect>
      <rect x="14" y="3" width="7" height="7"></rect>
      <rect x="14" y="14" width="7" height="7"></rect>
      <rect x="3" y="14" width="7" height="7"></rect>
    </svg>
  ),
  Menu: () => (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="3" y1="12" x2="21" y2="12"></line>
      <line x1="3" y1="6" x2="21" y2="6"></line>
      <line x1="3" y1="18" x2="21" y2="18"></line>
    </svg>
  ),
  Eye: () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
      <circle cx="12" cy="12" r="3"></circle>
    </svg>
  ),
  EyeOff: () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path>
      <line x1="1" y1="1" x2="23" y2="23"></line>
    </svg>
  ),
  Copy: () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
    </svg>
  ),
  Trash: () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3 6 5 6 21 6"></polyline>
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
    </svg>
  ),
  Search: () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="8"></circle>
      <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
    </svg>
  ),
  ChevronRight: () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="9 18 15 12 9 6"></polyline>
    </svg>
  )
}

export default function Dashboard() {
  const currentAccount = useCurrentAccount()
  const wallets = useWallets()
  const navigate = useNavigate()

  // Wrapper for sponsored transactions - memoized to prevent re-renders
  const signAndExecute = useCallback(async (params: { transaction: any }) => {
    if (!currentAccount) {
      throw new Error('No current account')
    }

    // Get the connected wallet
    const connectedWallet = wallets.find(w => w.accounts.some(acc => acc.address === currentAccount.address))
    if (!connectedWallet) {
      throw new Error('No connected wallet found')
    }

    // Get the signTransaction feature from the wallet
    const signTransactionFeature = (connectedWallet.features as any)['sui:signTransaction']
    if (!signTransactionFeature) {
      throw new Error('Wallet does not support sui:signTransaction')
    }

    return signAndExecuteSponsoredTransaction(
      params.transaction,
      async (sponsoredBytes: string) => {
        // Sign sponsored transaction bytes (base64 string)
        // Enoki's signTransaction expects a Transaction object, so we need to reconstruct it
        // from the base64 bytes
        const { Transaction } = await import('@mysten/sui/transactions')
        const { fromB64 } = await import('@mysten/sui/utils')

        // Decode base64 to Uint8Array
        const txBytes = fromB64(sponsoredBytes)

        // Reconstruct Transaction from bytes
        const sponsoredTx = Transaction.from(txBytes)

        // Sign the Transaction object
        const result = await signTransactionFeature.signTransaction({
          transaction: sponsoredTx,
          account: currentAccount,
          chain: currentAccount.chains?.[0] || 'sui:testnet',
        })
        return result.signature
      },
      currentAccount.address
    )
  }, [currentAccount, wallets])
  const [session] = useState(() => loadSession())
  const [credentials, setCredentials] = useState<Array<{ domain: string; username: string; password?: string }>>([])
  const [showAddForm, setShowAddForm] = useState(false)
  const [newCredential, setNewCredential] = useState({ domain: '', username: '', password: '' })
  const [loading, setLoading] = useState(false)
  const [loadingCredentials, setLoadingCredentials] = useState(true)
  const [_extensionInstalled, setExtensionInstalled] = useState(false)
  const [extensionSynced, setExtensionSynced] = useState(false)

  // New State
  const [searchQuery, setSearchQuery] = useState('')
  // Selected credential is now a GROUP of credentials for a domain
  const [selectedGroup, setSelectedGroup] = useState<{ domain: string; accounts: Array<{ username: string; password?: string }> } | null>(null)
  const [showUserMenu, setShowUserMenu] = useState(false)
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false)
  // Track password visibility per account index in the modal
  const [visiblePasswords, setVisiblePasswords] = useState<Record<number, boolean>>({})
  const [sidebarExpanded, setSidebarExpanded] = useState(false)

  // Add a flag to prevent multiple initializations
  const [isInitialized, setIsInitialized] = useState(false)

  // Use ref to prevent multiple concurrent initialization attempts
  const initializingRef = useRef(false)

  // Single coordinated initialization effect
  useEffect(() => {
    // Redirect to login if not connected
    if (!currentAccount) {
      navigate('/login')
      return
    }

    if (!session?.idToken) {
      console.error('[Dashboard] idToken is required but not available in session')
      return
    }

    // Prevent multiple initializations
    if (isInitialized || initializingRef.current) {
      console.log('[Dashboard] Already initialized or initializing, skipping...')
      return
    }

    let extensionCheckInterval: NodeJS.Timeout
    let queueProcessInterval: NodeJS.Timeout

    const initializeApp = async () => {
      try {
        console.log('[Dashboard] Starting initialization...')
        initializingRef.current = true
        setIsInitialized(true)

        // 1. Check for persisted session data first
        const persistedSession = await persistenceManager.getSessionIfValid(
          currentAccount.address,
          session.idToken
        )

        let masterKey: string

        if (persistedSession) {
          console.log('[Dashboard] Using persisted session data')
          masterKey = persistedSession.masterKey

          // Update managers with cached data
          masterKeyManager.setMasterKey(currentAccount.address, masterKey)
        } else {
          console.log('[Dashboard] No valid persisted session, deriving master key...')
          // Derive master key using deduplication manager
          masterKey = await masterKeyManager.getMasterKey(
            currentAccount.address,
            session.idToken,
            wallets,
            currentAccount,
            signAndExecute
          )

          // Persist the session for future use
          await persistenceManager.storeSession({
            address: currentAccount.address,
            idToken: session.idToken,
            provider: session.provider!,
            createdAt: session.createdAt!,
            masterKey,
          })
        }

        // 2. Sync session to API server using deduplication manager
        await sessionManager.syncSessionToAPI({
          address: currentAccount.address,
          idToken: session.idToken,
          provider: session.provider!,
          createdAt: session.createdAt!,
          masterKey,
        })

        // 3. Load credentials initially
        await loadCredentials()

        // 4. Set up extension status polling
        const checkExtensionStatus = async () => {
          try {
            const response = await fetch(`${API_BASE_URL}/extension-status`)
            if (response.ok) {
              const data = await response.json()
              setExtensionInstalled(data.installed === true)

              if (data.installed && currentAccount && session?.idToken) {
                const success = await syncSessionToExtension({
                  address: currentAccount.address,
                  idToken: session.idToken,
                  provider: session.provider,
                  createdAt: session.createdAt,
                })
                setExtensionSynced(success)
              } else {
                setExtensionSynced(false)
              }
            }
          } catch (error) {
            setExtensionInstalled(false)
            setExtensionSynced(false)
          }
        }

        // Initial extension check
        await checkExtensionStatus()

        // Set up extension polling (every 5 seconds)
        extensionCheckInterval = setInterval(checkExtensionStatus, 5000)

        // 5. Set up queue processing
        const processQueue = async () => {
          try {
            const response = await fetch(`${API_BASE_URL}/pending-saves`)
            const data = await response.json()

            if (data.success && data.pending && data.pending.length > 0) {
              const masterKey = await masterKeyManager.getMasterKey(
                currentAccount.address,
                session.idToken,
                wallets,
                currentAccount,
                signAndExecute
              )

              for (const item of data.pending) {
                try {
                  await saveCredential(
                    { domain: item.domain, username: item.username, password: item.password },
                    masterKey,
                    currentAccount.address,
                    signAndExecute,
                    wallets,
                    currentAccount
                  )

                  await fetch(`${API_BASE_URL}/pending-saves/${item.id}/complete`, {
                    method: 'POST',
                  })

                  // Refresh credentials list (force refresh to skip cache)
                  await loadCredentials(true)
                } catch (error) {
                  console.error(`[Dashboard] Error processing queued save:`, error)
                }
              }
            }
          } catch (error) {
            // Ignore errors in queue processing
          }
        }

        // Set up queue polling (every 10 seconds)
        queueProcessInterval = setInterval(processQueue, 10000)

        console.log('[Dashboard] Initialization complete!')
        initializingRef.current = false

      } catch (error) {
        console.error('[Dashboard] Error initializing app:', error)
        // Reset the initializing ref to allow manual retry
        initializingRef.current = false
        // Keep isInitialized true to prevent automatic retries that cause loops
      }
    }

    // Start initialization
    initializeApp()

    // Cleanup function
    return () => {
      if (extensionCheckInterval) {
        clearInterval(extensionCheckInterval)
      }
      if (queueProcessInterval) {
        clearInterval(queueProcessInterval)
      }
    }
  }, [currentAccount?.address, session?.idToken, navigate])

  // Separate effect for credential loading when needed
  const loadCredentials = async (forceRefresh: boolean = false) => {
    if (!currentAccount || !session?.idToken) return

    setLoadingCredentials(true)
    try {
      // 1. Try to load from cache first (unless force refresh)
      if (!forceRefresh) {
        const masterKey = masterKeyManager.getCachedMasterKey()
        if (masterKey) {
          const cachedCredentials = await persistenceManager.getCredentials(masterKey)
          if (cachedCredentials) {
            console.log('[Dashboard] Using cached credentials')
            setCredentials(cachedCredentials)
            setLoadingCredentials(false)
            return
          }
        }
      } else {
        console.log('[Dashboard] Force refresh requested, skipping cache')
      }

      // 2. Fetch from API if no cache
      console.log('[Dashboard] Fetching credentials from API...')
      const response = await fetch(`${API_BASE_URL}/all-credentials`)

      if (!response.ok) {
        if (response.status === 401) {
          console.warn('[Dashboard] Unauthorized - retrying...')
          await new Promise(resolve => setTimeout(resolve, 500))
          const retryResponse = await fetch(`${API_BASE_URL}/all-credentials`)
          if (!retryResponse.ok) {
            throw new Error(`HTTP ${retryResponse.status}: ${retryResponse.statusText}`)
          }
          const retryData = await retryResponse.json()
          if (retryData.success && Array.isArray(retryData.credentials)) {
            setCredentials(retryData.credentials)
            console.log('[Dashboard] Loaded', retryData.credentials.length, 'credentials')

            // Cache the results
            const masterKey = masterKeyManager.getCachedMasterKey()
            if (masterKey) {
              await persistenceManager.storeCredentials(retryData.credentials, masterKey)
            }
            return
          }
        }
        throw new Error(`HTTP ${response.status}: ${response.statusText}`)
      }

      const data = await response.json()

      if (data.success && Array.isArray(data.credentials)) {
        setCredentials(data.credentials)
        console.log('[Dashboard] Loaded', data.credentials.length, 'credentials')

        // Cache the results
        const masterKey = masterKeyManager.getCachedMasterKey()
        if (masterKey) {
          await persistenceManager.storeCredentials(data.credentials, masterKey)
        }
      } else {
        console.error('[Dashboard] Failed to load credentials:', data.error || 'Invalid response')
        setCredentials([])
      }
    } catch (error) {
      console.error('[Dashboard] Error loading credentials:', error)
      if (error instanceof TypeError && error.message.includes('fetch')) {
        console.warn('[Dashboard] API server not running, credentials not loaded')
      }
      setCredentials([])
    } finally {
      setLoadingCredentials(false)
    }
  }

  const handleLogout = async () => {
    try {
      console.log('[Dashboard] Starting logout process...')

      // 1. Clear session data
      clearSession()
      clearSessionInStore()

      // 2. Clear manager caches
      masterKeyManager.clearCache()
      sessionManager.clearState()

      // 3. Clear persistence layer
      persistenceManager.clearAll()

      // 4. Clear API session
      fetch(`${API_BASE_URL}/clear-session`, { method: 'POST' }).catch(() => { })

      // 5. Clear extension session
      await clearExtensionSession()

      // 5. Disconnect all wallets to clear IndexedDB state
      try {
        const connectedWallets = wallets.filter(wallet =>
          wallet.accounts.some(account => account.address === currentAccount?.address)
        )

        for (const wallet of connectedWallets) {
          if (wallet.features['standard:disconnect']) {
            console.log('[Dashboard] Disconnecting wallet:', wallet.name)
            await wallet.features['standard:disconnect'].disconnect()
          }
        }
      } catch (error) {
        console.warn('[Dashboard] Error disconnecting wallets:', error)
      }

      // 6. Clear IndexedDB entries (Enoki and wallet data)
      try {
        // Clear all IndexedDB databases that might store wallet state
        const databases = await indexedDB.databases()
        for (const db of databases) {
          if (db.name && (
            db.name.includes('enoki') ||
            db.name.includes('wallet') ||
            db.name.includes('sui') ||
            db.name.includes('dapp')
          )) {
            console.log('[Dashboard] Clearing IndexedDB:', db.name)
            indexedDB.deleteDatabase(db.name)
          }
        }
      } catch (error) {
        console.warn('[Dashboard] Error clearing IndexedDB:', error)
      }

      // 7. Clear all localStorage entries related to wallets
      Object.keys(localStorage).forEach(key => {
        if (key.includes('wallet') || key.includes('enoki') || key.includes('sui') || key.includes('connect')) {
          console.log('[Dashboard] Clearing localStorage key:', key)
          localStorage.removeItem(key)
        }
      })

      // 8. Clear sessionStorage
      sessionStorage.clear()

      console.log('[Dashboard] Logout complete, redirecting...')
      navigate('/')

      // 9. Force page reload to ensure clean state
      setTimeout(() => {
        window.location.reload()
      }, 100)

    } catch (error) {
      console.error('[Dashboard] Error during logout:', error)
      // Force navigation anyway
      navigate('/')
      window.location.reload()
    }
  }

  const handleAddCredential = async () => {
    if (!currentAccount) {
      alert('Please login first')
      return
    }

    if (!newCredential.domain || !newCredential.username || !newCredential.password) {
      alert('Please fill in all fields')
      return
    }

    setLoading(true)
    try {
      if (!session?.idToken) {
        throw new Error('idToken is required but not available in session')
      }

      // Use deduplication manager for master key
      const masterKey = await masterKeyManager.getMasterKey(
        currentAccount.address,
        session.idToken,
        wallets,
        currentAccount,
        signAndExecute
      )

      await saveCredential(
        { domain: newCredential.domain, username: newCredential.username, password: newCredential.password },
        masterKey,
        currentAccount.address,
        signAndExecute,
        wallets,
        currentAccount
      )

      // Reload credentials from API (force refresh to skip cache)
      await loadCredentials(true)
      setNewCredential({ domain: '', username: '', password: '' })
      setShowAddForm(false)
    } catch (error) {
      console.error('[Dashboard] Error saving credential:', error)
      alert('Failed to save credential: ' + String(error))
    } finally {
      setLoading(false)
    }
  }

  const handleDeleteCredential = async (domain: string) => {
    if (!currentAccount) {
      alert('Please login first')
      return
    }

    setLoading(true)
    try {
      if (!session?.idToken) {
        throw new Error('idToken is required but not available in session')
      }

      // Get master key using deduplication manager
      const masterKey = await masterKeyManager.getMasterKey(
        currentAccount.address,
        session.idToken,
        wallets,
        currentAccount,
        signAndExecute
      )

      console.log('[Dashboard] Deleting credential for domain:', domain)

      // Delete from blockchain
      const txHash = await deleteCredential(
        domain,
        masterKey,
        currentAccount.address,
        signAndExecute
      )

      console.log('[Dashboard] Credential deleted, transaction:', txHash)

      // Remove from local state immediately
      setCredentials(credentials.filter(c => c.domain !== domain))

      // Clear cached credentials to force refresh
      persistenceManager.clearCredentials()

      // Reload credentials to verify deletion (force refresh)
      await loadCredentials(true)

      // Close modal if open
      setSelectedGroup(null)

    } catch (error) {
      console.error('[Dashboard] Error deleting credential:', error)
      const errorMessage = error instanceof Error ? error.message : String(error)
      alert(`Failed to delete credential: ${errorMessage}`)
    } finally {
      setLoading(false)
    }
  }

  // Helper to get brand color based on domain
  const getBrandColor = (domain: string) => {
    const d = domain.toLowerCase()
    if (d.includes('google')) return 'linear-gradient(135deg, #4285F4, #34A853, #FBBC05, #EA4335)'
    if (d.includes('netflix')) return '#E50914'
    if (d.includes('spotify')) return '#1DB954'
    if (d.includes('github')) return '#333'
    if (d.includes('twitter') || d.includes('x.com')) return '#1DA1F2'
    if (d.includes('facebook')) return '#1877F2'
    if (d.includes('amazon')) return '#FF9900'
    return '#333' // Default
  }

  // Filter and Group credentials
  const groupedCredentials = useMemo(() => {
    let filtered = credentials
    if (searchQuery) {
      const q = searchQuery.toLowerCase()
      filtered = credentials.filter(c =>
        c.domain.toLowerCase().includes(q) ||
        c.username.toLowerCase().includes(q)
      )
    }

    // Group by domain
    const groups: Record<string, typeof credentials> = {}
    filtered.forEach(cred => {
      // Normalize domain for grouping (e.g. google.com vs Google.com)
      const key = cred.domain.toLowerCase()
      // Use the display domain from the first entry
      if (!groups[key]) groups[key] = []
      groups[key].push(cred)
    })

    return Object.values(groups).map(accounts => ({
      domain: accounts[0].domain,
      accounts: accounts
    }))
  }, [credentials, searchQuery])

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text)
  }

  const togglePasswordVisibility = (index: number) => {
    setVisiblePasswords(prev => ({
      ...prev,
      [index]: !prev[index]
    }))
  }

  if (!currentAccount) {
    return null
  }

  return (
    <div className="dashboard-container">
      {/* Sidebar */}
      <div className={`dash-sidebar ${sidebarExpanded ? 'expanded' : ''}`}>
        <div className="dash-logo-container" onClick={() => setSidebarExpanded(!sidebarExpanded)}>
          <img src={logoLight} alt="SafeKey" className="dash-logo-image" />
          <span className="dash-logo-text">SafeKey</span>
        </div>

        <div className="dash-nav">
          <div className="dash-nav-item active" onClick={() => setSidebarExpanded(!sidebarExpanded)}>
            <div className="nav-icon-wrapper">
              <Icons.Dashboard />
            </div>
            <span className="nav-label">Dashboard</span>
          </div>
        </div>

        <div className="dash-user-container">
          <div className="dash-user-bottom" onClick={() => setShowUserMenu(!showUserMenu)} title="User Profile">
            <img src={userIcon} alt="User" className="user-circle" />
            <span className="user-label">
              {currentAccount.address.slice(0, 6)}...
            </span>
          </div>

          {/* User Menu Popup */}
          {showUserMenu && (
            <div className="user-menu-popup">
              <div className="user-menu-info">
                <div className="user-menu-label">Signed in as</div>
                <div className="user-menu-address">
                  {currentAccount.address.slice(0, 6)}...{currentAccount.address.slice(-4)}
                </div>
              </div>
              <div className="user-menu-divider"></div>
              <button className="user-menu-logout" onClick={() => setShowLogoutConfirm(true)}>
                Log Out
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Main Content */}
      <div className="dash-main">
        {/* Header */}
        <div className="dash-header">
          <div className="mobile-logo">
            <img src={logoLight} alt="SafeKey" height="32" />
            <span className="mobile-logo-text">SafeKey</span>
          </div>
          <div className="dash-title">
            <h2>Dashboard</h2>
            <div className={`extension-status ${extensionSynced ? 'connected' : ''}`}>
              <div className="status-dot"></div>
              {extensionSynced ? 'Extension Connected' : 'Extension Not Detected'}
            </div>
          </div>

          <div className="dash-actions">
            <div className="dash-search-bar">
              <div className="dash-search-icon-wrapper">
                <Icons.Search />
              </div>
              <input
                type="text"
                className="dash-search-input"
                placeholder="Search vault..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
            <button className="dash-add-btn" onClick={() => setShowAddForm(true)}>
              <span>+</span>
              {/* Add New */}
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="dash-content">
          {loadingCredentials ? (
            <div className="loading-overlay">
              <div className="spinner"></div>
            </div>
          ) : groupedCredentials.length === 0 ? (
            <div className="empty-state">
              {searchQuery ? (
                <p>No credentials found matching "{searchQuery}"</p>
              ) : (
                <>
                  <h3>No credentials yet</h3>
                  <p>Add your first credential to get started.</p>
                </>
              )}
            </div>
          ) : (
            <div className="dash-list">
              {groupedCredentials.map((group, index) => (
                <div
                  key={index}
                  className="dash-row"
                  onClick={() => {
                    setSelectedGroup(group)
                    setVisiblePasswords({})
                  }}
                >
                  <div
                    className="dash-row-icon"
                    style={{ background: getBrandColor(group.domain) }}
                  >
                    {group.domain.charAt(0).toUpperCase()}
                  </div>
                  <div className="dash-row-content">
                    <div className="dash-row-title">{group.domain}</div>
                    <div className="dash-row-sub">
                      {group.accounts.length} account{group.accounts.length !== 1 ? 's' : ''}
                    </div>
                  </div>
                  <div className="dash-row-actions">
                    <div className="arrow-icon">
                      <Icons.ChevronRight />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Add Credential Modal */}
        {showAddForm && (
          <div className="modal-overlay" onClick={() => setShowAddForm(false)}>
            <div className="modal-content" onClick={e => e.stopPropagation()}>
              <div className="modal-header">
                <div className="modal-title">Add Credential</div>
                <button className="close-btn" onClick={() => setShowAddForm(false)}>×</button>
              </div>

              <div className="form-group">
                <input
                  type="text"
                  className="form-input"
                  placeholder="Domain (e.g. google.com)"
                  value={newCredential.domain}
                  onChange={(e) => setNewCredential({ ...newCredential, domain: e.target.value })}
                />
              </div>
              <div className="form-group">
                <input
                  type="text"
                  className="form-input"
                  placeholder="Username"
                  value={newCredential.username}
                  onChange={(e) => setNewCredential({ ...newCredential, username: e.target.value })}
                />
              </div>
              <div className="form-group">
                <input
                  type="password"
                  className="form-input"
                  placeholder="Password"
                  value={newCredential.password}
                  onChange={(e) => setNewCredential({ ...newCredential, password: e.target.value })}
                />
              </div>

              <button
                className="submit-btn"
                onClick={handleAddCredential}
                disabled={loading}
              >
                {loading ? 'Saving...' : 'Save to Vault'}
              </button>
            </div>
          </div>
        )}

        {/* Credential Detail Modal */}
        {selectedGroup && (
          <div className="modal-overlay" onClick={() => setSelectedGroup(null)}>
            <div className="modal-content detail-modal" onClick={e => e.stopPropagation()}>
              <div className="modal-header">
                <div className="detail-header-left">
                  <div
                    className="detail-icon"
                    style={{ background: getBrandColor(selectedGroup.domain) }}
                  >
                    {selectedGroup.domain.charAt(0).toUpperCase()}
                  </div>
                  <div className="modal-title">{selectedGroup.domain}</div>
                </div>
                <button className="close-btn" onClick={() => setSelectedGroup(null)}>×</button>
              </div>

              <div className="detail-accounts-list">
                {selectedGroup.accounts.map((account, idx) => (
                  <div key={idx} className="detail-account-item">
                    <div className="detail-group">
                      <label>Username</label>
                      <div className="detail-value-box">
                        <span>{account.username}</span>
                        <button className="copy-btn" onClick={() => handleCopy(account.username)}>
                          <Icons.Copy />
                        </button>
                      </div>
                    </div>

                    <div className="detail-group">
                      <label>Password</label>
                      <div className="detail-value-box">
                        <span className={visiblePasswords[idx] ? '' : 'masked'}>
                          {visiblePasswords[idx] ? account.password : '••••••••••••'}
                        </span>
                        <div className="detail-actions">
                          <button className="toggle-btn" onClick={() => togglePasswordVisibility(idx)}>
                            {visiblePasswords[idx] ? <Icons.EyeOff /> : <Icons.Eye />}
                          </button>
                          <button className="copy-btn" onClick={() => handleCopy(account.password || '')}>
                            <Icons.Copy />
                          </button>
                        </div>
                      </div>
                    </div>
                    {idx < selectedGroup.accounts.length - 1 && <div className="account-divider"></div>}
                  </div>
                ))}
              </div>

              <div className="detail-footer">
                <button
                  className="delete-btn-large"
                  onClick={() => {
                    if (confirm(`Are you sure you want to delete ALL credentials for ${selectedGroup.domain}?`)) {
                      handleDeleteCredential(selectedGroup.domain)
                    }
                  }}
                  disabled={loading}
                >
                  <span className="btn-icon"><Icons.Trash /></span>
                  {loading ? 'Deleting...' : 'Delete All Credentials'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Logout Confirmation Modal */}
        {showLogoutConfirm && (
          <div className="modal-overlay" onClick={() => setShowLogoutConfirm(false)}>
            <div className="modal-content confirm-modal" onClick={e => e.stopPropagation()}>
              <div className="modal-title">Log Out</div>
              <p className="confirm-text">Are you sure you want to log out? You will need to sign in again to access your vault.</p>
              <div className="confirm-actions">
                <button className="cancel-btn" onClick={() => setShowLogoutConfirm(false)}>Cancel</button>
                <button className="confirm-logout-btn" onClick={handleLogout}>Log Out</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
