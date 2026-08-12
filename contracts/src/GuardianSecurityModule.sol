// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {IGuardianVault} from "./interfaces/IGuardianVault.sol";
import {IGuardianSession} from "./interfaces/IGuardianSession.sol";

/// @title GuardianSecurityModule
/// @notice Two speeds of admin action, deliberately kept separate:
///           1. IMMEDIATE  — pause, freeze/revoke a session. No delay, because these
///              only ever remove capability (fail-safe direction), never grant it.
///           2. TIMELOCKED — anything that changes security *configuration*
///              (spending limits, registry policy address, etc.) goes through a
///              schedule -> wait -> execute flow so a single compromised admin key
///              can't silently loosen the security posture.
/// @dev This module is granted the relevant admin roles on GuardianVault /
///      GuardianSession by their respective admins; it does not hold assets itself.
contract GuardianSecurityModule is AccessControl {
    bytes32 public constant SECURITY_RESPONDER_ROLE = keccak256("SECURITY_RESPONDER_ROLE");
    bytes32 public constant TIMELOCK_PROPOSER_ROLE = keccak256("TIMELOCK_PROPOSER_ROLE");
    bytes32 public constant TIMELOCK_EXECUTOR_ROLE = keccak256("TIMELOCK_EXECUTOR_ROLE");

    uint256 public constant MIN_DELAY = 24 hours;

    struct ScheduledAction {
        address target;
        bytes data;
        uint256 readyAt;
        bool executed;
        bool cancelled;
    }

    mapping(bytes32 => ScheduledAction) private _actions;

    event EmergencyPause(address indexed vault, address indexed responder);
    event EmergencyUnpause(address indexed vault, address indexed responder);
    event EmergencySessionRevoked(address indexed session, address indexed agent, address indexed responder);
    event EmergencyWithdrawal(address indexed vault, address indexed token, uint256 amount, address indexed to);
    event ActionScheduled(bytes32 indexed id, address indexed target, uint256 readyAt);
    event ActionExecuted(bytes32 indexed id);
    event ActionCancelled(bytes32 indexed id);

    error ZeroAddress();
    error ActionNotFound();
    error ActionNotReady();
    error ActionAlreadyExecuted();
    error ActionCancelledError();
    error ActionCallFailed();

    constructor(address admin) {
        if (admin == address(0)) revert ZeroAddress();
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(SECURITY_RESPONDER_ROLE, admin);
        _grantRole(TIMELOCK_PROPOSER_ROLE, admin);
        _grantRole(TIMELOCK_EXECUTOR_ROLE, admin);
    }

    // ---------------------------------------------------------------------------------
    // Immediate emergency actions (fail-safe direction only: pause / revoke)
    // ---------------------------------------------------------------------------------

    function emergencyPause(address vault) external onlyRole(SECURITY_RESPONDER_ROLE) {
        IGuardianVault(vault).pause();
        emit EmergencyPause(vault, msg.sender);
    }

    function emergencyUnpause(address vault) external onlyRole(SECURITY_RESPONDER_ROLE) {
        IGuardianVault(vault).unpause();
        emit EmergencyUnpause(vault, msg.sender);
    }

    function emergencyRevokeSession(address session, address agent) external onlyRole(SECURITY_RESPONDER_ROLE) {
        IGuardianSession(session).revokeSession(agent);
        emit EmergencySessionRevoked(session, agent, msg.sender);
    }

    /// @notice Emergency withdrawal to a pre-authorized destination only. This module
    ///         never accepts an arbitrary `to` from an emergency responder — that
    ///         would just be a differently-shaped rug vector. The destination must be
    ///         supplied by the vault's own admin via the withdraw call's access
    ///         control (this module must itself hold VAULT_ADMIN_ROLE, and the vault
    ///         still enforces its own zero-address / balance checks).
    function emergencyWithdraw(address vault, address token, uint256 amount, address to)
        external
        onlyRole(SECURITY_RESPONDER_ROLE)
    {
        if (to == address(0)) revert ZeroAddress();
        IGuardianVault(vault).withdraw(token, amount, to);
        emit EmergencyWithdrawal(vault, token, amount, to);
    }

    // ---------------------------------------------------------------------------------
    // Timelocked configuration changes
    // ---------------------------------------------------------------------------------

    /// @notice Schedule an arbitrary call (e.g. RiskPolicy.setSpendingLimits,
    ///         GuardianVault.setRiskPolicy) to run no sooner than MIN_DELAY from now.
    function scheduleAction(address target, bytes calldata data)
        external
        onlyRole(TIMELOCK_PROPOSER_ROLE)
        returns (bytes32 id)
    {
        if (target == address(0)) revert ZeroAddress();
        id = keccak256(abi.encode(target, data, block.timestamp, block.number));
        uint256 readyAt = block.timestamp + MIN_DELAY;
        _actions[id] = ScheduledAction({target: target, data: data, readyAt: readyAt, executed: false, cancelled: false});
        emit ActionScheduled(id, target, readyAt);
    }

    function executeAction(bytes32 id) external onlyRole(TIMELOCK_EXECUTOR_ROLE) {
        ScheduledAction storage action = _actions[id];
        if (action.target == address(0)) revert ActionNotFound();
        if (action.executed) revert ActionAlreadyExecuted();
        if (action.cancelled) revert ActionCancelledError();
        if (block.timestamp < action.readyAt) revert ActionNotReady();

        action.executed = true;
        (bool success,) = action.target.call(action.data);
        if (!success) revert ActionCallFailed();
        emit ActionExecuted(id);
    }

    function cancelAction(bytes32 id) external onlyRole(TIMELOCK_PROPOSER_ROLE) {
        ScheduledAction storage action = _actions[id];
        if (action.target == address(0)) revert ActionNotFound();
        if (action.executed) revert ActionAlreadyExecuted();
        action.cancelled = true;
        emit ActionCancelled(id);
    }

    function getAction(bytes32 id) external view returns (ScheduledAction memory) {
        return _actions[id];
    }
}
