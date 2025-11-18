import { SealClient, SessionKey } from '@mysten/seal'
import { SuiClient, getFullnodeUrl } from '@mysten/sui/client'
import type { Signer } from '@mysten/sui/cryptography'
import { Transaction } from '@mysten/sui/transactions'
import { getKeyServerConfigs } from './seal.config'
import { SAFEKEY_PACKAGE_ID } from './vault'
import { isEnokiWallet } from '@mysten/enoki'
import type { SealClientOptions } from '@mysten/seal'
import { fromHEX } from '@mysten/sui/utils'

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

const NETWORK = getRequiredEnvVar('VITE_SUI_NETWORK') as 'testnet' | 'mainnet' | 'devnet'

const masterKeyCache = new Map<string, string>()
const sessionKeyCache = new Map<string, SessionKey>()
const shareCreationLock = new Map<string, Promise<Uint8Array>>()

let sealClient: SealClient | null = null
let sealClientOptions: SealClientOptions | null = null

export function initializeSeal(
  client: SuiClient,
  network: 'testnet' | 'mainnet' | 'devnet' = 'testnet'
): void {
  if (sealClient && sealClientOptions) {
    console.log('[SEAL] Client already initialized')
    return
  }

  const keyServers = getKeyServerConfigs(network)

  sealClientOptions = {
    suiClient: client,
    serverConfigs: keyServers,
    verifyKeyServers: true,
    timeout: 30000,
  }

  sealClient = new SealClient(sealClientOptions)
  console.log('[SEAL] Client initialized')
}

export async function createEnokiSigner(
  wallet: any,
  address: string,
  currentAccount: any
): Promise<Signer> {
  const publicKey: any = {
    toRawBytes() {
      return new Uint8Array(0)
    },
    flag: 0,
    scheme: 'ZkLogin' as any,
    equals() {
      return false
    },
    toBase64() {
      return ''
    },
    toSuiPublicKey() {
      return ''
    },
    verifyWithIntent() {
      return Promise.resolve(false)
    },
  }
  Object.defineProperty(publicKey, 'toSuiAddress', {
    value: function () {
      return address
    },
    writable: false,
    enumerable: true,
    configurable: false,
  })

  const signer = {
    getPublicKey: () => publicKey,
    toSuiAddress: () => address,
    signPersonalMessage: async (bytes: Uint8Array) => {
      const signPersonalMessageFeature = (wallet.features as any)['sui:signPersonalMessage']
      if (!signPersonalMessageFeature) {
        throw new Error('Wallet does not support sui:signPersonalMessage')
      }
      if (!currentAccount) {
        throw new Error('Current account is required')
      }
      if (!currentAccount.chains || currentAccount.chains.length === 0) {
        throw new Error(`Account chain not available. Expected chain from currentAccount.`)
      }
      const chain = currentAccount.chains[0]
      const result = await signPersonalMessageFeature.signPersonalMessage({
        message: new Uint8Array(bytes),
        account: currentAccount,
        chain,
      })
      const messageHex = Array.from(bytes)
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('')
      return { bytes: messageHex, signature: result.signature }
    },
    signTransactionBlock: async (transactionBlock: Uint8Array | any) => {
      const signTransactionFeature = (wallet.features as any)['sui:signTransaction']
      if (!signTransactionFeature) {
        throw new Error('Wallet does not support sui:signTransaction')
      }
      if (!currentAccount) {
        throw new Error('Current account is required')
      }
      if (!currentAccount.chains || currentAccount.chains.length === 0) {
        throw new Error(`Account chain not available. Expected chain from currentAccount.`)
      }
      const chain = currentAccount.chains[0]
      
      if (transactionBlock instanceof Uint8Array) {
        return transactionBlock
      }
      
      const result = await signTransactionFeature.signTransaction({
        transaction: transactionBlock,
        account: currentAccount,
        chain,
      })
      return result.signature
    },
    sign: async () => {
      throw new Error('Not implemented')
    },
    signWithIntent: async () => {
      throw new Error('Not implemented')
    },
    signTransaction: async () => {
      throw new Error('Not implemented')
    },
    signAndExecuteTransaction: async () => {
      throw new Error('Not implemented')
    },
    getKeyScheme: () => 'ZkLogin' as any,
  } as Signer

  return signer
}

