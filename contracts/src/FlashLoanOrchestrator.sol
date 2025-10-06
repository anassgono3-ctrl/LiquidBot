// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import {IFlashLoanOrchestrator} from "./interfaces/IFlashLoanOrchestrator.sol";
import {IEmergencyPause} from "./interfaces/IEmergencyPause.sol";
import {ICollateralOptimizer} from "./interfaces/ICollateralOptimizer.sol";

/**
 * @title FlashLoanOrchestrator
 * @notice Orchestrates Aave V3 flash loans for position protection
 * @dev Integrates with Aave V3 Pool on Base (0xA238Dd80C259a72e81d7e4664a9801593F98d1c5)
 * @dev Stub implementation - flash loan callback logic to be completed
 */
contract FlashLoanOrchestrator is IFlashLoanOrchestrator {
    /// @notice Aave V3 Pool address on Base
    address public constant AAVE_POOL = 0xA238Dd80C259a72e81d7e4664a9801593F98d1c5;

    /// @notice Emergency pause contract reference
    IEmergencyPause public immutable emergencyPause;

    /// @notice Collateral optimizer contract reference
    ICollateralOptimizer public immutable collateralOptimizer;

    /// @notice Position manager address (authorized caller)
    address public positionManager;

    /**
     * @notice Modifier to check if system is not paused
     */
    modifier whenNotPaused() {
        require(!emergencyPause.isPaused(), "FlashLoanOrchestrator: system is paused");
        _;
    }

    /**
     * @notice Modifier to restrict access to position manager only
     */
    modifier onlyPositionManager() {
        require(
            msg.sender == positionManager,
            "FlashLoanOrchestrator: caller is not position manager"
        );
        _;
    }

    /**
     * @notice Initialize the flash loan orchestrator
     * @param _emergencyPause Address of the emergency pause contract
     * @param _collateralOptimizer Address of the collateral optimizer
     * @param _positionManager Address of the position manager
     */
    constructor(
        address _emergencyPause,
        address _collateralOptimizer,
        address _positionManager
    ) {
        require(_emergencyPause != address(0), "FlashLoanOrchestrator: emergency pause is zero address");
        require(_collateralOptimizer != address(0), "FlashLoanOrchestrator: collateral optimizer is zero address");
        require(_positionManager != address(0), "FlashLoanOrchestrator: position manager is zero address");
        
        emergencyPause = IEmergencyPause(_emergencyPause);
        collateralOptimizer = ICollateralOptimizer(_collateralOptimizer);
        positionManager = _positionManager;
    }

    /**
     * @inheritdoc IFlashLoanOrchestrator
     * @dev Stub implementation - emits event only
     * Future: Integrate with Aave V3 flashLoan() and implement executeOperation()
     */
    function executeRefinance(
        address user,
        address asset,
        uint256 amount
    ) external override onlyPositionManager whenNotPaused returns (bool success) {
        require(user != address(0), "FlashLoanOrchestrator: user is zero address");
        require(asset != address(0), "FlashLoanOrchestrator: asset is zero address");
        require(amount > 0, "FlashLoanOrchestrator: amount is zero");

        // Stub: Future implementation will:
        // 1. Request flash loan from Aave V3 Pool
        // 2. Execute refinancing in executeOperation callback
        // 3. Call CollateralOptimizer if needed
        // 4. Repay flash loan with 0% fee (where applicable on Base)
        
        emit ProtectionExecuted(user, asset, amount, true);
        return true;
    }

    /**
     * @inheritdoc IFlashLoanOrchestrator
     */
    function getAavePool() external pure override returns (address) {
        return AAVE_POOL;
    }

    /**
     * @notice Flash loan callback (Aave V3 IFlashLoanReceiver interface)
     * @dev To be implemented with reentrancy guards and validation
     * @param assets Array of flash loan assets
     * @param amounts Array of flash loan amounts
     * @param premiums Array of flash loan premiums
     * @param initiator Address that initiated the flash loan
     * @param params Additional encoded parameters
     * @return success True if operation succeeded
     */
    function executeOperation(
        address[] calldata assets,
        uint256[] calldata amounts,
        uint256[] calldata premiums,
        address initiator,
        bytes calldata params
    ) external returns (bool success) {
        // Stub: Placeholder for flash loan callback logic
        // Future: Implement refinancing logic, slippage checks, oracle validation
        require(msg.sender == AAVE_POOL, "FlashLoanOrchestrator: caller must be Aave Pool");
        require(initiator == address(this), "FlashLoanOrchestrator: initiator must be this contract");
        
        // Avoid unused parameter warnings
        (assets, amounts, premiums, params);
        
        return true;
    }
}
