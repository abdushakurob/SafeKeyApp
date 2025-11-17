
import { useCurrentAccount, useWallets } from '@mysten/dapp-kit'
import { useNavigate } from 'react-router-dom'
import { useEffect, useState, useCallback } from 'react'
import { clearSession, loadSession } from '../lib/zklogin'
import { clearExtensionSession, syncSessionToExtension } from '../lib/extension'
import { saveCredential } from '../lib/credentials'
import { clearSession as clearSessionInStore } from '../server/session-store'
import { signAndExecuteSponsoredTransaction } from '../lib/sponsored-transactions'
import { API_BASE_URL } from '../lib/api-config'
import { masterKeyManager } from '../lib/master-key-manager'
import { sessionManager } from '../lib/session-manager'

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
  const [visiblePasswords, setVisiblePasswords] = useState<Set<number>>(new Set())
  const [loading, setLoading] = useState(false)
  const [loadingCredentials, setLoadingCredentials] = useState(true)
  const [extensionInstalled, setExtensionInstalled] = useState(false)
  const [extensionSynced, setExtensionSynced] = useState(false)

  // Add a flag to prevent multiple initializations
  const [isInitialized, setIsInitialized] = useState(false)

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
    if (isInitialized) {
      console.log('[Dashboard] Already initialized, skipping...')
      return
    }

    let extensionCheckInterval: NodeJS.Timeout
    let queueProcessInterval: NodeJS.Timeout

    const initializeApp = async () => {
      try {
        console.log('[Dashboard] Starting initialization...')
        setIsInitialized(true)

        // 1. Derive master key once using deduplication manager
        const masterKey = await masterKeyManager.getMasterKey(
          currentAccount.address,
          session.idToken,
          wallets,
          currentAccount,
          signAndExecute
        )

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
                  
                  // Refresh credentials list
                  await loadCredentials()
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

      } catch (error) {
        console.error('[Dashboard] Error initializing app:', error)
        setIsInitialized(false) // Reset flag on error
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
  }, [currentAccount?.address, session?.idToken, navigate, isInitialized])

  // Separate effect for credential loading when needed
  const loadCredentials = async () => {
    if (!currentAccount || !session?.idToken) return
    
    setLoadingCredentials(true)
    try {
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
            return
          }
        }
        throw new Error(`HTTP ${response.status}: ${response.statusText}`)
      }
      
      const data = await response.json()
      
      if (data.success && Array.isArray(data.credentials)) {
        setCredentials(data.credentials)
        console.log('[Dashboard] Loaded', data.credentials.length, 'credentials')
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
    clearSession()
    clearSessionInStore()
    
    // Clear manager caches
    masterKeyManager.clearCache()
    sessionManager.clearState()
    
    fetch(`${API_BASE_URL}/clear-session`, { method: 'POST' }).catch(() => {})
    await clearExtensionSession()
    navigate('/')
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

      // Reload credentials from API
      await loadCredentials()
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
    if (!confirm(`Delete credentials for ${domain}?`)) return
    // TODO: Implement delete functionality
    setCredentials(credentials.filter(c => c.domain !== domain))
  }

  if (!currentAccount) {
    return null
  }

  return (
    <div style={{ minHeight: '100vh', background: '#0a0a0a', color: '#ffffff' }}>
      {/* Header */}
      <header style={{ padding: '2rem 0', borderBottom: '1px solid rgba(255, 255, 255, 0.1)' }}>
        <div style={{ maxWidth: '1200px', margin: '0 auto', padding: '0 2rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontSize: '1.5rem', fontWeight: 700, letterSpacing: '-0.02em' }}>SafeKey</div>
          <div style={{ display: 'flex', gap: '1.5rem', alignItems: 'center' }}>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '0.75rem', color: 'rgba(255, 255, 255, 0.5)', marginBottom: '0.25rem' }}>
                /// CONNECTED
              </div>
              <div style={{ fontSize: '0.9rem', fontWeight: 500, color: '#bfff0b', marginBottom: '0.25rem' }}>
                {currentAccount.address.substring(0, 8)}...{currentAccount.address.substring(currentAccount.address.length - 6)}
              </div>
              <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '0.7rem', color: 'rgba(255, 255, 255, 0.4)', marginBottom: '0.25rem' }}>
                API: {loadingCredentials ? 'Loading...' : credentials.length > 0 ? `${credentials.length} credentials` : 'Ready'}
              </div>
              {extensionInstalled ? (
                <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '0.7rem', color: extensionSynced ? '#bfff0b' : 'rgba(255, 255, 255, 0.4)' }}>
                  Extension: {extensionSynced ? 'Synced' : 'Not synced'}
                </div>
              ) : (
                <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '0.7rem', color: 'rgba(255, 255, 255, 0.3)' }}>
                  Extension: Not installed
                </div>
              )}
            </div>
            <button
              onClick={handleLogout}
              style={{
                padding: '0.75rem 1.5rem',
                border: '1px solid rgba(255, 255, 255, 0.2)',
                borderRadius: '0.5rem',
                background: 'transparent',
                color: 'rgba(255, 255, 255, 0.8)',
                cursor: 'pointer',
                fontSize: '0.95rem',
                fontWeight: 500,
                transition: 'all 0.3s ease',
                fontFamily: 'Satoshi, sans-serif',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)'
                e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.3)'
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'transparent'
                e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.2)'
              }}
            >
              Logout
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main style={{ maxWidth: '1200px', margin: '4rem auto', padding: '0 2rem' }}>
        <div style={{ marginBottom: '3rem' }}>
          <p style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '0.85rem', color: 'rgba(255, 255, 255, 0.5)', marginBottom: '1rem', letterSpacing: '0.05em' }}>
            /// YOUR VAULT
          </p>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
            <h1 style={{ fontSize: 'clamp(2rem, 4vw, 3rem)', fontWeight: 900, lineHeight: 1.1, letterSpacing: '-0.02em' }}>
              Your <span style={{ color: '#bfff0b' }}>Credentials</span>
            </h1>
            <button
              onClick={() => setShowAddForm(!showAddForm)}
              style={{
                padding: '0.875rem 1.5rem',
                borderRadius: '0.5rem',
                background: showAddForm ? 'transparent' : '#bfff0b',
                color: showAddForm ? 'rgba(255, 255, 255, 0.8)' : '#0a0a0a',
                fontSize: '0.95rem',
                fontWeight: 700,
                cursor: 'pointer',
                transition: 'all 0.3s ease',
                fontFamily: 'Satoshi, sans-serif',
                border: showAddForm ? '1px solid rgba(255, 255, 255, 0.2)' : 'none',
              }}
              onMouseEnter={(e) => {
                if (!showAddForm) {
                  e.currentTarget.style.transform = 'translateY(-2px)'
                  e.currentTarget.style.boxShadow = '0 4px 12px rgba(191, 255, 11, 0.3)'
                }
              }}
              onMouseLeave={(e) => {
                if (!showAddForm) {
                  e.currentTarget.style.transform = 'translateY(0)'
                  e.currentTarget.style.boxShadow = 'none'
                }
              }}
            >
              {showAddForm ? 'Cancel' : '+ Add Credential'}
            </button>
          </div>

          {/* Add Credential Form */}
          {showAddForm && (
            <div
              style={{
                background: 'rgba(255, 255, 255, 0.03)',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                borderRadius: '1rem',
                padding: '2rem',
                marginBottom: '2rem',
              }}
            >
              <h3 style={{ fontSize: '1.25rem', fontWeight: 700, marginBottom: '1.5rem', letterSpacing: '-0.01em' }}>
                Add New Credential
              </h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <input
                  type="text"
                  placeholder="Domain (e.g., github.com)"
                  value={newCredential.domain}
                  onChange={(e) => setNewCredential({ ...newCredential, domain: e.target.value })}
                  style={{
                    padding: '0.875rem 1rem',
                    border: '1px solid rgba(255, 255, 255, 0.2)',
                    borderRadius: '0.5rem',
                    fontSize: '0.95rem',
                    background: 'rgba(255, 255, 255, 0.05)',
                    color: '#ffffff',
                    fontFamily: 'Satoshi, sans-serif',
                  }}
                />
                <input
                  type="text"
                  placeholder="Username or Email"
                  value={newCredential.username}
                  onChange={(e) => setNewCredential({ ...newCredential, username: e.target.value })}
                  style={{
                    padding: '0.875rem 1rem',
                    border: '1px solid rgba(255, 255, 255, 0.2)',
                    borderRadius: '0.5rem',
                    fontSize: '0.95rem',
                    background: 'rgba(255, 255, 255, 0.05)',
                    color: '#ffffff',
                    fontFamily: 'Satoshi, sans-serif',
                  }}
                />
                <input
                  type="password"
                  placeholder="Password"
                  value={newCredential.password}
                  onChange={(e) => setNewCredential({ ...newCredential, password: e.target.value })}
                  style={{
                    padding: '0.875rem 1rem',
                    border: '1px solid rgba(255, 255, 255, 0.2)',
                    borderRadius: '0.5rem',
                    fontSize: '0.95rem',
                    background: 'rgba(255, 255, 255, 0.05)',
                    color: '#ffffff',
                    fontFamily: 'Satoshi, sans-serif',
                  }}
                />
                <button
                  onClick={handleAddCredential}
                  disabled={loading}
                  style={{
                    padding: '0.875rem 1.5rem',
                    border: 'none',
                    borderRadius: '0.5rem',
                    background: loading ? 'rgba(255, 255, 255, 0.1)' : '#bfff0b',
                    color: loading ? 'rgba(255, 255, 255, 0.5)' : '#0a0a0a',
                    fontSize: '0.95rem',
                    fontWeight: 700,
                    cursor: loading ? 'not-allowed' : 'pointer',
                    transition: 'all 0.3s ease',
                    fontFamily: 'Satoshi, sans-serif',
                  }}
                  onMouseEnter={(e) => {
                    if (!loading) {
                      e.currentTarget.style.transform = 'translateY(-2px)'
                      e.currentTarget.style.boxShadow = '0 4px 12px rgba(191, 255, 11, 0.3)'
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!loading) {
                      e.currentTarget.style.transform = 'translateY(0)'
                      e.currentTarget.style.boxShadow = 'none'
                    }
                  }}
                >
                  {loading ? 'Saving...' : 'Save Credential'}
                </button>
              </div>
            </div>
          )}

          {/* Credentials List */}
          {loadingCredentials ? (
            <div style={{ textAlign: 'center', padding: '4rem', color: 'rgba(255, 255, 255, 0.5)' }}>
              Loading credentials...
            </div>
          ) : credentials.length === 0 ? (
            <div
              style={{
                background: 'rgba(255, 255, 255, 0.03)',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                borderRadius: '1rem',
                padding: '4rem 2rem',
                textAlign: 'center',
                color: 'rgba(255, 255, 255, 0.6)',
              }}
            >
              <p style={{ fontSize: '1.25rem', marginBottom: '0.75rem', fontWeight: 500 }}>
                No credentials yet
              </p>
              <p style={{ fontSize: '0.95rem', lineHeight: 1.6, color: 'rgba(255, 255, 255, 0.5)' }}>
                Add your first credential to get started, or use the browser extension to save credentials automatically when you log in to websites.
              </p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              {credentials.map((cred, index) => (
                <div
                  key={index}
                  style={{
                    background: 'rgba(255, 255, 255, 0.03)',
                    border: '1px solid rgba(255, 255, 255, 0.1)',
                    borderRadius: '0.75rem',
                    padding: '1.5rem',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    transition: 'all 0.3s ease',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.borderColor = 'rgba(191, 255, 11, 0.3)'
                    e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)'
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.1)'
                    e.currentTarget.style.background = 'rgba(255, 255, 255, 0.03)'
                  }}
                >
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: '1.1rem', fontWeight: 600, marginBottom: '0.5rem', color: '#ffffff' }}>
                      {cred.domain}
                    </div>
                    <div style={{ fontSize: '0.9rem', color: 'rgba(255, 255, 255, 0.6)', fontFamily: 'JetBrains Mono, monospace', marginBottom: '0.5rem' }}>
                      {cred.username}
                    </div>
                    {cred.password && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '0.5rem' }}>
                        <div style={{ 
                          fontSize: '0.85rem', 
                          color: 'rgba(255, 255, 255, 0.7)', 
                          fontFamily: 'JetBrains Mono, monospace',
                          padding: '0.25rem 0.5rem',
                          background: 'rgba(255, 255, 255, 0.05)',
                          borderRadius: '0.25rem',
                          flex: 1,
                        }}>
                          {visiblePasswords.has(index) ? cred.password : '••••••••'}
                        </div>
                        <button
                          onClick={() => {
                            const newVisible = new Set(visiblePasswords)
                            if (newVisible.has(index)) {
                              newVisible.delete(index)
                            } else {
                              newVisible.add(index)
                            }
                            setVisiblePasswords(newVisible)
                          }}
                          style={{
                            padding: '0.25rem 0.5rem',
                            border: '1px solid rgba(255, 255, 255, 0.2)',
                            borderRadius: '0.25rem',
                            background: 'transparent',
                            color: 'rgba(255, 255, 255, 0.7)',
                            cursor: 'pointer',
                            fontSize: '0.9rem',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            transition: 'all 0.2s ease',
                          }}
                          onMouseEnter={(e) => {
                            e.currentTarget.style.background = 'rgba(255, 255, 255, 0.1)'
                            e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.3)'
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.background = 'transparent'
                            e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.2)'
                          }}
                          title={visiblePasswords.has(index) ? 'Hide password' : 'Show password'}
                        >
                          {visiblePasswords.has(index) ? (
                            // Eye open icon (password visible)
                            <svg 
                              width="16" 
                              height="16" 
                              viewBox="0 0 24 24" 
                              fill="none" 
                              stroke="currentColor" 
                              strokeWidth="2" 
                              strokeLinecap="round" 
                              strokeLinejoin="round"
                            >
                              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                              <circle cx="12" cy="12" r="3"/>
                            </svg>
                          ) : (
                            // Eye closed icon (password hidden)
                            <svg 
                              width="16" 
                              height="16" 
                              viewBox="0 0 24 24" 
                              fill="none" 
                              stroke="currentColor" 
                              strokeWidth="2" 
                              strokeLinecap="round" 
                              strokeLinejoin="round"
                            >
                              <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/>
                              <line x1="1" y1="1" x2="23" y2="23"/>
                            </svg>
                          )}
                        </button>
                      </div>
                    )}
                  </div>
                  <button
                    onClick={() => handleDeleteCredential(cred.domain)}
                    style={{
                      padding: '0.5rem 1rem',
                      border: '1px solid rgba(255, 255, 255, 0.2)',
                      borderRadius: '0.5rem',
                      background: 'transparent',
                      color: 'rgba(255, 255, 255, 0.7)',
                      cursor: 'pointer',
                      fontSize: '0.9rem',
                      fontWeight: 500,
                      transition: 'all 0.3s ease',
                      fontFamily: 'Satoshi, sans-serif',
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = 'rgba(255, 255, 255, 0.1)'
                      e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.3)'
                      e.currentTarget.style.color = '#ffffff'
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = 'transparent'
                      e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.2)'
                      e.currentTarget.style.color = 'rgba(255, 255, 255, 0.7)'
                    }}
                  >
                    Delete
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  )
}
