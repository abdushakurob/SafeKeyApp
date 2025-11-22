import { useConnectWallet, useWallets, useCurrentAccount } from '@mysten/dapp-kit'
import { isEnokiWallet } from '@mysten/enoki'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { syncSessionToExtension, isExtensionInstalled } from '../lib/extension'
import { storeSession } from '../lib/zklogin'
import type { AuthProvider } from '../lib/zklogin'
import logoLight from '../assets/logo_light.png'
import './Login.css'

export default function Login() {
  const { mutateAsync: connectWallet } = useConnectWallet()
  const wallets = useWallets()
  const currentAccount = useCurrentAccount()
  const navigate = useNavigate()
  const [extensionInstalled, setExtensionInstalled] = useState(false)
  const [connecting, setConnecting] = useState(false)

  // Check if extension is installed
  useEffect(() => {
    const checkExtension = async () => {
      const installed = await isExtensionInstalled()
      setExtensionInstalled(installed)
    }
    checkExtension()
  }, [])

  // Redirect if already connected
  useEffect(() => {
    if (currentAccount) {
      const enokiWallet = wallets.find((w) => isEnokiWallet(w) && w.accounts.some(acc => acc.address === currentAccount.address))

      if (!enokiWallet || !isEnokiWallet(enokiWallet)) {
        throw new Error('Enoki wallet not found or invalid')
      }

      if (!enokiWallet.provider) {
        throw new Error('Wallet provider is required')
      }

      // Try to get the actual JWT idToken from Enoki wallet
      let idToken: string = currentAccount.address // Fallback to address

      // Try to get the JWT token from localStorage (Enoki stores it there)
      try {
        const enokiSession = localStorage.getItem('enoki:session')
        if (enokiSession) {
          const parsedSession = JSON.parse(enokiSession)
          if (parsedSession?.idToken) {
            idToken = parsedSession.idToken
            console.log('[Login] Found Enoki idToken in localStorage')
          }
        }
      } catch (error) {
        console.warn('[Login] Could not extract idToken from Enoki session:', error)
      }

      // If still no proper idToken, try alternative keys
      if (idToken === currentAccount.address) {
        try {
          const keys = Object.keys(localStorage)
          for (const key of keys) {
            if (key.includes('enoki') || key.includes('auth') || key.includes('token')) {
              const value = localStorage.getItem(key)
              if (value && value.includes('.') && value.length > 100) {
                // Looks like a JWT token
                idToken = value
                console.log('[Login] Found potential JWT token in localStorage key:', key)
                break
              }
            }
          }
        } catch (error) {
          console.warn('[Login] Could not search for JWT tokens:', error)
        }
      }

      const sessionData = {
        idToken,
        address: currentAccount.address,
        provider: enokiWallet.provider as AuthProvider,
        createdAt: Date.now(),
      }
      storeSession(sessionData)

      // Sync to extension if available
      if (extensionInstalled) {
        syncSessionToExtension(sessionData)
      }

      // Navigate to dashboard
      navigate('/dashboard')
    }
  }, [currentAccount, wallets, navigate, extensionInstalled])

  // Get Enoki wallets
  const enokiWallets = wallets.filter((w) => isEnokiWallet(w))

  const handleConnect = async (wallet: any) => {
    setConnecting(true)
    try {
      await connectWallet({ wallet })
      console.log('[Login] Connected to wallet')
    } catch (error) {
      console.error('[Login] Failed to connect:', error)
      alert('Failed to connect wallet. Please try again.')
    } finally {
      setConnecting(false)
    }
  }

  return (
    <div className="login-container">
      <div className="login-bg-glow"></div>

      <div className="login-content">
        {/* Header */}
        <div className="login-header">
          <div className="login-logo">
            <img src={logoLight} alt="SafeKey" className="login-logo-image" />
            <span>SafeKey</span>
          </div>
          <div className="login-sub">/// SIGN IN TO CONTINUE</div>
        </div>

        {/* Extension Notice */}
        {!extensionInstalled && (
          <div className="extension-notice">
            <div className="notice-icon">⚠</div>
            <div className="notice-text">
              Install the SafeKey browser extension for automatic password saving and autofill.
            </div>
          </div>
        )}

        {/* Login Card */}
        <div className="login-card">
          <div className="wallet-list">
            {enokiWallets.length === 0 ? (
              <div className="loading-text">Loading wallets...</div>
            ) : (
              enokiWallets.map((wallet) => {
                if (!isEnokiWallet(wallet)) return null

                const providerName =
                  wallet.provider.charAt(0).toUpperCase() + wallet.provider.slice(1)

                return (
                  <button
                    key={wallet.name}
                    className="wallet-btn"
                    onClick={() => handleConnect(wallet)}
                    disabled={connecting}
                  >
                    {connecting ? 'Connecting...' : `Sign in with ${providerName}`}
                  </button>
                )
              })
            )}
          </div>

          <div className="login-info">
            Your credentials are encrypted and stored on the Sui blockchain. Only you can decrypt them.
          </div>
        </div>

        {/* Back to Landing */}
        <button className="back-link" onClick={() => navigate('/')}>
          ← Back to home
        </button>
      </div>
    </div>
  )
}
