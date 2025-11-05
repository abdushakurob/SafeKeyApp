# SafeKey Vault - Smart Contract Documentation

## Overview
SafeKey Vault is a Sui Move smart contract that provides secure, encrypted credential storage on the Sui blockchain. Each user owns a personal vault where they can store, retrieve, update, and delete encrypted password entries.

**Key Security Features:**
- All credential data is encrypted client-side before being stored on-chain
- Only the vault owner can access their entries
- Encryption keys never touch the blockchain
- Each entry is indexed by a hashed domain identifier

---

## Contract Address
```
Package ID: [TO BE FILLED AFTER DEPLOYMENT]
Module: safekey::vault
```

---

## Data Structures

### UserVault
The main container object that holds all user credentials.

```move
public struct UserVault has key {
    id: UID,
    owner: address
}
```

**Fields:**
- `id`: Unique identifier for the vault
- `owner`: Address of the vault owner

**Ownership:** Owned by the user who created it

---

### VaultEntry
Individual encrypted credential entry stored within a vault.

```move
public struct VaultEntry has key, store {
    id: UID,
    owner: address,
    domain_hash: vector<u8>,
    data: vector<u8>,
    entry_nonce: vector<u8>,
    session_nonce: vector<u8>,
    created_at: u64
}
```

**Fields:**
- `id`: Unique identifier for the entry
- `owner`: Address of the entry owner (same as vault owner)
- `domain_hash`: SHA-256 hash of the domain/service name (used as lookup key)
- `data`: Encrypted credential data (username, password, notes, etc.)
- `entry_nonce`: Nonce used for entry-level encryption
- `session_nonce`: Nonce used for session-level encryption
- `created_at`: Timestamp in milliseconds when entry was created/last updated

**Storage:** Stored as dynamic fields on the UserVault object

---

## Error Codes

| Code | Constant | Description |
|------|----------|-------------|
| 0 | `ENotAuthorized` | Caller is not the vault owner |
| 1 | `EEntryAlreadyExists` | An entry with this domain_hash already exists |
| 2 | `EEntryNotFound` | No entry found for the given domain_hash |

---

## Functions

### 1. create_vault
Creates a new user vault and transfers ownership to the caller.

**Signature:**
```move
public fun create_vault(ctx: &mut TxContext)
```

**Parameters:**
- `ctx`: Transaction context (automatically provided)

**Returns:** None (transfers `UserVault` object to caller)

**Usage Example (TypeScript SDK):**
```typescript
const tx = new Transaction();
tx.moveCall({
    target: `${PACKAGE_ID}::vault::create_vault`,
});

const result = await signAndExecuteTransaction({
    transaction: tx,
    chain: 'sui:mainnet',
});
```

**Gas Estimate:** ~0.001 SUI

---

### 2. add_entry
Adds a new encrypted credential entry to the vault.

**Signature:**
```move
public fun add_entry(
    vault: &mut UserVault,
    domain_hash: vector<u8>,
    data: vector<u8>,
    entry_nonce: vector<u8>,
    session_nonce: vector<u8>,
    clock: &Clock,
    ctx: &mut TxContext
)
```

**Parameters:**
- `vault`: Reference to the user's vault object
- `domain_hash`: SHA-256 hash of the domain (e.g., `sha256("github.com")`)
- `data`: Encrypted credential data as bytes
- `entry_nonce`: Nonce for entry-level encryption
- `session_nonce`: Nonce for session-level encryption
- `clock`: Reference to shared Clock object (`0x6`)
- `ctx`: Transaction context

**Errors:**
- `ENotAuthorized`: If caller is not the vault owner
- `EEntryAlreadyExists`: If an entry with this domain_hash already exists

