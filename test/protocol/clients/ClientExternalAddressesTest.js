const { ethers } = require("hardhat");
const { getSigners, ZeroAddress, getContractFactory, getContractAt } = ethers;
const { gasLimit } = require("../../../environments");
const { deployProtocolClientImpls } = require("../../../scripts/util/deploy-protocol-client-impls.js");
const { deployProtocolClientBeacons } = require("../../../scripts/util/deploy-protocol-client-beacons.js");
const { expect } = require("chai");
const { RevertReasons } = require("../../../scripts/config/revert-reasons");
const { maxPriorityFeePerGas } = require("../../util/constants.js");
const { setupTestEnvironment, getSnapshot, revertToSnapshot } = require("../../util/utils.js");

describe("IClientExternalAddresses", function () {
  let deployer, rando, other1, other3;
  let beacon;
  let voucherImplementation, protocolAddress;
  let snapshotId;
  let protocolDiamondAddress;
  let bosonErrors;

  before(async function () {
    // Specify contracts needed for this test
    const contracts = {};

    ({
      signers: [rando, other1, other3],
      diamondAddress: protocolDiamondAddress,
      extraReturnValues: { beacon },
    } = await setupTestEnvironment(contracts));

    bosonErrors = await getContractAt("BosonErrors", protocolDiamondAddress);

    [deployer] = await getSigners();

    // Get snapshot id
    snapshotId = await getSnapshot();
  });

  afterEach(async function () {
    await revertToSnapshot(snapshotId);
    snapshotId = await getSnapshot();
  });

  // Interface support
  context("📋 Setters", async function () {
    context("👉 setImplementation()", async function () {
      beforeEach(async function () {
        // set new value for voucher implementation
        voucherImplementation = await other1.getAddress(); // random address, just for test
      });

      it("should emit an Upgraded event", async function () {
        // Set new implementation, testing for the event
        await expect(beacon.connect(deployer).setImplementation(voucherImplementation))
          .to.emit(beacon, "Upgraded")
          .withArgs(voucherImplementation, await deployer.getAddress());
      });

      it("should update state", async function () {
        // Set new implementation
        await beacon.connect(deployer).setImplementation(voucherImplementation);

        // Verify that new value is stored
        expect(await beacon.connect(rando).getImplementation()).to.equal(voucherImplementation);
      });

      context("💔 Revert Reasons", async function () {
        it("caller is not the admin", async function () {
          // Attempt to set new implementation, expecting revert
          await expect(beacon.connect(rando).setImplementation(voucherImplementation)).to.revertedWithCustomError(
            bosonErrors,
            RevertReasons.ACCESS_DENIED
          );
        });

        it("implementation address is the zero address", async function () {
          // Attempt to set new implementation, expecting revert
          await expect(beacon.connect(deployer).setImplementation(ZeroAddress)).to.revertedWithCustomError(
            bosonErrors,
            RevertReasons.INVALID_ADDRESS
          );
        });
      });
    });

    context("👉 setProtocolAddress()", async function () {
      beforeEach(async function () {
        // set new value for protocol address
        protocolAddress = await other3.getAddress(); // random address, just for test
      });

      it("should emit a ProtocolAddressChanged event", async function () {
        // Set new protocol address, testing for the event
        await expect(beacon.connect(deployer).setProtocolAddress(protocolAddress))
          .to.emit(beacon, "ProtocolAddressChanged")
          .withArgs(protocolAddress, await deployer.getAddress());
      });

      it("should update state", async function () {
        // Set new protocol address
        await beacon.connect(deployer).setProtocolAddress(protocolAddress);

        // Verify that new value is stored
        expect(await beacon.connect(rando).getProtocolAddress()).to.equal(protocolAddress);
      });

      context("💔 Revert Reasons", async function () {
        it("caller is not the admin", async function () {
          // Attempt to set new protocol address, expecting revert
          await expect(beacon.connect(rando).setProtocolAddress(protocolAddress)).to.revertedWithCustomError(
            bosonErrors,
            RevertReasons.ACCESS_DENIED
          );
        });

        it("protocol address is the zero address", async function () {
          // Attempt to set new protocol address, expecting revert
          await expect(beacon.connect(deployer).setProtocolAddress(ZeroAddress)).to.revertedWithCustomError(
            bosonErrors,
            RevertReasons.INVALID_ADDRESS
          );
        });
      });
    });

    context("👉 constructor", async function () {
      context("💔 Revert Reasons", async function () {
        it("_protocolAddress address is the zero address", async function () {
          // Deploy Protocol Client implementation contracts
          const protocolClientImpls = await deployProtocolClientImpls([ZeroAddress], maxPriorityFeePerGas);

          // Deploy Protocol Client beacon contracts
          const protocolClientArgs = [ZeroAddress];
          await expect(
            deployProtocolClientBeacons(protocolClientImpls, protocolClientArgs, maxPriorityFeePerGas)
          ).to.revertedWithCustomError(bosonErrors, RevertReasons.INVALID_ADDRESS);
        });

        it("_impl address is the zero address", async function () {
          // Client args
          const protocolClientArgs = [protocolDiamondAddress];

          // Deploy the ClientBeacon for BosonVoucher
          const ClientBeacon = await getContractFactory("BosonClientBeacon");
          await expect(
            ClientBeacon.deploy(...protocolClientArgs, ZeroAddress, { gasLimit })
          ).to.revertedWithCustomError(bosonErrors, RevertReasons.INVALID_ADDRESS);
        });
      });
    });
  });
});
