/**
 * Shared heartbeat utility for SafeKey Extension
 */

import { API_BASE_URL } from './constants'

/**
 * Send heartbeat to API server to announce extension is installed
 */
export async function sendHeartbeat(): Promise<void> {
  try {
    const extensionId = chrome.runtime.id
    const response = await fetch(`${API_BASE_URL}/api/extension-ping`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ extensionId }),
    })
    
    if (response.ok) {
      console.log('[Extension] Heartbeat sent successfully')
    } else {
      console.warn('[Extension] Heartbeat failed:', response.status)
    }
  } catch (error) {
    // Silently fail - API server might not be running
    // This is expected if the web app isn't started yet
  }
}

