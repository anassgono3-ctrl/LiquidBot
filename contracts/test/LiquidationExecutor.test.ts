import { expect } from "chai";
import { ethers } from "hardhat";
import { LiquidationExecutor } from "../typechain-types";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

describe("LiquidationExecutor", function () {
  let executor: LiquidationExecutor;
  let owner: SignerWithAddress;
  let user: SignerWithAddress;
  
  const BALANCER_VAULT = "0xBA12222222228d8Ba445958a75a0704d566BF2C8";
  const AAVE_POOL = "0xA238Dd80C259a72e81d7e4664a9801593F98d1c5";
  const ONEINCH_ROUTER = "0x1111111254EEB25477B68fb85Ed929f73A960582";
  
  beforeEach(async function () {
    [owner, user] = await ethers.getSigners();
    
    const LiquidationExecutor = await ethers.getContractFactory("LiquidationExecutor");
    executor = await LiquidationExecutor.deploy(
      BALANCER_VAULT,
      AAVE_POOL,
      ONEINCH_ROUTER,
      owner.address
    );
    await executor.waitForDeployment();
  });

  describe("Deployment", function () {
    it("should set the correct owner", async function () {
      expect(await executor.owner()).to.equal(owner.address);
    });

    it("should set the correct addresses", async function () {
      expect(await executor.balancerVault()).to.equal(BALANCER_VAULT);
      expect(await executor.aavePool()).to.equal(AAVE_POOL);
      expect(await executor.oneInchRouter()).to.equal(ONEINCH_ROUTER);
      expect(await executor.payoutDefault()).to.equal(owner.address);
    });

    it("should not be paused initially", async function () {
      expect(await executor.paused()).to.equal(false);
    });

    it("should revert with zero addresses", async function () {
      const LiquidationExecutor = await ethers.getContractFactory("LiquidationExecutor");
      
      await expect(
        LiquidationExecutor.deploy(
          ethers.ZeroAddress,
          AAVE_POOL,
          ONEINCH_ROUTER,
          owner.address
        )
      ).to.be.revertedWithCustomError(executor, "InvalidAddress");
    });
  });

  describe("Access Control", function () {
    it("should allow owner to set vault address", async function () {
      const newVault = "0x0000000000000000000000000000000000000001";
      await expect(executor.setVault(newVault))
        .to.emit(executor, "ConfigUpdated")
        .withArgs("vault", newVault);
      expect(await executor.balancerVault()).to.equal(newVault);
    });

    it("should not allow non-owner to set vault address", async function () {
      const newVault = "0x0000000000000000000000000000000000000001";
      await expect(
        executor.connect(user).setVault(newVault)
      ).to.be.revertedWithCustomError(executor, "Unauthorized");
    });

    it("should allow owner to set pool address", async function () {
      const newPool = "0x0000000000000000000000000000000000000001";
      await executor.setPool(newPool);
      expect(await executor.aavePool()).to.equal(newPool);
    });

    it("should allow owner to set router address", async function () {
      const newRouter = "0x0000000000000000000000000000000000000001";
      await executor.setRouter(newRouter);
      expect(await executor.oneInchRouter()).to.equal(newRouter);
    });

    it("should allow owner to set payout address", async function () {
      const newPayout = user.address;
      await executor.setPayoutDefault(newPayout);
      expect(await executor.payoutDefault()).to.equal(newPayout);
    });

    it("should reject zero address for setters", async function () {
      await expect(
        executor.setVault(ethers.ZeroAddress)
      ).to.be.revertedWithCustomError(executor, "InvalidAddress");
    });
  });

  describe("Whitelist Management", function () {
    const testAsset = "0x0000000000000000000000000000000000000001";

    it("should allow owner to whitelist asset", async function () {
      await expect(executor.setWhitelist(testAsset, true))
        .to.emit(executor, "AssetWhitelisted")
        .withArgs(testAsset, true);
      expect(await executor.whitelistedAssets(testAsset)).to.equal(true);
    });

    it("should allow owner to remove asset from whitelist", async function () {
      await executor.setWhitelist(testAsset, true);
      await executor.setWhitelist(testAsset, false);
      expect(await executor.whitelistedAssets(testAsset)).to.equal(false);
    });

    it("should not allow non-owner to whitelist asset", async function () {
      await expect(
        executor.connect(user).setWhitelist(testAsset, true)
      ).to.be.revertedWithCustomError(executor, "Unauthorized");
    });
  });

  describe("Pause Functionality", function () {
    it("should allow owner to pause", async function () {
      await expect(executor.pause())
        .to.emit(executor, "Paused")
        .withArgs(owner.address);
      expect(await executor.paused()).to.equal(true);
    });

    it("should allow owner to unpause", async function () {
      await executor.pause();
      await expect(executor.unpause())
        .to.emit(executor, "Unpaused")
        .withArgs(owner.address);
      expect(await executor.paused()).to.equal(false);
    });

    it("should not allow non-owner to pause", async function () {
      await expect(
        executor.connect(user).pause()
      ).to.be.revertedWithCustomError(executor, "Unauthorized");
    });

    it("should block initiateLiquidation when paused", async function () {
      await executor.pause();
      
      const params = {
        user: user.address,
        collateralAsset: ethers.ZeroAddress,
        debtAsset: ethers.ZeroAddress,
        debtToCover: 0,
        oneInchCalldata: "0x",
        minOut: 0,
        payout: ethers.ZeroAddress
      };
      
      await expect(
        executor.initiateLiquidation(params)
      ).to.be.revertedWithCustomError(executor, "ContractPaused");
    });
  });

  describe("Ownership Transfer", function () {
    it("should allow owner to transfer ownership", async function () {
      await executor.transferOwnership(user.address);
      expect(await executor.owner()).to.equal(user.address);
    });

    it("should not allow non-owner to transfer ownership", async function () {
      await expect(
        executor.connect(user).transferOwnership(user.address)
      ).to.be.revertedWithCustomError(executor, "Unauthorized");
    });

    it("should reject zero address for ownership transfer", async function () {
      await expect(
        executor.transferOwnership(ethers.ZeroAddress)
      ).to.be.revertedWithCustomError(executor, "InvalidAddress");
    });
  });

  describe("Liquidation Initiation", function () {
    const collateralAsset = "0x0000000000000000000000000000000000000001";
    const debtAsset = "0x0000000000000000000000000000000000000002";

    it("should revert if collateral asset not whitelisted", async function () {
      await executor.setWhitelist(debtAsset, true);
      
      const params = {
        user: user.address,
        collateralAsset: collateralAsset,
        debtAsset: debtAsset,
        debtToCover: 100,
        oneInchCalldata: "0x",
        minOut: 100,
        payout: owner.address
      };
      
      await expect(
        executor.initiateLiquidation(params)
      ).to.be.revertedWithCustomError(executor, "AssetNotWhitelisted");
    });

    it("should revert if debt asset not whitelisted", async function () {
      await executor.setWhitelist(collateralAsset, true);
      
      const params = {
        user: user.address,
        collateralAsset: collateralAsset,
        debtAsset: debtAsset,
        debtToCover: 100,
        oneInchCalldata: "0x",
        minOut: 100,
        payout: owner.address
      };
      
      await expect(
        executor.initiateLiquidation(params)
      ).to.be.revertedWithCustomError(executor, "AssetNotWhitelisted");
    });
  });
});
