// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {DataTypes} from "./libraries/DataTypes.sol";
import {IGuardianSession} from "./interfaces/IGuardianSession.sol";

/// @title GuardianSession
/// @notice Bounds what an AI agent / hot session key can ever do, independent of
///         (and in addition to) the deterministic RiskPolicy checks in the vault.
/// @dev If a session key or the AI agent's credentials are compromised, damage is
///      capped at maxTxValue per call, dailyLimit per rolling day, only against an
///      explicit allow-list of contracts/tokens, and only until expiresAt. The AI
///      never gets a raw key controlling the whole vault — this contract is the
///      enforcement boundary for that guarantee.
contract GuardianSession is IGuardianSession, AccessControl {
    bytes32 public constant SESSION_ADMIN_ROLE = keccak256("SESSION_ADMIN_ROLE");

    mapping(address => DataTypes.SessionPermissions) private _sessions;
    mapping(address => mapping(address => bool)) private _allowedContracts; // agent => target => allowed
    mapping(address => mapping(address => bool)) private _allowedTokens; // agent => token => allowed
    mapping(address => mapping(uint256 => uint256)) private _dailySpent; // agent => dayIndex => spent

    error ZeroAddress();
    error SessionNotActive();
    error SessionExpired();
    error ContractNotAllowed();
    error ExceedsSessionMaxTxValue();
    error ExceedsSessionDailyLimit();
    error InvalidDuration();

    constructor(address admin) {
        if (admin == address(0)) revert ZeroAddress();
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(SESSION_ADMIN_ROLE, admin);
    }

    /// @inheritdoc IGuardianSession
    function createSession(
        address agent,
        uint256 maxTxValue,
        uint256 dailyLimit,
        uint256 durationSeconds,
        address[] calldata allowedContracts,
        address[] calldata allowedTokens
    ) external override onlyRole(SESSION_ADMIN_ROLE) {
        if (agent == address(0)) revert ZeroAddress();
        if (durationSeconds == 0) revert InvalidDuration();

        uint256 expiresAt = block.timestamp + durationSeconds;

        _sessions[agent] = DataTypes.SessionPermissions({
            agent: agent,
            maxTxValue: maxTxValue,
            dailyLimit: dailyLimit,
            expiresAt: expiresAt,
            active: true
        });

        for (uint256 i = 0; i < allowedContracts.length; i++) {
            _allowedContracts[agent][allowedContracts[i]] = true;
            emit AllowedContractSet(agent, allowedContracts[i], true);
        }
        for (uint256 i = 0; i < allowedTokens.length; i++) {
            _allowedTokens[agent][allowedTokens[i]] = true;
            emit AllowedTokenSet(agent, allowedTokens[i], true);
        }

        emit SessionCreated(agent, maxTxValue, dailyLimit, expiresAt);
    }

    /// @inheritdoc IGuardianSession
    function revokeSession(address agent) external override onlyRole(SESSION_ADMIN_ROLE) {
        _sessions[agent].active = false;
        emit SessionRevoked(agent, msg.sender);
    }

    function setAllowedContract(address agent, address target, bool allowed)
        external
        onlyRole(SESSION_ADMIN_ROLE)
    {
        _allowedContracts[agent][target] = allowed;
        emit AllowedContractSet(agent, target, allowed);
    }

    function setAllowedToken(address agent, address token, bool allowed) external onlyRole(SESSION_ADMIN_ROLE) {
        _allowedTokens[agent][token] = allowed;
        emit AllowedTokenSet(agent, token, allowed);
    }

    /// @inheritdoc IGuardianSession
    function checkAndConsume(address agent, address target, uint256 value) external override {
        DataTypes.SessionPermissions storage session = _sessions[agent];
        if (!session.active) revert SessionNotActive();
        if (block.timestamp > session.expiresAt) revert SessionExpired();
        if (!_allowedContracts[agent][target]) revert ContractNotAllowed();
        if (session.maxTxValue != 0 && value > session.maxTxValue) revert ExceedsSessionMaxTxValue();

        uint256 today = _dayIndex();
        uint256 spent = _dailySpent[agent][today];
        if (session.dailyLimit != 0 && spent + value > session.dailyLimit) revert ExceedsSessionDailyLimit();

        _dailySpent[agent][today] = spent + value;
    }

    function getSession(address agent) external view override returns (DataTypes.SessionPermissions memory) {
        return _sessions[agent];
    }

    function isContractAllowed(address agent, address target) external view override returns (bool) {
        return _allowedContracts[agent][target];
    }

    function isTokenAllowed(address agent, address token) external view override returns (bool) {
        return _allowedTokens[agent][token];
    }

    function sessionSpentToday(address agent) external view override returns (uint256) {
        return _dailySpent[agent][_dayIndex()];
    }

    function _dayIndex() internal view returns (uint256) {
        return block.timestamp / 1 days;
    }
}
