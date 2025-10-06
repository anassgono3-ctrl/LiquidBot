// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

/**
 * @title IPositionManager
 * @notice Interface for managing user positions and subscriptions
 * @dev Handles position registration and subscription tiers
 */
interface IPositionManager {
    /**
     * @notice Emitted when a user registers a position
     * @param user Address of the user
     * @param timestamp When the position was registered
     */
    event PositionRegistered(address indexed user, uint256 timestamp);

    /**
     * @notice Emitted when a user unregisters a position
     * @param user Address of the user
     * @param timestamp When the position was unregistered
     */
    event PositionUnregistered(address indexed user, uint256 timestamp);

    /**
     * @notice Emitted when subscription tier is updated
     * @param user Address of the user
     * @param tier New subscription tier (0=BASIC, 1=PREMIUM, 2=ENTERPRISE)
     */
    event SubscriptionUpdated(address indexed user, uint8 tier);

    /**
     * @notice Register a position for monitoring
     * @param healthFactorThreshold Minimum health factor threshold for alerts
     */
    function registerPosition(uint256 healthFactorThreshold) external;

    /**
     * @notice Unregister a position
     */
    function unregisterPosition() external;

    /**
     * @notice Check if a user has an active position
     * @param user Address to check
     * @return True if position is registered
     */
    function isRegistered(address user) external view returns (bool);

    /**
     * @notice Get user's subscription tier
     * @param user Address to check
     * @return Subscription tier (0=BASIC, 1=PREMIUM, 2=ENTERPRISE)
     */
    function getSubscriptionTier(address user) external view returns (uint8);
}
