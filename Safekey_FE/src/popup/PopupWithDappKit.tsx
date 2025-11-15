/**
 * Popup component wrapped with dApp-kit providers
 * This provides automatic session management and wallet connection
 */

import {
  createNetworkConfig,
  SuiClientProvider,
  useSuiClientContext,
  WalletProvider,
} from '@mysten/dapp-kit'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { isEnokiNetwork, registerEnokiWallets } from '@mysten/enoki'
import { getFullnodeUrl } from '@mysten/sui/client'
import { useEffect } from 'react'
import Popup from './popup'

// Create a QueryClient instance for React Query (required by dApp-kit)
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5, // 5 minutes
      gcTime: 1000 * 60 * 10, // 10 minutes (formerly cacheTime)
      retry: false,
      refetchOnWindowFocus: false,
    },
  },
})

const { networkConfig } = createNetworkConfig({
  testnet: { url: getFullnodeUrl('testnet') },
  mainnet: { url: getFullnodeUrl('mainnet') },
  devnet: { url: getFullnodeUrl('devnet') },
})

/**
 * Component to register Enoki wallets with dApp-kit
 * This should be rendered before WalletProvider
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

    console.log('[dApp-kit] ✅ Enoki wallets registered')

    return () => {
      console.log('[dApp-kit] Unregistering Enoki wallets...')
      unregister()
    }
  }, [client, network])

  return null
}

/**
 * Main popup component wrapped with dApp-kit providers
 * autoConnect will automatically restore sessions without OAuth popup
 */
export default function PopupWithDappKit() {
  return (
    <QueryClientProvider client={queryClient}>
      <SuiClientProvider networks={networkConfig} defaultNetwork="testnet">
        <RegisterEnokiWallets />
        <WalletProvider 
          autoConnect
          storageKey="safekey-wallet-connection"
          storage={typeof chrome !== 'undefined' && chrome.storage ? {
            getItem: async (key: string) => {
              const result = await chrome.storage.local.get(key)
              return result[key] || null
            },
            setItem: async (key: string, value: string) => {
              await chrome.storage.local.set({ [key]: value })
            },
            removeItem: async (key: string) => {
              await chrome.storage.local.remove(key)
            },
          } : undefined}
        >
          <Popup />
        </WalletProvider>
      </SuiClientProvider>
    </QueryClientProvider>
  )
}