**Usage Example (TypeScript SDK):**
```typescript
import { sha256 } from '@noble/hashes/sha256';

// Client-side encryption (example)
const domain = "github.com";
const domainHash = Array.from(sha256(domain));
const encryptedData = encryptCredentials(username, password, masterKey);

const tx = new Transaction();
tx.moveCall({
    target: `${PACKAGE_ID}::vault::add_entry`,
    arguments: [
        tx.object(vaultId),                    // vault
        tx.pure.vector('u8', domainHash),      // domain_hash
        tx.pure.vector('u8', encryptedData),   // data
        tx.pure.vector('u8', entryNonce),      // entry_nonce
        tx.pure.vector('u8', sessionNonce),    // session_nonce
        tx.object('0x6'),                      // clock
    ],
});

await signAndExecuteTransaction({ transaction: tx });
```

**Gas Estimate:** ~0.002-0.005 SUI (depends on data size)

---

### 3. get_entry_info
Retrieves encrypted credential information for a specific domain.

**Signature:**
```move
public fun get_entry_info(
    vault: &UserVault,
    domain_hash: vector<u8>,
    ctx: &TxContext
): (address, vector<u8>, vector<u8>, vector<u8>, vector<u8>, u64)
```

**Parameters:**
- `vault`: Reference to the user's vault object
- `domain_hash`: SHA-256 hash of the domain to retrieve
- `ctx`: Transaction context

**Returns:** Tuple containing:
1. `owner` (address)
2. `domain_hash` (vector<u8>)
3. `data` (vector<u8>) - encrypted credentials
4. `entry_nonce` (vector<u8>)
5. `session_nonce` (vector<u8>)
6. `created_at` (u64) - timestamp in milliseconds

**Errors:**
- `ENotAuthorized`: If caller is not the vault owner
- `EEntryNotFound`: If no entry exists for this domain_hash

**Usage Example (TypeScript SDK):**
```typescript
const tx = new Transaction();
const [owner, domainHash, data, entryNonce, sessionNonce, createdAt] = tx.moveCall({
    target: `${PACKAGE_ID}::vault::get_entry_info`,
    arguments: [
        tx.object(vaultId),
        tx.pure.vector('u8', domainHash),
    ],
});

// Use devInspectTransactionBlock for read-only operations
const result = await suiClient.devInspectTransactionBlock({
    sender: walletAddress,
    transactionBlock: tx,
});

// Parse the result and decrypt client-side
const encryptedData = result.results[0].returnValues[2];
const credentials = decryptCredentials(encryptedData, masterKey);
```

**Gas Estimate:** Free (read-only, use `devInspectTransactionBlock`)

---

### 4. update_entry
Updates an existing credential entry with new encrypted data.

**Signature:**
```move
public fun update_entry(
    vault: &mut UserVault,
    domain_hash: vector<u8>,
    new_data: vector<u8>,
    new_entry_nonce: vector<u8>,
    new_session_nonce: vector<u8>,
    clock: &Clock,
    ctx: &TxContext
)
```

**Parameters:**
- `vault`: Reference to the user's vault object
- `domain_hash`: SHA-256 hash of the domain to update
- `new_data`: New encrypted credential data
- `new_entry_nonce`: New entry-level nonce
- `new_session_nonce`: New session-level nonce
- `clock`: Reference to shared Clock object (`0x6`)
- `ctx`: Transaction context

**Errors:**
- `ENotAuthorized`: If caller is not the vault owner
- `EEntryNotFound`: If no entry exists for this domain_hash

**Usage Example (TypeScript SDK):**
```typescript
const tx = new Transaction();
tx.moveCall({
    target: `${PACKAGE_ID}::vault::update_entry`,
    arguments: [
        tx.object(vaultId),
        tx.pure.vector('u8', domainHash),
        tx.pure.vector('u8', newEncryptedData),
        tx.pure.vector('u8', newEntryNonce),
        tx.pure.vector('u8', newSessionNonce),
        tx.object('0x6'),
    ],
});

await signAndExecuteTransaction({ transaction: tx });
```

**Note:** The `created_at` timestamp is updated to the current time on each update.

**Gas Estimate:** ~0.002-0.005 SUI (depends on data size)

---

### 5. delete_entry
Permanently deletes a credential entry from the vault.

**Signature:**
```move
public fun delete_entry(
    vault: &mut UserVault,
    domain_hash: vector<u8>,
    ctx: &TxContext
)
```

