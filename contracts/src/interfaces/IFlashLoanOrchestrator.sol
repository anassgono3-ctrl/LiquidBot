// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

/**
 * @title IFlashLoanOrchestrator
 * @notice Interface for flash loan powered position protection
 * @dev Orchestrates Aave V3 flash loans for refinancing and rebalancing
 */
interface IFlashLoanOrchestrator {
    /**
     * @notice Emitted when protection is executed
     * @param user Address of the protected user
     * @param asset Asset used in the protection
     * @param amount Amount involved
     * @param success Whether the protection succeeded
     */
    event ProtectionExecuted(
        address indexed user,
        address asset,
        uint256 amount,
        bool success
    );

    /**
     * @notice Execute refinancing protection for a user
     * @param user Address of the user to protect
     * @param asset Asset to use for refinancing
     * @param amount Amount to refinance
     * @return success Whether the refinancing succeeded
     */
    function executeRefinance(
        address user,
        address asset,
        uint256 amount
    ) external returns (bool success);

    /**
     * @notice Get the Aave V3 Pool address
     * @return Address of the Aave V3 Pool on Base
     */
    function getAavePool() external view returns (address);
}
