// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {DataTypes} from "./libraries/DataTypes.sol";
import {IRiskPolicy} from "./interfaces/IRiskPolicy.sol";
import {IGuardianRegistry} from "./interfaces/IGuardianRegistry.sol";

/// @title RiskPolicy
/// @notice Deterministic, on-chain risk scoring and policy enforcement.
/// @dev This contract NEVER blindly trusts the AI-supplied score. The AI score is
///      combined with registry status and hard security rules to produce a final,
///      reproducible decision. Hard rules can only ever push risk up / force a
///      BLOCK — they can never be bypassed by a favorable AI score.
contract RiskPolicy is IRiskPolicy, AccessControl {
    bytes32 public constant POLICY_ADMIN_ROLE = keccak256("POLICY_ADMIN_ROLE");

    IGuardianRegistry public immutable registry;

    // Risk tier upper bounds (inclusive). CRITICAL is anything > highMax.
    uint256 public lowMax = 30;
    uint256 public mediumMax = 60;
    uint256 public highMax = 80;

    // Weighted adjustments applied to the AI score. Expressed as signed deltas.
    uint256 public constant UNKNOWN_CONTRACT_PENALTY = 15;
    uint256 public constant UNLIMITED_APPROVAL_PENALTY = 40; // large enough to force BLOCK on its own
    uint256 public constant SUSPICIOUS_CONTRACT_PENALTY = 25;
    uint256 public constant TRUSTED_PROTOCOL_DISCOUNT = 20;

    struct SpendingLimit {
        uint256 maxTxValue;
        uint256 dailyLimit;
    }

    mapping(address => SpendingLimit) private _spendingLimits;

    error InvalidThresholds();
    error ZeroAddress();

    constructor(address admin, address registry_) {
        if (admin == address(0) || registry_ == address(0)) revert ZeroAddress();
        registry = IGuardianRegistry(registry_);
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(POLICY_ADMIN_ROLE, admin);
    }

    /// @inheritdoc IRiskPolicy
    function evaluate(
        DataTypes.TransactionRequest calldata request,
        uint256 aiScore,
        bool isKnownUnlimitedApproval
    ) external view override returns (DataTypes.RiskAssessment memory assessment) {
        // Clamp AI input defensively; the AI is treated as untrusted.
        uint256 score = aiScore > 100 ? 100 : aiScore;

        DataTypes.ContractStatus status = registry.getContractStatus(request.target);

        bool hardBlock = false;
        string memory reason = "Transaction within policy";

        // --- Hard rule: blocked target -------------------------------------------------
        if (status == DataTypes.ContractStatus.BLOCKED) {
            hardBlock = true;
            reason = "Target contract is blocklisted";
            score = 100;
        }

        // --- Hard rule: expired deadline ------------------------------------------------
        if (!hardBlock && request.deadline != 0 && request.deadline < block.timestamp) {
            hardBlock = true;
            reason = "Transaction request has expired";
            score = 100;
        }

        // --- Weighted adjustments (only if not already hard-blocked) --------------------
        if (!hardBlock) {
            if (status == DataTypes.ContractStatus.UNKNOWN) {
                score = _addCapped(score, UNKNOWN_CONTRACT_PENALTY);
                reason = "Target contract is not in the trusted registry";
            } else if (status == DataTypes.ContractStatus.SUSPICIOUS) {
                score = _addCapped(score, SUSPICIOUS_CONTRACT_PENALTY);
                reason = "Target contract has been flagged as suspicious";
            } else if (status == DataTypes.ContractStatus.TRUSTED) {
                score = _subCapped(score, TRUSTED_PROTOCOL_DISCOUNT);
            }

            if (isKnownUnlimitedApproval) {
                score = _addCapped(score, UNLIMITED_APPROVAL_PENALTY);
                reason = "Transaction grants unlimited token approval";
                hardBlock = true; // unlimited approval is always a hard block, regardless of resulting score
            }
        }

        DataTypes.RiskLevel level = _levelFor(score);
        DataTypes.Decision decision = _decisionFor(score, level, hardBlock);

        assessment = DataTypes.RiskAssessment({
            aiScore: aiScore,
            finalScore: score,
            level: level,
            decision: decision,
            hardRuleTriggered: hardBlock,
            reason: reason
        });
    }

    function _levelFor(uint256 score) internal view returns (DataTypes.RiskLevel) {
        if (score <= lowMax) return DataTypes.RiskLevel.LOW;
        if (score <= mediumMax) return DataTypes.RiskLevel.MEDIUM;
        if (score <= highMax) return DataTypes.RiskLevel.HIGH;
        return DataTypes.RiskLevel.CRITICAL;
    }

    function _decisionFor(uint256 score, DataTypes.RiskLevel level, bool hardBlock)
        internal
        pure
        returns (DataTypes.Decision)
    {
        if (hardBlock || level == DataTypes.RiskLevel.CRITICAL) return DataTypes.Decision.BLOCK;
        if (level == DataTypes.RiskLevel.HIGH) return DataTypes.Decision.DELAY;
        if (level == DataTypes.RiskLevel.MEDIUM) return DataTypes.Decision.REQUIRE_APPROVAL;
        score; // silence unused warning on LOW path
        return DataTypes.Decision.ALLOW;
    }

    function _addCapped(uint256 a, uint256 b) private pure returns (uint256) {
        uint256 sum = a + b;
        return sum > 100 ? 100 : sum;
    }

    function _subCapped(uint256 a, uint256 b) private pure returns (uint256) {
        return a > b ? a - b : 0;
    }

    /// @inheritdoc IRiskPolicy
    function setThresholds(uint256 lowMax_, uint256 mediumMax_, uint256 highMax_)
        external
        override
        onlyRole(POLICY_ADMIN_ROLE)
    {
        if (lowMax_ >= mediumMax_ || mediumMax_ >= highMax_ || highMax_ > 100) revert InvalidThresholds();
        lowMax = lowMax_;
        mediumMax = mediumMax_;
        highMax = highMax_;
        emit ThresholdsUpdated(lowMax_, mediumMax_, highMax_);
    }

    /// @inheritdoc IRiskPolicy
    function setSpendingLimits(address vault, uint256 maxTxValue, uint256 dailyLimit)
        external
        override
        onlyRole(POLICY_ADMIN_ROLE)
    {
        if (vault == address(0)) revert ZeroAddress();
        _spendingLimits[vault] = SpendingLimit({maxTxValue: maxTxValue, dailyLimit: dailyLimit});
        emit SpendingLimitsUpdated(vault, maxTxValue, dailyLimit);
    }

    /// @inheritdoc IRiskPolicy
    function getSpendingLimits(address vault) external view override returns (uint256 maxTxValue, uint256 dailyLimit) {
        SpendingLimit memory limit = _spendingLimits[vault];
        return (limit.maxTxValue, limit.dailyLimit);
    }
}
