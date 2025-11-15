
import { useConnectWallet, useWallets, useCurrentAccount } from '@mysten/dapp-kit'
import { isEnokiWallet } from '@mysten/enoki'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { syncSessionToExtension, isExtensionInstalled } from '../lib/extension'
import { storeSession } from '../lib/zklogin'
import type { AuthProvider } from '../lib/zklogin'

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
      
      const sessionData = {
        idToken: currentAccount.address,
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
    <div style={{ minHeight: '100vh', background: '#0a0a0a', color: '#ffffff', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '2rem' }}>
      <div style={{ maxWidth: '500px', width: '100%' }}>
        {/* Header */}
        <div style={{ textAlign: 'center', marginBottom: '3rem' }}>
          <div style={{ fontSize: '2rem', fontWeight: 700, letterSpacing: '-0.02em', marginBottom: '0.5rem' }}>SafeKey</div>
          <p style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '0.9rem', color: 'rgba(255, 255, 255, 0.6)', letterSpacing: '0.05em' }}>
            /// SIGN IN TO CONTINUE
          </p>
        </div>

        {/* Extension Notice */}
        {!extensionInstalled && (
          <div
            style={{
              padding: '1rem',
              background: 'rgba(191, 255, 11, 0.1)',
              border: '1px solid rgba(191, 255, 11, 0.3)',
              borderRadius: '0.75rem',
              marginBottom: '2rem',
            }}
          >
            <p style={{ margin: 0, fontSize: '0.9rem', color: 'rgba(255, 255, 255, 0.8)', lineHeight: 1.6 }}>
              Install the SafeKey browser extension for automatic password saving and autofill.
            </p>
          </div>
        )}

        {/* Login Card */}
        <div
          style={{
            background: 'rgba(255, 255, 255, 0.03)',
            border: '1px solid rgba(255, 255, 255, 0.1)',
            borderRadius: '1rem',
            padding: '2.5rem',
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {enokiWallets.length === 0 ? (
              <p style={{ textAlign: 'center', color: 'rgba(255, 255, 255, 0.6)' }}>
                Loading wallets...
              </p>
            ) : (
              enokiWallets.map((wallet) => {
                if (!isEnokiWallet(wallet)) return null

                const providerName =
                  wallet.provider.charAt(0).toUpperCase() + wallet.provider.slice(1)

                return (
                  <button
                    key={wallet.name}
                    onClick={() => handleConnect(wallet)}
                    disabled={connecting}
                    style={{
                      padding: '1rem 1.5rem',
                      border: connecting ? '1px solid rgba(255, 255, 255, 0.2)' : '1px solid rgba(191, 255, 11, 0.5)',
                      borderRadius: '0.5rem',
                      background: connecting ? 'rgba(255, 255, 255, 0.05)' : 'transparent',
                      color: connecting ? 'rgba(255, 255, 255, 0.5)' : '#bfff0b',
                      fontSize: '1rem',
                      fontWeight: 500,
                      cursor: connecting ? 'not-allowed' : 'pointer',
                      transition: 'all 0.3s ease',
                      fontFamily: 'Satoshi, sans-serif',
                    }}
                    onMouseEnter={(e) => {
                      if (!connecting) {
                        e.currentTarget.style.background = 'rgba(191, 255, 11, 0.1)'
                        e.currentTarget.style.borderColor = '#bfff0b'
                        e.currentTarget.style.transform = 'translateY(-2px)'
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (!connecting) {
                        e.currentTarget.style.background = 'transparent'
                        e.currentTarget.style.borderColor = 'rgba(191, 255, 11, 0.5)'
                        e.currentTarget.style.transform = 'translateY(0)'
                      }
                    }}
                  >
                    {connecting ? 'Connecting...' : `Sign in with ${providerName}`}
                  </button>
                )
              })
            )}
          </div>

          <p
            style={{
              marginTop: '2rem',
              fontSize: '0.85rem',
              textAlign: 'center',
              color: 'rgba(255, 255, 255, 0.5)',
              lineHeight: 1.6,
            }}
          >
            Your credentials are encrypted and stored on the Sui blockchain. Only you can decrypt them.
          </p>
        </div>

        {/* Back to Landing */}
        <div style={{ textAlign: 'center', marginTop: '2rem' }}>
          <button
            onClick={() => navigate('/')}
            style={{
              background: 'transparent',
              border: 'none',
              color: 'rgba(255, 255, 255, 0.6)',
              fontSize: '0.9rem',
              cursor: 'pointer',
              textDecoration: 'underline',
              fontFamily: 'Satoshi, sans-serif',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.color = '#bfff0b'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = 'rgba(255, 255, 255, 0.6)'
            }}
          >
            ← Back to home
          </button>
        </div>
      </div>
    </div>
  )
}
