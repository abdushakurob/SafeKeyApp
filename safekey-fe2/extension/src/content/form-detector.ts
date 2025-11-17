
import { checkCredentialExists, saveCredential, getCredential, getCredentials, Credential } from '../services/blockchain'

export interface DetectedForm {
  form: HTMLFormElement
  usernameField: HTMLInputElement
  passwordField: HTMLInputElement
  domain: string
}

function getDomain(): string {
  return window.location.hostname.replace(/^www\./, '')
}

export function detectLoginForms(): DetectedForm[] {
  const forms = document.querySelectorAll('form')
  const detectedForms: DetectedForm[] = []
  const domain = getDomain()

  forms.forEach((form) => {
    const inputs = form.querySelectorAll('input')
    let usernameField: HTMLInputElement | null = null
    let passwordField: HTMLInputElement | null = null

    inputs.forEach((input) => {
      const type = input.type.toLowerCase()
      const name = input.name.toLowerCase()
      const id = input.id.toLowerCase()
      const placeholder = input.placeholder?.toLowerCase() || ''
      const autocomplete = input.autocomplete?.toLowerCase() || ''

      // Detect username/email field
      if (
        type === 'email' ||
        (type === 'text' &&
          (name.includes('user') ||
            name.includes('email') ||
            name.includes('login') ||
            id.includes('user') ||
            id.includes('email') ||
            id.includes('login') ||
            placeholder.includes('email') ||
            placeholder.includes('username') ||
            autocomplete.includes('username') ||
            autocomplete.includes('email')))
      ) {
        if (!usernameField) {
          usernameField = input as HTMLInputElement
        }
      }

      // Detect password field
      if (type === 'password') {
        passwordField = input as HTMLInputElement
      }
    })

    if (usernameField && passwordField) {
      detectedForms.push({
        form,
        usernameField,
        passwordField,
        domain,
      })
    }
  })

  return detectedForms
}

