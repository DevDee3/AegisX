// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {DataTypes} from "../libraries/DataTypes.sol";

interface IRiskPolicy {
    event ThresholdsUpdated(uint256 lowMax, uint256 mediumMax, uint256 highMax);
    event SpendingLimitsUpdated(address indexed vault, uint256 maxTxValue, uint256 dailyLimit);

    /// @notice Deterministically evaluate a transaction request.
    /// @dev The AI score is ONE input among many deterministic, on-chain-verifiable
    ///      signals. Hard rules (unlimited approval, blocked target, over-limit, etc.)
    ///      cannot be overridden regardless of the AI score.
    function evaluate(
        DataTypes.TransactionRequest calldata request,
        uint256 aiScore,
        bool isKnownUnlimitedApproval
    ) external view returns (DataTypes.RiskAssessment memory assessment);

    function setThresholds(uint256 lowMax, uint256 mediumMax, uint256 highMax) external;
    function setSpendingLimits(address vault, uint256 maxTxValue, uint256 dailyLimit) external;
    function getSpendingLimits(address vault) external view returns (uint256 maxTxValue, uint256 dailyLimit);
}
