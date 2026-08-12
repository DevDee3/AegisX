// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title UpgradeableAttack
/// @notice A minimal, deliberately naive upgradeable proxy: the owner can repoint
///         `implementation` to any address at any time, with no timelock and no
///         event history a naive scanner would catch. Used to test Guardian's
///         upgrade-detection / implementation-snapshot monitoring.
contract UpgradeableAttack {
    address public owner;
    address public implementation;

    constructor(address initialImplementation) {
        owner = msg.sender;
        implementation = initialImplementation;
    }

    function upgradeTo(address newImplementation) external {
        require(msg.sender == owner, "not owner");
        implementation = newImplementation;
    }

    fallback() external payable {
        address impl = implementation;
        assembly {
            calldatacopy(0, 0, calldatasize())
            let result := delegatecall(gas(), impl, 0, calldatasize(), 0, 0)
            returndatacopy(0, 0, returndatasize())
            switch result
            case 0 { revert(0, returndatasize()) }
            default { return(0, returndatasize()) }
        }
    }

    receive() external payable {}
}