function showNotification(message: string, type: 'error' | 'info' | 'success' = 'info') {
  // Remove existing notification if any
  const existing = document.querySelector('.safekey-notification')
  if (existing) {
    existing.remove()
  }

  const notification = document.createElement('div')
  notification.className = 'safekey-notification'
  notification.textContent = message
  notification.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    background: ${type === 'error' ? '#ff4444' : type === 'success' ? '#bfff0b' : '#4a90e2'};
    color: ${type === 'success' ? '#0a0a0a' : '#ffffff'};
    padding: 1rem 1.5rem;
    border-radius: 0.5rem;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
    z-index: 100000;
    font-size: 0.9rem;
    font-weight: 500;
    max-width: 400px;
    font-family: 'Satoshi', -apple-system, BlinkMacSystemFont, sans-serif;
    animation: slideIn 0.3s ease;
  `

  // Add animation
  const style = document.createElement('style')
  style.textContent = `
    @keyframes slideIn {
      from {
        transform: translateX(100%);
        opacity: 0;
      }
      to {
        transform: translateX(0);
        opacity: 1;
      }
    }
  `
  if (!document.head.querySelector('style[data-safekey-notification]')) {
    style.setAttribute('data-safekey-notification', 'true')
    document.head.appendChild(style)
  }

  document.body.appendChild(notification)

  // Auto-remove after 5 seconds
  setTimeout(() => {
    notification.style.animation = 'slideIn 0.3s ease reverse'
    setTimeout(() => {
      notification.remove()
    }, 300)
  }, 5000)
}

function showAutofillButton(form: DetectedForm, credential: Credential) {
  console.log('[Form Detector] showAutofillButton called for domain:', credential.domain)
  
  // Remove existing button if any
  const existingButton = document.querySelector('.safekey-autofill-btn')
  if (existingButton) {
    console.log('[Form Detector] Removing existing autofill button')
    existingButton.remove()
  }

  // Create button
  const button = document.createElement('button')
  button.className = 'safekey-autofill-btn'
  
  // Create lock icon SVG
  const lockIcon = `
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 0.5rem;">
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
      <circle cx="12" cy="16" r="1"/>
      <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
    </svg>
  `
  button.innerHTML = `${lockIcon}Fill with SafeKey`
  button.style.cssText = `
    position: fixed;
    background: #bfff0b;
    color: #0a0a0a;
    border: 2px solid #0a0a0a;
    padding: 0.75rem 1.25rem;
    border-radius: 0.5rem;
    cursor: pointer;
    font-size: 0.9rem;
    font-weight: 600;
    z-index: 999999;
    box-shadow: 0 4px 12px rgba(191, 255, 11, 0.5);
    font-family: 'Satoshi', -apple-system, BlinkMacSystemFont, sans-serif;
    transition: all 0.3s ease;
    display: flex;
    align-items: center;
    justify-content: center;
  `

  // Position button near password field (use fixed positioning for better visibility)
  const rect = form.passwordField.getBoundingClientRect()
  button.style.top = `${rect.top + window.scrollY - 50}px`
  button.style.left = `${rect.left + window.scrollX}px`
  
  console.log('[Form Detector] Button positioned at:', { top: button.style.top, left: button.style.left })

  // Hover effects
  button.addEventListener('mouseenter', () => {
    button.style.transform = 'translateY(-2px)'
    button.style.boxShadow = '0 6px 16px rgba(191, 255, 11, 0.4)'
  })
  button.addEventListener('mouseleave', () => {
    button.style.transform = 'translateY(0)'
    button.style.boxShadow = '0 4px 12px rgba(191, 255, 11, 0.3)'
  })

  // Click handler
  button.addEventListener('click', (e) => {
    e.preventDefault()
    e.stopPropagation()
    form.usernameField.value = credential.username
    form.passwordField.value = credential.password
    button.remove()
  })

  document.body.appendChild(button)
  console.log('[Form Detector] Autofill button added to DOM')
  
  // Also add a scroll/resize listener to update button position
  const updatePosition = () => {
    const newRect = form.passwordField.getBoundingClientRect()
    button.style.top = `${newRect.top + window.scrollY - 50}px`
    button.style.left = `${newRect.left + window.scrollX}px`
  }
  
  window.addEventListener('scroll', updatePosition, { passive: true })
  window.addEventListener('resize', updatePosition, { passive: true })
  
  // Clean up listeners when button is removed
  const originalRemove = button.remove.bind(button)
  button.remove = () => {
    window.removeEventListener('scroll', updatePosition)
    window.removeEventListener('resize', updatePosition)
    originalRemove()
  }
}

function showCredentialSelector(form: DetectedForm, credentials: Credential[]) {
  console.log('[Form Detector] showCredentialSelector called with', credentials.length, 'credentials')
  
  // Remove existing selector if any
  const existingSelector = document.querySelector('.safekey-credential-selector')
  if (existingSelector) {
    console.log('[Form Detector] Removing existing credential selector')
    existingSelector.remove()
  }

  // Create selector modal/dropdown
  const selector = document.createElement('div')
  selector.className = 'safekey-credential-selector'
  selector.style.cssText = `
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    background: #0a0a0a;
    border: 1px solid rgba(191, 255, 11, 0.3);
    border-radius: 0.75rem;
    padding: 1.5rem;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.8);
    z-index: 10001;
    max-width: 400px;
    max-height: 80vh;
    overflow-y: auto;
    font-family: 'Satoshi', -apple-system, BlinkMacSystemFont, sans-serif;
    color: #ffffff;
  `

  // Header
  const header = document.createElement('div')
  header.style.cssText = `
    font-family: 'JetBrains Mono', monospace;
    font-size: 0.75rem;
    color: rgba(255, 255, 255, 0.5);
    margin-bottom: 0.5rem;
    letter-spacing: 0.05em;
  `
  header.textContent = '/// MULTIPLE ACCOUNTS'

  // Title
  const title = document.createElement('div')
  title.style.cssText = `
    font-weight: 700;
    margin-bottom: 1rem;
    font-size: 1.1rem;
    color: #bfff0b;
  `
  title.textContent = `Select Account for ${form.domain}`

  // Credentials list
  const credentialsList = document.createElement('div')
  credentialsList.style.cssText = `
    margin-bottom: 1rem;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  `

  credentials.forEach((cred) => {
    const credButton = document.createElement('button')
    credButton.style.cssText = `
      padding: 0.75rem;
      background: rgba(191, 255, 11, 0.1);
      border: 1px solid rgba(191, 255, 11, 0.2);
      border-radius: 0.5rem;
      color: rgba(255, 255, 255, 0.9);
      cursor: pointer;
      font-family: 'Satoshi', sans-serif;
      font-size: 0.9rem;
      text-align: left;
      transition: all 0.3s ease;
      display: flex;
      flex-direction: column;
      gap: 0.25rem;
    `

    const username = document.createElement('div')
    username.style.color = '#bfff0b'
    username.style.fontWeight = '600'
    username.textContent = cred.username

    const domain = document.createElement('div')
    domain.style.fontSize = '0.8rem'
    domain.style.color = 'rgba(255, 255, 255, 0.5)'
    domain.textContent = cred.domain

    credButton.appendChild(username)
    credButton.appendChild(domain)

    // Hover effect
    credButton.addEventListener('mouseenter', () => {
      credButton.style.background = 'rgba(191, 255, 11, 0.2)'
      credButton.style.borderColor = 'rgba(191, 255, 11, 0.5)'
    })
    credButton.addEventListener('mouseleave', () => {
      credButton.style.background = 'rgba(191, 255, 11, 0.1)'
      credButton.style.borderColor = 'rgba(191, 255, 11, 0.2)'
    })

    // Click handler - autofill with this credential
    credButton.addEventListener('click', (e) => {
      e.preventDefault()
      e.stopPropagation()
      console.log('[Form Detector] Selected credential:', cred.username)
      form.usernameField.value = cred.username
      form.passwordField.value = cred.password
      selector.remove()
      showNotification(`Autofilled with ${cred.username}`, 'success')
    })

    credentialsList.appendChild(credButton)
  })

  // Cancel button
  const cancelBtn = document.createElement('button')
  cancelBtn.textContent = 'Cancel'
  cancelBtn.style.cssText = `
    width: 100%;
    padding: 0.75rem;
    background: transparent;
    border: 1px solid rgba(255, 255, 255, 0.2);
    color: rgba(255, 255, 255, 0.8);
    border-radius: 0.5rem;
    cursor: pointer;
    font-family: 'Satoshi', sans-serif;
    font-size: 0.9rem;
    transition: all 0.3s ease;
  `

  cancelBtn.addEventListener('mouseenter', () => {
    cancelBtn.style.background = 'rgba(255, 255, 255, 0.05)'
    cancelBtn.style.borderColor = 'rgba(255, 255, 255, 0.3)'
  })
  cancelBtn.addEventListener('mouseleave', () => {
    cancelBtn.style.background = 'transparent'
    cancelBtn.style.borderColor = 'rgba(255, 255, 255, 0.2)'
  })

  cancelBtn.addEventListener('click', (e) => {
    e.preventDefault()
    e.stopPropagation()
    selector.remove()
  })

  // Assemble selector
  selector.appendChild(header)
  selector.appendChild(title)
  selector.appendChild(credentialsList)
  selector.appendChild(cancelBtn)

  document.body.appendChild(selector)
  console.log('[Form Detector] Credential selector added to DOM')

  // Close on escape key
  const handleEscape = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      selector.remove()
      document.removeEventListener('keydown', handleEscape)
    }
  }
  document.addEventListener('keydown', handleEscape)
}

function showSavePrompt(form: DetectedForm, isNewForm: boolean = false) {
  // Remove existing prompt if any
  const existingPrompt = document.querySelector('.safekey-save-prompt')
  if (existingPrompt) {
    existingPrompt.remove()
  }

  const username = form.usernameField.value
  const password = form.passwordField.value

  if (!username || !password) {
    return
  }

  // Add styles if not already added
  if (!document.getElementById('safekey-styles')) {
    const style = document.createElement('style')
    style.id = 'safekey-styles'
    style.textContent = `
      @import url('https://fonts.googleapis.com/css2?family=Satoshi:wght@400;500;700;900&family=JetBrains+Mono:wght@400;500&display=swap');
      @keyframes slideIn {
        from {
          transform: translateX(100%);
          opacity: 0;
        }
        to {
          transform: translateX(0);
          opacity: 1;
        }
      }
    `
    document.head.appendChild(style)
  }

  // Create prompt
  const prompt = document.createElement('div')
  prompt.className = 'safekey-save-prompt'
  prompt.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    background: #0a0a0a;
    border: 1px solid rgba(191, 255, 11, 0.3);
    border-radius: 0.75rem;
    padding: 1.5rem;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
    z-index: 10001;
    max-width: 360px;
    animation: slideIn 0.3s ease-out;
    font-family: 'Satoshi', -apple-system, BlinkMacSystemFont, sans-serif;
    color: #ffffff;
  `

  const title = isNewForm 
    ? 'New Login Detected' 
    : 'Update Credentials?'
  const message = isNewForm
    ? `Save credentials for ${form.domain}?`
    : `Update saved credentials for ${form.domain}?`

  prompt.innerHTML = `
    <div style="font-family: 'JetBrains Mono', monospace; font-size: 0.75rem; color: rgba(255, 255, 255, 0.5); margin-bottom: 0.5rem; letter-spacing: 0.05em;">/// SAFEKEY</div>
    <div style="font-weight: 700; margin-bottom: 0.5rem; font-size: 1.1rem; color: #bfff0b;">${title}</div>
    <div style="font-size: 0.9rem; color: rgba(255, 255, 255, 0.7); margin-bottom: 1rem; line-height: 1.5;">${message}</div>
    <div style="font-size: 0.85rem; color: rgba(255, 255, 255, 0.6); margin-bottom: 1rem; padding: 0.75rem; background: rgba(255, 255, 255, 0.03); border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 0.5rem;">
      <div style="margin-bottom: 0.25rem;"><strong style="color: #bfff0b;">Username:</strong> <span style="font-family: 'JetBrains Mono', monospace;">${username}</span></div>
      <div><strong style="color: #bfff0b;">Domain:</strong> <span style="font-family: 'JetBrains Mono', monospace;">${form.domain}</span></div>
    </div>
    <div style="display: flex; gap: 0.75rem;">
      <button class="safekey-save-yes" style="flex: 1; padding: 0.75rem; background: #bfff0b; color: #0a0a0a; border: none; border-radius: 0.5rem; cursor: pointer; font-weight: 700; font-size: 0.9rem; font-family: 'Satoshi', sans-serif; transition: all 0.3s ease;">Save</button>
      <button class="safekey-save-no" style="flex: 1; padding: 0.75rem; background: transparent; border: 1px solid rgba(255, 255, 255, 0.2); color: rgba(255, 255, 255, 0.8); border-radius: 0.5rem; cursor: pointer; font-size: 0.9rem; font-family: 'Satoshi', sans-serif; transition: all 0.3s ease;">Cancel</button>
    </div>
  `

  // Add hover effects to buttons
  const saveBtn = prompt.querySelector('.safekey-save-yes') as HTMLButtonElement
  const cancelBtn = prompt.querySelector('.safekey-save-no') as HTMLButtonElement

  if (saveBtn) {
    saveBtn.addEventListener('mouseenter', () => {
      saveBtn.style.transform = 'translateY(-2px)'
      saveBtn.style.boxShadow = '0 4px 12px rgba(191, 255, 11, 0.3)'
    })
    saveBtn.addEventListener('mouseleave', () => {
      saveBtn.style.transform = 'translateY(0)'
      saveBtn.style.boxShadow = 'none'
    })
  }

  if (cancelBtn) {
    cancelBtn.addEventListener('mouseenter', () => {
      cancelBtn.style.background = 'rgba(255, 255, 255, 0.05)'
      cancelBtn.style.borderColor = 'rgba(255, 255, 255, 0.3)'
    })
    cancelBtn.addEventListener('mouseleave', () => {
      cancelBtn.style.background = 'transparent'
      cancelBtn.style.borderColor = 'rgba(255, 255, 255, 0.2)'
    })
  }

  // Event handlers
  prompt.querySelector('.safekey-save-yes')?.addEventListener('click', async () => {
    prompt.innerHTML = '<div style="color: rgba(255, 255, 255, 0.7); text-align: center; padding: 1rem; font-family: \'Satoshi\', sans-serif;">Saving...</div>'
    
    console.log('[Form Detector] Saving credential for:', form.domain)
    const result = await saveCredential({
      domain: form.domain,
      username,
      password,
    })

    if (result.success) {
      prompt.innerHTML = `
        <div style="color: #bfff0b; text-align: center; padding: 1rem; font-family: 'Satoshi', sans-serif;">
          <div style="font-weight: 700; margin-bottom: 0.5rem;">Saved successfully!</div>
          <div style="font-size: 0.85rem; color: rgba(255, 255, 255, 0.6);">Credential queued for blockchain storage</div>
        </div>
      `
      setTimeout(() => {
        prompt.remove()
        form.form.submit()
      }, 1500)
    } else {
      const errorMsg = result.error || 'Unknown error occurred'
      console.error('[Form Detector] Save failed:', errorMsg)
      
      prompt.innerHTML = `
        <div style="font-family: 'JetBrains Mono', monospace; font-size: 0.75rem; color: rgba(255, 255, 255, 0.5); margin-bottom: 0.5rem; letter-spacing: 0.05em;">/// ERROR</div>
        <div style="color: rgba(191, 255, 11, 0.8); text-align: center; padding: 0.5rem 0; margin-bottom: 1rem; font-weight: 600;">
          Failed to save
        </div>
        <div style="font-size: 0.85rem; color: rgba(255, 255, 255, 0.6); margin-bottom: 1rem; padding: 0.75rem; background: rgba(255, 255, 255, 0.03); border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 0.5rem; word-break: break-word; line-height: 1.5;">
          ${errorMsg}
        </div>
        <div style="display: flex; gap: 0.75rem;">
          <button class="safekey-retry-btn" style="flex: 1; padding: 0.75rem; background: #bfff0b; color: #0a0a0a; border: none; border-radius: 0.5rem; cursor: pointer; font-weight: 700; font-size: 0.9rem; font-family: 'Satoshi', sans-serif; transition: all 0.3s ease;">Retry</button>
          <button class="safekey-submit-anyway-btn" style="flex: 1; padding: 0.75rem; background: transparent; border: 1px solid rgba(255, 255, 255, 0.2); color: rgba(255, 255, 255, 0.8); border-radius: 0.5rem; cursor: pointer; font-size: 0.9rem; font-family: 'Satoshi', sans-serif; transition: all 0.3s ease;">Submit Anyway</button>
        </div>
      `
      
      // Add hover effects
      const retryBtn = prompt.querySelector('.safekey-retry-btn') as HTMLButtonElement
      const submitBtn = prompt.querySelector('.safekey-submit-anyway-btn') as HTMLButtonElement

      if (retryBtn) {
        retryBtn.addEventListener('mouseenter', () => {
          retryBtn.style.transform = 'translateY(-2px)'
          retryBtn.style.boxShadow = '0 4px 12px rgba(191, 255, 11, 0.3)'
        })
        retryBtn.addEventListener('mouseleave', () => {
          retryBtn.style.transform = 'translateY(0)'
          retryBtn.style.boxShadow = 'none'
        })
      }

      if (submitBtn) {
        submitBtn.addEventListener('mouseenter', () => {
          submitBtn.style.background = 'rgba(255, 255, 255, 0.05)'
          submitBtn.style.borderColor = 'rgba(255, 255, 255, 0.3)'
        })
        submitBtn.addEventListener('mouseleave', () => {
          submitBtn.style.background = 'transparent'
          submitBtn.style.borderColor = 'rgba(255, 255, 255, 0.2)'
        })
      }
      
      // Retry button
      prompt.querySelector('.safekey-retry-btn')?.addEventListener('click', async () => {
        prompt.innerHTML = '<div style="color: rgba(255, 255, 255, 0.7); text-align: center; padding: 1rem; font-family: \'Satoshi\', sans-serif;">Saving...</div>'
        console.log('[Form Detector] Retrying save for:', form.domain)
        const retryResult = await saveCredential({
          domain: form.domain,
          username,
          password,
        })
        if (retryResult.success) {
          prompt.innerHTML = `
            <div style="color: #bfff0b; text-align: center; padding: 1rem; font-family: 'Satoshi', sans-serif;">
              <div style="font-weight: 700; margin-bottom: 0.5rem;">Saved!</div>
              <div style="font-size: 0.85rem; color: rgba(255, 255, 255, 0.6);">Credential queued for blockchain storage</div>
            </div>
          `
          setTimeout(() => {
            prompt.remove()
            form.form.submit()
          }, 1500)
        } else {
          const retryErrorMsg = retryResult.error || 'Unknown error'
          console.error('[Form Detector] Retry failed:', retryErrorMsg)
          prompt.innerHTML = `
            <div style="font-family: 'JetBrains Mono', monospace; font-size: 0.75rem; color: rgba(255, 255, 255, 0.5); margin-bottom: 0.5rem; letter-spacing: 0.05em;">/// ERROR</div>
            <div style="color: rgba(191, 255, 11, 0.8); text-align: center; padding: 0.5rem 0; margin-bottom: 1rem; font-weight: 600;">
              Still failed
            </div>
            <div style="font-size: 0.85rem; color: rgba(255, 255, 255, 0.6); margin-bottom: 1rem; padding: 0.75rem; background: rgba(255, 255, 255, 0.03); border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 0.5rem; word-break: break-word; line-height: 1.5;">
              ${retryErrorMsg}
            </div>
            <button class="safekey-submit-anyway-btn" style="width: 100%; padding: 0.75rem; background: transparent; border: 1px solid rgba(255, 255, 255, 0.2); color: rgba(255, 255, 255, 0.8); border-radius: 0.5rem; cursor: pointer; font-size: 0.9rem; font-family: 'Satoshi', sans-serif; transition: all 0.3s ease;">Submit Anyway</button>
          `
          const finalSubmitBtn = prompt.querySelector('.safekey-submit-anyway-btn') as HTMLButtonElement
          if (finalSubmitBtn) {
            finalSubmitBtn.addEventListener('mouseenter', () => {
              finalSubmitBtn.style.background = 'rgba(255, 255, 255, 0.05)'
              finalSubmitBtn.style.borderColor = 'rgba(255, 255, 255, 0.3)'
            })
            finalSubmitBtn.addEventListener('mouseleave', () => {
              finalSubmitBtn.style.background = 'transparent'
              finalSubmitBtn.style.borderColor = 'rgba(255, 255, 255, 0.2)'
            })
          }
          prompt.querySelector('.safekey-submit-anyway-btn')?.addEventListener('click', () => {
            prompt.remove()
            form.form.submit()
          })
        }
      })
      
      // Submit anyway button
      prompt.querySelector('.safekey-submit-anyway-btn')?.addEventListener('click', () => {
        prompt.remove()
        form.form.submit()
      })
    }
  })

  prompt.querySelector('.safekey-save-no')?.addEventListener('click', () => {
    prompt.remove()
  })

  document.body.appendChild(prompt)
  
  // Auto-remove after 30 seconds if not interacted
  setTimeout(() => {
    if (document.body.contains(prompt)) {
      prompt.remove()
    }
  }, 30000)
}

