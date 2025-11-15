/**
 * API Server Configuration
 * Centralized configuration for API server URL
 */

function getApiServerUrl(): string {
  // Try to get from environment variable (VITE_ prefix for frontend)
  if (typeof import.meta !== 'undefined' && import.meta.env) {
    const url = (import.meta.env as any).VITE_API_SERVER_URL
    if (url) {
      return url
    }
  }
  
  // Fallback to localhost for development
  return 'http://localhost:3001'
}

export const API_SERVER_URL = getApiServerUrl()
export const API_BASE_URL = `${API_SERVER_URL}/api`

