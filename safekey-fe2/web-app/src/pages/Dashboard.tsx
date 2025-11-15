
import { useCurrentAccount, useWallets } from '@mysten/dapp-kit'
import { useNavigate } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { clearSession, loadSession } from '../lib/zklogin'
import { clearExtensionSession, syncSessionToExtension } from '../lib/extension'
import { saveCredential } from '../lib/credentials'
import { deriveMasterKey } from '../lib/credentials'
import { storeSession as storeSessionInStore, clearSession as clearSessionInStore, getSession as getSessionFromStore } from '../server/session-store'
import { signAndExecuteSponsoredTransaction } from '../lib/sponsored-transactions'

export default function Dashboard() {
  const currentAccount = useCurrentAccount()
  const wallets = useWallets()
  const navigate = useNavigate()
  
  // Wrapper for sponsored transactions
  const signAndExecute = async (params: { transaction: any }) => {
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
  }
  const [session] = useState(loadSession())
  const [credentials, setCredentials] = useState<Array<{ domain: string; username: string; password?: string }>>([])
  const [showAddForm, setShowAddForm] = useState(false)
  const [newCredential, setNewCredential] = useState({ domain: '', username: '', password: '' })
  const [visiblePasswords, setVisiblePasswords] = useState<Set<number>>(new Set())
  const [loading, setLoading] = useState(false)
  const [loadingCredentials, setLoadingCredentials] = useState(true)
  const [extensionInstalled, setExtensionInstalled] = useState(false)
  const [extensionSynced, setExtensionSynced] = useState(false)

  // Check extension status via API endpoint
  useEffect(() => {
    const checkExtensionStatus = async () => {
      try {
        const response = await fetch('http://localhost:3001/api/extension-status')
        if (response.ok) {
          const data = await response.json()
          setExtensionInstalled(data.installed === true)
          
          // If extension is installed, sync session
          if (data.installed && currentAccount && session?.idToken) {
            const success = await syncSessionToExtension({
              address: currentAccount.address,
              idToken: session.idToken,
              provider: session.provider,
              createdAt: session.createdAt,
            })
            setExtensionSynced(success)
            if (success) {
              console.log('[Dashboard] Session synced to extension')
            } else {
              console.warn('[Dashboard] Failed to sync session to extension')
            }
          } else {
            setExtensionSynced(false)
          }
        }
      } catch (error) {
        // API server might not be running, extension not installed
        setExtensionInstalled(false)
        setExtensionSynced(false)
      }
    }
    
    // Initial check
    checkExtensionStatus()
    
    // Poll every 5 seconds to check extension status
    const interval = setInterval(checkExtensionStatus, 5000)
    
    return () => clearInterval(interval)
  }, [currentAccount, session])

  // Redirect to login if not connected
  useEffect(() => {
    if (!currentAccount) {
      navigate('/login')
    }
  }, [currentAccount, navigate])

  // Sync session to API server and extension
  useEffect(() => {
    if (currentAccount && wallets) {
      if (!session?.idToken) {
        console.error('[Dashboard] idToken is required but not available in session')
        return
      }
      
      deriveMasterKey(currentAccount.address, session.idToken, wallets, currentAccount, signAndExecute)
        .then((masterKey) => {
          console.log('[Dashboard] Master key derived successfully')
          if (!session?.provider) {
            throw new Error('Session provider is required')
          }
          if (!session?.createdAt) {
            throw new Error('Session createdAt is required')
          }
          
          storeSessionInStore({
            address: currentAccount.address,
            idToken: session.idToken,
            provider: session.provider,
            createdAt: session.createdAt,
            masterKey,
          })
          
          return fetch('http://localhost:3001/api/sync-session', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              address: currentAccount.address,
              idToken: session.idToken,
              provider: session.provider,
              createdAt: session.createdAt,
              masterKey,
            }),
          })
        })
        .then((response) => {
          if (response.ok) {
            console.log('[Dashboard] Session synced to API server')
          } else {
            return response.json().then((data) => {
              console.error('[Dashboard] Failed to sync session to API server:', data)
              throw new Error(data.error || 'Failed to sync session')
            })
          }
        })
        .catch((error) => {
          console.error('[Dashboard] Error syncing session to API server:', error)
          console.error('[Dashboard] Error details:', {
            message: error.message,
            stack: error.stack,
            name: error.name,
          })
        })

      // Session syncing to extension is handled by the extension status check useEffect
    }
  }, [currentAccount, session])

  // Poll and process save queue
  useEffect(() => {
    if (!currentAccount || !session?.idToken) return

    const processQueue = async () => {
      try {
        const response = await fetch('http://localhost:3001/api/pending-saves')
        const data = await response.json()
        
        if (data.success && data.pending && data.pending.length > 0) {
          if (!session.idToken) {
            throw new Error('idToken is required but not available in session')
          }
          const masterKey = await deriveMasterKey(
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
                signAndExecute
              )
              
              await fetch(`http://localhost:3001/api/pending-saves/${item.id}/complete`, {
                method: 'POST',
              })
              
              // Refresh credentials list
              loadCredentials()
            } catch (error) {
              console.error(`[Dashboard] Error processing queued save:`, error)
            }
          }
        }
      } catch (error) {
        // Ignore errors
      }
    }

    processQueue()
    // Poll every 10 seconds instead of 5 to reduce spam
    const interval = setInterval(processQueue, 10000)
    return () => clearInterval(interval)
  }, [currentAccount, session, signAndExecute, wallets])

  // Load credentials (wait for session to be synced first)
  const loadCredentials = async () => {
    if (!currentAccount || !session?.idToken) return
    
    if (!session.idToken) {
      throw new Error('idToken is required but not available in session')
    }
    
    try {
      const storedSession = getSessionFromStore()
      let masterKey = storedSession?.masterKey
      
      if (!masterKey && wallets && currentAccount) {
        masterKey = await deriveMasterKey(currentAccount.address, session.idToken, wallets, currentAccount, signAndExecute)
      }
      
      if (!masterKey) {
        throw new Error('Master key is required but could not be derived')
      }
      
      if (!session.provider) {
        throw new Error('Session provider is required')
      }
      
      if (!session.createdAt) {
        throw new Error('Session createdAt is required')
      }
      
      await fetch('http://localhost:3001/api/sync-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          address: currentAccount.address,
          idToken: session.idToken,
          provider: session.provider,
          createdAt: session.createdAt,
          masterKey,
        }),
      })
    } catch (error) {
      // If sync fails, still try to load (might work if session was already synced)
      console.warn('[Dashboard] Session sync failed, continuing anyway:', error)
    }
    
    // Small delay to ensure session is processed
    await new Promise(resolve => setTimeout(resolve, 100))
    
    setLoadingCredentials(true)
    try {
      const response = await fetch('http://localhost:3001/api/all-credentials')
      
      if (!response.ok) {
        if (response.status === 401) {
          console.warn('[Dashboard] Unauthorized - session may not be synced yet, retrying...')
          // Retry once after a short delay
          await new Promise(resolve => setTimeout(resolve, 500))
          const retryResponse = await fetch('http://localhost:3001/api/all-credentials')
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
      // API server might not be running, that's okay
      if (error instanceof TypeError && error.message.includes('fetch')) {
        console.warn('[Dashboard] API server not running, credentials not loaded')
      }
      setCredentials([])
    } finally {
      setLoadingCredentials(false)
    }
  }

  useEffect(() => {
    // Wait a bit for session sync to complete
    const timer = setTimeout(() => {
      loadCredentials()
    }, 200)
    return () => clearTimeout(timer)
  }, [currentAccount, session])

  const handleLogout = async () => {
    clearSession()
    clearSessionInStore()
    fetch('http://localhost:3001/api/clear-session', { method: 'POST' }).catch(() => {})
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
      const masterKey = await deriveMasterKey(
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
        signAndExecute
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
                          {visiblePasswords.has(index) ? '👁️' : '👁️‍🗨️'}
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
