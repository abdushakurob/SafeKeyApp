import React from 'react'
import ReactDOM from 'react-dom/client'
import './popup.css'

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
  const [zkLoginStatus, setZkLoginStatus] = React.useState<ZkLoginStatus | null>(null)
  const [loading, setLoading] = React.useState(false)

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

    // Get zkLogin status
    try {
      chrome.runtime.sendMessage({ type: 'GET_ZKLOGIN_STATUS' }, (response: ZkLoginStatus) => {
        if (response) {
          setZkLoginStatus(response)
        }
      })
    } catch (error) {
      console.error('Error getting zkLogin status:', error)
    }
  }, [])

  const handleZkLoginAuth = async (provider: string) => {
    setLoading(true)
    try {
      const clientId = import.meta.env.VITE_OAUTH_CLIENT_ID
      const redirectUrl = import.meta.env.VITE_OAUTH_REDIRECT_URL || 'http://localhost:3000/callback'

      if (!clientId) {
        throw new Error('OAuth client ID not configured in .env')
      }

      console.log(`[Popup] Opening ${provider} OAuth flow with redirect: ${redirectUrl}`)

      let authUrl = ''
      if (provider === 'google') {
        // Send message to background to get Google OAuth URL
        chrome.runtime.sendMessage(
          {
            type: 'GET_OAUTH_URL',
            provider: 'google',
            clientId,
            redirectUrl,
          },
          (response) => {
            if (response && response.success && response.authUrl) {
              authUrl = response.authUrl
              console.log('[Popup] Opening Google auth URL')
              chrome.tabs.create({ url: authUrl })
            } else {
              const errorMsg = response?.error || 'Unknown error'
              console.error('[Popup] Auth URL error:', errorMsg)
              alert('Failed to get auth URL: ' + errorMsg)
            }
            setLoading(false)
          }
        )
      } else if (provider === 'facebook') {
        // Send message to background to get Facebook OAuth URL
        chrome.runtime.sendMessage(
          {
            type: 'GET_OAUTH_URL',
            provider: 'facebook',
            clientId,
            redirectUrl,
          },
          (response) => {
            if (response && response.success && response.authUrl) {
              authUrl = response.authUrl
              console.log('[Popup] Opening Facebook auth URL')
              chrome.tabs.create({ url: authUrl })
            } else {
              const errorMsg = response?.error || 'Unknown error'
              console.error('[Popup] Auth URL error:', errorMsg)
              alert('Failed to get auth URL: ' + errorMsg)
            }
            setLoading(false)
          }
        )
      }
    } catch (error) {
      console.error('Error initiating zkLogin:', error)
      alert('Error: ' + String(error))
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

  return (
    <div className="popup-container">
      <h1>🔐 SafeKey</h1>

      {/* SafeKey Status */}
      <div className="section">
        <h2>SafeKey Status</h2>
        <p className="status">
          Status: <strong>{status}</strong>
        </p>
        <div className="button-group">
          <button onClick={() => console.log('Lock clicked')}>🔒 Lock</button>
          <button onClick={() => console.log('Settings clicked')}>⚙️ Settings</button>
        </div>
      </div>

      {/* zkLogin Section */}
      <div className="section">
        <h2>Blockchain Login</h2>

        {zkLoginStatus?.isActive ? (
          <div className="zklogin-active">
            <p>✅ Logged in</p>
            <p className="address">Address: {zkLoginStatus.address?.substring(0, 10)}...</p>
            <p className="provider">Provider: {zkLoginStatus.provider}</p>
            <button onClick={handleLogout} disabled={loading} className="logout-btn">
              {loading ? 'Logging out...' : '🚪 Logout'}
            </button>
          </div>
        ) : (
          <div className="zklogin-inactive">
            <p>Login with your Sui account</p>
            <div className="oauth-buttons">
              <button onClick={() => handleZkLoginAuth('google')} disabled={loading} className="oauth-btn">
                {loading ? '⏳ Loading...' : '🔵 Google'}
              </button>
              <button onClick={() => handleZkLoginAuth('facebook')} disabled={loading} className="oauth-btn">
                {loading ? '⏳ Loading...' : '📘 Facebook'}
              </button>
            </div>
          </div>
        )}
      </div>

      <p className="demo-text">✅ Extension is working!</p>
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
