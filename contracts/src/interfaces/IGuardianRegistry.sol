// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {DataTypes} from "../libraries/DataTypes.sol";

interface IGuardianRegistry {
    event ContractTrusted(address indexed target, address indexed admin);
    event ContractBlocked(address indexed target, address indexed admin, string reason);
    event ContractUnblocked(address indexed target, address indexed admin);
    event ContractFlaggedSuspicious(address indexed target, address indexed admin, string reason);
    event ContractStatusCleared(address indexed target, address indexed admin);
    event ImplementationSnapshotUpdated(address indexed target, address indexed implementation);

    function addTrustedContract(address target) external;
    function blockContract(address target, string calldata reason) external;
    function flagSuspicious(address target, string calldata reason) external;
    function unblockContract(address target) external;
    function clearStatus(address target) external;

    function getContractStatus(address target) external view returns (DataTypes.ContractStatus);
    function isTrusted(address target) external view returns (bool);
    function isBlocked(address target) external view returns (bool);

    /// @notice Records the implementation address observed for a proxy so that
    ///         future upgrades can be detected by comparing snapshots.
    function recordImplementation(address target, address implementation) external;
    function getRecordedImplementation(address target) external view returns (address);
}
