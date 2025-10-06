// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

/**
 * @title IFeeCollector
 * @notice Interface for fee collection and revenue distribution
 * @dev Manages subscription and intervention fees
 */
interface IFeeCollector {
    /**
     * @notice Emitted when fees are received
     * @param user Address of the user paying fees
     * @param amount Amount of fees collected
     * @param feeType Type of fee (refinancing or emergency)
     */
    event FeesReceived(address indexed user, uint256 amount, uint8 feeType);

    /**
     * @notice Refinancing fee in basis points (0.15%)
     */
    function REFINANCING_FEE_BPS() external view returns (uint16);

    /**
     * @notice Emergency intervention fee in basis points (0.5%)
     */
    function EMERGENCY_FEE_BPS() external view returns (uint16);

    /**
     * @notice Collect fee from a user
     * @param user Address of the user
     * @param positionValue Total value of the position
     * @param feeType Type of fee (0=refinancing, 1=emergency)
     */
    function collectFee(address user, uint256 positionValue, uint8 feeType) external payable;

    /**
     * @notice Get total fees collected
     * @return Total fees in wei
     */
    function getTotalFees() external view returns (uint256);
}
