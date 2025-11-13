module safekey::vault {
    use sui::clock::Clock;
    use sui::dynamic_field;
    
    /// Error codes
    const ENotAuthorized: u64 = 0;
    const EEntryAlreadyExists: u64 = 1;
    const EEntryNotFound: u64 = 2;
    
    /// A secure vault entry containing encrypted credentials
    public struct VaultEntry has key, store {
        id: UID,
        owner: address,
        domain_hash: vector<u8>,
        data: vector<u8>,
        entry_nonce: vector<u8>,
        session_nonce: vector<u8>,
        created_at: u64
    }
    
    public struct UserVault has key {
        id: UID,
        owner: address
    }
    
    /// Create a new user vault
    public fun create_vault(ctx: &mut tx_context::TxContext) {
        let owner = tx_context::sender(ctx);
        let vault = UserVault {
            id: object::new(ctx),
            owner
        };
        transfer::transfer(vault, owner);
    }
    
    /// Add a new credential entry to the user's vault
    public fun add_entry(
        vault: &mut UserVault,
        domain_hash: vector<u8>,
        data: vector<u8>,
        entry_nonce: vector<u8>,
        session_nonce: vector<u8>,
        clock: &Clock,
        ctx: &mut tx_context::TxContext
    ) {
        let owner = tx_context::sender(ctx);
        assert!(vault.owner == owner, ENotAuthorized);
        assert!(!dynamic_field::exists_<vector<u8>>(&vault.id, domain_hash), EEntryAlreadyExists);
        
        let entry = VaultEntry {
            id: object::new(ctx),
            owner,
            domain_hash: domain_hash,
            data,
            entry_nonce,
            session_nonce,
            created_at: clock.timestamp_ms()
        };
        dynamic_field::add(&mut vault.id, domain_hash, entry);
    }
    
    /// Get vault entry information (owner only)
    public fun get_entry_info(
        vault: &UserVault,
        domain_hash: vector<u8>,
        ctx: &tx_context::TxContext
    ): (address, vector<u8>, vector<u8>, vector<u8>, vector<u8>, u64) {
        let sender = tx_context::sender(ctx);
        assert!(vault.owner == sender, ENotAuthorized);
        assert!(dynamic_field::exists_<vector<u8>>(&vault.id, domain_hash), EEntryNotFound);
        
        let entry = dynamic_field::borrow<vector<u8>, VaultEntry>(&vault.id, domain_hash);
        (
            entry.owner,
            entry.domain_hash,
            entry.data,
            entry.entry_nonce,
            entry.session_nonce,
            entry.created_at
        )
    }
    
    /// Update an existing vault entry (owner only)
    public fun update_entry(
        vault: &mut UserVault,
        domain_hash: vector<u8>,
        new_data: vector<u8>,
        new_entry_nonce: vector<u8>,
        new_session_nonce: vector<u8>,
        clock: &Clock,
        ctx: &tx_context::TxContext
    ) {
        let sender = tx_context::sender(ctx);
        assert!(vault.owner == sender, ENotAuthorized);
        assert!(dynamic_field::exists_<vector<u8>>(&vault.id, domain_hash), EEntryNotFound);
        
        let entry = dynamic_field::borrow_mut<vector<u8>, VaultEntry>(&mut vault.id, domain_hash);
        entry.data = new_data;
        entry.entry_nonce = new_entry_nonce;
        entry.session_nonce = new_session_nonce;
        entry.created_at = clock.timestamp_ms();
    }
    
    /// Delete a vault entry (owner only)
    public fun delete_entry(
        vault: &mut UserVault,
        domain_hash: vector<u8>,
        ctx: &tx_context::TxContext
    ) {
        let sender = tx_context::sender(ctx);
        assert!(vault.owner == sender, ENotAuthorized);
        assert!(dynamic_field::exists_<vector<u8>>(&vault.id, domain_hash), EEntryNotFound);
        
        let entry = dynamic_field::remove<vector<u8>, VaultEntry>(&mut vault.id, domain_hash);
        let VaultEntry {
            id,
            owner: _,
            domain_hash: _,
            data: _,
            entry_nonce: _,
            session_nonce: _,
            created_at: _
        } = entry;
        object::delete(id);
    }
    
    /// Check if entry exists for a domain
    public fun entry_exists(vault: &UserVault, domain_hash: vector<u8>): bool {
        dynamic_field::exists_<vector<u8>>(&vault.id, domain_hash)
    }
    
    /// SEAL approval function for access control
    /// This function is called by SEAL key servers to verify access to decryption keys
    /// According to SEAL docs: https://seal-docs.wal.app/UsingSeal/
    /// - First parameter must be the requested identity (id: vector<u8>), excluding package ID prefix
    /// - Function should abort if access is not granted
    /// - Should be defined as entry function
    entry fun seal_approve(id: vector<u8>, clock: &Clock, ctx: &tx_context::TxContext) {
        let sender = tx_context::sender(ctx);
        let sender_bytes = sender.to_bytes();
        
        // Verify that the id (user address) matches the transaction sender
        // This ensures only the user can retrieve their own SEAL share
        // If access is not granted, abort (as per SEAL requirements)
        assert!(sender_bytes == id, ENotAuthorized);
        
        // Clock parameter is required by SEAL for transaction validation
        // We don't need to use it, but it must be present in the signature
        let _ = clock;
    }
}