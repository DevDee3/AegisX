// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {DataTypes} from "../libraries/DataTypes.sol";

interface IGuardianSession {
    event SessionCreated(
        address indexed agent, uint256 maxTxValue, uint256 dailyLimit, uint256 expiresAt
    );
    event SessionRevoked(address indexed agent, address indexed revokedBy);
    event AllowedContractSet(address indexed agent, address indexed target, bool allowed);
    event AllowedTokenSet(address indexed agent, address indexed token, bool allowed);

    function createSession(
        address agent,
        uint256 maxTxValue,
        uint256 dailyLimit,
        uint256 durationSeconds,
        address[] calldata allowedContracts,
        address[] calldata allowedTokens
    ) external;

    function revokeSession(address agent) external;

    /// @notice Checks whether `agent` is currently permitted to propose a call to
    ///         `target` moving `value`. Reverts with a descriptive reason on denial.
    /// @dev Vault-side spending limits (RiskPolicy) are enforced independently and
    ///      are NOT replaced by this check — this is an additional, tighter bound
    ///      specific to the session-holding agent (e.g. the AI / hot key), so that a
    ///      compromised session key's blast radius is bounded even if it somehow
    ///      passed the deterministic risk policy.
    function checkAndConsume(address agent, address target, uint256 value) external;

    function getSession(address agent) external view returns (DataTypes.SessionPermissions memory);
    function isContractAllowed(address agent, address target) external view returns (bool);
    function isTokenAllowed(address agent, address token) external view returns (bool);
    function sessionSpentToday(address agent) external view returns (uint256);
}
