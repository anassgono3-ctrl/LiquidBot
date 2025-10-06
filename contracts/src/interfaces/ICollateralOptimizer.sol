// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

/**
 * @title ICollateralOptimizer
 * @notice Interface for collateral rebalancing strategies
 * @dev Provides automated collateral swap planning and execution
 */
interface ICollateralOptimizer {
    /**
     * @notice Emitted when a rebalance plan is generated
     * @param user Address of the user
     * @param fromAsset Source collateral asset
     * @param toAsset Target collateral asset
     * @param amount Amount to rebalance
     */
    event RebalancePlanned(
        address indexed user,
        address fromAsset,
        address toAsset,
        uint256 amount
    );

    /**
     * @notice Emitted when a rebalance is executed
     * @param user Address of the user
     * @param fromAsset Source collateral asset
     * @param toAsset Target collateral asset
     * @param amount Amount rebalanced
     * @param success Whether the rebalance succeeded
     */
    event RebalanceExecuted(
        address indexed user,
        address fromAsset,
        address toAsset,
        uint256 amount,
        bool success
    );

    /**
     * @notice Generate a rebalance plan for user's collateral
     * @param user Address of the user
     * @return fromAsset Source asset to swap from
     * @return toAsset Target asset to swap to
     * @return amount Amount to swap
     */
    function planRebalance(address user)
        external
        view
        returns (
            address fromAsset,
            address toAsset,
            uint256 amount
        );

    /**
     * @notice Execute a collateral rebalance
     * @param user Address of the user
     * @param fromAsset Source asset
     * @param toAsset Target asset
     * @param amount Amount to swap
     */
    function executeRebalance(
        address user,
        address fromAsset,
        address toAsset,
        uint256 amount
    ) external;
}
