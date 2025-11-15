import { API_BASE_URL } from '../shared/constants'
import { sendHeartbeat } from '../shared/heartbeat'

function getElement(id: string): HTMLElement | null {
  return document.getElementById(id)
}

async function checkApiConnection(): Promise<boolean> {
  try {
    const response = await fetch(`${API_BASE_URL}/api/health`, {
      method: 'GET',
      signal: AbortSignal.timeout(2000),
    })
    return response.ok
  } catch {
    return false
  }
}

async function checkSession() {
  const statusCard = getElement('statusCard')
  const statusValue = getElement('statusValue')
  const addressContainer = getElement('addressContainer')
  const address = getElement('address')
  const emptyState = getElement('emptyState')
  const actions = getElement('actions')
  const apiStatus = getElement('apiStatus')

  try {
    // Check API server first
    const apiConnected = await checkApiConnection()
    if (apiStatus) {
      if (apiConnected) {
        apiStatus.textContent = 'API: Connected'
        apiStatus.className = 'api-status connected'
      } else {
        apiStatus.textContent = 'API: Not Connected'
        apiStatus.className = 'api-status disconnected'
      }
    }

    const response = await new Promise<any>((resolve) => {
      chrome.runtime.sendMessage({ type: 'GET_SESSION' }, (response) => {
        if (chrome.runtime.lastError) {
          console.error('[Popup] Chrome runtime error:', chrome.runtime.lastError)
          resolve(null)
        } else {
          resolve(response)
        }
      })
    })
    
    if (response && response.success && response.session) {
      // Show connected state
      if (statusCard) statusCard.style.display = 'block'
      if (emptyState) emptyState.style.display = 'none'
      if (actions) actions.style.display = 'flex'
      
      if (statusValue) {
        statusValue.textContent = 'Connected'
        statusValue.className = 'status-value'
      }
      
      if (address && response.session.address) {
        const addr = response.session.address
        address.textContent = `${addr.substring(0, 6)}...${addr.substring(addr.length - 4)}`
        if (addressContainer) addressContainer.style.display = 'block'
      }
    } else {
      // Show disconnected state (no session)
      if (statusCard) statusCard.style.display = 'block'
      if (emptyState) emptyState.style.display = 'none'
      if (actions) actions.style.display = 'flex'
      
      if (statusValue) {
        statusValue.textContent = 'Not Connected'
        statusValue.className = 'status-value disconnected'
      }
      
      if (addressContainer) addressContainer.style.display = 'none'
    }
  } catch (error) {
    console.error('[Popup] Error checking session:', error)
    // Show error state but still show the UI
    if (statusCard) statusCard.style.display = 'block'
    if (emptyState) emptyState.style.display = 'none'
    if (actions) actions.style.display = 'flex'
    
    if (statusValue) {
      statusValue.textContent = 'Error checking session'
      statusValue.className = 'status-value disconnected'
    }
    
    if (addressContainer) addressContainer.style.display = 'none'
  }
}

function setupButtons() {
  const openDashboardBtn = getElement('openDashboard')
  const openWebAppBtn = getElement('openWebApp')

  if (openDashboardBtn) {
    openDashboardBtn.addEventListener('click', () => {
      chrome.tabs.create({ url: 'http://localhost:3000/dashboard' })
    })
  }

  if (openWebAppBtn) {
    openWebAppBtn.addEventListener('click', () => {
      chrome.tabs.create({ url: 'http://localhost:3000' })
    })
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    sendHeartbeat()
    setupButtons()
    checkSession()
  })
} else {
  sendHeartbeat()
  setupButtons()
  checkSession()
}

setInterval(checkSession, 3000)
