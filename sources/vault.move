module safekey::vault {

    use sui::clock::{Self, Clock};

    /// Error codes
    const ENotAuthorized: u64 = 0;

    /// A secure vault entry containing encrypted credentials
    public struct VaultEntry has key {
        id: UID,
        owner: address,
        domain_hash: vector<u8>,
        data: vector<u8>,
        entry_nonce: vector<u8>,
        session_nonce: vector<u8>,
        created_at: u64
    }

    /// Represents a domain entry in the vault for quick lookup
    public struct DomainEntry has store, copy, drop {
        domain_hash: vector<u8>,
        entry_id: ID
    }

    /// Each user has a vault that holds multiple entries
    public struct UserVault has key {
        id: UID,
        owner: address,
        entries: vector<DomainEntry>
    }

    /// Create a new user vault
    public entry fun create_vault(ctx: &mut TxContext) {
        let owner = tx_context::sender(ctx);
        let vault = UserVault {
            id: object::new(ctx),
            owner,
            entries: vector::empty<DomainEntry>()
        };

        transfer::transfer(vault, owner);
    }

    /// Add a new credential entry to the user's vault
    public entry fun add_entry(
        vault: &mut UserVault,
        domain_hash: vector<u8>,
        data: vector<u8>,
        entry_nonce: vector<u8>,
        session_nonce: vector<u8>,
        clock: &Clock,
        ctx: &mut TxContext
    ) {
        let owner = tx_context::sender(ctx);
        assert!(vault.owner == owner, ENotAuthorized);

        let entry = VaultEntry {
            id: object::new(ctx),
            owner,
            domain_hash: domain_hash,
            data,
            entry_nonce,
            session_nonce,
            created_at: clock::timestamp_ms(clock)
        };

        let entry_id = object::id(&entry);
        let domain_entry = DomainEntry {
            domain_hash,
            entry_id
        };
        vector::push_back(&mut vault.entries, domain_entry);

        transfer::transfer(entry, owner);
    }

    /// Get vault entry information (owner only)
    public fun get_entry_info(
        entry: &VaultEntry,
        ctx: &TxContext
    ): (address, vector<u8>, vector<u8>, vector<u8>, vector<u8>, u64) {
        let sender = tx_context::sender(ctx);
        assert!(entry.owner == sender, ENotAuthorized);

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
    public entry fun update_entry(
        entry: &mut VaultEntry,
        new_data: vector<u8>,
        new_entry_nonce: vector<u8>,
        new_session_nonce: vector<u8>,
        clock: &Clock,
        ctx: &mut TxContext
    ) {
        let sender = tx_context::sender(ctx);
        assert!(entry.owner == sender, ENotAuthorized);

        entry.data = new_data;
        entry.entry_nonce = new_entry_nonce;
        entry.session_nonce = new_session_nonce;
        entry.created_at = clock::timestamp_ms(clock);
    }

    /// Delete a vault entry (owner only)
    public entry fun delete_entry(
        vault: &mut UserVault,
        entry: VaultEntry,
        ctx: &TxContext
    ) {
        let sender = tx_context::sender(ctx);
        assert!(entry.owner == sender, ENotAuthorized);

        let domain_hash = entry.domain_hash;
        let entry_id = object::id(&entry);

        remove_entry_from_vault(vault, domain_hash, entry_id);

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

    /// Helper: remove entry reference from user vault
    fun remove_entry_from_vault(vault: &mut UserVault, _domain_hash: vector<u8>, entry_id: ID) {
        let length = vector::length(&vault.entries);
        let mut i = 0;
        while (i < length) {
            let domain_entry = vector::borrow(&vault.entries, i);
            if (domain_entry.entry_id == entry_id) {
                vector::remove(&mut vault.entries, i);
                return
            };
            i = i + 1;
        };
    }

    /// Lookup entry ID by domain hash
    public fun find_entry_by_domain(vault: &UserVault, domain_hash: vector<u8>): (bool, ID) {
        let length = vector::length(&vault.entries);
        let mut i = 0;
        while (i < length) {
            let domain_entry = vector::borrow(&vault.entries, i);
            if (vector::length(&domain_entry.domain_hash) == vector::length(&domain_hash)) {
                let g_match = compare_hashes(&domain_entry.domain_hash, &domain_hash);
                if (g_match) {
                    return (true, domain_entry.entry_id)
                }
            };
            i = i + 1;
        };

        (false, object::id_from_address(@0x0))
    }

    /// Compare two byte vectors (domain hashes)
    fun compare_hashes(a: &vector<u8>, b: &vector<u8>): bool {
        let len = vector::length(a);
        let mut i = 0;
        while (i < len) {
            if (*vector::borrow(a, i) != *vector::borrow(b, i)) {
                return false
            };
            i = i + 1;
        };
        true
    }
}
