
import { credentialExists, getCredential, saveCredential, deriveMasterKey } from '../lib/credentials'

export interface BlockchainRequest {
  type: 'CHECK_CREDENTIAL' | 'SAVE_CREDENTIAL' | 'GET_CREDENTIAL'
  domain?: string
  credential?: {
    domain: string
    username: string
    password: string
  }
}

export interface BlockchainResponse {
  success: boolean
  exists?: boolean
  credential?: {
    domain: string
    username: string
    password: string
  }
  credentials?: {
    domain: string
    username: string
    password: string
  }[]
  error?: string
}

export async function handleBlockchainRequest(
  request: BlockchainRequest,
  address: string,
  idToken: string,
  signAndExecute: (params: { transaction: any }) => Promise<any>,
  wallets?: any[],
  currentAccount?: any
): Promise<BlockchainResponse> {
  try {
    // Derive master key (with SEAL if wallets/account provided)
    const masterKey = await deriveMasterKey(address, idToken, wallets, currentAccount)

    switch (request.type) {
      case 'CHECK_CREDENTIAL':
        if (!request.domain) {
          return { success: false, error: 'Domain is required' }
        }
        const exists = await credentialExists(request.domain, address)
        return { success: true, exists }

      case 'GET_CREDENTIAL':
        if (!request.domain) {
          return { success: false, error: 'Domain is required' }
        }
        const credentials = await getCredential(request.domain, masterKey, address)
        if (credentials && credentials.length > 0) {
          // Return first credential for backward compatibility
          // TODO: Update extension to handle multiple credentials
          return { success: true, credential: credentials[0], credentials }
        }
        return { success: false, error: 'Credential not found' }

      case 'SAVE_CREDENTIAL':
        if (!request.credential) {
          return { success: false, error: 'Credential is required' }
        }
        if (!wallets || !currentAccount) {
          return { success: false, error: 'Wallets and currentAccount are required for saving credentials' }
        }
        await saveCredential(request.credential, masterKey, address, signAndExecute, wallets, currentAccount)
        return { success: true }

      default:
        return { success: false, error: 'Unknown request type' }
    }
  } catch (error) {
    console.error('[Extension Bridge] Error handling request:', error)
    return { success: false, error: String(error) }
  }
}

export function setupExtensionListener(
  _address: string,
  _idToken: string,
  _signAndExecute: (params: { transaction: any }) => Promise<any>
) {
  console.log('[Extension Bridge] Listener setup (handled by web-app-listener)')
}

