
import type { KeyServerConfig } from '@mysten/seal'


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
 * 
 * @param network - Sui network (testnet, mainnet, devnet)
 * @returns Array of key server configurations
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


export const DEFAULT_SEAL_PACKAGE_ID = '0xd7cad3ae47268c69e8fd843ed59c8daa428efdc06a954fca98fc45770334b4be' // ✅ Deployed package ID

/**
 * SEAL System Package IDs (for on-chain decryption only)
 */
export const SEAL_SYSTEM_PACKAGE_IDS = {
  testnet: '0x927a54e9ae803f82ebf480136a9bcff45101ccbe28b13f433c89f5181069d682',
} as const


