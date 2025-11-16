/**
 * API Configuration Template
 * 
 * IMPORTANT: Due to the extension bundling requirements, API URLs are inlined
 * directly in the source files to avoid ES module import issues.
 * 
 * To change the API URL:
 * 1. Update the API_BASE_URL in these files:
 *    - src/services/blockchain.ts (line ~26)
 *    - src/shared/heartbeat.ts (line ~7) 
 *    - src/popup/popup.ts (line ~5)
 *    - src/background/background.ts (line ~3)
 * 2. Run: npm run build
 * 3. Reload the extension in Chrome
 * 
 * Common configurations:
 */

// Development (default)
export const DEV_API_URL = 'http://localhost:3001'

// Production example
export const PROD_API_URL = 'https://your-production-api.com'

// Staging example  
export const STAGING_API_URL = 'https://staging-api.yourapp.com'

// Alternative local port
export const ALT_LOCAL_API_URL = 'http://localhost:3000'

// Default for reference
export const API_BASE_URL = DEV_API_URL
export const API_BASE_URL_WITH_API = `${API_BASE_URL}/api`