// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import {IPositionManager} from "./interfaces/IPositionManager.sol";
import {IEmergencyPause} from "./interfaces/IEmergencyPause.sol";

/**
 * @title PositionManager
 * @notice Manages user subscriptions and position registration
 * @dev Central registry for monitoring positions
 */
contract PositionManager is IPositionManager {
    /**
     * @notice Position information for a user
     * @param registered Whether the position is active
     * @param healthFactorThreshold Minimum HF threshold for alerts
     * @param subscriptionTier Subscription level (0=BASIC, 1=PREMIUM, 2=ENTERPRISE)
     * @param enrolledAt When the position was registered
     */
    struct Position {
        bool registered;
        uint256 healthFactorThreshold;
        uint8 subscriptionTier;
        uint256 enrolledAt;
    }

    /// @notice Emergency pause contract reference
    IEmergencyPause public immutable emergencyPause;

    /// @notice Admin address for tier updates
    address public admin;

    /// @notice Mapping of user addresses to their positions
    mapping(address => Position) public positions;

    /**
     * @notice Modifier to check if system is not paused
     */
    modifier whenNotPaused() {
        require(!emergencyPause.isPaused(), "PositionManager: system is paused");
        _;
    }

    /**
     * @notice Modifier to restrict access to admin only
     */
    modifier onlyAdmin() {
        require(msg.sender == admin, "PositionManager: caller is not admin");
        _;
    }

    /**
     * @notice Initialize the position manager
     * @param _emergencyPause Address of the emergency pause contract
     * @param _admin Address of the admin
     */
    constructor(address _emergencyPause, address _admin) {
        require(_emergencyPause != address(0), "PositionManager: emergency pause is zero address");
        require(_admin != address(0), "PositionManager: admin is zero address");
        emergencyPause = IEmergencyPause(_emergencyPause);
        admin = _admin;
    }

    /**
     * @inheritdoc IPositionManager
     */
    function registerPosition(uint256 healthFactorThreshold) external override whenNotPaused {
        require(!positions[msg.sender].registered, "PositionManager: already registered");
        require(healthFactorThreshold > 0, "PositionManager: invalid threshold");

        positions[msg.sender] = Position({
            registered: true,
            healthFactorThreshold: healthFactorThreshold,
            subscriptionTier: 0, // Default to BASIC
            enrolledAt: block.timestamp
        });

        emit PositionRegistered(msg.sender, block.timestamp);
    }

    /**
     * @inheritdoc IPositionManager
     */
    function unregisterPosition() external override {
        require(positions[msg.sender].registered, "PositionManager: not registered");
        
        delete positions[msg.sender];
        emit PositionUnregistered(msg.sender, block.timestamp);
    }

    /**
     * @inheritdoc IPositionManager
     */
    function isRegistered(address user) external view override returns (bool) {
        return positions[user].registered;
    }

    /**
     * @inheritdoc IPositionManager
     */
    function getSubscriptionTier(address user) external view override returns (uint8) {
        return positions[user].subscriptionTier;
    }

    /**
     * @notice Update user's subscription tier (admin only)
     * @param user Address of the user
     * @param tier New subscription tier (0=BASIC, 1=PREMIUM, 2=ENTERPRISE)
     */
    function updateSubscriptionTier(address user, uint8 tier) external onlyAdmin {
        require(positions[user].registered, "PositionManager: user not registered");
        require(tier <= 2, "PositionManager: invalid tier");
        
        positions[user].subscriptionTier = tier;
        emit SubscriptionUpdated(user, tier);
    }
}
