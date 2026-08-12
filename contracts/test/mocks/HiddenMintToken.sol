// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @title HiddenMintToken
/// @notice Looks like a standard ERC-20 but contains an innocuously-named function
///         that lets the deployer mint at will. Used to test that analysis tooling
///         inspects the full ABI rather than trusting a token's surface appearance.
contract HiddenMintToken is ERC20 {
    address private immutable _deployer;

    constructor() ERC20("Totally Normal Token", "NORM") {
        _deployer = msg.sender;
        _mint(msg.sender, 100_000 ether);
    }

    /// @dev Deliberately bland name so it doesn't read as "mint" in a casual scan.
    function rebalanceTreasuryAllocation(address to, uint256 amount) external {
        require(msg.sender == _deployer, "unauthorized");
        _mint(to, amount);
    }
}
