const { expect } = require("chai");
const hre = require("hardhat");
const ethers = hre.ethers;

const Role = require("../../scripts/domain/Role");
const { deployProtocolDiamond } = require("../../scripts/util/deploy-protocol-diamond.js");
const { deployAndCutFacets, deployProtocolFacets } = require("../../scripts/util/deploy-protocol-handler-facets");
const { getInterfaceIds, interfaceImplementers } = require("../../scripts/config/supported-interfaces");
const { maxPriorityFeePerGas } = require("../util/constants");
const { getFees } = require("../../scripts/util/utils");
const { getFacetAddCut } = require("../../scripts/util/diamond-utils");
const { RevertReasons } = require("../../scripts/config/revert-reasons.js");
const { getFacetsWithArgs } = require("../util/utils.js");

describe("ProtocolInitializationHandler", async function () {
  // Common vars
  let InterfaceIds;
  let deployer, rando;
  let protocolInitializationFacet, diamondCutFacet;
  let protocolDiamond, accessController;
  let erc165;
  let version;
  let maxPremintedVouchers, initializationData;

  before(async function () {
    // get interface Ids
    InterfaceIds = await getInterfaceIds();
  });

  beforeEach(async function () {
    // Make accounts available
    [deployer, rando] = await ethers.getSigners();

    // Deploy the Protocol Diamond
    [protocolDiamond, , , , accessController] = await deployProtocolDiamond(maxPriorityFeePerGas);

    // Temporarily grant UPGRADER role to deployer account
    await accessController.grantRole(Role.UPGRADER, deployer.address);

    // Temporarily grant UPGRADER role to deployer 1ccount
    await accessController.grantRole(Role.UPGRADER, deployer.address);

    // Cast Diamond to IERC165
    erc165 = await ethers.getContractAt("ERC165Facet", protocolDiamond.address);

    // Cast Diamond to DiamondCutFacet
    diamondCutFacet = await ethers.getContractAt("DiamondCutFacet", protocolDiamond.address);

    // Cast Diamond to ProtocolInitializationHandlerFacet
    protocolInitializationFacet = await ethers.getContractAt(
      "ProtocolInitializationHandlerFacet",
      protocolDiamond.address
    );

    version = "2.2.0";

    // initialization data for v2.2.0
    maxPremintedVouchers = "1000";
    initializationData = ethers.utils.defaultAbiCoder.encode(["uint256"], [maxPremintedVouchers]);
  });

  describe("Deploy tests", async function () {
    context("📋 Initializer", async function () {
      it("Should initialize version 2.2.0 and emit ProtocolInitialized", async function () {
        const { cutTransaction } = await deployAndCutFacets(
          protocolDiamond.address,
          { ProtocolInitializationHandlerFacet: [] },
          maxPriorityFeePerGas
        );

        expect(cutTransaction).to.emit(protocolInitializationFacet, "ProtocolInitialized").withArgs(version);
      });

      context("💔 Revert Reasons", async function () {
        let protocolInitializationFacetDeployed;

        beforeEach(async function () {
          const ProtocolInitilizationContractFactory = await ethers.getContractFactory(
            "ProtocolInitializationHandlerFacet"
          );
          protocolInitializationFacetDeployed = await ProtocolInitilizationContractFactory.deploy(
            await getFees(maxPriorityFeePerGas)
          );

          await protocolInitializationFacetDeployed.deployTransaction.wait();
        });

        it("Addresses and calldata length mismatch", async function () {
          version = ethers.utils.formatBytes32String("2.2.0");

          const callData = protocolInitializationFacetDeployed.interface.encodeFunctionData("initialize", [
            version,
            [rando.address],
            [],
            true,
            initializationData,
            [],
            [],
          ]);

          let facetCut = getFacetAddCut(protocolInitializationFacetDeployed, [callData.slice(0, 10)]);

          const cutArgs = [
            [facetCut],
            protocolInitializationFacetDeployed.address,
            callData,
            await getFees(maxPriorityFeePerGas),
          ];

          await expect(diamondCutFacet.connect(deployer).diamondCut(...cutArgs)).to.revertedWith(
            RevertReasons.ADDRESSES_AND_CALLDATA_MUST_BE_SAME_LENGTH
          );
        });

        it("Version is empty", async function () {
          const callData = protocolInitializationFacetDeployed.interface.encodeFunctionData("initialize", [
            ethers.constants.HashZero,
            [],
            [],
            true,
            initializationData,
            [],
            [],
          ]);

          let facetCut = getFacetAddCut(protocolInitializationFacetDeployed, [callData.slice(0, 10)]);

          const cutArgs = [
            [facetCut],
            protocolInitializationFacetDeployed.address,
            callData,
            await getFees(maxPriorityFeePerGas),
          ];

          await expect(diamondCutFacet.connect(deployer).diamondCut(...cutArgs)).to.revertedWith(
            RevertReasons.VERSION_MUST_BE_SET
          );
        });

        it("Initialize same version twice", async function () {
          version = ethers.utils.formatBytes32String("2.2.0");

          const callData = protocolInitializationFacetDeployed.interface.encodeFunctionData("initialize", [
            version,
            [],
            [],
            true,
            initializationData,
            [],
            [],
          ]);

          let facetCut = getFacetAddCut(protocolInitializationFacetDeployed, [callData.slice(0, 10)]);

          await diamondCutFacet.diamondCut(
            [facetCut],
            protocolInitializationFacetDeployed.address,
            callData,
            await getFees(maxPriorityFeePerGas)
          );

          // Mock a new facet to add to diamond so we can call initialize again
          let FacetTestFactory = await ethers.getContractFactory("Test3Facet");
          const testFacet = await FacetTestFactory.deploy(await getFees(maxPriorityFeePerGas));
          await testFacet.deployTransaction.wait();

          const calldataTestFacet = testFacet.interface.encodeFunctionData("initialize", [rando.address]);

          facetCut = getFacetAddCut(testFacet, [calldataTestFacet.slice(0, 10)]);

          const calldataProtocolInitialization = protocolInitializationFacetDeployed.interface.encodeFunctionData(
            "initialize",
            [version, [testFacet.address], [calldataTestFacet], true, initializationData, [], []]
          );

          const cutTransaction = diamondCutFacet.diamondCut(
            [facetCut],
            protocolInitializationFacetDeployed.address,
            calldataProtocolInitialization,
            await getFees(maxPriorityFeePerGas)
          );

          await expect(cutTransaction).to.be.revertedWith(RevertReasons.ALREADY_INITIALIZED);
        });
      });
    });
  });

  describe("After deploy tests", async function () {
    let deployedProtocolInitializationHandlerFacet;
    beforeEach(async function () {
      version = "2.2.0";

      const interfaceId = InterfaceIds[interfaceImplementers["ProtocolInitializationHandlerFacet"]];

      const { deployedFacets } = await deployAndCutFacets(
        protocolDiamond.address,
        { ProtocolInitializationHandlerFacet: [version, [], [], true] },
        maxPriorityFeePerGas,
        version,
        undefined,
        [interfaceId]
      );
      deployedProtocolInitializationHandlerFacet = deployedFacets[0];
    });

    // Interface support (ERC-156 provided by ProtocolDiamond, others by deployed facets)
    context("📋 Interfaces", async function () {
      context("👉 supportsInterface()", async function () {
        it("Should indicate support for IBosonProtocolInitializationHandler interface", async function () {
          // Current interfaceId for IBosonProtocolInitializationHandler
          const support = await erc165.supportsInterface(InterfaceIds.IBosonProtocolInitializationHandler);

          // Test
          expect(support, "IBosonProtocolInitializationHandler interface not supported").is.true;
        });
      });

      it("Should remove interfaces when supplied", async function () {
        const configHandlerInterface = InterfaceIds[interfaceImplementers["ConfigHandlerFacet"]];
        const accountInterface = InterfaceIds[interfaceImplementers["AccountHandlerFacet"]];

        version = ethers.utils.formatBytes32String("2.3.0");
        const calldataProtocolInitialization =
          deployedProtocolInitializationHandlerFacet.contract.interface.encodeFunctionData("initialize", [
            version,
            [],
            [],
            true,
            "0x",
            [(configHandlerInterface, accountInterface)],
            [],
          ]);

        await diamondCutFacet.diamondCut(
          [],
          deployedProtocolInitializationHandlerFacet.contract.address,
          calldataProtocolInitialization,
          await getFees(maxPriorityFeePerGas)
        );

        let support = await erc165.supportsInterface(InterfaceIds.IBosonConfigHandler);

        expect(support, "IBosonConfigHandler interface supported").is.false;

        support = await erc165.supportsInterface(InterfaceIds.IBosonAccountHandler);
        expect(support, "IBosonAccountHandler interface supported").is.false;
      });
    });

    it("Should return the correct version", async function () {
      const version = await protocolInitializationFacet.connect(rando).getVersion();

      // slice because of unicode escape notation
      expect(version.slice(0, 5)).to.equal("2.2.0");
    });

    it("Should call facet initializer internally when _addresses and _calldata are supplied", async function () {
      let FacetTestFactory = await ethers.getContractFactory("Test3Facet");
      const testFacet = await FacetTestFactory.deploy(await getFees(maxPriorityFeePerGas));
      await testFacet.deployTransaction.wait();

      const calldataTestFacet = testFacet.interface.encodeFunctionData("initialize", [rando.address]);

      version = ethers.utils.formatBytes32String("2.3.0");
      const calldataProtocolInitialization =
        deployedProtocolInitializationHandlerFacet.contract.interface.encodeFunctionData("initialize", [
          version,
          [testFacet.address],
          [calldataTestFacet],
          true,
          "0x",
          [],
          [],
        ]);

      const facetCuts = [getFacetAddCut(testFacet)];

      await diamondCutFacet.diamondCut(
        facetCuts,
        deployedProtocolInitializationHandlerFacet.contract.address,
        calldataProtocolInitialization,
        await getFees(maxPriorityFeePerGas)
      );

      const testFacetContract = await ethers.getContractAt("Test3Facet", protocolDiamond.address);

      expect(await testFacetContract.getTestAddress()).to.equal(rando.address);
    });

    context("💔 Revert Reasons", async function () {
      let testFacet, version;

      beforeEach(async function () {
        let FacetTestFactory = await ethers.getContractFactory("Test3Facet");
        testFacet = await FacetTestFactory.deploy(await getFees(maxPriorityFeePerGas));
        await testFacet.deployTransaction.wait();

        version = ethers.utils.formatBytes32String("2.3.0");
      });

      it("Delegate call to initialize fails", async function () {
        const calldataTestFacet = testFacet.interface.encodeFunctionData("initialize", [testFacet.address]);

        const calldataProtocolInitialization =
          deployedProtocolInitializationHandlerFacet.contract.interface.encodeFunctionData("initialize", [
            version,
            [testFacet.address],
            [calldataTestFacet],
            true,
            initializationData,
            [],
            [],
          ]);

        const facetCuts = [getFacetAddCut(testFacet)];

        await expect(
          diamondCutFacet.diamondCut(
            facetCuts,
            deployedProtocolInitializationHandlerFacet.contract.address,
            calldataProtocolInitialization,
            await getFees(maxPriorityFeePerGas)
          )
        ).to.be.revertedWith(RevertReasons.CONTRACT_NOT_ALLOWED);
      });

      it("Default reason if not supplied by implementation", async () => {
        // If the caller's address is supplied Test3Facet's initializer will revert with no reason
        // and so the diamondCut function will supply it's own reason
        const calldataTestFacet = testFacet.interface.encodeFunctionData("initialize", [deployer.address]);

        const calldataProtocolInitialization =
          deployedProtocolInitializationHandlerFacet.contract.interface.encodeFunctionData("initialize", [
            version,
            [testFacet.address],
            [calldataTestFacet],
            true,
            initializationData,
            [],
            [],
          ]);

        const facetCuts = [getFacetAddCut(testFacet)];

        await expect(
          diamondCutFacet.diamondCut(
            facetCuts,
            deployedProtocolInitializationHandlerFacet.contract.address,
            calldataProtocolInitialization,
            await getFees(maxPriorityFeePerGas)
          )
        ).to.be.revertedWith(RevertReasons.PROTOCOL_INITIALIZATION_FAILED);
      });
    });
  });

  describe("initV2_2_0", async function () {
    let deployedProtocolInitializationHandlerFacet;
    let configHandler;
    let facetCut;
    let calldataProtocolInitialization;

    beforeEach(async function () {
      version = "2.1.0";

      // Deploy mock protocol initialization facet which simulates state before v2.2.0
      const ProtocolInitilizationContractFactory = await ethers.getContractFactory(
        "MockProtocolInitializationHandlerFacet"
      );
      const mockInitializationFacetDeployed = await ProtocolInitilizationContractFactory.deploy(
        await getFees(maxPriorityFeePerGas)
      );

      await mockInitializationFacetDeployed.deployTransaction.wait();

      const facetNames = [
        "SellerHandlerFacet",
        "AgentHandlerFacet",
        "DisputeResolverHandlerFacet",
        "OfferHandlerFacet",
        "PauseHandlerFacet",
        "FundsHandlerFacet",
        "ExchangeHandlerFacet",
      ];

      const facetsToDeploy = await getFacetsWithArgs(facetNames);

      // Make initial deployment (simulate v2.1.0)
      await deployAndCutFacets(
        protocolDiamond.address,
        facetsToDeploy,
        maxPriorityFeePerGas,
        version,
        mockInitializationFacetDeployed,
        []
      );

      // Deploy v2.2.0 facets
      [{ contract: deployedProtocolInitializationHandlerFacet }, { contract: configHandler }] =
        await deployProtocolFacets(
          ["ProtocolInitializationHandlerFacet", "ConfigHandlerFacet"],
          {},
          await getFees(maxPriorityFeePerGas)
        );

      version = ethers.utils.formatBytes32String("2.2.0");

      // Prepare cut data
      facetCut = getFacetAddCut(configHandler);
      // Attach correct address to configHandler
      configHandler = configHandler.attach(protocolDiamond.address);
      // Prepare calldata
      calldataProtocolInitialization = deployedProtocolInitializationHandlerFacet.interface.encodeFunctionData(
        "initialize",
        [version, [], [], true, initializationData, [], []]
      );
    });

    it("Should emit MaxPremintedVouchersChanged event", async function () {
      // Make the cut, check the event
      await expect(
        diamondCutFacet.diamondCut(
          [facetCut],
          deployedProtocolInitializationHandlerFacet.address,
          calldataProtocolInitialization,
          await getFees(maxPriorityFeePerGas)
        )
      )
        .to.emit(configHandler, "MaxPremintedVouchersChanged")
        .withArgs(maxPremintedVouchers, deployer.address);
    });

    it("Should update state", async function () {
      // Make the cut, check the event
      await diamondCutFacet.diamondCut(
        [facetCut],
        deployedProtocolInitializationHandlerFacet.address,
        calldataProtocolInitialization,
        await getFees(maxPriorityFeePerGas)
      );

      // Verify that new value is stored
      expect(await configHandler.connect(rando).getMaxPremintedVouchers()).to.equal(maxPremintedVouchers);
    });

    context("💔 Revert Reasons", async function () {
      it("Max preminted vouchers is zero", async function () {
        // set invalid maxPremintedVouchers
        maxPremintedVouchers = "0";
        initializationData = ethers.utils.defaultAbiCoder.encode(["uint256"], [maxPremintedVouchers]);

        calldataProtocolInitialization = deployedProtocolInitializationHandlerFacet.interface.encodeFunctionData(
          "initialize",
          [version, [], [], true, initializationData, [], []]
        );

        // make diamond cut, expect revert
        await expect(
          diamondCutFacet.diamondCut(
            [facetCut],
            deployedProtocolInitializationHandlerFacet.address,
            calldataProtocolInitialization,
            await getFees(maxPriorityFeePerGas)
          )
        ).to.be.revertedWith(RevertReasons.VALUE_ZERO_NOT_ALLOWED);
      });

      it("Current version is not 0", async () => {
        // Deploy higher version
        version = "2.3.0";
        const interfaceId = InterfaceIds[interfaceImplementers["ProtocolInitializationHandlerFacet"]];
        const {
          deployedFacets: [{ contract: deployedProtocolInitializationHandlerFacet }],
        } = await deployAndCutFacets(
          protocolDiamond.address,
          { ProtocolInitializationHandlerFacet: [version, [], [], true] },
          maxPriorityFeePerGas,
          version,
          undefined,
          [interfaceId]
        );

        // Prepare 2.2.0 deployment
        version = ethers.utils.formatBytes32String("2.2.0");

        // make diamond cut, expect revert
        await expect(
          diamondCutFacet.diamondCut(
            [facetCut],
            deployedProtocolInitializationHandlerFacet.address,
            calldataProtocolInitialization,
            await getFees(maxPriorityFeePerGas)
          )
        ).to.be.revertedWith(RevertReasons.WRONG_CURRENT_VERSION);
      });
    });
  });
});
