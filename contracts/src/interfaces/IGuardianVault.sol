// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {DataTypes} from "../libraries/DataTypes.sol";

interface IGuardianVault {
    event Deposited(address indexed from, address indexed token, uint256 amount);
    event Withdrawn(address indexed to, address indexed token, uint256 amount);
    event TransactionProposed(bytes32 indexed requestHash, address indexed proposer, DataTypes.TransactionRequest request);
    event TransactionApproved(bytes32 indexed requestHash, address indexed approver);
    event TransactionBlocked(bytes32 indexed requestHash, string reason, uint256 riskScore);
    event TransactionExecuted(bytes32 indexed requestHash, bool success, bytes returnData);
    event TransactionCancelled(bytes32 indexed requestHash, address indexed canceller);
    event VaultPaused(address indexed admin);
    event VaultUnpaused(address indexed admin);

    function deposit(address token, uint256 amount) external payable;
    function withdraw(address token, uint256 amount, address to) external;

    function proposeTransaction(DataTypes.TransactionRequest calldata request, uint256 aiScore)
        external
        returns (bytes32 requestHash);

    function approveTransaction(bytes32 requestHash) external;
    function executeTransaction(bytes32 requestHash) external returns (bool success, bytes memory returnData);
    function cancelTransaction(bytes32 requestHash) external;

    function pause() external;
    function unpause() external;

    function getProposalState(bytes32 requestHash) external view returns (DataTypes.ProposalState);
    function currentNonce() external view returns (uint256);
}
