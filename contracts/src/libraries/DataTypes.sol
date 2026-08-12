// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title DataTypes
/// @notice Shared structs and enums used across the Guardian system.
library DataTypes {
    /// @notice Classification tiers for the GuardianRegistry.
    enum ContractStatus {
        UNKNOWN, // 0 - default, no data
        TRUSTED, // 1 - explicitly vetted / whitelisted
        SUSPICIOUS, // 2 - flagged, requires extra confirmation
        BLOCKED // 3 - always rejected
    }

    /// @notice Coarse risk tiers derived from a 0-100 risk score.
    enum RiskLevel {
        LOW, // 0-30
        MEDIUM, // 31-60
        HIGH, // 61-80
        CRITICAL // 81-100
    }

    /// @notice Final decision the policy/vault takes for a proposed transaction.
    enum Decision {
        ALLOW,
        REQUIRE_APPROVAL,
        DELAY,
        BLOCK
    }

    /// @notice Lifecycle state of a transaction proposal inside the vault.
    enum ProposalState {
        NONE,
        PENDING,
        APPROVED,
        EXECUTED,
        CANCELLED,
        EXPIRED
    }

    /// @notice A structured transaction request, analogous to a Gnosis-Safe-style
    ///         transaction but scoped to a single Guardian-protected vault.
    struct TransactionRequest {
        address vault; // vault this request targets (binds the hash to a vault)
        address target; // contract to call
        uint256 value; // native AVAX to send
        bytes data; // calldata
        uint256 nonce; // vault-scoped sequential nonce
        uint256 deadline; // unix timestamp after which the request is invalid
    }

    /// @notice Result of the deterministic risk evaluation for a request.
    struct RiskAssessment {
        uint256 aiScore; // 0-100, AI-supplied input (informational only)
        uint256 finalScore; // 0-100, deterministic engine output
        RiskLevel level;
        Decision decision;
        bool hardRuleTriggered; // true if a non-overridable rule fired
        string reason; // human-readable primary reason
    }

    /// @notice Per-session limited permissions granted to an AI agent / hot key.
    struct SessionPermissions {
        address agent; // address authorized to act under this session
        uint256 maxTxValue; // max value (in wei, native asset denomination) per tx
        uint256 dailyLimit; // max cumulative value per rolling 24h window
        uint256 expiresAt; // unix timestamp
        bool active;
    }
}
