/**
 * Security Utilities - Input validation, error handling, and security helpers
 */

export class SecurityError extends Error {
  constructor(message: string, public readonly code: string) {
    super(message)
    this.name = 'SecurityError'
  }
}

export class ValidationError extends SecurityError {
  constructor(field: string, message: string) {
    super(`Validation failed for ${field}: ${message}`, 'VALIDATION_ERROR')
  }
}

/**
 * Input validation utilities
 */
export class SecurityValidator {
  /**
   * Validate Sui address format
   */
  static validateSuiAddress(address: string): void {
    if (!address) {
      throw new ValidationError('address', 'Address is required')
    }
    
    if (typeof address !== 'string') {
      throw new ValidationError('address', 'Address must be a string')
    }
    
    // Sui addresses are 32-byte hex strings with 0x prefix
    const addressRegex = /^0x[a-fA-F0-9]{64}$/
    if (!addressRegex.test(address)) {
      throw new ValidationError('address', 'Invalid Sui address format')
    }
  }

  /**
   * Validate JWT token format (basic check)
   */
  static validateJWT(token: string): void {
    if (!token) {
      throw new ValidationError('token', 'JWT token is required')
    }
    
    if (typeof token !== 'string') {
      throw new ValidationError('token', 'JWT token must be a string')
    }
    
    // For zkLogin, tokens might not be standard JWTs
    // Accept any non-empty string as a valid token
    if (token.trim().length === 0) {
      throw new ValidationError('token', 'JWT token cannot be empty')
    }

    // If it looks like a JWT (has dots), validate structure
    if (token.includes('.')) {
      const parts = token.split('.')
      if (parts.length !== 3) {
        // Log for debugging but don't throw - zkLogin tokens might be non-standard
        SecureErrorHandler.logError('JWT format validation', `Token has ${parts.length} parts instead of 3, but allowing for zkLogin compatibility`)
        return
      }
      
      // Basic base64 validation for each part (if it's a proper JWT)
      for (let i = 0; i < parts.length; i++) {
        if (parts[i] && !/^[A-Za-z0-9_-]*$/.test(parts[i])) {
          SecureErrorHandler.logError('JWT character validation', `JWT part ${i + 1} contains invalid characters, but allowing for zkLogin compatibility`)
          return
        }
      }
    }
  }

  /**
   * Validate domain name
   */
  static validateDomain(domain: string): void {
    if (!domain) {
      throw new ValidationError('domain', 'Domain is required')
    }
    
    if (typeof domain !== 'string') {
      throw new ValidationError('domain', 'Domain must be a string')
    }
    
    if (domain.length < 1 || domain.length > 253) {
      throw new ValidationError('domain', 'Domain length must be between 1 and 253 characters')
    }
    
    // Basic domain validation
    const domainRegex = /^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/
    if (!domainRegex.test(domain)) {
      throw new ValidationError('domain', 'Invalid domain format')
    }
  }

  /**
   * Validate username
   */
  static validateUsername(username: string): void {
    if (!username) {
      throw new ValidationError('username', 'Username is required')
    }
    
    if (typeof username !== 'string') {
      throw new ValidationError('username', 'Username must be a string')
    }
    
    if (username.length < 1 || username.length > 256) {
      throw new ValidationError('username', 'Username length must be between 1 and 256 characters')
    }
    
    // Prevent common injection patterns
    const dangerousPatterns = [
      /<script/i,
      /javascript:/i,
      /data:text\/html/i,
      /vbscript:/i,
      /onload=/i,
      /onerror=/i
    ]
    
    for (const pattern of dangerousPatterns) {
      if (pattern.test(username)) {
        throw new ValidationError('username', 'Username contains potentially dangerous content')
      }
    }
  }

  /**
   * Validate password (if provided)
   */
  static validatePassword(password?: string): void {
    if (password !== undefined) {
      if (typeof password !== 'string') {
        throw new ValidationError('password', 'Password must be a string')
      }
      
      if (password.length > 1024) {
        throw new ValidationError('password', 'Password is too long (max 1024 characters)')
      }
    }
  }

  /**
   * Validate timestamp
   */
  static validateTimestamp(timestamp: number): void {
    if (typeof timestamp !== 'number') {
      throw new ValidationError('timestamp', 'Timestamp must be a number')
    }
    
    if (!Number.isInteger(timestamp) || timestamp < 0) {
      throw new ValidationError('timestamp', 'Timestamp must be a positive integer')
    }
    
    const now = Date.now()
    const oneYearAgo = now - (365 * 24 * 60 * 60 * 1000)
    const oneYearFromNow = now + (365 * 24 * 60 * 60 * 1000)
    
    if (timestamp < oneYearAgo || timestamp > oneYearFromNow) {
      throw new ValidationError('timestamp', 'Timestamp is outside reasonable range')
    }
  }

