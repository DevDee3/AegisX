// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import {DataTypes} from "./libraries/DataTypes.sol";
import {IGuardianVault} from "./interfaces/IGuardianVault.sol";
import {IRiskPolicy} from "./interfaces/IRiskPolicy.sol";
import {IGuardianSession} from "./interfaces/IGuardianSession.sol";

/// @title GuardianVault
/// @notice Holds user assets and mediates ALL outbound calls through the deterministic
///         RiskPolicy engine. The vault never executes an arbitrary call directly from
///         a proposal without it first passing policy evaluation — the AI-suggested
///         risk score is only one input to that evaluation, never the authorization
///         itself.
/// @dev Roles:
///      - VAULT_ADMIN_ROLE: owner-equivalent; can pause, configure, withdraw, cancel.
///      - AGENT_ROLE: bounded proposer role intended for the AI agent / session key.
///        An agent can PROPOSE transactions but can never single-handedly force
///        execution of anything the policy engine flags for approval or blocks.
contract GuardianVault is IGuardianVault, AccessControl, ReentrancyGuard, Pausable, EIP712 {
    using SafeERC20 for IERC20;

    bytes32 public constant VAULT_ADMIN_ROLE = keccak256("VAULT_ADMIN_ROLE");
    bytes32 public constant AGENT_ROLE = keccak256("AGENT_ROLE");

    bytes32 private constant _TX_REQUEST_TYPEHASH = keccak256(
        "TransactionRequest(address vault,address target,uint256 value,bytes data,uint256 nonce,uint256 deadline)"
    );

    // approve(address,uint256) selector
    bytes4 private constant _APPROVE_SELECTOR = 0x095ea7b3;

    IRiskPolicy public riskPolicy;

    /// @notice Optional bounded-session enforcement for agent proposers. When set,
    ///         every AGENT_ROLE proposal is additionally checked against the agent's
    ///         session permissions (max tx value, daily limit, contract allow-list,
    ///         expiration) — a tighter, independent bound on top of RiskPolicy, so a
    ///         compromised agent key's blast radius stays capped even if it somehow
    ///         produced a favorable risk assessment. Left unset, sessions are opt-in.
    IGuardianSession public session;

    uint256 public currentNonce;

    struct Proposal {
        DataTypes.TransactionRequest request;
        DataTypes.ProposalState state;
        uint256 riskScore;
        uint256 readyAt; // for DELAY decisions: earliest execution timestamp
        address proposer;
    }

    mapping(bytes32 => Proposal) private _proposals;

    // Rolling daily spend tracking, keyed by UTC day index.
    mapping(uint256 => uint256) private _dailySpent;

    error ZeroAddress();
    error InvalidNonce();
    error RequestExpired();
    error ProposalNotFound();
    error ProposalNotPending();
    error ProposalNotApproved();
    error ProposalNotReady();
    error TransactionBlockedByPolicy(string reason, uint256 riskScore);
    error ExceedsMaxTxValue();
    error ExceedsDailyLimit();
    error InsufficientBalance();
    error NativeTransferFailed();
    error VaultMismatch();

    constructor(address admin, address riskPolicy_) EIP712("GuardianVault", "1") {
        if (admin == address(0) || riskPolicy_ == address(0)) revert ZeroAddress();
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(VAULT_ADMIN_ROLE, admin);
        riskPolicy = IRiskPolicy(riskPolicy_);
    }

    receive() external payable {}

    // ---------------------------------------------------------------------------------
    // Deposits / withdrawals
    // ---------------------------------------------------------------------------------

    /// @inheritdoc IGuardianVault
    function deposit(address token, uint256 amount) external payable override nonReentrant {
        if (token == address(0)) {
            // native AVAX deposit — amount is ignored, msg.value is authoritative
            emit Deposited(msg.sender, address(0), msg.value);
            return;
        }
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        emit Deposited(msg.sender, token, amount);
    }

    /// @inheritdoc IGuardianVault
    function withdraw(address token, uint256 amount, address to) external override onlyRole(VAULT_ADMIN_ROLE) nonReentrant {
        if (to == address(0)) revert ZeroAddress();
        if (token == address(0)) {
            if (address(this).balance < amount) revert InsufficientBalance();
            (bool ok,) = to.call{value: amount}("");
            if (!ok) revert NativeTransferFailed();
        } else {
            IERC20(token).safeTransfer(to, amount);
        }
        emit Withdrawn(to, token, amount);
    }

    // ---------------------------------------------------------------------------------
    // Transaction lifecycle
    // ---------------------------------------------------------------------------------

    /// @inheritdoc IGuardianVault
    function proposeTransaction(DataTypes.TransactionRequest calldata request, uint256 aiScore)
        external
        override
        onlyRole(AGENT_ROLE)
        whenNotPaused
        returns (bytes32 requestHash)
    {
        if (request.vault != address(this)) revert VaultMismatch();
        if (request.nonce != currentNonce) revert InvalidNonce();
        if (request.deadline != 0 && request.deadline < block.timestamp) revert RequestExpired();

        // Session bound is checked BEFORE policy evaluation: an agent operating
        // outside its own session permissions should never even reach the risk
        // engine, regardless of what the AI thinks the risk is.
        if (address(session) != address(0)) {
            session.checkAndConsume(msg.sender, request.target, request.value);
        }

        requestHash = _hashRequest(request);

        bool unlimitedApproval = _isUnlimitedApproval(request.data);

        DataTypes.RiskAssessment memory assessment =
            riskPolicy.evaluate(request, aiScore, unlimitedApproval);

        // Consume the nonce regardless of outcome to prevent replay of a blocked request.
        currentNonce += 1;

        if (assessment.decision == DataTypes.Decision.BLOCK) {
            emit TransactionBlocked(requestHash, assessment.reason, assessment.finalScore);
            // Store a terminal, non-executable record for auditability.
            _proposals[requestHash] = Proposal({
                request: request,
                state: DataTypes.ProposalState.CANCELLED,
                riskScore: assessment.finalScore,
                readyAt: 0,
                proposer: msg.sender
            });
            revert TransactionBlockedByPolicy(assessment.reason, assessment.finalScore);
        }

        DataTypes.ProposalState state;
        uint256 readyAt;

        if (assessment.decision == DataTypes.Decision.ALLOW) {
            state = DataTypes.ProposalState.APPROVED;
        } else if (assessment.decision == DataTypes.Decision.DELAY) {
            state = DataTypes.ProposalState.PENDING;
            readyAt = block.timestamp + 1 hours;
        } else {
            // REQUIRE_APPROVAL
            state = DataTypes.ProposalState.PENDING;
        }

        _proposals[requestHash] = Proposal({
            request: request,
            state: state,
            riskScore: assessment.finalScore,
            readyAt: readyAt,
            proposer: msg.sender
        });

        emit TransactionProposed(requestHash, msg.sender, request);
    }

    /// @inheritdoc IGuardianVault
    function approveTransaction(bytes32 requestHash) external override onlyRole(VAULT_ADMIN_ROLE) whenNotPaused {
        Proposal storage proposal = _proposals[requestHash];
        if (proposal.state == DataTypes.ProposalState.NONE) revert ProposalNotFound();
        if (proposal.state != DataTypes.ProposalState.PENDING) revert ProposalNotPending();
        if (proposal.readyAt != 0 && block.timestamp < proposal.readyAt) revert ProposalNotReady();

        proposal.state = DataTypes.ProposalState.APPROVED;
        emit TransactionApproved(requestHash, msg.sender);
    }

    /// @inheritdoc IGuardianVault
    function executeTransaction(bytes32 requestHash)
        external
        override
        onlyRole(VAULT_ADMIN_ROLE)
        whenNotPaused
        nonReentrant
        returns (bool success, bytes memory returnData)
    {
        Proposal storage proposal = _proposals[requestHash];
        if (proposal.state == DataTypes.ProposalState.NONE) revert ProposalNotFound();
        if (proposal.state != DataTypes.ProposalState.APPROVED) revert ProposalNotApproved();
        if (proposal.request.deadline != 0 && proposal.request.deadline < block.timestamp) {
            revert RequestExpired();
        }

        _enforceSpendingLimits(proposal.request.value);

        // Effects before interaction (checks-effects-interactions).
        proposal.state = DataTypes.ProposalState.EXECUTED;
        _dailySpent[_dayIndex()] += proposal.request.value;

        (success, returnData) =
            proposal.request.target.call{value: proposal.request.value}(proposal.request.data);

        emit TransactionExecuted(requestHash, success, returnData);
    }

    /// @inheritdoc IGuardianVault
    function cancelTransaction(bytes32 requestHash) external override {
        Proposal storage proposal = _proposals[requestHash];
        if (proposal.state == DataTypes.ProposalState.NONE) revert ProposalNotFound();
        if (proposal.state != DataTypes.ProposalState.PENDING && proposal.state != DataTypes.ProposalState.APPROVED) {
            revert ProposalNotPending();
        }
        bool isAdmin = hasRole(VAULT_ADMIN_ROLE, msg.sender);
        require(isAdmin || msg.sender == proposal.proposer, "GuardianVault: not authorized to cancel");

        proposal.state = DataTypes.ProposalState.CANCELLED;
        emit TransactionCancelled(requestHash, msg.sender);
    }

    // ---------------------------------------------------------------------------------
    // Emergency controls
    // ---------------------------------------------------------------------------------

    function pause() external override onlyRole(VAULT_ADMIN_ROLE) {
        _pause();
        emit VaultPaused(msg.sender);
    }

    function unpause() external override onlyRole(VAULT_ADMIN_ROLE) {
        _unpause();
        emit VaultUnpaused(msg.sender);
    }

    function setRiskPolicy(address riskPolicy_) external onlyRole(VAULT_ADMIN_ROLE) {
        if (riskPolicy_ == address(0)) revert ZeroAddress();
        riskPolicy = IRiskPolicy(riskPolicy_);
    }

    /// @notice Set or clear (address(0)) the session-enforcement contract.
    function setSession(address session_) external onlyRole(VAULT_ADMIN_ROLE) {
        session = IGuardianSession(session_);
    }

    // ---------------------------------------------------------------------------------
    // Views
    // ---------------------------------------------------------------------------------

    function getProposalState(bytes32 requestHash) external view override returns (DataTypes.ProposalState) {
        return _proposals[requestHash].state;
    }

    function getProposal(bytes32 requestHash) external view returns (Proposal memory) {
        return _proposals[requestHash];
    }

    function hashRequest(DataTypes.TransactionRequest calldata request) external view returns (bytes32) {
        return _hashRequest(request);
    }

    function dailySpent() external view returns (uint256) {
        return _dailySpent[_dayIndex()];
    }

    // ---------------------------------------------------------------------------------
    // Internal
    // ---------------------------------------------------------------------------------

    function _hashRequest(DataTypes.TransactionRequest calldata request) internal view returns (bytes32) {
        bytes32 structHash = keccak256(
            abi.encode(
                _TX_REQUEST_TYPEHASH,
                request.vault,
                request.target,
                request.value,
                keccak256(request.data),
                request.nonce,
                request.deadline
            )
        );
        return _hashTypedDataV4(structHash);
    }

    function _isUnlimitedApproval(bytes calldata data) internal pure returns (bool) {
        if (data.length < 4 + 64) return false;
        if (bytes4(data[0:4]) != _APPROVE_SELECTOR) return false;
        uint256 amount = abi.decode(data[4 + 32:4 + 64], (uint256));
        return amount == type(uint256).max;
    }

    function _enforceSpendingLimits(uint256 value) internal view {
        (uint256 maxTxValue, uint256 dailyLimit) = riskPolicy.getSpendingLimits(address(this));
        if (maxTxValue != 0 && value > maxTxValue) revert ExceedsMaxTxValue();
        if (dailyLimit != 0 && _dailySpent[_dayIndex()] + value > dailyLimit) revert ExceedsDailyLimit();
    }

    function _dayIndex() internal view returns (uint256) {
        return block.timestamp / 1 days;
    }
}
