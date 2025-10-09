// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

/**
 * @title IFlashLoanRecipient
 * @notice Interface for Balancer flash loan recipients
 * @dev Contract must implement this to receive Balancer flash loans
 */
interface IFlashLoanRecipient {
    /**
     * @notice Callback for Balancer flash loans
     * @param tokens Array of token addresses borrowed
     * @param amounts Array of amounts borrowed
     * @param feeAmounts Array of fee amounts (0 for Balancer on most networks)
     * @param userData Arbitrary data passed from flashLoan call
     */
    function receiveFlashLoan(
        address[] memory tokens,
        uint256[] memory amounts,
        uint256[] memory feeAmounts,
        bytes memory userData
    ) external;
}
