import { expect } from "chai";
import { ethers } from "hardhat";
import { LiquidationExecutor } from "../typechain-types";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

describe("LiquidationExecutor - Unit Tests with Mocks", function () {
  let executor: LiquidationExecutor;
  let mockVault: any;
  let mockAave: any;
  let mockRouter: any;
  let collateralToken: any;
  let debtToken: any;
  let owner: SignerWithAddress;
  let user: SignerWithAddress;
  let payout: SignerWithAddress;
  
  beforeEach(async function () {
    [owner, user, payout] = await ethers.getSigners();
    
    // Deploy mock tokens
    const MockERC20 = await ethers.getContractFactory("src/mocks/MockERC20.sol:MockERC20");
    collateralToken = await MockERC20.deploy("Wrapped Ether", "WETH", 18);
    debtToken = await MockERC20.deploy("USD Coin", "USDC", 6);
    await collateralToken.waitForDeployment();
    await debtToken.waitForDeployment();
    
    // Deploy mock protocols
    const MockBalancerVault = await ethers.getContractFactory("MockBalancerVault");
    mockVault = await MockBalancerVault.deploy();
    await mockVault.waitForDeployment();
    
    const MockAavePool = await ethers.getContractFactory("MockAavePool");
    mockAave = await MockAavePool.deploy();
    await mockAave.waitForDeployment();
    
    const MockOneInchRouter = await ethers.getContractFactory("MockOneInchRouter");
    mockRouter = await MockOneInchRouter.deploy();
    await mockRouter.waitForDeployment();
    
    // Deploy executor with mock addresses
    const LiquidationExecutor = await ethers.getContractFactory("LiquidationExecutor");
    executor = await LiquidationExecutor.deploy(
      await mockVault.getAddress(),
      await mockAave.getAddress(),
      await mockRouter.getAddress(),
      owner.address
    );
    await executor.waitForDeployment();
    
    // Whitelist assets
    await executor.setWhitelist(await collateralToken.getAddress(), true);
    await executor.setWhitelist(await debtToken.getAddress(), true);
  });

  describe("Happy Path - Full Liquidation Flow", function () {
    it("should execute complete liquidation: flashLoan -> liquidate -> swap -> repay -> profit", async function () {
      const debtToCover = ethers.parseUnits("1000", 6); // 1000 USDC
      const liquidationBonus = 500; // 5%
      const collateralReceived = debtToCover + (debtToCover * BigInt(liquidationBonus) / BigInt(10000));
      
      // Setup: Fund vault with debt tokens
      await debtToken.mint(await mockVault.getAddress(), debtToCover);
      
      // Setup: Fund Aave pool with collateral (to give back during liquidation)
      await collateralToken.mint(await mockAave.getAddress(), collateralReceived);
      
      // Setup: Configure router to swap collateral -> debt at 1:1 rate (since collateral > debt, we make profit)
      await mockRouter.setTokenPair(await collateralToken.getAddress(), await debtToken.getAddress());
      await mockRouter.setExchangeRate(10000); // 1:1
      await debtToken.mint(await mockRouter.getAddress(), collateralReceived); // Fund router with output tokens
      
      // Build 1inch calldata (empty for mock - mock router uses fallback)
      const oneInchCalldata = "0x";
      const minOut = debtToCover; // Expect at least debtToCover back
      
      const params = {
        user: user.address,
        collateralAsset: await collateralToken.getAddress(),
        debtAsset: await debtToken.getAddress(),
        debtToCover: debtToCover,
        oneInchCalldata: oneInchCalldata,
        minOut: minOut,
        payout: payout.address
      };
      
      // Execute liquidation
      const tx = await executor.initiateLiquidation(params);
      const receipt = await tx.wait();
      
      // Verify event was emitted
      const event = receipt?.logs.find(
        (log: any) => {
          try {
            const parsed = executor.interface.parseLog(log);
            return parsed?.name === "LiquidationExecuted";
          } catch {
            return false;
          }
        }
      );
      
      expect(event).to.not.be.undefined;
      
      // Parse event to check profit
      const parsedEvent = executor.interface.parseLog(event!);
      const profit = parsedEvent?.args.profit;
      
      // Expected profit: collateralReceived (1:1 swap) - debtToCover
      const expectedProfit = collateralReceived - debtToCover;
      
      // Profit should equal liquidation bonus amount (within 1 wei for rounding)
      expect(profit).to.be.closeTo(expectedProfit, 1);
      
      // Verify payout received profit
      const payoutBalance = await debtToken.balanceOf(payout.address);
      expect(payoutBalance).to.equal(profit);
    });
    
    it("should handle exact minOut with no profit", async function () {
      const debtToCover = ethers.parseUnits("1000", 6);
      const collateralReceived = debtToCover; // No bonus for edge case
      
      await debtToken.mint(await mockVault.getAddress(), debtToCover);
      await collateralToken.mint(await mockAave.getAddress(), collateralReceived);
      await mockAave.setLiquidationBonus(0); // No bonus
      
      await mockRouter.setTokenPair(await collateralToken.getAddress(), await debtToken.getAddress());
      await mockRouter.setExchangeRate(10000);
      await debtToken.mint(await mockRouter.getAddress(), collateralReceived);
      
      const params = {
        user: user.address,
        collateralAsset: await collateralToken.getAddress(),
        debtAsset: await debtToken.getAddress(),
        debtToCover: debtToCover,
        oneInchCalldata: "0x",
        minOut: debtToCover,
        payout: payout.address
      };
      
      await expect(executor.initiateLiquidation(params))
        .to.emit(executor, "LiquidationExecuted");
    });
  });

  describe("Slippage Guard", function () {
    it("should revert if swap output < minOut", async function () {
      const debtToCover = ethers.parseUnits("1000", 6);
      const collateralReceived = debtToCover + (debtToCover * BigInt(500) / BigInt(10000));
      
      await debtToken.mint(await mockVault.getAddress(), debtToCover);
      await collateralToken.mint(await mockAave.getAddress(), collateralReceived);
      
      // Configure bad swap rate (95% - lose 5%)
      await mockRouter.setTokenPair(await collateralToken.getAddress(), await debtToken.getAddress());
      await mockRouter.setExchangeRate(9500); // 0.95:1
      await debtToken.mint(await mockRouter.getAddress(), collateralReceived);
      
      const params = {
        user: user.address,
        collateralAsset: await collateralToken.getAddress(),
        debtAsset: await debtToken.getAddress(),
        debtToCover: debtToCover,
        oneInchCalldata: "0x",
        minOut: debtToCover + BigInt(100), // Require more than we'll get
        payout: payout.address
      };
      
      await expect(executor.initiateLiquidation(params))
        .to.be.revertedWithCustomError(executor, "InsufficientOutput");
    });
    
    it("should succeed when minOut is met exactly", async function () {
      const debtToCover = ethers.parseUnits("1000", 6);
      const collateralReceived = debtToCover + (debtToCover * BigInt(500) / BigInt(10000));
      
      await debtToken.mint(await mockVault.getAddress(), debtToCover);
      await collateralToken.mint(await mockAave.getAddress(), collateralReceived);
      
      // Swap at 1:1
      await mockRouter.setTokenPair(await collateralToken.getAddress(), await debtToken.getAddress());
      await mockRouter.setExchangeRate(10000);
      await debtToken.mint(await mockRouter.getAddress(), collateralReceived);
      
      const swapOutput = collateralReceived; // 1:1 swap
      
      const params = {
        user: user.address,
        collateralAsset: await collateralToken.getAddress(),
        debtAsset: await debtToken.getAddress(),
        debtToCover: debtToCover,
        oneInchCalldata: "0x",
        minOut: swapOutput, // Exact minOut
        payout: payout.address
      };
      
      await expect(executor.initiateLiquidation(params))
        .to.emit(executor, "LiquidationExecuted");
    });
  });

  describe("Pause Functionality", function () {
    it("should block initiateLiquidation when paused", async function () {
      await executor.pause();
      
      const params = {
        user: user.address,
        collateralAsset: await collateralToken.getAddress(),
        debtAsset: await debtToken.getAddress(),
        debtToCover: 100,
        oneInchCalldata: "0x",
        minOut: 100,
        payout: payout.address
      };
      
      await expect(executor.initiateLiquidation(params))
        .to.be.revertedWithCustomError(executor, "ContractPaused");
    });
    
    it("should allow execution after unpause", async function () {
      const debtToCover = ethers.parseUnits("1000", 6);
      const collateralReceived = debtToCover + (debtToCover * BigInt(500) / BigInt(10000));
      
      // Setup tokens
      await debtToken.mint(await mockVault.getAddress(), debtToCover);
      await collateralToken.mint(await mockAave.getAddress(), collateralReceived);
      await mockRouter.setTokenPair(await collateralToken.getAddress(), await debtToken.getAddress());
      await mockRouter.setExchangeRate(10000);
      await debtToken.mint(await mockRouter.getAddress(), collateralReceived);
      
      // Pause and unpause
      await executor.pause();
      await executor.unpause();
      
      const params = {
        user: user.address,
        collateralAsset: await collateralToken.getAddress(),
        debtAsset: await debtToken.getAddress(),
        debtToCover: debtToCover,
        oneInchCalldata: "0x",
        minOut: debtToCover,
        payout: payout.address
      };
      
      await expect(executor.initiateLiquidation(params))
        .to.emit(executor, "LiquidationExecuted");
    });
  });

  describe("Whitelist Enforcement", function () {
    it("should revert if collateral not whitelisted", async function () {
      // Deploy non-whitelisted token
      const MockERC20 = await ethers.getContractFactory("src/mocks/MockERC20.sol:MockERC20");
      const badToken = await MockERC20.deploy("Bad Token", "BAD", 18);
      await badToken.waitForDeployment();
      
      const params = {
        user: user.address,
        collateralAsset: await badToken.getAddress(),
        debtAsset: await debtToken.getAddress(),
        debtToCover: 100,
        oneInchCalldata: "0x",
        minOut: 100,
        payout: payout.address
      };
      
      await expect(executor.initiateLiquidation(params))
        .to.be.revertedWithCustomError(executor, "AssetNotWhitelisted");
    });
    
    it("should revert if debt not whitelisted", async function () {
      const MockERC20 = await ethers.getContractFactory("src/mocks/MockERC20.sol:MockERC20");
      const badToken = await MockERC20.deploy("Bad Token", "BAD", 18);
      await badToken.waitForDeployment();
      
      const params = {
        user: user.address,
        collateralAsset: await collateralToken.getAddress(),
        debtAsset: await badToken.getAddress(),
        debtToCover: 100,
        oneInchCalldata: "0x",
        minOut: 100,
        payout: payout.address
      };
      
      await expect(executor.initiateLiquidation(params))
        .to.be.revertedWithCustomError(executor, "AssetNotWhitelisted");
    });
    
    it("should allow liquidation with both assets whitelisted", async function () {
      const debtToCover = ethers.parseUnits("1000", 6);
      const collateralReceived = debtToCover + (debtToCover * BigInt(500) / BigInt(10000));
      
      await debtToken.mint(await mockVault.getAddress(), debtToCover);
      await collateralToken.mint(await mockAave.getAddress(), collateralReceived);
      await mockRouter.setTokenPair(await collateralToken.getAddress(), await debtToken.getAddress());
      await mockRouter.setExchangeRate(10000);
      await debtToken.mint(await mockRouter.getAddress(), collateralReceived);
      
      const params = {
        user: user.address,
        collateralAsset: await collateralToken.getAddress(),
        debtAsset: await debtToken.getAddress(),
        debtToCover: debtToCover,
        oneInchCalldata: "0x",
        minOut: debtToCover,
        payout: payout.address
      };
      
      await expect(executor.initiateLiquidation(params))
        .to.emit(executor, "LiquidationExecuted");
    });
  });

  describe("Approval Flows", function () {
    it("should approve Aave pool for debt token", async function () {
      const debtToCover = ethers.parseUnits("1000", 6);
      const collateralReceived = debtToCover + (debtToCover * BigInt(500) / BigInt(10000));
      
      await debtToken.mint(await mockVault.getAddress(), debtToCover);
      await collateralToken.mint(await mockAave.getAddress(), collateralReceived);
      await mockRouter.setTokenPair(await collateralToken.getAddress(), await debtToken.getAddress());
      await mockRouter.setExchangeRate(10000);
      await debtToken.mint(await mockRouter.getAddress(), collateralReceived);
      
      const params = {
        user: user.address,
        collateralAsset: await collateralToken.getAddress(),
        debtAsset: await debtToken.getAddress(),
        debtToCover: debtToCover,
        oneInchCalldata: "0x",
        minOut: debtToCover,
        payout: payout.address
      };
      
      await executor.initiateLiquidation(params);
      
      // Check allowance was used (should be 0 after liquidation)
      const allowance = await debtToken.allowance(await executor.getAddress(), await mockAave.getAddress());
      expect(allowance).to.equal(0);
    });
    
    it("should approve 1inch router for collateral token", async function () {
      const debtToCover = ethers.parseUnits("1000", 6);
      const collateralReceived = debtToCover + (debtToCover * BigInt(500) / BigInt(10000));
      
      await debtToken.mint(await mockVault.getAddress(), debtToCover);
      await collateralToken.mint(await mockAave.getAddress(), collateralReceived);
      await mockRouter.setTokenPair(await collateralToken.getAddress(), await debtToken.getAddress());
      await mockRouter.setExchangeRate(10000);
      await debtToken.mint(await mockRouter.getAddress(), collateralReceived);
      
      const params = {
        user: user.address,
        collateralAsset: await collateralToken.getAddress(),
        debtAsset: await debtToken.getAddress(),
        debtToCover: debtToCover,
        oneInchCalldata: "0x",
        minOut: debtToCover,
        payout: payout.address
      };
      
      await executor.initiateLiquidation(params);
      
      // Check allowance was used
      const allowance = await collateralToken.allowance(await executor.getAddress(), await mockRouter.getAddress());
      expect(allowance).to.equal(0);
    });
  });

  describe("Event Assertions", function () {
    it("should emit LiquidationExecuted with correct parameters", async function () {
      const debtToCover = ethers.parseUnits("1000", 6);
      const liquidationBonus = 500;
      const collateralReceived = debtToCover + (debtToCover * BigInt(liquidationBonus) / BigInt(10000));
      
      await debtToken.mint(await mockVault.getAddress(), debtToCover);
      await collateralToken.mint(await mockAave.getAddress(), collateralReceived);
      await mockRouter.setTokenPair(await collateralToken.getAddress(), await debtToken.getAddress());
      await mockRouter.setExchangeRate(10000);
      await debtToken.mint(await mockRouter.getAddress(), collateralReceived);
      
      const params = {
        user: user.address,
        collateralAsset: await collateralToken.getAddress(),
        debtAsset: await debtToken.getAddress(),
        debtToCover: debtToCover,
        oneInchCalldata: "0x",
        minOut: debtToCover,
        payout: payout.address
      };
      
      await expect(executor.initiateLiquidation(params))
        .to.emit(executor, "LiquidationExecuted")
        .withArgs(
          user.address,
          await collateralToken.getAddress(),
          await debtToken.getAddress(),
          collateralReceived - debtToCover, // profit
          0 // gasRefund placeholder
        );
    });
    
    it("should calculate profit exactly (within 1 wei)", async function () {
      const debtToCover = ethers.parseUnits("1000", 6);
      const liquidationBonus = 500;
      const collateralReceived = debtToCover + (debtToCover * BigInt(liquidationBonus) / BigInt(10000));
      
      await debtToken.mint(await mockVault.getAddress(), debtToCover);
      await collateralToken.mint(await mockAave.getAddress(), collateralReceived);
      await mockRouter.setTokenPair(await collateralToken.getAddress(), await debtToken.getAddress());
      await mockRouter.setExchangeRate(10000);
      await debtToken.mint(await mockRouter.getAddress(), collateralReceived);
      
      const params = {
        user: user.address,
        collateralAsset: await collateralToken.getAddress(),
        debtAsset: await debtToken.getAddress(),
        debtToCover: debtToCover,
        oneInchCalldata: "0x",
        minOut: debtToCover,
        payout: payout.address
      };
      
      const tx = await executor.initiateLiquidation(params);
      const receipt = await tx.wait();
      
      const event = receipt?.logs.find((log: any) => {
        try {
          const parsed = executor.interface.parseLog(log);
          return parsed?.name === "LiquidationExecuted";
        } catch {
          return false;
        }
      });
      
      const parsedEvent = executor.interface.parseLog(event!);
      const profit = parsedEvent?.args.profit;
      
      // Expected: collateral swapped 1:1 - debtToCover = liquidation bonus
      const expectedProfit = collateralReceived - debtToCover;
      
      // Check within 1 wei (for any rounding in calculations)
      expect(profit).to.be.closeTo(expectedProfit, 1);
    });
  });
});
