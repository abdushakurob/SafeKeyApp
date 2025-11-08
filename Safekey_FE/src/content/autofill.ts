/**
 * Content Script for SafeKey Autofill
 * Detects login forms and provides autofill functionality
 */

console.log('[SafeKey Autofill] Script loaded')

// Track processed forms to avoid duplicates
const processedForms = new WeakSet<HTMLFormElement>()

// Detect login forms on page load
function detectLoginForms(): void {
  console.log('[SafeKey Autofill] Scanning for login forms...')
  const forms = document.querySelectorAll('form')
  console.log('[SafeKey Autofill] Found', forms.length, 'form(s) on page')

  const loginForms: HTMLFormElement[] = []

  forms.forEach((form, index) => {
    // Skip if already processed
    if (processedForms.has(form)) {
      return
    }

    const inputs = form.querySelectorAll('input[type="password"], input[type="text"], input[type="email"], input:not([type])')
    const passwordInputs = form.querySelectorAll('input[type="password"]')
    
    const hasPassword = passwordInputs.length > 0 || Array.from(inputs).some((input: Element) => {
      const inputEl = input as HTMLInputElement
      const name = (inputEl.name || '').toLowerCase()
      const id = (inputEl.id || '').toLowerCase()
      const placeholder = (inputEl.placeholder || '').toLowerCase()
      return name.includes('password') || 
             id.includes('password') ||
             placeholder.includes('password')
    })

    // Also check for username/email fields
    const hasUsername = Array.from(inputs).some((input: Element) => {
      const inputEl = input as HTMLInputElement
      const name = (inputEl.name || '').toLowerCase()
      const id = (inputEl.id || '').toLowerCase()
      const placeholder = (inputEl.placeholder || '').toLowerCase()
      const type = inputEl.type.toLowerCase()
      return type === 'email' ||
             type === 'text' ||
             name.includes('user') ||
             name.includes('email') ||
             name.includes('login') ||
             id.includes('user') ||
             id.includes('email') ||
             id.includes('login') ||
             placeholder.includes('email') ||
             placeholder.includes('username')
    })

    // Consider it a login form if it has password field OR (password-like field + username-like field)
    if (hasPassword && (inputs.length >= 2 || hasUsername)) {
      console.log('[SafeKey Autofill] Found login form', index, form)
      loginForms.push(form as HTMLFormElement)
      processedForms.add(form)
    }
  })

  if (loginForms.length > 0) {
    console.log('[SafeKey Autofill] ✅ Found', loginForms.length, 'login form(s)')
    handleLoginForms(loginForms)
  } else {
    console.log('[SafeKey Autofill] No login forms detected')
  }
}

// Handle login forms - add autofill buttons and detect submissions
function handleLoginForms(forms: HTMLFormElement[]): void {
  forms.forEach((form, formIndex) => {
    // Find password field
    let passwordField = form.querySelector('input[type="password"]') as HTMLInputElement
    
    // If no password field, look for password-like fields
    if (!passwordField) {
      const allInputs = form.querySelectorAll('input')
      passwordField = Array.from(allInputs).find((input: HTMLInputElement) => {
        const name = (input.name || '').toLowerCase()
        const id = (input.id || '').toLowerCase()
        const placeholder = (input.placeholder || '').toLowerCase()
        return name.includes('password') || id.includes('password') || placeholder.includes('password')
      }) as HTMLInputElement
    }

    if (!passwordField) {
      console.log('[SafeKey Autofill] No password field found in form', formIndex)
      return
    }

    // Find username field
    let usernameField = form.querySelector('input[type="text"], input[type="email"]') as HTMLInputElement
    if (!usernameField) {
      const allInputs = form.querySelectorAll('input')
      usernameField = Array.from(allInputs).find((input: HTMLInputElement) => {
        if (input === passwordField) return false
        const name = (input.name || '').toLowerCase()
        const id = (input.id || '').toLowerCase()
        const placeholder = (input.placeholder || '').toLowerCase()
        const type = input.type.toLowerCase()
        return type === 'email' ||
               type === 'text' ||
               name.includes('user') ||
               name.includes('email') ||
               name.includes('login') ||
               id.includes('user') ||
               id.includes('email') ||
               id.includes('login') ||
               placeholder.includes('email') ||
               placeholder.includes('username')
      }) as HTMLInputElement
    }

    console.log('[SafeKey Autofill] Processing form', formIndex, {
      hasPassword: !!passwordField,
      hasUsername: !!usernameField,
    })

    // Create autofill button
    const autofillButton = document.createElement('button')
    autofillButton.type = 'button'
    autofillButton.textContent = '🔐 SafeKey'
    autofillButton.className = 'safekey-autofill-btn'
    autofillButton.style.cssText = `
      position: relative;
      background: #6366f1;
      color: white;
      border: none;
      padding: 6px 12px;
      border-radius: 4px;
      cursor: pointer;
      font-size: 12px;
      z-index: 10000;
      margin-left: 8px;
      margin-top: 4px;
      display: inline-block;
    `
    autofillButton.title = 'Fill credentials from SafeKey'

    // Add click handler
    autofillButton.addEventListener('click', async (e) => {
      e.preventDefault()
      e.stopPropagation()
      console.log('[SafeKey Autofill] Button clicked')
      await autofillCredentials(usernameField, passwordField)
    })

    // Insert button after password field (or in the same container)
    const container = passwordField.parentElement
    if (container) {
      // Make container relative if needed
      const containerStyle = getComputedStyle(container)
      if (containerStyle.position === 'static') {
        container.style.position = 'relative'
      }
      
      // Insert button after password field
      if (passwordField.nextSibling) {
        container.insertBefore(autofillButton, passwordField.nextSibling)
      } else {
        container.appendChild(autofillButton)
      }
      
      console.log('[SafeKey Autofill] ✅ Autofill button added to form', formIndex)
    } else {
      // Fallback: insert after password field
      passwordField.insertAdjacentElement('afterend', autofillButton)
    }

    // Listen for form submission to capture new credentials
    form.addEventListener('submit', async () => {
      await captureCredentials(usernameField, passwordField)
    }, { capture: true })
  })
}

