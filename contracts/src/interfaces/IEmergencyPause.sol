// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

/**
 * @title IEmergencyPause
 * @notice Interface for emergency pause functionality
 * @dev Provides circuit breaker pattern for system-wide safety
 */
interface IEmergencyPause {
    /**
     * @notice Emitted when the system is paused
     * @param guardian Address that triggered the pause
     * @param timestamp When the pause occurred
     */
    event Paused(address indexed guardian, uint256 timestamp);

    /**
     * @notice Emitted when the system is unpaused
     * @param guardian Address that triggered the unpause
     * @param timestamp When the unpause occurred
     */
    event Unpaused(address indexed guardian, uint256 timestamp);

    /**
     * @notice Check if the system is currently paused
     * @return True if paused, false otherwise
     */
    function isPaused() external view returns (bool);

    /**
     * @notice Pause the system
     * @dev Only callable by guardian
     */
    function pause() external;

    /**
     * @notice Unpause the system
     * @dev Only callable by guardian
     */
    function unpause() external;
}
