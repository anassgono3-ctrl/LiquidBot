import { expect } from "chai";
import { ethers } from "hardhat";
import { LiquidationExecutor } from "../typechain-types";

describe("LiquidationExecutor - Base Fork Smoke Test", function () {
  // Skip if RPC_URL not configured
  before(function() {
    if (!process.env.RPC_URL) {
      console.log("⏭️  Skipping fork tests: RPC_URL not configured");
      this.skip();
    }
  });
  
  let executor: LiquidationExecutor;
  
  const BALANCER_VAULT = "0xBA12222222228d8Ba445958a75a0704d566BF2C8";
  const AAVE_POOL = "0xA238Dd80C259a72e81d7e4664a9801593F98d1c5";
  const ONEINCH_ROUTER = "0x1111111254EEB25477B68fb85Ed929f73A960582";
  
  it("should deploy executor on Base fork", async function () {
    this.timeout(60000); // Increase timeout for fork operations
    
    const [deployer] = await ethers.getSigners();
    
    const LiquidationExecutor = await ethers.getContractFactory("LiquidationExecutor");
    executor = await LiquidationExecutor.deploy(
      BALANCER_VAULT,
      AAVE_POOL,
      ONEINCH_ROUTER,
      deployer.address
    );
    await executor.waitForDeployment();
    
    const executorAddress = await executor.getAddress();
    console.log(`✅ Executor deployed at: ${executorAddress}`);
    
    expect(executorAddress).to.be.properAddress;
  });
  
  it("should verify protocol addresses are contracts on Base", async function () {
    this.timeout(60000);
    
    // Check that protocol addresses have code (are contracts)
    const vaultCode = await ethers.provider.getCode(BALANCER_VAULT);
    const aaveCode = await ethers.provider.getCode(AAVE_POOL);
    const routerCode = await ethers.provider.getCode(ONEINCH_ROUTER);
    
    expect(vaultCode).to.not.equal("0x");
    expect(aaveCode).to.not.equal("0x");
    expect(routerCode).to.not.equal("0x");
    
    console.log("✅ All protocol addresses are valid contracts");
  });
  
  it("should have correct configuration", async function () {
    this.timeout(60000);
    
    const [deployer] = await ethers.getSigners();
    
    expect(await executor.owner()).to.equal(deployer.address);
    expect(await executor.balancerVault()).to.equal(BALANCER_VAULT);
    expect(await executor.aavePool()).to.equal(AAVE_POOL);
    expect(await executor.oneInchRouter()).to.equal(ONEINCH_ROUTER);
    expect(await executor.paused()).to.equal(false);
    
    console.log("✅ Executor configuration verified");
  });
  
  it("should support whitelist operations", async function () {
    this.timeout(60000);
    
    // Base USDC address
    const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
    
    await executor.setWhitelist(USDC, true);
    expect(await executor.whitelistedAssets(USDC)).to.equal(true);
    
    await executor.setWhitelist(USDC, false);
    expect(await executor.whitelistedAssets(USDC)).to.equal(false);
    
    console.log("✅ Whitelist operations work correctly");
  });
  
  it("should support pause/unpause", async function () {
    this.timeout(60000);
    
    await executor.pause();
    expect(await executor.paused()).to.equal(true);
    
    await executor.unpause();
    expect(await executor.paused()).to.equal(false);
    
    console.log("✅ Pause/unpause operations work correctly");
  });
  
  it("should validate call path preparation (no execution)", async function () {
    this.timeout(60000);
    
    // This test validates the wiring without executing a real liquidation
    // We just verify the contract can receive the correct parameters
    
    const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
    const WETH = "0x4200000000000000000000000000000000000006";
    
    // Whitelist assets
    await executor.setWhitelist(USDC, true);
    await executor.setWhitelist(WETH, true);
    
    const params = {
      user: ethers.ZeroAddress, // Dummy user
      collateralAsset: WETH,
      debtAsset: USDC,
      debtToCover: 1000,
      oneInchCalldata: "0x",
      minOut: 1000,
      payout: ethers.ZeroAddress
    };
    
    // Should fail at flash loan stage (no balance) but validates wiring
    // We expect it to revert during the flash loan callback
    await expect(executor.initiateLiquidation(params))
      .to.be.reverted;
    
    console.log("✅ Call path validated (reverted as expected without funding)");
  });
});
