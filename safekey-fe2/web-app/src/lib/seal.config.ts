import type { KeyServerConfig } from '@mysten/seal'

function getRequiredEnvVar(key: string): string {
  let value: string | undefined
  
  if (typeof process !== 'undefined' && process.env) {
    value = process.env[key]
  } else if (typeof import.meta !== 'undefined' && import.meta.env) {
    value = (import.meta.env as any)[key]
  }
  
  if (!value) {
    throw new Error(`Required environment variable ${key} is not set. Please set it in your .env file.`)
  }
  
  return value
}

export const MYSTEN_TESTNET_KEY_SERVERS: KeyServerConfig[] = [
  {
    // mysten-testnet-1 (Open mode)
    objectId: '0x73d05d62c18d9374e3ea529e8e0ed6161da1a141a94d3f76ae3fe4e99356db75',
    weight: 1,
  },
  {
    // mysten-testnet-2 (Open mode)
    objectId: '0xf5d14a81a982144ae441cd7d64b09027f116a468bd36e7eca494f750591623c8',
    weight: 1,
  },
]

/**
 * Get key server configs for a specific network
 */
export function getKeyServerConfigs(
  network: 'testnet' | 'mainnet' | 'devnet'
): KeyServerConfig[] {
  switch (network) {
    case 'testnet':
      return MYSTEN_TESTNET_KEY_SERVERS
    case 'devnet':
      return MYSTEN_TESTNET_KEY_SERVERS
    case 'mainnet':
      throw new Error('Mainnet key servers not configured. Contact Mysten Labs for mainnet access.')
    default:
      throw new Error(`Unsupported network: ${network}`)
  }
}

export const SEAL_PACKAGE_ID = getRequiredEnvVar('VITE_SEAL_PACKAGE_ID')