**Parameters:**
- `vault`: Reference to the user's vault object
- `domain_hash`: SHA-256 hash of the domain to delete
- `ctx`: Transaction context

**Errors:**
- `ENotAuthorized`: If caller is not the vault owner
- `EEntryNotFound`: If no entry exists for this domain_hash

**Usage Example (TypeScript SDK):**
```typescript
const tx = new Transaction();
tx.moveCall({
    target: `${PACKAGE_ID}::vault::delete_entry`,
    arguments: [
        tx.object(vaultId),
        tx.pure.vector('u8', domainHash),
    ],
});

await signAndExecuteTransaction({ transaction: tx });
```

**Gas Estimate:** ~0.001-0.002 SUI

---

### 6. entry_exists
Checks if an entry exists for a given domain without retrieving its data.

**Signature:**
```move
public fun entry_exists(vault: &UserVault, domain_hash: vector<u8>): bool
```

**Parameters:**
- `vault`: Reference to the user's vault object
- `domain_hash`: SHA-256 hash of the domain to check

**Returns:** `true` if entry exists, `false` otherwise

**Usage Example (TypeScript SDK):**
```typescript
const tx = new Transaction();
const [exists] = tx.moveCall({
    target: `${PACKAGE_ID}::vault::entry_exists`,
    arguments: [
        tx.object(vaultId),
        tx.pure.vector('u8', domainHash),
    ],
});

const result = await suiClient.devInspectTransactionBlock({
    sender: walletAddress,
    transactionBlock: tx,
});

const entryExists = result.results[0].returnValues[0][0] === 1;
```

**Gas Estimate:** Free (read-only)

---

## Client-Side Encryption Guide

### Recommended Encryption Flow

**Before storing credentials:**
1. User enters master password
2. Derive encryption key from master password using PBKDF2/Argon2
3. Encrypt credentials using AES-256-GCM with derived key
4. Generate random nonces for entry and session
5. Hash domain name using SHA-256
6. Call `add_entry` with encrypted data

**When retrieving credentials:**
1. Call `get_entry_info` with domain hash
2. Decrypt returned data using master password-derived key
3. Display credentials to user

### Example Encryption Implementation (TypeScript)

```typescript
import { sha256 } from '@noble/hashes/sha256';
import { xchacha20poly1305 } from '@noble/ciphers/chacha';
import { randomBytes } from '@noble/ciphers/webcrypto';

// Derive key from master password
async function deriveMasterKey(password: string, salt: Uint8Array): Promise<Uint8Array> {
    const encoder = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey(
        'raw',
        encoder.encode(password),
        'PBKDF2',
        false,
        ['deriveBits']
    );
    
    const key = await crypto.subtle.deriveBits(
        {
            name: 'PBKDF2',
            salt: salt,
            iterations: 100000,
            hash: 'SHA-256'
        },
        keyMaterial,
        256
    );
    
    return new Uint8Array(key);
}

// Encrypt credentials
function encryptCredentials(
    username: string,
    password: string,
    masterKey: Uint8Array
): { data: Uint8Array; nonce: Uint8Array } {
    const plaintext = JSON.stringify({ username, password });
    const nonce = randomBytes(24); // XChaCha20 uses 24-byte nonces
    
    const cipher = xchacha20poly1305(masterKey, nonce);
    const ciphertext = cipher.encrypt(new TextEncoder().encode(plaintext));
    
    return { data: ciphertext, nonce };
}

// Decrypt credentials
function decryptCredentials(
    ciphertext: Uint8Array,
    nonce: Uint8Array,
    masterKey: Uint8Array
): { username: string; password: string } {
    const cipher = xchacha20poly1305(masterKey, nonce);
    const plaintext = cipher.decrypt(ciphertext);
    
    return JSON.parse(new TextDecoder().decode(plaintext));
}

// Hash domain for lookup
function hashDomain(domain: string): Uint8Array {
    return sha256(domain);
}
```

---

## Integration Workflow

