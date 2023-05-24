const hre = require("hardhat");
const { expect } = require("chai");
const { utils, BigNumber } = hre.ethers;
const { getStorageAt } = require("@nomicfoundation/hardhat-network-helpers");
const PausableRegion = require("../../scripts/domain/PausableRegion.js");
const { getInterfaceIds } = require("../../scripts/config/supported-interfaces.js");
const { RevertReasons } = require("../../scripts/config/revert-reasons.js");
const { setupTestEnvironment, getSnapshot, revertToSnapshot } = require("../util/utils.js");

/**
 *  Test the Boson Pause Handler interface
 *
 *  Note: This only tests the pause/unpause functionality.
 *        Every transactional protocol method is tested
 *        for pausability in the test suites for the
 *        facets where they live.
 */
describe("IBosonPauseHandler", function () {
  // Common vars
  let InterfaceIds;
  let pauser, rando;
  let erc165, pauseHandler, support, regions;
  let snapshotId;

  before(async function () {
    // get interface Ids
    InterfaceIds = await getInterfaceIds();

    // Specify contracts needed for this test
    const contracts = {
      erc165: "ERC165Facet",
      pauseHandler: "IBosonPauseHandler",
    };

    ({
      signers: [pauser, rando],
      contractInstances: { erc165, pauseHandler },
    } = await setupTestEnvironment(contracts));

    // Get snapshot id
    snapshotId = await getSnapshot();
  });

  afterEach(async function () {
    await revertToSnapshot(snapshotId);
    snapshotId = await getSnapshot();
  });

  // Interface support (ERC-156 provided by ProtocolDiamond, others by deployed facets)
  context("📋 Interfaces", async function () {
    context("👉 supportsInterface()", async function () {
      it("should indicate support for IBosonPauseHandler interface", async function () {
        // Current interfaceId for IBosonPauseHandler
        support = await erc165.supportsInterface(InterfaceIds.IBosonPauseHandler);

        // Test
        expect(support, "IBosonPauseHandler interface not supported").is.true;
      });
    });
  });

  // All supported methods
  context("📋 Pause Handler Methods", async function () {
    context("👉 pause()", async function () {
      it("should emit a ProtocolPaused event", async function () {
        // Regions to pause
        regions = [PausableRegion.Offers, PausableRegion.Twins, PausableRegion.Bundles];

        // Pause the protocol, testing for the event
        await expect(pauseHandler.connect(pauser).pause(regions))
          .to.emit(pauseHandler, "ProtocolPaused")
          .withArgs(regions, pauser.address);
      });

      it.only("should pause all regions when no regions are specified", async function () {
        // Pause the protocol, testing for the event
        await expect(pauseHandler.connect(pauser).pause([]))
          .to.emit(pauseHandler, "ProtocolPaused")
          .withArgs([], pauser.address);

        // Check that all regions are paused
        const protocolStatusStorageSlot = utils.keccak256(utils.toUtf8Bytes("boson.protocol.initializers"));
        const protocolStatusStorageSlotNumber = BigNumber.from(protocolStatusStorageSlot);

        // pause scenario
        const pauseScenario = await getStorageAt(pauseHandler.address, protocolStatusStorageSlotNumber);
        expect(BigNumber.from(pauseScenario).toNumber(), "Protocol not paused").to.equal(78);
      });

      context("💔 Revert Reasons", async function () {
        it("Caller does not have PAUSER role", async function () {
          // Attempt to pause without PAUSER role, expecting revert
          await expect(pauseHandler.connect(rando).pause([])).to.revertedWith(RevertReasons.ACCESS_DENIED);
        });

        it("Protocol is already paused", async function () {
          // Pause protocol
          await pauseHandler.connect(pauser).pause([PausableRegion.Sellers]);

          // Attempt to pause while already paused, expecting revert
          await expect(pauseHandler.connect(pauser).pause([PausableRegion.Buyers])).to.revertedWith(
            RevertReasons.ALREADY_PAUSED
          );
        });
      });
    });

    context("👉 unpause()", async function () {
      it("should emit a ProtocolUnpaused event", async function () {
        // Pause protocol
        await pauseHandler.connect(pauser).pause([PausableRegion.Sellers, PausableRegion.DisputeResolvers]);

        // Unpause the protocol, testing for the event
        await expect(pauseHandler.connect(pauser).unpause())
          .to.emit(pauseHandler, "ProtocolUnpaused")
          .withArgs(pauser.address);
      });

      it("should be possible to pause again after an unpause", async function () {
        // Pause protocol
        await pauseHandler.connect(pauser).pause([PausableRegion.Sellers, PausableRegion.DisputeResolvers]);

        // Unpause the protocol, testing for the event
        await pauseHandler.connect(pauser).unpause();

        // Pause the protocol, testing for the event
        regions = [PausableRegion.Funds];
        await expect(pauseHandler.connect(pauser).pause(regions))
          .to.emit(pauseHandler, "ProtocolPaused")
          .withArgs(regions, pauser.address);
      });

      context("💔 Revert Reasons", async function () {
        it("Caller does not have PAUSER role", async function () {
          // Pause protocol
          await pauseHandler.connect(pauser).pause([PausableRegion.Exchanges]);

          // Attempt to unpause without PAUSER role, expecting revert
          await expect(pauseHandler.connect(rando).unpause([])).to.revertedWith(RevertReasons.ACCESS_DENIED);
        });

        it("Protocol is not currently paused", async function () {
          // Attempt to unpause while not paused, expecting revert
          await expect(pauseHandler.connect(pauser).unpause()).to.revertedWith(RevertReasons.NOT_PAUSED);
        });
      });
    });
  });
});
