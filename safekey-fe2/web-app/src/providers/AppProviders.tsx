/**
 * App Providers Component
 * Wraps the app with dApp-kit providers
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  createNetworkConfig,
  SuiClientProvider,
  useSuiClientContext,
  WalletProvider,
} from '@mysten/dapp-kit'
import { isEnokiNetwork, registerEnokiWallets } from '@mysten/enoki'
import { getFullnodeUrl } from '@mysten/sui/client'
import { useEffect, ReactNode } from 'react'
// Enoki initialization is handled by registerEnokiWallets

const { networkConfig } = createNetworkConfig({
  testnet: { url: getFullnodeUrl('testnet') },
  mainnet: { url: getFullnodeUrl('mainnet') },
  devnet: { url: getFullnodeUrl('devnet') },
})

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5, // 5 minutes
      gcTime: 1000 * 60 * 10, // 10 minutes
      retry: false,
      refetchOnWindowFocus: false,
    },
  },
})

/**
 * Component to register Enoki wallets
 */
function RegisterEnokiWallets() {
  const { client, network } = useSuiClientContext()

  useEffect(() => {
    if (!isEnokiNetwork(network)) {
      console.log('[dApp-kit] Not an Enoki network, skipping wallet registration')
      return
    }

    const apiKey = import.meta.env.VITE_ENOKI_API_KEY
    const clientId = import.meta.env.VITE_OAUTH_CLIENT_ID

    if (!apiKey || !clientId) {
      console.error('[dApp-kit] Missing Enoki config')
      return
    }

    console.log('[dApp-kit] Registering Enoki wallets...')
    const { unregister } = registerEnokiWallets({
      apiKey,
      providers: {
        google: {
          clientId,
        },
      },
      client,
      network,
    })

    console.log('[dApp-kit] Enoki wallets registered')

    return () => {
      console.log('[dApp-kit] Unregistering Enoki wallets...')
      unregister()
    }
  }, [client, network])

  return null
}

interface AppProvidersProps {
  children: ReactNode
}

/**
 * Main providers wrapper
 */
export function AppProviders({ children }: AppProvidersProps) {
  return (
    <QueryClientProvider client={queryClient}>
      <SuiClientProvider networks={networkConfig} defaultNetwork="testnet">
        <RegisterEnokiWallets />
        <WalletProvider autoConnect storageKey="safekey-wallet-connection">
          {children}
        </WalletProvider>
      </SuiClientProvider>
    </QueryClientProvider>
  )
}

