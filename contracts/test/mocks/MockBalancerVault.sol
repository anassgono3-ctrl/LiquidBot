// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "../../src/interfaces/IFlashLoanRecipient.sol";

/**
 * @title MockBalancerVault
 * @notice Mock Balancer Vault for testing flash loans (0% fee)
 */
contract MockBalancerVault {
    /**
     * @notice Execute flash loan
     * @param recipient Recipient contract (must implement IFlashLoanRecipient)
     * @param tokens Array of token addresses to borrow
     * @param amounts Array of amounts to borrow
     * @param userData Arbitrary data to pass to recipient
     */
    function flashLoan(
        address recipient,
        address[] memory tokens,
        uint256[] memory amounts,
        bytes memory userData
    ) external {
        // Transfer tokens to recipient
        for (uint256 i = 0; i < tokens.length; i++) {
            MockERC20(tokens[i]).transfer(recipient, amounts[i]);
        }
        
        // Call receiveFlashLoan on recipient (with zero fees for Balancer)
        uint256[] memory feeAmounts = new uint256[](amounts.length);
        IFlashLoanRecipient(recipient).receiveFlashLoan(
            tokens,
            amounts,
            feeAmounts,
            userData
        );
        
        // Expect repayment (principal + fee, but fee is 0 for Balancer)
        for (uint256 i = 0; i < tokens.length; i++) {
            uint256 expectedRepayment = amounts[i] + feeAmounts[i];
            require(
                MockERC20(tokens[i]).balanceOf(address(this)) >= expectedRepayment,
                "Flash loan not repaid"
            );
        }
    }
    
    // Helper to check balance
    function getBalance(address token) external view returns (uint256) {
        return MockERC20(token).balanceOf(address(this));
    }
}

// Import MockERC20 interface for calls
interface MockERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}
