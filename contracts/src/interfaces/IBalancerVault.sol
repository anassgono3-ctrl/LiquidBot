// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

/**
 * @title IBalancerVault
 * @notice Minimal interface for Balancer V2 Vault flash loans
 * @dev Balancer Vault on Base: 0xBA12222222228d8Ba445958a75a0704d566BF2C8
 */
interface IBalancerVault {
    /**
     * @notice Perform a flash loan
     * @param recipient Contract receiving the flash loan (must implement IFlashLoanRecipient)
     * @param tokens Array of token addresses to borrow
     * @param amounts Array of amounts to borrow
     * @param userData Arbitrary data to pass to recipient
     */
    function flashLoan(
        address recipient,
        address[] memory tokens,
        uint256[] memory amounts,
        bytes memory userData
    ) external;
}
