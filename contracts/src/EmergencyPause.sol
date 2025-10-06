// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import {IEmergencyPause} from "./interfaces/IEmergencyPause.sol";

/**
 * @title EmergencyPause
 * @notice Circuit breaker for system-wide emergency situations
 * @dev Guardian-controlled pause/unpause mechanism
 */
contract EmergencyPause is IEmergencyPause {
    /// @notice Guardian address with pause/unpause privileges
    address public guardian;

    /// @notice Current pause state
    bool private _paused;

    /**
     * @notice Modifier to restrict access to guardian only
     */
    modifier onlyGuardian() {
        require(msg.sender == guardian, "EmergencyPause: caller is not guardian");
        _;
    }

    /**
     * @notice Initialize the contract with a guardian
     * @param _guardian Address of the guardian
     */
    constructor(address _guardian) {
        require(_guardian != address(0), "EmergencyPause: guardian is zero address");
        guardian = _guardian;
        _paused = false;
    }

    /**
     * @inheritdoc IEmergencyPause
     */
    function isPaused() external view override returns (bool) {
        return _paused;
    }

    /**
     * @inheritdoc IEmergencyPause
     */
    function pause() external override onlyGuardian {
        require(!_paused, "EmergencyPause: already paused");
        _paused = true;
        emit Paused(msg.sender, block.timestamp);
    }

    /**
     * @inheritdoc IEmergencyPause
     */
    function unpause() external override onlyGuardian {
        require(_paused, "EmergencyPause: not paused");
        _paused = false;
        emit Unpaused(msg.sender, block.timestamp);
    }
}
