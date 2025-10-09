// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

/**
 * @title IAggregationRouterV6
 * @notice Minimal interface for 1inch Aggregation Router V6
 * @dev 1inch Router on Base: 0x1111111254EEB25477B68fb85Ed929f73A960582
 * @dev We use a generic call interface since calldata is provided by 1inch API
 */
interface IAggregationRouterV6 {
    /**
     * @notice Execute a swap with provided calldata
     * @dev The actual swap function signature varies, so we rely on low-level call
     * @dev Calldata is obtained from 1inch API
     */
    // Note: We'll use a low-level call with calldata from 1inch API
    // No specific function signature needed here
}
