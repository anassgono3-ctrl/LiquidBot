// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

/**
 * @title MockOneInchRouter
 * @notice Mock 1inch router for testing swaps
 * @dev Simulates swap with configurable rate
 */
contract MockOneInchRouter {
    // Exchange rate in basis points (e.g., 10000 = 1:1, 9500 = 0.95:1)
    uint256 public exchangeRate = 10000; // 1:1 by default
    
    address public srcToken;
    address public dstToken;
    
    /**
     * @notice Set exchange rate for testing
     * @param _rate Rate in basis points (10000 = 1:1)
     */
    function setExchangeRate(uint256 _rate) external {
        exchangeRate = _rate;
    }
    
    /**
     * @notice Configure token pair for swap
     * @param _srcToken Source token address
     * @param _dstToken Destination token address
     */
    function setTokenPair(address _srcToken, address _dstToken) external {
        srcToken = _srcToken;
        dstToken = _dstToken;
    }
    
    /**
     * @notice Mock swap function
     * @dev Called via low-level call from executor
     * This simulates the 1inch swap interface
     */
    fallback() external {
        // Get src token balance of caller (executor)
        uint256 srcAmount = MockERC20(srcToken).balanceOf(msg.sender);
        
        // Pull src tokens from caller
        MockERC20(srcToken).transferFrom(msg.sender, address(this), srcAmount);
        
        // Calculate output amount with exchange rate
        uint256 dstAmount = srcAmount * exchangeRate / 10000;
        
        // Send dst tokens to caller
        MockERC20(dstToken).transfer(msg.sender, dstAmount);
    }
}

interface MockERC20 {
    function balanceOf(address account) external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}
