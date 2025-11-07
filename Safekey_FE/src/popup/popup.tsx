import React from 'react'
import ReactDOM from 'react-dom/client'
import './popup.css'
import { initializeEnokiFlow, processOAuthJWT, loadZkLoginSessionFromStorage, saveZkLoginSessionSecurely, getZkLoginSession, prepareZkLoginSession } from '../lib/zklogin'

interface StatusResponse {
  status: string
  isLocked?: boolean
}

interface ZkLoginStatus {
  success: boolean
  isActive: boolean
  address?: string
  provider?: string
}

function Popup(): React.ReactElement {
  const [status, setStatus] = React.useState('Connecting...')
  const [zkLoginStatus, setZkLoginStatus] = React.useState<ZkLoginStatus>({ success: false, isActive: false })
  const [loading, setLoading] = React.useState(false)
  const [showSessionDetails, setShowSessionDetails] = React.useState(false)

  React.useEffect(() => {
    // Initialize Enoki in popup context
    const initEnoki = async () => {
      try {
        const apiKey = import.meta.env.VITE_ENOKI_API_KEY
        const clientId = import.meta.env.VITE_OAUTH_CLIENT_ID
        
        if (!apiKey || !clientId) {
          console.error('[Popup] Missing Enoki config')
          return
        }

        // Initialize Enoki wallets in popup context
        initializeEnokiFlow(apiKey, { google: { clientId } }, 'testnet')
      } catch (error) {
        console.error('[Popup] ❌ Failed to initialize Enoki:', error)
      }
    }

    initEnoki()

    // Listen for background script notifications that zkLogin session is ready
    const messageListener = (message: any) => {
      if (message.type === 'ZKLOGIN_SESSION_READY') {
        // Reload the session from storage
        loadZkLoginSessionFromStorage().then(session => {
          if (session && session.address) {
            setZkLoginStatus({
              success: true,
              isActive: true,
              address: session.address,
              provider: session.provider,
            })
            setStatus(`Connected: ${session.address.substring(0, 10)}...`)
          }
        }).catch(err => {
          console.error('[Popup] Error loading session:', err)
        })
      }
    }
    
    chrome.runtime.onMessage.addListener(messageListener)

    // Load existing zkLogin session from storage
    const loadSession = async () => {
      try {
        const session = await loadZkLoginSessionFromStorage()
        if (session && session.address) {
          setZkLoginStatus({
            success: true,
            isActive: true,
            address: session.address,
            provider: session.provider,
          })
        } else {
          // Check for OAuth token that might be waiting to be processed
          try {
            let pendingToken: string | null = null
            if (chrome.storage.session) {
              const sessionToken = await chrome.storage.session.get('oauth_id_token')
              if (sessionToken.oauth_id_token) {
                pendingToken = sessionToken.oauth_id_token
              }
            }
            if (!pendingToken && chrome.storage.local) {
              const localToken = await chrome.storage.local.get('oauth_id_token')
              if (localToken.oauth_id_token) {
                pendingToken = localToken.oauth_id_token
              }
            }
            if (!pendingToken) {
              // Try background script
              try {
                const bgResponse = await new Promise<any>((resolve) => {
                  chrome.runtime.sendMessage({ type: 'GET_OAUTH_TOKEN' }, (response) => {
                    resolve(response)
                  })
                })
                if (bgResponse && bgResponse.success && bgResponse.id_token) {
                  pendingToken = bgResponse.id_token
                }
              } catch (bgErr) {
                // Ignore
              }
            }
            
            if (pendingToken) {
              setLoading(true)
              // Clear token from storage first
              try {
                if (chrome.storage.session) await chrome.storage.session.remove('oauth_id_token')
                if (chrome.storage.local) await chrome.storage.local.remove('oauth_id_token')
              } catch {}
              await handleOAuthToken(pendingToken, 'google')
              return
            }
          } catch (tokenCheckError) {
            // Ignore token check errors
          }
          
          setZkLoginStatus({ success: true, isActive: false })
        }
      } catch (error) {
        console.error('[Popup] Failed to load session:', error)
        setZkLoginStatus({ success: false, isActive: false })
      }
    }
    loadSession()
    
    // Also poll for session updates periodically (in case session is saved from another context)
    const sessionPollInterval = setInterval(async () => {
      try {
        const session = await loadZkLoginSessionFromStorage()
        if (session && session.address) {
          setZkLoginStatus(prev => {
            // Only update if address changed or status is inactive
            if (!prev.isActive || prev.address !== session.address) {
              return {
                success: true,
                isActive: true,
                address: session.address,
                provider: session.provider,
              }
            }
            return prev
          })
        } else {
          // Session was cleared or doesn't exist
          setZkLoginStatus(prev => {
            if (prev.isActive) {
              return { success: true, isActive: false }
            }
            return prev
          })
        }
      } catch (error) {
        // Silently fail - don't spam console
      }
    }, 2000) // Check every 2 seconds
    
    return () => {
      clearInterval(sessionPollInterval)
    }
  }, []) // Empty deps - only run on mount

  React.useEffect(() => {
    // Get SafeKey status
    try {
      chrome.runtime.sendMessage({ type: 'GET_STATUS' }, (response: StatusResponse) => {
        if (response && response.status) {
          setStatus(response.status)
        }
      })
    } catch (error) {
      console.error('Error communicating with background:', error)
      setStatus('Error')
    }

    // Get zkLogin status from background (as backup)
    try {
      chrome.runtime.sendMessage({ type: 'GET_ZKLOGIN_STATUS' }, (response: ZkLoginStatus) => {
        if (response && response.isActive) {
          setZkLoginStatus(response)
        }
      })
    } catch (error) {
      console.error('Error getting zkLogin status:', error)
    }
  }, [])

  // Helper function to handle OAuth token processing
  const handleOAuthToken = async (idToken: string, provider: string) => {
    try {
      let address: string
      try {
        address = await processOAuthJWT(idToken, provider as any)
      } catch (processError) {
        console.error('[Popup] processOAuthJWT failed:', processError)
        throw processError
      }

      // Session is already complete from processOAuthJWT(), just save it
      await saveZkLoginSessionSecurely()

      // Send to background to save
      chrome.runtime.sendMessage(
        {
          type: 'SAVE_ZKLOGIN_SESSION',
          address,
          provider,
        },
        (response) => {
          if (!response?.success) {
            console.error('[Popup] Background save failed:', response)
          }
        }
      )
      
      // Reload session from storage to ensure consistency
      try {
        const savedSession = await loadZkLoginSessionFromStorage()
        if (savedSession && savedSession.address) {
          setZkLoginStatus({
            success: true,
            isActive: true,
            address: savedSession.address,
            provider: savedSession.provider,
          })
        } else {
          // Fallback to using the address from processOAuthJWT
          setZkLoginStatus({
            success: true,
            isActive: true,
            address,
            provider,
          })
        }
      } catch (reloadError) {
        console.error('[Popup] Failed to reload session:', reloadError)
        setZkLoginStatus({
          success: true,
          isActive: true,
          address,
          provider,
        })
      }

      // Close the OAuth tab if possible
      try {
        const tabs = await chrome.tabs.query({ url: '*://localhost:3000/callback*' })
        for (const tab of tabs) {
          if (tab.id) {
            chrome.tabs.remove(tab.id)
          }
        }
      } catch (e) {
        // Ignore tab closing errors
      }

      setLoading(false)
    } catch (error) {
      console.error('[Popup] Failed to process OAuth token:', error)
      alert('Failed to process authentication: ' + String(error))
      setLoading(false)
      throw error
    }
  }

  const handleZkLoginAuth = async (provider: string) => {
    setLoading(true)
    try {
      // Clear any old OAuth tokens from storage before starting new flow
      try {
        if (chrome.storage.session) {
          await chrome.storage.session.remove('oauth_id_token')
          await chrome.storage.session.remove('oauth_access_token')
        }
        if (chrome.storage.local) {
          await chrome.storage.local.remove('oauth_id_token')
          await chrome.storage.local.remove('oauth_access_token')
        }
      } catch (clearError) {
        // Ignore clear errors
      }

      // Prepare zkLogin session (get nonce from Enoki)
      const prepData = await prepareZkLoginSession(provider as any)
      
      // Get client ID from environment
      const clientId = import.meta.env.VITE_OAUTH_CLIENT_ID
      if (!clientId) {
        throw new Error('OAuth client ID not configured')
      }

      // Open OAuth handler tab with client ID and nonce
      const oauthBaseUrl = chrome.runtime.getURL('oauth-handler.html')
      const oauthUrl = `${oauthBaseUrl}?clientId=${encodeURIComponent(clientId)}&nonce=${encodeURIComponent(prepData.nonce)}`

      await chrome.tabs.create({ url: oauthUrl, active: true })

      // Poll for OAuth completion
      let attempts = 0
      const maxAttempts = 120 // 2 minutes with 1s interval
      
      // Also listen for storage changes as a backup
      const storageListener = (changes: { [key: string]: chrome.storage.StorageChange }, areaName: string) => {
        // Check both session and local storage areas
        if ((areaName === 'session' || areaName === 'local') && changes.oauth_id_token) {
          const idToken = changes.oauth_id_token.newValue
          if (idToken) {
            clearInterval(pollForCompletion)
            chrome.storage.onChanged.removeListener(storageListener)
            handleOAuthToken(idToken, provider)
          }
        }
      }
      chrome.storage.onChanged.addListener(storageListener)
      
      const pollForCompletion = setInterval(async () => {
        attempts++
        
        try {
          // Check both storage areas explicitly to ensure we find the token
          let idToken: string | undefined
          let foundInStorage = ''
          
          // Try session storage first (Chrome)
          if (chrome.storage.session) {
            try {
              const sessionData = await chrome.storage.session.get('oauth_id_token')
              if (sessionData.oauth_id_token) {
                idToken = sessionData.oauth_id_token
                foundInStorage = 'session'
              }
            } catch (sessionError) {
              // Firefox might not support chrome.storage.session
            }
          }
          
          // If not found, try local storage (Firefox or fallback)
          if (!idToken && chrome.storage.local) {
            try {
              const localData = await chrome.storage.local.get('oauth_id_token')
              if (localData.oauth_id_token) {
                idToken = localData.oauth_id_token
                foundInStorage = 'local'
              }
            } catch (localError) {
              // Ignore local storage errors
            }
          }
          
          // Fallback: Ask background script directly for the token
          if (!idToken && attempts > 2) {
            try {
              const bgResponse = await new Promise<any>((resolve) => {
                chrome.runtime.sendMessage({ type: 'GET_OAUTH_TOKEN' }, (response) => {
                  resolve(response)
                })
              })
              if (bgResponse && bgResponse.success && bgResponse.id_token) {
                idToken = bgResponse.id_token
                foundInStorage = 'background'
              }
            } catch (bgError) {
              // Silently fail - background might not have handler yet
            }
          }
          
          if (idToken) {
            // Clear the token from storage immediately to prevent re-processing
            try {
              if (foundInStorage === 'session' && chrome.storage.session) {
                await chrome.storage.session.remove('oauth_id_token')
                await chrome.storage.session.remove('oauth_access_token')
              } else if (chrome.storage.local) {
                await chrome.storage.local.remove('oauth_id_token')
                await chrome.storage.local.remove('oauth_access_token')
              }
            } catch (clearErr) {
              // Ignore clear errors
            }
            
            clearInterval(pollForCompletion)
            chrome.storage.onChanged.removeListener(storageListener)
            setLoading(true)
            await handleOAuthToken(idToken, provider)
            return
          }

          if (attempts >= maxAttempts) {
            console.error('[Popup] OAuth timeout - max attempts reached')
            clearInterval(pollForCompletion)
            chrome.storage.onChanged.removeListener(storageListener)
            setLoading(false)
            alert('OAuth timeout - please try again')
            return
          }
        } catch (error) {
          console.error('[Popup] Error polling for OAuth:', error)
          if (attempts >= maxAttempts) {
            clearInterval(pollForCompletion)
            chrome.storage.onChanged.removeListener(storageListener)
            setLoading(false)
            alert('OAuth timeout - please try again')
          }
        }
      }, 1000)

    } catch (error) {
      console.error('[Popup] OAuth error:', error)
      alert('OAuth failed: ' + String(error))
      setLoading(false)
    }
  }

  const handleLogout = async () => {
    setLoading(true)
    try {
      chrome.runtime.sendMessage({ type: 'LOGOUT_ZKLOGIN' }, (response) => {
        if (response && response.success) {
          setZkLoginStatus({ success: true, isActive: false })
        }
        setLoading(false)
      })
    } catch (error) {
      console.error('Error logging out:', error)
      setLoading(false)
    }
  }

  const getStatusText = () => {
    return status === 'Active' ? 'Active' : 'Locked'
  }

  return (
    <div className="popup-container">
      <div className="header">
        <h1>SafeKey</h1>
        <div className="subtitle">Secure Key Management</div>
      </div>

      <div className="content">
      {/* SafeKey Status */}
      <div className="section">
          <div className="section-header">
            <svg className="section-icon" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
            </svg>
            <h2>Vault Status</h2>
          </div>
          <div className="status-card">
            <div className="status-indicator">
              <div className={`status-dot ${status === 'Locked' ? 'locked' : ''}`}></div>
              <span className="status-text">Status:</span>
              <span className="status-value">{getStatusText()}</span>
            </div>
          </div>
        <div className="button-group">
            <button className="btn btn-secondary">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
                <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
              </svg>
              Lock
            </button>
            <button className="btn btn-secondary">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="3"></circle>
                <path d="M12 1v6m0 6v6M5.64 5.64l4.24 4.24m4.24 4.24l4.24 4.24M1 12h6m6 0h6M5.64 18.36l4.24-4.24m4.24-4.24l4.24-4.24"></path>
              </svg>
              Settings
            </button>
          </div>
      </div>

      {/* zkLogin Section */}
      <div className="section">
          <div className="section-header">
            <svg className="section-icon" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
            <h2>Blockchain Wallet</h2>
          </div>

        {zkLoginStatus.isActive ? (
          <div className="zklogin-active">
              <div className="zklogin-header">
                <div className="status-dot"></div>
                <span className="zklogin-title">Connected</span>
              </div>
              <div className="account-info">
                <div className="info-row">
                  <span className="info-label">Address</span>
                  <span className="info-value" title={zkLoginStatus.address}>
                    {zkLoginStatus.address?.substring(0, 8)}...{zkLoginStatus.address?.substring(zkLoginStatus.address.length - 6)}
                  </span>
                </div>
                <div className="info-row">
                  <span className="info-label">Provider</span>
                  <span className="info-value">
                    {zkLoginStatus.provider 
                      ? zkLoginStatus.provider.charAt(0).toUpperCase() + zkLoginStatus.provider.slice(1)
                      : 'Unknown'}
                  </span>
                </div>
              </div>
              <button 
                onClick={() => {
                  const session = getZkLoginSession()
                  if (session) {
                    console.log('[Popup] Session details:', {
                      address: session.address,
                      provider: session.provider,
                      createdAt: new Date(session.createdAt).toISOString(),
                      hasIdToken: !!session.idToken,
                      hasProofPoints: !!session.proofPoints,
                    })
                    setShowSessionDetails(!showSessionDetails)
                  } else {
                    loadZkLoginSessionFromStorage().then(s => {
                      if (s) {
                        console.log('[Popup] Session details (from storage):', {
                          address: s.address,
                          provider: s.provider,
                          createdAt: new Date(s.createdAt).toISOString(),
                          hasIdToken: !!s.idToken,
                          hasProofPoints: !!s.proofPoints,
                        })
                      }
                    })
                  }
                }}
                className="btn btn-secondary"
                style={{ width: '100%', marginTop: '8px', fontSize: '12px', padding: '8px' }}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="10"></circle>
                  <line x1="12" y1="16" x2="12" y2="12"></line>
                  <line x1="12" y1="8" x2="12.01" y2="8"></line>
                </svg>
                View Session Details (Console)
              </button>
            <button onClick={handleLogout} disabled={loading} className="logout-btn">
                {loading ? (
                  <>
                    <span className="loading"></span>
                    Logging out...
                  </>
                ) : (
                  <>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path>
                      <polyline points="16 17 21 12 16 7"></polyline>
                      <line x1="21" y1="12" x2="9" y2="12"></line>
                    </svg>
                    Disconnect Wallet
                  </>
                )}
            </button>
          </div>
        ) : (
          <div className="zklogin-inactive">
              <p>Connect your Sui wallet to get started</p>
            <div className="oauth-buttons">
                <button
                  onClick={() => handleZkLoginAuth('google')}
                  disabled={loading}
                  className="oauth-btn google"
                >
                  {loading ? (
                    <>
                      <span className="loading"></span>
                      Connecting...
                    </>
                  ) : (
                    <>
                      <svg className="oauth-icon" viewBox="0 0 24 24">
                        <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                        <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                        <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                        <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                      </svg>
                      Continue with Google
                    </>
                  )}
              </button>
                {/* <button
                  onClick={() => handleZkLoginAuth('facebook')}
                  disabled={loading}
                  className="oauth-btn facebook"
                >
                  {loading ? (
                    <>
                      <span className="loading"></span>
                      Connecting...
                    </>
                  ) : (
                    <>
                      <svg className="oauth-icon" viewBox="0 0 24 24" fill="#1877F2">
                        <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/>
                      </svg>
                      Continue with Facebook
                    </>
                  )}
              </button> */}
            </div>
          </div>
        )}
        </div>
      </div>

      <div className="footer">
        <div className="footer-text">SafeKey Extension v0.0.1</div>
      </div>
    </div>
  )
}

const root = document.getElementById('root')
if (root) {
  ReactDOM.createRoot(root).render(
    <React.StrictMode>
      <Popup />
    </React.StrictMode>,
  )
}
