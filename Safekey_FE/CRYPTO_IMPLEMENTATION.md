# SafeKey Crypto Implementation

## What was implemented

All crypto functions are in `src/lib/crypto.ts`:

### Core Functions

1. **`generateNonce(length?)`** → base64 string
   - Generates cryptographically secure random nonce
   - Default 12 bytes (96 bits) for GCM IV

2. **`generateSessionNonce()`** → base64 string
   - 16-byte (128-bit) session nonce for key derivation

3. **`generateRandomKey(length?)`** → base64 string
   - Generate random encryption keys (default 32 bytes = 256-bit)

4. **`deriveKS(KM, sessionNonce)`** → Promise<base64 string>
   - Derive session key from master key using HKDF-SHA256
   - **Input:** KM (base64), sessionNonce (base64)
   - **Output:** KS session key (base64)
   - Pattern: `KS = HKDF-SHA256(KM, info=sessionNonce, salt=empty, length=32 bytes)`

5. **`encrypt(data, key)`** → Promise<string>
   - AES-256-GCM symmetric encryption
   - **Input:** data (string), key (base64)
   - **Output:** encrypted data as `"iv.ciphertext"` (both base64)
   - Generates random IV per encryption

6. **`decrypt(encryptedData, key)`** → Promise<string>
   - AES-256-GCM symmetric decryption
   - **Input:** encrypted data (`"iv.ciphertext"`), key (base64)
   - **Output:** plaintext string

7. **`hashDomain(domain, KM)`** → Promise<base64 string>
   - HMAC-SHA256(KM, domain)
   - Produces deterministic hash of domain using master key
   - Useful for site-specific derived passwords

8. **`deriveKey(KM, info, salt?, length?)`** → Promise<base64 string>
   - General HKDF-SHA256 key derivation
   - **Input:** master key, context info (e.g., "encryption" or "signing")
   - Derive different keys for different purposes from same master

### Helper Functions

- **`base64Encode(bytes)`** / **`base64Decode(str)`** - Uint8Array ↔ base64
- **`hexToBytes(hex)`** / **`bytesToHex(bytes)`** - Hex string ↔ Uint8Array

---

## How to use

### Example: Full Setup Workflow

```typescript
import { generateRandomKey, deriveKS, encrypt, decrypt, hashDomain } from '../lib/crypto'

// 1. Generate master key (user's passphrase is normally used, but for demo:)
const KM = generateRandomKey(32) // "base64string..."

// 2. Create session with nonce
const sessionNonce = generateSessionNonce() // "nonce_base64..."
const KS = await deriveKS(KM, sessionNonce) // "session_key_base64..."

// 3. Encrypt a password
const password = "MyPassword123"
const encrypted = await encrypt(password, KS)
// Output: "iv_base64.ciphertext_base64"

// 4. Decrypt later
const decrypted = await decrypt(encrypted, KS) // "MyPassword123"

// 5. Hash domain for site-specific vault
const domainHash = await hashDomain("example.com", KM)
```

---

## Integration with Extension

The background worker (`src/background/background.ts`) now includes message handlers:

- `INIT_SESSION` - Initialize with master key, set `KM` in session state
- `LOCK_SESSION` - Clear session state, lock the extension
- `GET_STATUS` - Check if locked/active
- `ENCRYPT` - Encrypt data using session key
- `DECRYPT` - Decrypt data
- `HASH_DOMAIN` - Hash a domain for vault lookup

### From Popup

```typescript
// Initialize session (user enters master passphrase)
chrome.runtime.sendMessage({ type: 'INIT_SESSION', KM: masterKey }, (res) => {
  console.log('Session initialized:', res.success)
})

// Encrypt a password
chrome.runtime.sendMessage(
  { type: 'ENCRYPT', data: 'MyPassword' },
  (res) => {
    if (res.success) console.log('Encrypted:', res.encrypted)
  }
)
```

### From Content Script

```typescript
// Get domain hash to find vault entry
chrome.runtime.sendMessage(
  { type: 'HASH_DOMAIN', domain: window.location.hostname },
  (res) => {
    if (res.success) {
      console.log('Domain hash:', res.domainHash)
      // Use to query vault
    }
  }
)
```

---

## Key Cryptographic Details

- **Master Key (KM):** 256-bit random key (or derived from passphrase via Argon2/PBKDF2)
- **Session Nonce:** 128-bit random, unique per session
- **Session Key (KS):** Derived via HKDF-SHA256 (KM as IKM, nonce as info, empty salt)
- **Encryption:** AES-256-GCM (256-bit key, 96-bit IV, 128-bit auth tag)
- **Domain Hash:** HMAC-SHA256(KM, domain) — deterministic, same domain always produces same hash

---

## Security Notes

✅ **Uses Web Crypto API** — native browser crypto, no external dependencies
✅ **Authenticated encryption** — GCM prevents tampering
✅ **Random IVs** — each encryption gets a new random IV
✅ **HKDF derivation** — proper key derivation from master key

⚠️ **Still needed:**
- Passphrase → Master Key derivation (use Argon2 or PBKDF2)
- Secure storage of encrypted vault (use chrome.storage + additional encryption)
- MFA / biometric unlock for session

---

## Files Modified

- `src/lib/crypto.ts` — Full crypto implementation
- `src/lib/crypto.examples.ts` — Example usage patterns
- `src/background/background.ts` — Message handlers for crypto operations
- Build: ✅ `npm run build:extension` succeeds

---

Ready to extend! Pick your next feature (e.g., "auto-fill passwords on login pages") and I'll show exact code.