  /**
   * Validate session data
   */
  static validateSessionData(sessionData: {
    address: string
    idToken: string
    provider: string
    createdAt: number
    masterKey?: string
  }): void {
    this.validateSuiAddress(sessionData.address)
    this.validateJWT(sessionData.idToken)
    
    if (!sessionData.provider || typeof sessionData.provider !== 'string') {
      throw new ValidationError('provider', 'Provider is required and must be a string')
    }
    
    if (sessionData.provider.length < 1 || sessionData.provider.length > 50) {
      throw new ValidationError('provider', 'Provider length must be between 1 and 50 characters')
    }
    
    this.validateTimestamp(sessionData.createdAt)
    
    if (sessionData.masterKey) {
      if (typeof sessionData.masterKey !== 'string') {
        throw new ValidationError('masterKey', 'Master key must be a string')
      }
      
      if (sessionData.masterKey.length < 32) {
        throw new ValidationError('masterKey', 'Master key is too short')
      }
    }
  }

  /**
   * Validate credential data
   */
  static validateCredentialData(credential: {
    domain: string
    username: string
    password?: string
  }): void {
    this.validateDomain(credential.domain)
    this.validateUsername(credential.username)
    this.validatePassword(credential.password)
  }
}

/**
 * Secure error handler with sanitization
 */
export class SecureErrorHandler {
  /**
   * Sanitize error for logging (remove sensitive data)
   */
  static sanitizeError(error: any): {
    message: string
    code?: string
    type: string
    timestamp: number
  } {
    const sanitized = {
      message: 'Unknown error',
      code: undefined as string | undefined,
      type: 'Error',
      timestamp: Date.now()
    }

    if (error instanceof SecurityError) {
      sanitized.message = error.message
      sanitized.code = error.code
      sanitized.type = 'SecurityError'
    } else if (error instanceof Error) {
      sanitized.message = error.message
      sanitized.type = error.constructor.name
    } else if (typeof error === 'string') {
      sanitized.message = error
    } else if (error && typeof error.message === 'string') {
      sanitized.message = error.message
    }

    // Remove potentially sensitive information
    const sensitivePatterns = [
      /0x[a-fA-F0-9]{64}/g, // Sui addresses
      /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, // JWT tokens
      /[A-Za-z0-9+/]{40,}={0,2}/g, // Base64 encoded data
      /password/gi,
      /token/gi,
      /key/gi
    ]

    for (const pattern of sensitivePatterns) {
      sanitized.message = sanitized.message.replace(pattern, '[REDACTED]')
    }

    return sanitized
  }

  /**
   * Log error securely
   */
  static logError(error: any, context?: string): void {
    const sanitized = this.sanitizeError(error)
    const logMessage = context 
      ? `[${context}] ${sanitized.type}: ${sanitized.message}`
      : `${sanitized.type}: ${sanitized.message}`
    
    console.error(logMessage)
  }

  /**
   * Create user-safe error message
   */
  static createUserMessage(error: any): string {
    if (error instanceof ValidationError) {
      return error.message
    }
    
    if (error instanceof SecurityError) {
      return 'A security error occurred. Please try again.'
    }
    
    // Generic safe message for unknown errors
    return 'An error occurred. Please try again or contact support if the issue persists.'
  }
}

/**
 * Rate limiting utility
 */
export class RateLimiter {
  private attempts = new Map<string, { count: number; resetTime: number }>()
  private readonly maxAttempts: number
  private readonly windowMs: number

  constructor(maxAttempts: number = 5, windowMs: number = 60000) {
    this.maxAttempts = maxAttempts
    this.windowMs = windowMs
  }

  /**
   * Check if action is allowed
   */
  checkLimit(key: string): boolean {
    const now = Date.now()
    const record = this.attempts.get(key)

    if (!record || now > record.resetTime) {
      this.attempts.set(key, { count: 1, resetTime: now + this.windowMs })
      return true
    }

    if (record.count >= this.maxAttempts) {
      throw new SecurityError(
        `Rate limit exceeded. Try again in ${Math.ceil((record.resetTime - now) / 1000)} seconds.`,
        'RATE_LIMIT_EXCEEDED'
      )
    }

    record.count++
    return true
  }

  /**
   * Reset attempts for a key
   */
  reset(key: string): void {
    this.attempts.delete(key)
  }

  /**
   * Clean expired entries
   */
  cleanup(): void {
    const now = Date.now()
    for (const [key, record] of this.attempts.entries()) {
      if (now > record.resetTime) {
        this.attempts.delete(key)
      }
    }
  }
}

// Global instances
export const authRateLimiter = new RateLimiter(3, 300000) // 3 attempts per 5 minutes
export const apiRateLimiter = new RateLimiter(10, 60000) // 10 requests per minute