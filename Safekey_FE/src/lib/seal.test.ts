/**
 * Test utility for SEAL integration
 * Can be called from browser console: window.testSealSessionKey()
 */

import { initializeSeal, createSessionKeyFromZkProof } from './seal'
import { getZkLoginProof, getProvider, isZkLoginActive } from './zklogin'

/**
 * Test createSessionKeyFromZkProof function
 * 
 * Usage in browser console:
 *   await window.testSealSessionKey()
 */
export async function testSealSessionKey(): Promise<{
  success: boolean
  error?: string
  sessionKey?: any
}> {
  try {
    console.log('[TEST] Starting SEAL SessionKey test...')
    
    // Step 1: Check if zkLogin is active
    if (!isZkLoginActive()) {
      throw new Error('zkLogin is not active. Please login first.')
    }
    
    // Step 2: Get zkLogin proof
    const zkProof = getZkLoginProof()
    if (!zkProof) {
      throw new Error('No zkLogin proof available. Please complete login.')
    }
    
    console.log('[TEST] ✅ zkLogin proof obtained:', {
      address: zkProof.address,
      hasProofPoints: !!zkProof.proofPoints,
    })
    
    // Step 3: Initialize SEAL
    const provider = getProvider()
    if (!provider) {
      throw new Error('No provider available')
    }
    
    console.log('[TEST] Initializing SEAL for network: testnet')
    initializeSeal('testnet')
    console.log('[TEST] ✅ SEAL initialized')
    
    // Step 4: Create SessionKey
    console.log('[TEST] Creating SessionKey from zkProof...')
    const sessionKey = await createSessionKeyFromZkProof(zkProof)
    
    console.log('[TEST] ✅ SessionKey created successfully!')
    console.log('[TEST] SessionKey details:', {
      address: sessionKey.getAddress(),
      packageId: sessionKey.getPackageId(),
    })
    
    return {
      success: true,
      sessionKey: {
        address: sessionKey.getAddress(),
        packageId: sessionKey.getPackageId(),
      },
    }
  } catch (error) {
    console.error('[TEST] ❌ Test failed:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

// Expose to window for console testing
if (typeof window !== 'undefined') {
  (window as any).testSealSessionKey = testSealSessionKey
}