### 1. Initial Setup (New User)
```typescript
// Step 1: Create vault
const createTx = new Transaction();
createTx.moveCall({
    target: `${PACKAGE_ID}::vault::create_vault`,
});

const result = await signAndExecuteTransaction({ transaction: createTx });

// Step 2: Extract vault object ID from transaction effects
const vaultId = result.effects.created[0].reference.objectId;

// Step 3: Store vaultId in local storage
localStorage.setItem('safekey_vault_id', vaultId);
```

### 2. Adding Credentials
```typescript
async function addPassword(domain: string, username: string, password: string) {
    // Get master key (from user input)
    const masterPassword = prompt('Enter master password:');
    const salt = getUserSalt(); // Retrieve or generate user-specific salt
    const masterKey = await deriveMasterKey(masterPassword, salt);
    
    // Encrypt credentials
    const { data, nonce: entryNonce } = encryptCredentials(username, password, masterKey);
    const sessionNonce = randomBytes(24);
    
    // Hash domain
    const domainHash = Array.from(hashDomain(domain));
    
    // Add to blockchain
    const vaultId = localStorage.getItem('safekey_vault_id');
    const tx = new Transaction();
    tx.moveCall({
        target: `${PACKAGE_ID}::vault::add_entry`,
        arguments: [
            tx.object(vaultId),
            tx.pure.vector('u8', domainHash),
            tx.pure.vector('u8', Array.from(data)),
            tx.pure.vector('u8', Array.from(entryNonce)),
            tx.pure.vector('u8', Array.from(sessionNonce)),
            tx.object('0x6'),
        ],
    });
    
    await signAndExecuteTransaction({ transaction: tx });
}
```

### 3. Retrieving Credentials
```typescript
async function getPassword(domain: string) {
    const vaultId = localStorage.getItem('safekey_vault_id');
    const domainHash = Array.from(hashDomain(domain));
    
    // Check if entry exists first
    const existsTx = new Transaction();
    existsTx.moveCall({
        target: `${PACKAGE_ID}::vault::entry_exists`,
        arguments: [
            existsTx.object(vaultId),
            existsTx.pure.vector('u8', domainHash),
        ],
    });
    
    const existsResult = await suiClient.devInspectTransactionBlock({
        sender: walletAddress,
        transactionBlock: existsTx,
    });
    
    if (!existsResult.results[0].returnValues[0][0]) {
        throw new Error('No credentials found for this domain');
    }
    
    // Get entry info
    const tx = new Transaction();
    tx.moveCall({
        target: `${PACKAGE_ID}::vault::get_entry_info`,
        arguments: [
            tx.object(vaultId),
            tx.pure.vector('u8', domainHash),
        ],
    });
    
    const result = await suiClient.devInspectTransactionBlock({
        sender: walletAddress,
        transactionBlock: tx,
    });
    
    // Parse results
    const data = new Uint8Array(result.results[0].returnValues[2][0]);
    const entryNonce = new Uint8Array(result.results[0].returnValues[3][0]);
    
    // Decrypt
    const masterPassword = prompt('Enter master password:');
    const salt = getUserSalt();
    const masterKey = await deriveMasterKey(masterPassword, salt);
    
    return decryptCredentials(data, entryNonce, masterKey);
}
```

### 4. Updating Credentials
```typescript
async function updatePassword(domain: string, newUsername: string, newPassword: string) {
    const vaultId = localStorage.getItem('safekey_vault_id');
    const domainHash = Array.from(hashDomain(domain));
    
    // Get master key
    const masterPassword = prompt('Enter master password:');
    const salt = getUserSalt();
    const masterKey = await deriveMasterKey(masterPassword, salt);
    
    // Encrypt new credentials
    const { data, nonce: entryNonce } = encryptCredentials(newUsername, newPassword, masterKey);
    const sessionNonce = randomBytes(24);
    
    // Update on blockchain
    const tx = new Transaction();
    tx.moveCall({
        target: `${PACKAGE_ID}::vault::update_entry`,
        arguments: [
            tx.object(vaultId),
            tx.pure.vector('u8', domainHash),
            tx.pure.vector('u8', Array.from(data)),
            tx.pure.vector('u8', Array.from(entryNonce)),
            tx.pure.vector('u8', Array.from(sessionNonce)),
            tx.object('0x6'),
        ],
    });
    
    await signAndExecuteTransaction({ transaction: tx });
}
```