// Autofill credentials from SafeKey
async function autofillCredentials(
  usernameField: HTMLInputElement | null,
  passwordField: HTMLInputElement
): Promise<void> {
  try {
    const domain = window.location.hostname

    // Request credentials from background
    const response = await chrome.runtime.sendMessage({
      type: 'GET_CREDENTIALS',
      domain,
    })

    if (response?.success && response.credentials) {
      const { username, password } = response.credentials

      // Fill fields
      if (usernameField && username) {
        usernameField.value = username
        usernameField.dispatchEvent(new Event('input', { bubbles: true }))
        usernameField.dispatchEvent(new Event('change', { bubbles: true }))
      }

      if (password) {
        passwordField.value = password
        passwordField.dispatchEvent(new Event('input', { bubbles: true }))
        passwordField.dispatchEvent(new Event('change', { bubbles: true }))
      }

      // Show success notification
      showNotification('Credentials filled!', 'success')
    } else if (response?.success && !response.credentials) {
      showNotification('No saved credentials for this site', 'info')
    } else {
      showNotification('Failed to retrieve credentials. Please login to SafeKey.', 'error')
    }
  } catch (error) {
    console.error('[SafeKey] Autofill error:', error)
    showNotification('Error: ' + (error instanceof Error ? error.message : String(error)), 'error')
  }
}

// Capture credentials on form submission
async function captureCredentials(
  usernameField: HTMLInputElement | null,
  passwordField: HTMLInputElement
): Promise<void> {
  try {
    const username = usernameField?.value || ''
    const password = passwordField.value

    if (!password || password.length < 3) {
      return // Don't save weak passwords
    }

    const domain = window.location.hostname

    // Ask user if they want to save
    const shouldSave = confirm(`Save credentials for ${domain}?`)
    if (!shouldSave) {
      return
    }

    // Save to background
    const response = await chrome.runtime.sendMessage({
      type: 'SAVE_CREDENTIALS',
      domain,
      username,
      password,
    })

    if (response?.success) {
      showNotification('Credentials saved!', 'success')
    } else {
      console.error('[SafeKey] Failed to save credentials:', response?.error)
    }
  } catch (error) {
    console.error('[SafeKey] Capture error:', error)
  }
}

// Show notification to user
function showNotification(message: string, type: 'success' | 'error' | 'info'): void {
  const notification = document.createElement('div')
  notification.textContent = message
  notification.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    padding: 12px 20px;
    border-radius: 6px;
    color: white;
    font-size: 14px;
    z-index: 100000;
    box-shadow: 0 4px 6px rgba(0,0,0,0.1);
    ${type === 'success' ? 'background: #10b981;' : ''}
    ${type === 'error' ? 'background: #ef4444;' : ''}
    ${type === 'info' ? 'background: #3b82f6;' : ''}
  `

  document.body.appendChild(notification)

  setTimeout(() => {
    notification.style.opacity = '0'
    notification.style.transition = 'opacity 0.3s'
    setTimeout(() => notification.remove(), 300)
  }, 3000)
}

// Run on page load
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', detectLoginForms)
} else {
  detectLoginForms()
}

// Also run when new content is added (for SPAs)
const observer = new MutationObserver(() => {
  detectLoginForms()
})

observer.observe(document.body, {
  childList: true,
  subtree: true,
})

export {}

