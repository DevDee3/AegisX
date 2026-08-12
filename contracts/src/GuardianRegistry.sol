// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {DataTypes} from "./libraries/DataTypes.sol";
import {IGuardianRegistry} from "./interfaces/IGuardianRegistry.sol";

/// @title GuardianRegistry
/// @notice On-chain source of truth for contract trust classification. Consulted
///         by RiskPolicy as one deterministic input to risk evaluation.
contract GuardianRegistry is IGuardianRegistry, AccessControl {
    bytes32 public constant REGISTRY_ADMIN_ROLE = keccak256("REGISTRY_ADMIN_ROLE");
    bytes32 public constant MONITOR_ROLE = keccak256("MONITOR_ROLE"); // off-chain monitor/backend

    mapping(address => DataTypes.ContractStatus) private _status;
    mapping(address => string) private _statusReason;
    mapping(address => address) private _recordedImplementation;

    error ZeroAddress();

    constructor(address admin) {
        if (admin == address(0)) revert ZeroAddress();
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(REGISTRY_ADMIN_ROLE, admin);
    }

    /// @inheritdoc IGuardianRegistry
    function addTrustedContract(address target) external override onlyRole(REGISTRY_ADMIN_ROLE) {
        if (target == address(0)) revert ZeroAddress();
        _status[target] = DataTypes.ContractStatus.TRUSTED;
        delete _statusReason[target];
        emit ContractTrusted(target, msg.sender);
    }

    /// @inheritdoc IGuardianRegistry
    function blockContract(address target, string calldata reason) external override onlyRole(REGISTRY_ADMIN_ROLE) {
        if (target == address(0)) revert ZeroAddress();
        _status[target] = DataTypes.ContractStatus.BLOCKED;
        _statusReason[target] = reason;
        emit ContractBlocked(target, msg.sender, reason);
    }

    /// @inheritdoc IGuardianRegistry
    function flagSuspicious(address target, string calldata reason) external override onlyRole(MONITOR_ROLE) {
        if (target == address(0)) revert ZeroAddress();
        // Monitors can flag as suspicious but cannot escalate to BLOCKED or downgrade
        // an existing BLOCKED status — only a full registry admin can do that.
        if (_status[target] == DataTypes.ContractStatus.BLOCKED) return;
        _status[target] = DataTypes.ContractStatus.SUSPICIOUS;
        _statusReason[target] = reason;
        emit ContractFlaggedSuspicious(target, msg.sender, reason);
    }

    /// @inheritdoc IGuardianRegistry
    function unblockContract(address target) external override onlyRole(REGISTRY_ADMIN_ROLE) {
        _status[target] = DataTypes.ContractStatus.UNKNOWN;
        delete _statusReason[target];
        emit ContractUnblocked(target, msg.sender);
    }

    /// @inheritdoc IGuardianRegistry
    function clearStatus(address target) external override onlyRole(REGISTRY_ADMIN_ROLE) {
        delete _status[target];
        delete _statusReason[target];
        emit ContractStatusCleared(target, msg.sender);
    }

    /// @inheritdoc IGuardianRegistry
    function recordImplementation(address target, address implementation) external override onlyRole(MONITOR_ROLE) {
        _recordedImplementation[target] = implementation;
        emit ImplementationSnapshotUpdated(target, implementation);
    }

    function getRecordedImplementation(address target) external view override returns (address) {
        return _recordedImplementation[target];
    }

    function getContractStatus(address target) external view override returns (DataTypes.ContractStatus) {
        return _status[target];
    }

    function isTrusted(address target) external view override returns (bool) {
        return _status[target] == DataTypes.ContractStatus.TRUSTED;
    }

    function isBlocked(address target) external view override returns (bool) {
        return _status[target] == DataTypes.ContractStatus.BLOCKED;
    }

    function getStatusReason(address target) external view returns (string memory) {
        return _statusReason[target];
    }
}