### 5. Deleting Credentials
```typescript
async function deletePassword(domain: string) {
    const vaultId = localStorage.getItem('safekey_vault_id');
    const domainHash = Array.from(hashDomain(domain));
    
    const tx = new Transaction();
    tx.moveCall({
        target: `${PACKAGE_ID}::vault::delete_entry`,
        arguments: [
            tx.object(vaultId),
            tx.pure.vector('u8', domainHash),
        ],
    });
    
    await signAndExecuteTransaction({ transaction: tx });
}
```

---

## Best Practices

### Security
1. **Never store master password**: Master password should only exist in memory during encryption/decryption
2. **Use strong KDF**: Use PBKDF2 with 100,000+ iterations or Argon2id
3. **Random nonces**: Always generate cryptographically secure random nonces
4. **Clear sensitive data**: Zero out encryption keys and plaintext passwords after use
5. **Salt storage**: Store user-specific salt securely (can be derived from wallet address)

### Gas Optimization
1. **Batch operations**: If adding multiple entries, consider batching in a single transaction
2. **Data size**: Keep credential data compact (only store essential information)
3. **Check existence**: Use `entry_exists` before `add_entry` to provide better UX

### Error Handling
```typescript
try {
    await addPassword(domain, username, password);
} catch (error) {
    if (error.message.includes('EEntryAlreadyExists')) {
        console.error('Credentials already exist for this domain. Use update instead.');
    } else if (error.message.includes('ENotAuthorized')) {
        console.error('You do not own this vault.');
    } else if (error.message.includes('EEntryNotFound')) {
        console.error('No credentials found for this domain.');
    } else {
        console.error('Transaction failed:', error);
    }
}
```

---

## Querying User's Vault

To find a user's vault object:

```typescript
async function findUserVault(ownerAddress: string): Promise<string | null> {
    const objects = await suiClient.getOwnedObjects({
        owner: ownerAddress,
        filter: {
            StructType: `${PACKAGE_ID}::vault::UserVault`
        },
    });
    
    return objects.data[0]?.data?.objectId || null;
}
```

---

## Testing

### Unit Tests (Move)
```bash
sui move test
```

### Integration Tests (TypeScript)
```typescript
describe('SafeKey Vault', () => {
    it('should create a vault', async () => {
        // Test vault creation
    });
    
    it('should add and retrieve credentials', async () => {
        // Test add/get flow
    });
    
    it('should update existing credentials', async () => {
        // Test update flow
    });
    
    it('should delete credentials', async () => {
        // Test deletion
    });
    
    it('should prevent unauthorized access', async () => {
        // Test authorization
    });
});
```

---

## FAQ

**Q: Can I have multiple vaults?**
A: Yes, you can create multiple vaults, but typically one vault per user is recommended for simplicity.

**Q: What happens if I lose my master password?**
A: There is no password recovery. All data is encrypted client-side, so losing the master password means losing access to all credentials permanently.

**Q: Can someone else read my encrypted data?**
A: The encrypted data is publicly readable on the blockchain, but without your master password, it's cryptographically impossible to decrypt.

**Q: What's the maximum size for credential data?**
A: While there's no hard limit, keeping data under 10KB is recommended for gas efficiency.

**Q: How do I list all my saved domains?**
A: Currently, you need to maintain a local index of domain hashes. The contract stores entries as dynamic fields which aren't easily enumerable. Consider storing a list of domains in your frontend's local storage.

---

## Support & Resources

- **Contract Source**: [GitHub Repository]
- **Sui Documentation**: https://docs.sui.io
- **Sui TypeScript SDK**: https://sdk.mystenlabs.com/typescript
- **Report Issues**: [GitHub Issues]

---

**Version:** 1.0.0  
**Last Updated:** October 2025  
**License:** MIT
```