const processedForms = new WeakSet<HTMLFormElement>()
const credentialCheckCache = new Map<string, { result: { success: boolean; exists: boolean; error?: string }; timestamp: number }>()
const CACHE_TTL = 30000

// Global flag to prevent multiple simultaneous initializations
let isInitializing = false

export async function initFormDetection() {
  // Prevent multiple simultaneous runs
  if (isInitializing) {
    console.log('[Form Detector] Already initializing, skipping duplicate call')
    return
  }

  isInitializing = true

  try {
    const forms = detectLoginForms()

    if (forms.length === 0) {
      return
    }

    const domain = getDomain()

  // Check cache first
  const cached = credentialCheckCache.get(domain)
  const now = Date.now()
  let checkResult: { success: boolean; exists: boolean; error?: string }
  
  if (cached && (now - cached.timestamp) < CACHE_TTL) {
    // Use cached result
    checkResult = cached.result
    console.log('[Form Detector] Using cached credential check for:', domain)
  } else {
    // Check if credential exists for this domain
    checkResult = await checkCredentialExists(domain)
    // Cache the result
    credentialCheckCache.set(domain, { result: checkResult, timestamp: now })
  }
  
  // Show error notification if check failed
  if (!checkResult.success && checkResult.error) {
    console.warn('[Form Detector] Failed to check credential:', checkResult.error)
    // Show a subtle notification to user (non-intrusive)
    showNotification(checkResult.error, 'error')
  }

  forms.forEach((form) => {
    // Skip if already processed
    if (processedForms.has(form.form)) {
      return
    }
    processedForms.add(form.form)

    if (checkResult.success && checkResult.exists) {
      // Get credentials and show appropriate UI
      console.log('[Form Detector] Credential EXISTS for domain, fetching details:', domain)
      console.log('[Form Detector] Calling getCredentials for:', domain)
      
      getCredentials(domain)
        .then((result) => {
          console.log('[Form Detector] 📦 Get credentials result:', JSON.stringify(result, null, 2))
          
          if (result.success && result.credentials && result.credentials.length > 0) {
            console.log('[Form Detector] Retrieved', result.credentials.length, 'credential(s)!')
            
            // Show appropriate UI based on number of credentials
            if (result.credentials.length === 1) {
              // Single credential - show autofill button
              console.log('[Form Detector] 🎯 Single credential, showing autofill button...')
              showAutofillButton(form, result.credentials[0])
              showNotification(`SafeKey: Credential found for ${domain}`, 'success')
            } else {
              // Multiple credentials - show selector
              console.log('[Form Detector] 🎯 Multiple credentials, showing selector...')
              showCredentialSelector(form, result.credentials)
              showNotification(`SafeKey: ${result.credentials.length} accounts found for ${domain}`, 'success')
            }
          } else if (result.success && (!result.credentials || result.credentials.length === 0)) {
            console.warn('[Form Detector] Credential check said exists but getCredentials returned empty for:', domain)
            console.warn('[Form Detector] This might indicate a data inconsistency')
          } else if (!result.success && result.error) {
            console.error('[Form Detector] Failed to get credentials:', result.error)
            showNotification(result.error, 'error')
          } else {
            console.warn('[Form Detector] Unexpected result format:', result)
          }
        })
        .catch((error) => {
          console.error('[Form Detector] Error in getCredentials promise:', error)
          console.error('[Form Detector] Error stack:', error.stack)
        })
    } else {
      console.log('[Form Detector] ℹ️ No credential found for domain:', domain, 'checkResult:', checkResult)
    }

    // Listen for form submission to show save/update prompt
    // This is the ONLY place we show save prompts (no time-based detection)
    form.form.addEventListener('submit', async (e) => {
      const username = form.usernameField.value
      const password = form.passwordField.value
      
      if (!username || !password) {
        return // Let form submit normally
      }

      // Prevent form submission temporarily
      e.preventDefault()
      e.stopPropagation()

      // Check if credential exists and if it's different
      const currentCheckResult = await checkCredentialExists(domain)
      
      if (!currentCheckResult.success) {
        // Error checking - show error and submit form normally
        if (currentCheckResult.error) {
          showNotification(currentCheckResult.error, 'error')
        }
        form.form.submit()
        return
      }
      
      if (currentCheckResult.exists) {
        // Credential exists - check if it's different
        const getResult = await getCredential(domain)
        if (getResult.success && getResult.credential) {
          const savedCred = getResult.credential
          if (savedCred.password !== password || savedCred.username !== username) {
            // Credentials changed - show update prompt
            showSavePrompt(form, false)
          } else {
            // No change - submit form normally
            form.form.submit()
          }
        } else {
          // Error getting credential - submit form normally
          if (getResult.error) {
            showNotification(getResult.error, 'error')
          }
          form.form.submit()
        }
      } else {
        // No credential exists - show save prompt for new credential
        showSavePrompt(form, true)
      }
    }, true) // Use capture phase to intercept before form submits
  })
  } finally {
    // Always reset the initialization flag
    isInitializing = false
  }
}

let debounceTimer: number | null = null
const DEBOUNCE_DELAY = 1000

function debouncedInitFormDetection() {
  if (debounceTimer !== null) {
    clearTimeout(debounceTimer)
  }
  debounceTimer = window.setTimeout(() => {
    initFormDetection()
    debounceTimer = null
  }, DEBOUNCE_DELAY)
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initFormDetection)
} else {
  initFormDetection()
}

const observer = new MutationObserver(() => {
  debouncedInitFormDetection()
})

observer.observe(document.body, {
  childList: true,
  subtree: true,
})
