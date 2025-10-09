// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "../interfaces/IERC20.sol";

/**
 * @title MockAavePool
 * @notice Mock Aave V3 Pool for testing liquidations
 * @dev Simulates liquidation with configurable liquidation bonus
 */
contract MockAavePool {
    // Liquidation bonus in basis points (e.g., 500 = 5%)
    uint256 public liquidationBonus = 500; // 5% bonus by default
    
    /**
     * @notice Set liquidation bonus for testing
     * @param _bonus Bonus in basis points
     */
    function setLiquidationBonus(uint256 _bonus) external {
        liquidationBonus = _bonus;
    }
    
    /**
     * @notice Mock liquidation call
     * @param collateralAsset Address of collateral asset
     * @param debtAsset Address of debt asset
     * @param debtToCover Amount of debt to cover
     * @return Amount of collateral received
     */
    function liquidationCall(
        address collateralAsset,
        address debtAsset,
        address /* user */,
        uint256 debtToCover,
        bool /* receiveAToken */
    ) external returns (uint256) {
        // Transfer debt from liquidator to pool
        IERC20(debtAsset).transferFrom(msg.sender, address(this), debtToCover);
        
        // Calculate collateral to give (debt + bonus)
        uint256 collateralAmount = debtToCover + (debtToCover * liquidationBonus / 10000);
        
        // Transfer collateral to liquidator
        IERC20(collateralAsset).transfer(msg.sender, collateralAmount);
        
        return collateralAmount;
    }
}
