// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

/**
 * @title IAavePool
 * @notice Minimal interface for Aave V3 Pool liquidation calls
 * @dev Aave V3 Pool on Base: 0xA238Dd80C259a72e81d7e4664a9801593F98d1c5
 */
interface IAavePool {
    /**
     * @notice Liquidate a position
     * @param collateralAsset The address of the collateral asset
     * @param debtAsset The address of the debt asset
     * @param user The address of the borrower
     * @param debtToCover The amount of debt to cover
     * @param receiveAToken True to receive aTokens, false to receive underlying
     * @return The actual amount of collateral liquidated
     */
    function liquidationCall(
        address collateralAsset,
        address debtAsset,
        address user,
        uint256 debtToCover,
        bool receiveAToken
    ) external returns (uint256);
}
