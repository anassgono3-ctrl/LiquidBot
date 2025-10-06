// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import {IFeeCollector} from "./interfaces/IFeeCollector.sol";
import {IEmergencyPause} from "./interfaces/IEmergencyPause.sol";

/**
 * @title FeeCollector
 * @notice Aggregates fees and manages revenue distribution
 * @dev Implements fee collection for refinancing and emergency interventions
 */
contract FeeCollector is IFeeCollector {
    /// @inheritdoc IFeeCollector
    uint16 public constant REFINANCING_FEE_BPS = 15; // 0.15%

    /// @inheritdoc IFeeCollector
    uint16 public constant EMERGENCY_FEE_BPS = 50; // 0.5%

    /// @notice Emergency pause contract reference
    IEmergencyPause public immutable emergencyPause;

    /// @notice Total fees collected
    uint256 private _totalFees;

    /// @notice Admin address for withdrawals (placeholder)
    address public admin;

    /**
     * @notice Modifier to check if system is not paused
     */
    modifier whenNotPaused() {
        require(!emergencyPause.isPaused(), "FeeCollector: system is paused");
        _;
    }

    /**
     * @notice Modifier to restrict access to admin only
     */
    modifier onlyAdmin() {
        require(msg.sender == admin, "FeeCollector: caller is not admin");
        _;
    }

    /**
     * @notice Initialize the fee collector
     * @param _emergencyPause Address of the emergency pause contract
     * @param _admin Address of the admin
     */
    constructor(address _emergencyPause, address _admin) {
        require(_emergencyPause != address(0), "FeeCollector: emergency pause is zero address");
        require(_admin != address(0), "FeeCollector: admin is zero address");
        emergencyPause = IEmergencyPause(_emergencyPause);
        admin = _admin;
    }

    /**
     * @inheritdoc IFeeCollector
     */
    function collectFee(
        address user,
        uint256 positionValue,
        uint8 feeType
    ) external payable override whenNotPaused {
        require(user != address(0), "FeeCollector: user is zero address");
        require(positionValue > 0, "FeeCollector: position value is zero");
        require(feeType <= 1, "FeeCollector: invalid fee type");

        uint16 feeBps = feeType == 0 ? REFINANCING_FEE_BPS : EMERGENCY_FEE_BPS;
        uint256 expectedFee = (positionValue * feeBps) / 10000;
        
        require(msg.value >= expectedFee, "FeeCollector: insufficient fee");

        _totalFees += msg.value;
        emit FeesReceived(user, msg.value, feeType);
    }

    /**
     * @inheritdoc IFeeCollector
     */
    function getTotalFees() external view override returns (uint256) {
        return _totalFees;
    }

    /**
     * @notice Withdraw collected fees (admin only)
     * @param amount Amount to withdraw
     * @dev Placeholder for multisig integration
     */
    function withdrawFees(uint256 amount) external onlyAdmin {
        require(amount <= address(this).balance, "FeeCollector: insufficient balance");
        payable(admin).transfer(amount);
    }

    /**
     * @notice Receive function to accept ETH
     */
    receive() external payable {
        _totalFees += msg.value;
    }
}
