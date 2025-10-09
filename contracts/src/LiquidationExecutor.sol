// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import {IFlashLoanRecipient} from "./interfaces/IFlashLoanRecipient.sol";
import {IBalancerVault} from "./interfaces/IBalancerVault.sol";
import {IAavePool} from "./interfaces/IAavePool.sol";
import {IERC20} from "./interfaces/IERC20.sol";

/**
 * @title LiquidationExecutor
 * @notice Production-ready on-chain liquidation executor for Base
 * @dev Atomically: borrows via Balancer flash loan, liquidates on Aave V3, swaps via 1inch, repays loan
 * @dev Chain: Base (chainId 8453)
 */
contract LiquidationExecutor is IFlashLoanRecipient {
    // State variables
    address public owner;
    address public balancerVault;
    address public aavePool;
    address public oneInchRouter;
    address public payoutDefault;
    bool public paused;
    
    // Asset whitelist mapping
    mapping(address => bool) public whitelistedAssets;
    
    // Events
    event LiquidationExecuted(
        address indexed user,
        address indexed collateralAsset,
        address indexed debtAsset,
        uint256 profit,
        uint256 gasRefund
    );
    
    event ConfigUpdated(string param, address value);
    event AssetWhitelisted(address indexed asset, bool status);
    event Paused(address indexed by);
    event Unpaused(address indexed by);
    
    // Errors
    error Unauthorized();
    error Paused();
    error InvalidAddress();
    error AssetNotWhitelisted();
    error InsufficientOutput();
    error FlashLoanFailed();
    error SwapFailed();
    error OnlyVault();
    
    // Modifiers
    modifier onlyOwner() {
        if (msg.sender != owner) revert Unauthorized();
        _;
    }
    
    modifier whenNotPaused() {
        if (paused) revert Paused();
        _;
    }
    
    // Struct for liquidation parameters
    struct LiquidationParams {
        address user;
        address collateralAsset;
        address debtAsset;
        uint256 debtToCover;
        bytes oneInchCalldata;
        uint256 minOut;
        address payout;
    }
    
    /**
     * @notice Constructor
     * @param _balancerVault Balancer Vault address (0xBA12222222228d8Ba445958a75a0704d566BF2C8 on Base)
     * @param _aavePool Aave V3 Pool address (0xA238Dd80C259a72e81d7e4664a9801593F98d1c5 on Base)
     * @param _oneInchRouter 1inch Aggregation Router address (0x1111111254EEB25477B68fb85Ed929f73A960582 on Base)
     * @param _payoutDefault Default payout address for profits
     */
    constructor(
        address _balancerVault,
        address _aavePool,
        address _oneInchRouter,
        address _payoutDefault
    ) {
        if (_balancerVault == address(0)) revert InvalidAddress();
        if (_aavePool == address(0)) revert InvalidAddress();
        if (_oneInchRouter == address(0)) revert InvalidAddress();
        if (_payoutDefault == address(0)) revert InvalidAddress();
        
        owner = msg.sender;
        balancerVault = _balancerVault;
        aavePool = _aavePool;
        oneInchRouter = _oneInchRouter;
        payoutDefault = _payoutDefault;
        paused = false;
    }
    
    /**
     * @notice Initiate liquidation with Balancer flash loan
     * @param params Liquidation parameters
     */
    function initiateLiquidation(LiquidationParams calldata params) external onlyOwner whenNotPaused {
        // Validate assets are whitelisted
        if (!whitelistedAssets[params.collateralAsset]) revert AssetNotWhitelisted();
        if (!whitelistedAssets[params.debtAsset]) revert AssetNotWhitelisted();
        
        // Prepare flash loan request
        address[] memory tokens = new address[](1);
        tokens[0] = params.debtAsset;
        
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = params.debtToCover;
        
        // Encode parameters for callback
        bytes memory userData = abi.encode(params);
        
        // Request flash loan from Balancer
        IBalancerVault(balancerVault).flashLoan(
            address(this),
            tokens,
            amounts,
            userData
        );
    }
    
    /**
     * @notice Balancer flash loan callback
     * @param tokens Array of borrowed tokens
     * @param amounts Array of borrowed amounts
     * @param feeAmounts Array of fee amounts (0 for Balancer)
     * @param userData Encoded liquidation parameters
     */
    function receiveFlashLoan(
        address[] memory tokens,
        uint256[] memory amounts,
        uint256[] memory feeAmounts,
        bytes memory userData
    ) external override {
        // Only Balancer Vault can call this
        if (msg.sender != balancerVault) revert OnlyVault();
        
        // Decode parameters
        LiquidationParams memory params = abi.decode(userData, (LiquidationParams));
        
        // Step 1: Approve Aave Pool to spend debt token
        IERC20(params.debtAsset).approve(aavePool, params.debtToCover);
        
        // Step 2: Execute liquidation on Aave V3
        IAavePool(aavePool).liquidationCall(
            params.collateralAsset,
            params.debtAsset,
            params.user,
            params.debtToCover,
            false // Receive underlying collateral, not aTokens
        );
        
        // Step 3: Check received collateral
        uint256 collateralReceived = IERC20(params.collateralAsset).balanceOf(address(this));
        
        // Step 4: Approve 1inch router to spend collateral
        IERC20(params.collateralAsset).approve(oneInchRouter, collateralReceived);
        
        // Step 5: Swap collateral to debt asset via 1inch
        (bool swapSuccess, bytes memory swapResult) = oneInchRouter.call(params.oneInchCalldata);
        if (!swapSuccess) revert SwapFailed();
        
        // Step 6: Verify output meets minimum
        uint256 debtAssetBalance = IERC20(params.debtAsset).balanceOf(address(this));
        if (debtAssetBalance < params.minOut) revert InsufficientOutput();
        
        // Step 7: Repay flash loan (principal + fee)
        uint256 totalRepayment = amounts[0] + feeAmounts[0];
        IERC20(tokens[0]).transfer(balancerVault, totalRepayment);
        
        // Step 8: Calculate and transfer profit
        uint256 profit = debtAssetBalance - totalRepayment;
        address payoutAddress = params.payout != address(0) ? params.payout : payoutDefault;
        
        if (profit > 0) {
            IERC20(params.debtAsset).transfer(payoutAddress, profit);
        }
        
        // Step 9: Emit event
        emit LiquidationExecuted(
            params.user,
            params.collateralAsset,
            params.debtAsset,
            profit,
            0 // Gas refund placeholder for future implementation
        );
    }
    
    /**
     * @notice Set Balancer Vault address
     * @param _vault New vault address
     */
    function setVault(address _vault) external onlyOwner {
        if (_vault == address(0)) revert InvalidAddress();
        balancerVault = _vault;
        emit ConfigUpdated("vault", _vault);
    }
    
    /**
     * @notice Set Aave Pool address
     * @param _pool New pool address
     */
    function setPool(address _pool) external onlyOwner {
        if (_pool == address(0)) revert InvalidAddress();
        aavePool = _pool;
        emit ConfigUpdated("pool", _pool);
    }
    
    /**
     * @notice Set 1inch Router address
     * @param _router New router address
     */
    function setRouter(address _router) external onlyOwner {
        if (_router == address(0)) revert InvalidAddress();
        oneInchRouter = _router;
        emit ConfigUpdated("router", _router);
    }
    
    /**
     * @notice Set default payout address
     * @param _payout New payout address
     */
    function setPayoutDefault(address _payout) external onlyOwner {
        if (_payout == address(0)) revert InvalidAddress();
        payoutDefault = _payout;
        emit ConfigUpdated("payoutDefault", _payout);
    }
    
    /**
     * @notice Set asset whitelist status
     * @param asset Asset address
     * @param status Whitelist status
     */
    function setWhitelist(address asset, bool status) external onlyOwner {
        whitelistedAssets[asset] = status;
        emit AssetWhitelisted(asset, status);
    }
    
    /**
     * @notice Pause contract
     */
    function pause() external onlyOwner {
        paused = true;
        emit Paused(msg.sender);
    }
    
    /**
     * @notice Unpause contract
     */
    function unpause() external onlyOwner {
        paused = false;
        emit Unpaused(msg.sender);
    }
    
    /**
     * @notice Transfer ownership
     * @param newOwner New owner address
     */
    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert InvalidAddress();
        owner = newOwner;
    }
    
    /**
     * @notice Emergency withdraw tokens
     * @param token Token address
     * @param amount Amount to withdraw
     */
    function emergencyWithdraw(address token, uint256 amount) external onlyOwner {
        IERC20(token).transfer(owner, amount);
    }
}