export async function deriveMasterKeyFromSeal(
  address: string,
  _idToken: string,
  wallets: any[],
  currentAccount: any,
  signAndExecute?: (params: { transaction: any }) => Promise<any>
): Promise<string> {
  if (masterKeyCache.has(address)) {
    const cachedKey = masterKeyCache.get(address)!
    console.log('[SEAL] Using cached master key for address:', cachedKey.substring(0, 20) + '...')
    return cachedKey
  }
  
  console.log('[SEAL] No cached master key, deriving from SEAL share...')
  
  if (!sealClient) {
    const client = new SuiClient({ url: getFullnodeUrl(NETWORK) })
    initializeSeal(client, NETWORK)
  }

  if (!sealClient || !sealClientOptions) {
    throw new Error('SEAL client not initialized')
  }

  const enokiWallet = wallets.find(
    (w) => isEnokiWallet(w) && w.accounts.some((acc: any) => acc.address === currentAccount.address)
  )

  if (!enokiWallet) {
    throw new Error('Enoki wallet not found')
  }

  const signer = await createEnokiSigner(enokiWallet, address, currentAccount)

  if (!SAFEKEY_PACKAGE_ID || SAFEKEY_PACKAGE_ID.length < 20) {
    throw new Error(
      '[SEAL] Invalid SAFEKEY_PACKAGE_ID. Please set VITE_SAFEKEY_PACKAGE_ID in your .env file to your deployed package ID.'
    )
  }

  console.log('[SEAL] Using package ID:', SAFEKEY_PACKAGE_ID)

  const sessionKeyCacheKey = `${address}:${SAFEKEY_PACKAGE_ID}`
  let sessionKey: SessionKey
  
  if (sessionKeyCache.has(sessionKeyCacheKey)) {
    sessionKey = sessionKeyCache.get(sessionKeyCacheKey)!
    console.log('[SEAL] Reusing cached SessionKey instance for consistent share retrieval')
  } else {
    try {
      sessionKey = await SessionKey.create({
        address,
        packageId: SAFEKEY_PACKAGE_ID,
        ttlMin: 30,
        suiClient: sealClientOptions.suiClient,
        signer,
      })
      sessionKeyCache.set(sessionKeyCacheKey, sessionKey)
      console.log('[SEAL] Created new SessionKey instance and cached it for reuse')
    } catch (error) {
      if (error instanceof Error && error.message.includes('invalid')) {
        throw new Error(
          `[SEAL] Package ID ${SAFEKEY_PACKAGE_ID} is invalid or not deployed. ` +
          `Please ensure:\n` +
          `1. Your Move contract is deployed with the seal_approve function\n` +
          `2. VITE_SAFEKEY_PACKAGE_ID is set to the correct deployed package ID\n` +
          `3. The package exists on ${NETWORK} network`
        )
      }
      throw error
    }
  }

  const keyServers = await sealClient.getKeyServers()
  const keyServerList = Array.from(keyServers.values())
  
  if (keyServerList.length === 0) {
    throw new Error('[SEAL] No key servers available')
  }
  
  const tx = new Transaction()
  tx.setSender(address)
  
  const addressBytes = fromHEX(address.replace('0x', ''))
  
  tx.moveCall({
    target: `${SAFEKEY_PACKAGE_ID}::vault::seal_approve`,
    arguments: [
      tx.pure.vector('u8', Array.from(addressBytes)),
      tx.object('0x6'),
    ],
  })
  
  console.log('[SEAL] Building seal_approve transaction...')
  const txBytes = await tx.build({ 
    client: sealClientOptions.suiClient, 
    onlyTransactionKind: true 
  })
  
  const txBytesHash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', txBytes))).map(b => b.toString(16).padStart(2, '0')).join('').substring(0, 32)
  console.log('[SEAL] Transaction bytes hash (for debugging):', txBytesHash)
  
  const sessionKeyAddress = (sessionKey as any).getAddress?.() || (sessionKey as any).address || 'unknown'
  const sessionKeyPackageId = (sessionKey as any).getPackageId?.() || (sessionKey as any).packageId || 'unknown'
  console.log('[SEAL] SessionKey details:', {
    address: sessionKeyAddress,
    packageId: sessionKeyPackageId,
  })
  
  let shareBytes: Uint8Array
  
  try {
    console.log('[SEAL] Attempting to retrieve existing SEAL share...')
    
    const sessionKeyId = (sessionKey as any).id || (sessionKey as any).getId?.() || 'unknown'
    const sessionKeyCert = (sessionKey as any).certificate || (sessionKey as any).getCertificate?.() || 'unknown'
    const sessionKeyCertHash = typeof sessionKeyCert === 'string' 
      ? sessionKeyCert.substring(0, 32) 
      : sessionKeyCert instanceof Uint8Array 
        ? Array.from(sessionKeyCert).slice(0, 16).map(b => b.toString(16).padStart(2, '0')).join('')
        : 'unknown'
    
    console.log('[SEAL] getDerivedKeys params:', {
      id: address,
      txBytesLength: txBytes.length,
      txBytesHash,
      sessionKeyAddress,
      sessionKeyPackageId,
      sessionKeyId: typeof sessionKeyId === 'string' ? sessionKeyId.substring(0, 32) : String(sessionKeyId).substring(0, 32),
      sessionKeyCertHash,
      threshold: 1,
    })
    
    console.log('[SEAL] SessionKey object identity:', {
      sessionKeyType: typeof sessionKey,
      sessionKeyConstructor: sessionKey?.constructor?.name,
      sessionKeyKeys: Object.keys(sessionKey || {}),
    })
    
    const derivedKeys = await sealClient!.getDerivedKeys({
      id: address,
      txBytes: txBytes,
      sessionKey: sessionKey,
      threshold: 1,
    })
    
    if (!derivedKeys || derivedKeys.size === 0) {
      throw new Error('[SEAL] No derived keys returned')
    }
    
    console.log(`[SEAL] getDerivedKeys returned ${derivedKeys.size} share(s)`)
    
    const allShares: Uint8Array[] = []
    const shareHashes: string[] = []
    
    for (const derivedKey of derivedKeys.values()) {
      const derivedKeyAny = derivedKey as any
      const g1Element = derivedKeyAny.key || derivedKeyAny
      if (!g1Element || typeof g1Element.toBytes !== 'function') {
        continue
      }
      const share = g1Element.toBytes()
      allShares.push(share)
      const shareHash = Array.from(share).slice(0, 16).map((b) => (b as number).toString(16).padStart(2, '0')).join('')
      shareHashes.push(shareHash)
    }
    
    console.log(`[SEAL] Extracted ${allShares.length} valid share(s) from getDerivedKeys result`)
    console.log(`[SEAL] Share hash(es) (first 32 hex chars):`, shareHashes)
    
    if (allShares.length === 0) {
      throw new Error('[SEAL] No valid shares found in derivedKeys')
    }
    
    if (allShares.length > 1) {
      console.error(`[SEAL] ERROR: Multiple shares found for address ${address}!`)
      console.error('[SEAL] This means sealClient.encrypt() was called multiple times, creating multiple shares.')
      console.error('[SEAL] This breaks determinism - SEAL may return different shares based on SessionKey certificate.')
      console.error('[SEAL] ROOT CAUSE: Multiple shares exist. We will use lexicographically first one for consistency.')
      console.error(`[SEAL] Found ${shareHashes.length} different shares:`, shareHashes)
    }
    
    allShares.sort((a, b) => {
      for (let i = 0; i < Math.min(a.length, b.length); i++) {
        if (a[i] < b[i]) return -1
        if (a[i] > b[i]) return 1
      }
      return a.length - b.length
    })
    
    shareBytes = allShares[0]
    const shareBytesHex = Array.from(shareBytes).map(b => b.toString(16).padStart(2, '0')).join('').substring(0, 32) + '...'
    console.log('[SEAL] Successfully retrieved SEAL share (hex prefix):', shareBytesHex)
    if (allShares.length > 1) {
      console.log('[SEAL] Using lexicographically first share for consistency')
    }
  } catch (error: any) {
    if (error?.message?.includes('403') || error?.message?.includes('NoAccessError') || error?.message?.includes('does not have access')) {
      console.log('[SEAL] 403 error - share may exist but access not authorized. Trying seal_approve first...')
      
      if (!signAndExecute) {
        throw new Error('[SEAL] Cannot authorize share access: signAndExecute is required to execute seal_approve transaction')
      }
      
      try {
        console.log('[SEAL] Executing seal_approve transaction to authorize share access...')
        
        const sealApproveTx = new Transaction()
        sealApproveTx.setSender(address)
        
        const addressHex = address.replace('0x', '')
        if (addressHex.length !== 64) {
          throw new Error(`[SEAL] Invalid address length: expected 64 hex chars (32 bytes), got ${addressHex.length}`)
        }
        const addressBytesForSeal = fromHEX(addressHex)
        
        sealApproveTx.moveCall({
          target: `${SAFEKEY_PACKAGE_ID}::vault::seal_approve`,
          arguments: [
            sealApproveTx.pure.vector('u8', Array.from(addressBytesForSeal)),
            sealApproveTx.object('0x6'),
          ],
        })
        
        sealApproveTx.setGasBudget(10000000)
        
        const approveTxBytes = await sealApproveTx.build({ 
          client: sealClientOptions.suiClient, 
          onlyTransactionKind: true 
        })
        
        const result = await signAndExecute({ transaction: sealApproveTx })
        console.log('[SEAL] seal_approve transaction executed successfully')
        console.log('[SEAL] Transaction digest:', result.digest)
        
        console.log('[SEAL] Waiting for transaction confirmation and SEAL server processing...')
        await new Promise(resolve => setTimeout(resolve, 5000))
        
        console.log('[SEAL] Retrying getDerivedKeys after seal_approve...')
        
        const derivedKeysAfterApprove = await sealClient.getDerivedKeys({
          id: address,
          txBytes: approveTxBytes,
          sessionKey: sessionKey,
          threshold: 1,
        })
        
        if (!derivedKeysAfterApprove || derivedKeysAfterApprove.size === 0) {
          throw new Error('[SEAL] No derived keys returned after seal_approve. Share may not exist yet.')
        }
        
        console.log(`[SEAL] getDerivedKeys returned ${derivedKeysAfterApprove.size} share(s) after seal_approve`)
        
        if (derivedKeysAfterApprove.size > 1) {
          console.warn(`[SEAL] WARNING: Multiple shares found for address ${address}. This should not happen.`)
        }
        
        const allShares: Uint8Array[] = []
        for (const derivedKey of derivedKeysAfterApprove.values()) {
          const derivedKeyAny = derivedKey as any
          const g1Element = derivedKeyAny.key || derivedKeyAny
          if (!g1Element || typeof g1Element.toBytes !== 'function') {
            continue
          }
          const share = g1Element.toBytes()
          allShares.push(share)
        }
        
        if (allShares.length === 0) {
          throw new Error('[SEAL] No valid shares found after seal_approve')
        }
        
        allShares.sort((a, b) => {
          for (let i = 0; i < Math.min(a.length, b.length); i++) {
            if (a[i] < b[i]) return -1
            if (a[i] > b[i]) return 1
          }
          return a.length - b.length
        })
        
        shareBytes = allShares[0]
        const shareBytesHex = Array.from(shareBytes).map(b => b.toString(16).padStart(2, '0')).join('').substring(0, 32) + '...'
        console.log('[SEAL] Successfully retrieved existing SEAL share after seal_approve (hex prefix):', shareBytesHex)
        if (allShares.length > 1) {
          console.log('[SEAL] Using lexicographically first share for consistency')
        }
      } catch (execError: any) {
        if (execError?.message?.includes('403') || execError?.message?.includes('NoAccessError') || execError?.message?.includes('does not have access') || execError?.message?.includes('No derived keys') || execError?.message?.includes('No valid shares')) {
          console.log('[SEAL] Share does not exist after seal_approve. This is a first-time user. Creating share...')
          
          const shareCreationKey = `${address}:${SAFEKEY_PACKAGE_ID}`
          
          if (shareCreationLock.has(shareCreationKey)) {
            console.log('[SEAL] Share creation already in progress, waiting for it to complete...')
            shareBytes = await shareCreationLock.get(shareCreationKey)!
            console.log('[SEAL] Share creation completed by another call, using the created share')
          } else {
            const shareCreationPromise = (async (): Promise<Uint8Array> => {
              try {
                console.log('[SEAL] Creating SEAL share using encrypt()...')
                const dummyData = new Uint8Array([1, 2, 3, 4])
                
                const encryptResult = await sealClient.encrypt({
                  kemType: 0,
                  demType: 0,
                  threshold: 1,
                  packageId: SAFEKEY_PACKAGE_ID,
                  id: address,
                  data: dummyData,
                })
                
                console.log('[SEAL] Encrypted object created, share generated on SEAL servers')
                console.log('[SEAL] Encrypt result:', encryptResult ? 'Received' : 'None')
                
                console.log('[SEAL] Executing seal_approve transaction to authorize the newly created share...')
                
                const sealApproveTx2 = new Transaction()
                sealApproveTx2.setSender(address)
                
                const addressHex2 = address.replace('0x', '')
                const addressBytesForSeal2 = fromHEX(addressHex2)
                
                sealApproveTx2.moveCall({
                  target: `${SAFEKEY_PACKAGE_ID}::vault::seal_approve`,
                  arguments: [
                    sealApproveTx2.pure.vector('u8', Array.from(addressBytesForSeal2)),
                    sealApproveTx2.object('0x6'),
                  ],
                })
                
                sealApproveTx2.setGasBudget(10000000)
                
                const approveTxBytes2 = await sealApproveTx2.build({ 
                  client: sealClientOptions.suiClient, 
                  onlyTransactionKind: true 
                })
                
                const result2 = await signAndExecute({ transaction: sealApproveTx2 })
                console.log('[SEAL] seal_approve transaction executed successfully for new share')
                console.log('[SEAL] Transaction digest:', result2.digest)
                
                console.log('[SEAL] Waiting for transaction confirmation and SEAL server processing...')
                await new Promise(resolve => setTimeout(resolve, 5000))
                
                console.log('[SEAL] Retrieving newly created share...')
                
                const derivedKeysAfterCreate = await sealClient.getDerivedKeys({
                  id: address,
                  txBytes: approveTxBytes2,
                  sessionKey: sessionKey,
                  threshold: 1,
                })
                
                if (!derivedKeysAfterCreate || derivedKeysAfterCreate.size === 0) {
                  throw new Error('[SEAL] No derived keys returned after creating share')
                }
                
                console.log(`[SEAL] getDerivedKeys returned ${derivedKeysAfterCreate.size} share(s) after creation`)
                
                if (derivedKeysAfterCreate.size > 1) {
                  console.warn(`[SEAL] WARNING: Multiple shares found after creation. This should not happen.`)
                }
                
                const allSharesAfterCreate: Uint8Array[] = []
                for (const derivedKey of derivedKeysAfterCreate.values()) {
                  const derivedKeyAny = derivedKey as any
                  const g1Element = derivedKeyAny.key || derivedKeyAny
                  if (!g1Element || typeof g1Element.toBytes !== 'function') {
                    continue
                  }
                  const share = g1Element.toBytes()
                  allSharesAfterCreate.push(share)
                }
                
                if (allSharesAfterCreate.length === 0) {
                  throw new Error('[SEAL] No valid shares found after creation')
                }
                
                allSharesAfterCreate.sort((a, b) => {
                  for (let i = 0; i < Math.min(a.length, b.length); i++) {
                    if (a[i] < b[i]) return -1
                    if (a[i] > b[i]) return 1
                  }
                  return a.length - b.length
                })
                
                const createdShareBytes = allSharesAfterCreate[0]
                const shareBytesHex = Array.from(createdShareBytes).map(b => b.toString(16).padStart(2, '0')).join('').substring(0, 32) + '...'
                console.log('[SEAL] Successfully created and retrieved SEAL share (hex prefix):', shareBytesHex)
                console.log('[SEAL] Share created for first-time user. This share will be used for all future sessions.')
                if (allSharesAfterCreate.length > 1) {
                  console.log('[SEAL] Using lexicographically first share for consistency')
                }
                
                return createdShareBytes
              } catch (createError: any) {
                console.error('[SEAL] Error creating share for first-time user:', createError)
                throw new Error(`[SEAL] Failed to create share for first-time user: ${createError?.message || String(createError)}`)
              } finally {
                shareCreationLock.delete(shareCreationKey)
              }
            })()
            
            shareCreationLock.set(shareCreationKey, shareCreationPromise)
            shareBytes = await shareCreationPromise
          }
        } else {
          console.error('[SEAL] Error authorizing share access:', execError)
          throw new Error(`[SEAL] Failed to authorize share access: ${execError?.message || String(execError)}`)
        }
      }
    } else {
      throw error
    }
  }
  
  const encoder = new TextEncoder()
  const addressBytesForHash = encoder.encode(address)
  const combined = new Uint8Array(addressBytesForHash.length + shareBytes.length)
  combined.set(addressBytesForHash, 0)
  combined.set(shareBytes, addressBytesForHash.length)
  const hash = await crypto.subtle.digest('SHA-256', combined.buffer as ArrayBuffer)
  const kmBytes = new Uint8Array(hash)
  
  const masterKey = btoa(String.fromCharCode(...kmBytes))
  
  if (masterKeyCache.has(address)) {
    const cachedKey = masterKeyCache.get(address)!
    if (cachedKey !== masterKey) {
      console.error('[SEAL] WARNING: Master key changed! This should not happen.')
      console.error('[SEAL] Cached key:', cachedKey.substring(0, 20) + '...')
      console.error('[SEAL] New key:', masterKey.substring(0, 20) + '...')
      console.error('[SEAL] This means the SEAL share changed, which will break decryption of existing credentials!')
    }
  }
  
  masterKeyCache.set(address, masterKey)
  
  console.log('[SEAL] Master key derived successfully from address and SEAL share')
  console.log('[SEAL] Master key (first 20 chars):', masterKey.substring(0, 20) + '...')
  console.log('[SEAL] Master key cached for future use')
  
  return masterKey
}

