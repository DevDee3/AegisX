// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @title MockRouter
/// @notice Benign stand-in for a trusted DEX router, used for happy-path tests.
contract MockRouter {
    event Swapped(address indexed caller, address tokenIn, uint256 amountIn, address tokenOut, uint256 amountOut);

    function swap(address tokenIn, uint256 amountIn, address tokenOut, uint256 minOut) external returns (uint256) {
        IERC20(tokenIn).transferFrom(msg.sender, address(this), amountIn);
        uint256 amountOut = amountIn; // 1:1 mock rate
        require(amountOut >= minOut, "slippage");
        IERC20(tokenOut).transfer(msg.sender, amountOut);
        emit Swapped(msg.sender, tokenIn, amountIn, tokenOut, amountOut);
        return amountOut;
    }
}
