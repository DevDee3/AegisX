// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @title MaliciousToken
/// @notice Test-only ERC20 with unrestricted owner minting and account freezing,
///         used to exercise Guardian's detection paths. NEVER deploy to mainnet.
contract MaliciousToken is ERC20 {
    address public owner;
    mapping(address => bool) public frozen;

    constructor() ERC20("Malicious Token", "EVIL") {
        owner = msg.sender;
        _mint(msg.sender, 1_000_000 ether);
    }

    modifier onlyOwner() {
        require(msg.sender == owner, "not owner");
        _;
    }

    /// @notice Unrestricted privileged minting — a red flag a real analyzer should catch.
    function privilegedMint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }

    /// @notice Owner can freeze arbitrary accounts, blocking their transfers.
    function freeze(address account) external onlyOwner {
        frozen[account] = true;
    }

    function unfreeze(address account) external onlyOwner {
        frozen[account] = false;
    }

    /// @notice Owner can arbitrarily manipulate balances — another red flag.
    function privilegedSetBalance(address account, uint256 newBalance) external onlyOwner {
        uint256 current = balanceOf(account);
        if (newBalance > current) {
            _mint(account, newBalance - current);
        } else if (newBalance < current) {
            _burn(account, current - newBalance);
        }
    }

    function _update(address from, address to, uint256 value) internal override {
        require(!frozen[from], "sender frozen");
        require(!frozen[to], "recipient frozen");
        super._update(from, to, value);
    }
}
