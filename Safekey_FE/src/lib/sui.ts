/**
 * Compatibility layer - re-exports from vault.ts
 * This maintains backward compatibility with existing code
 * while using the new popup-based signing workaround
 */

export { getOrCreateVault, addCredential, getCredentialInfo } from './vault'
export { SAFEKEY_PACKAGE_ID } from './vault'

// Re-export for backward compatibility
import { getOrCreateVault } from './vault'
export { getOrCreateVault as createVault }

// Placeholder functions for backward compatibility
export function initializeSuiClient(_network: 'testnet' | 'mainnet' | 'devnet' = 'testnet'): void {
  // Client initialization is handled in vault.ts
  console.log('[Sui] Client will be initialized on first use')
}

// These functions need to be implemented if they're used elsewhere
export async function getUserVaultId(_address: string): Promise<string | null> {
  // This should use getOrCreateVault instead
  throw new Error('getUserVaultId is deprecated. Use getOrCreateVault() instead.')
}

export async function saveCredentials(
  _vaultId: string,
  _domainHash: Uint8Array,
  _encryptedData: Uint8Array,
  _entryNonce: Uint8Array,
  _sessionNonce: Uint8Array
): Promise<void> {
  // Use addCredential from vault.ts instead
  throw new Error('saveCredentials is deprecated. Use addCredential() from vault.ts instead.')
}

export async function deleteCredentials(
  _vaultId: string,
  _domainHash: Uint8Array
): Promise<void> {
  throw new Error('deleteCredentials not yet implemented in new vault.ts')
}

export async function getCredentials(
  _vaultId: string,
  _domainHash: Uint8Array
): Promise<unknown> {
  // Use getCredentialInfo from vault.ts instead
  throw new Error('getCredentials is deprecated. Use getCredentialInfo() from vault.ts instead.')
}

export async function getAllDomainHashes(_vaultId: string): Promise<Uint8Array[]> {
  throw new Error('getAllDomainHashes not yet implemented in new vault.ts')
}

export async function entryExists(
  _vaultId: string,
  _domainHash: Uint8Array
): Promise<boolean> {
  throw new Error('entryExists not yet implemented in new vault.ts')
}










