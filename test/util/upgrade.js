const shell = require("shelljs");
const _ = require("lodash");
const { getStorageAt } = require("@nomicfoundation/hardhat-network-helpers");
const hre = require("hardhat");
const ethers = hre.ethers;
const { keccak256, formatBytes32String } = utils;
const AuthToken = require("../../scripts/domain/AuthToken");
const { getMetaTransactionsHandlerFacetInitArgs } = require("../../scripts/config/facet-deploy.js");
const AuthTokenType = require("../../scripts/domain/AuthTokenType");
const Role = require("../../scripts/domain/Role");
const Bundle = require("../../scripts/domain/Bundle");
const Group = require("../../scripts/domain/Group");
const VoucherInitValues = require("../../scripts/domain/VoucherInitValues");
const TokenType = require("../../scripts/domain/TokenType.js");
const Exchange = require("../../scripts/domain/Exchange.js");
const { DisputeResolverFee } = require("../../scripts/domain/DisputeResolverFee");
const {
  mockOffer,
  mockDisputeResolver,
  mockAuthToken,
  mockSeller,
  mockAgent,
  mockBuyer,
  mockCondition,
  mockTwin,
} = require("./mock");
const {
  setNextBlockTimestamp,
  paddingType,
  getMappingStoragePosition,
  calculateContractAddress,
} = require("./utils.js");
const { oneMonth, oneDay } = require("./constants");
const { getInterfaceIds } = require("../../scripts/config/supported-interfaces.js");
const { deployMockTokens } = require("../../scripts/util/deploy-mock-tokens");
const { readContracts } = require("../../scripts/util/utils");
const { getFacets } = require("../upgrade/00_config");
const Receipt = require("../../scripts/domain/Receipt");
const Offer = require("../../scripts/domain/Offer");
const OfferFees = require("../../scripts/domain/OfferFees");
const DisputeResolutionTerms = require("../../scripts/domain/DisputeResolutionTerms");
const OfferDurations = require("../../scripts/domain/OfferDurations");
const OfferDates = require("../../scripts/domain/OfferDates");
const Seller = require("../../scripts/domain/Seller");
const DisputeResolver = require("../../scripts/domain/DisputeResolver");
const Agent = require("../../scripts/domain/Agent");
const Buyer = require("../../scripts/domain/Buyer");
const { tagsByVersion } = require("../upgrade/00_config");

// Common vars
const versionsWithActivateDRFunction = ["v2.0.0", "v2.1.0"];
const versionsWithClerkRole = ["v2.0.0", "v2.1.0", "v2.2.0", "v2.2.1"];
let rando;
let preUpgradeInterfaceIds, preUpgradeVersions;
let facets, versionTags;

function getVersionsBeforeTarget(versions, targetVersion) {
  const versionsBefore = versions.filter((v, index, arr) => {
    if (v === "v2.1.0" || v === "latest") return false;
    if (v === targetVersion) {
      arr.splice(index + 1); // Truncate array after the target version
      return false; //
    }
    return true;
  });

  return versionsBefore.map((version) => {
    // Remove "v" prefix and "-rc.${number}" suffix
    return formatBytes32String(version.replace(/^v/, "").replace(/-rc\.\d+$/, ""));
  });
}

// deploy suite and return deployed contracts
async function deploySuite(deployer, newVersion) {
  // Cache config data
  versionTags = tagsByVersion[newVersion];
  facets = await getFacets();

  // checkout old version
  const { oldVersion: tag, deployScript: scriptsTag } = versionTags;

  console.log(`Fetching tags`);
  shell.exec(`git fetch --force --tags origin`);
  console.log(`Checking out version ${tag}`);
  shell.exec(`rm -rf contracts/*`);
  shell.exec(`git checkout ${tag} contracts`);
  if (scriptsTag) {
    console.log(`Checking out scripts on version ${scriptsTag}`);
    shell.exec(`rm -rf scripts/*`);
    shell.exec(`git checkout ${scriptsTag} scripts`);
  }

  const deployConfig = facets.deploy[tag];

  if (!deployConfig) {
    throw new Error(`No deploy config found for tag ${tag}`);
  }

  // run deploy suite, which automatically compiles the contracts
  await hre.run("deploy-suite", {
    env: "upgrade-test",
    facetConfig: JSON.stringify(deployConfig),
    version: tag.replace(/^v/, ""),
  });

  // Read contract info from file
  const chainId = (await hre.provider.getNetwork()).chainId;
  const contractsFile = readContracts(chainId, "hardhat", "upgrade-test");

  // Get AccessController abstraction
  const accessControllerInfo = contractsFile.contracts.find((i) => i.name === "AccessController");
  const accessController = await getContractAt("AccessController", await accessControllerInfo.getAddress());

  // Temporarily grant UPGRADER role to deployer account
  await accessController.grantRole(Role.UPGRADER, await deployer.getAddress());

  // Get protocolDiamondAddress
  const protocolDiamondAddress = contractsFile.contracts.find((i) => i.name === "ProtocolDiamond").address;

  // Grant PROTOCOL role to ProtocolDiamond address
  await accessController.grantRole(Role.PROTOCOL, protocolDiamondAddress);

  // Cast Diamond to interfaces
  const accountHandler = await getContractAt("IBosonAccountHandler", protocolDiamondAddress);
  const bundleHandler = await getContractAt("IBosonBundleHandler", protocolDiamondAddress);
  const disputeHandler = await getContractAt("IBosonDisputeHandler", protocolDiamondAddress);
  const exchangeHandler = await getContractAt("IBosonExchangeHandler", protocolDiamondAddress);
  const fundsHandler = await getContractAt("IBosonFundsHandler", protocolDiamondAddress);
  const groupHandler = await getContractAt("IBosonGroupHandler", protocolDiamondAddress);
  const offerHandler = await getContractAt("IBosonOfferHandler", protocolDiamondAddress);
  const orchestrationHandler = await getContractAt("IBosonOrchestrationHandler", protocolDiamondAddress);
  const twinHandler = await getContractAt("IBosonTwinHandler", protocolDiamondAddress);
  const pauseHandler = await getContractAt("IBosonPauseHandler", protocolDiamondAddress);
  const metaTransactionsHandler = await getContractAt("IBosonMetaTransactionsHandler", protocolDiamondAddress);
  const configHandler = await getContractAt("IBosonConfigHandler", protocolDiamondAddress);
  const ERC165Facet = await getContractAt("ERC165Facet", protocolDiamondAddress);
  const protocolInitializationHandler = await getContractAt(
    "IBosonProtocolInitializationHandler",
    protocolDiamondAddress
  );

  // create mock token for auth
  const [mockAuthERC721Contract] = await deployMockTokens(["Foreign721"]);
  configHandler.connect(deployer).setAuthTokenContract(AuthTokenType.Lens, await mockAuthERC721Contract.getAddress());

  // create mock token for offers
  const [mockToken, mockConditionalToken, mockTwin721_1, mockTwin721_2, mockTwin20, mockTwin1155] =
    await deployMockTokens(["Foreign20", "Foreign20", "Foreign721", "Foreign721", "Foreign20", "Foreign1155"]);
  const mockTwinTokens = [mockTwin721_1, mockTwin721_2];

  return {
    protocolDiamondAddress,
    protocolContracts: {
      accountHandler,
      exchangeHandler,
      offerHandler,
      fundsHandler,
      disputeHandler,
      bundleHandler,
      groupHandler,
      twinHandler,
      configHandler,
      orchestrationHandler,
      pauseHandler,
      metaTransactionsHandler,
      ERC165Facet,
      protocolInitializationHandler,
    },
    mockContracts: {
      mockAuthERC721Contract,
      mockToken,
      mockConditionalToken,
      mockTwinTokens,
      mockTwin20,
      mockTwin1155,
    },
  };
}

// upgrade the suite to new version and returns handlers with upgraded interfaces
// upgradedInterfaces is object { handlerName : "interfaceName"}
async function upgradeSuite(protocolDiamondAddress, upgradedInterfaces, overrideFacetConfig) {
  if (!versionTags) {
    throw new Error("Version tags not cached");
  }
  const { newVersion: tag, upgradeScript: scriptsTag } = versionTags;

  shell.exec(`rm -rf contracts/*`);
  shell.exec(`rm -rf scripts/*`);

  if (scriptsTag) {
    console.log(`Checking out scripts on version ${scriptsTag}`);
    shell.exec(`git checkout ${scriptsTag} scripts`);
  } else {
    console.log(`Checking out latest scripts`);
    shell.exec(`git checkout HEAD scripts`);
  }

  if (tag) {
    // checkout the new tag
    console.log(`Checking out version ${tag}`);
    shell.exec(`git checkout ${tag} contracts`);
  } else {
    // if tag was not created yet, use the latest code
    console.log(`Checking out latest code`);
    shell.exec(`git checkout HEAD contracts`);
  }

  if (!facets) facets = await getFacets();

  let facetConfig = facets.upgrade[tag] || facets.upgrade["latest"];
  if (overrideFacetConfig) {
    facetConfig = _.merge(facetConfig, overrideFacetConfig);
  }

  // compile new contracts
  await hre.run("compile");
  await hre.run("upgrade-facets", {
    env: "upgrade-test",
    facetConfig: JSON.stringify(facetConfig),
  });

  // Cast to updated interface
  let newHandlers = {};
  for (const [handlerName, interfaceName] of Object.entries(upgradedInterfaces)) {
    newHandlers[handlerName] = await getContractAt(interfaceName, protocolDiamondAddress);
  }

  return newHandlers;
}

// upgrade the clients to new version
async function upgradeClients() {
  // Upgrade Clients
  shell.exec(`rm -rf contracts/*`);
  shell.exec(`git checkout HEAD scripts`);
  const tag = versionTags.newVersion;

  // checkout the new tag
  console.log(`Checking out version ${tag}`);
  shell.exec(`git checkout ${tag} contracts`);

  await hre.run("compile");
  // Mock forwarder to test metatx
  const MockForwarder = await getContractFactory("MockForwarder");

  const forwarder = await MockForwarder.deploy();

  const clientConfig = {
    META_TRANSACTION_FORWARDER: {
      hardhat: await forwarder.getAddress(),
    },
  };

  // Upgrade clients
  await hre.run("upgrade-clients", {
    env: "upgrade-test",
    clientConfig: JSON.stringify(clientConfig),
    newVersion: tag.replace("v", ""),
  });

  return forwarder;
}

// populates protocol with some entities
// returns
/*   DRs
      sellers
      buyers
      agents
      offers
      exchanges
      bundles
      groups
      twins*/
async function populateProtocolContract(
  deployer,
  protocolDiamondAddress,
  {
    accountHandler,
    exchangeHandler,
    offerHandler,
    fundsHandler,
    disputeHandler,
    bundleHandler,
    groupHandler,
    twinHandler,
  },
  { mockToken, mockConditionalToken, mockAuthERC721Contract, mockTwinTokens, mockTwin20, mockTwin1155 },
  isBefore = false
) {
  let DRs = [];
  let sellers = [];
  let buyers = [];
  let agents = [];
  let offers = [];
  let groups = [];
  let twins = [];
  let exchanges = [];
  let bundles = [];

  const entityType = {
    SELLER: 0,
    DR: 1,
    AGENT: 2,
    BUYER: 3,
  };

  const entities = [
    entityType.DR,
    entityType.AGENT,
    entityType.SELLER,
    entityType.SELLER,
    entityType.DR,
    entityType.SELLER,
    entityType.DR,
    entityType.SELLER,
    entityType.AGENT,
    entityType.SELLER,
    entityType.BUYER,
    entityType.BUYER,
    entityType.BUYER,
    entityType.BUYER,
    entityType.BUYER,
  ];

  let nextAccountId = Number(await accountHandler.getNextAccountId());
  let voucherIndex = 1;

  for (const entity of entities) {
    const wallet = Wallet.createRandom();
    const connectedWallet = wallet.connect(provider);
    //Fund the new wallet
    let tx = {
      to: await connectedWallet.getAddress(),
      // Convert currency unit from ether to wei
      value: parseEther("10"),
    };
    await deployer.sendTransaction(tx);

    // create entities
    switch (entity) {
      case entityType.DR: {
        const clerkAddress = versionsWithClerkRole.includes(isBefore ? versionTags.oldVersion : versionTags.newVersion)
          ? await wallet.getAddress()
          : ZeroAddress;
        const disputeResolver = mockDisputeResolver(
          await wallet.getAddress(),
          await wallet.getAddress(),
          clerkAddress,
          await wallet.getAddress(),
          true,
          true
        );
        const disputeResolverFees = [
          new DisputeResolverFee(ZeroAddress, "Native", "0"),
          new DisputeResolverFee(await mockToken.getAddress(), "MockToken", "0"),
        ];
        const sellerAllowList = [];
        disputeResolver.id = nextAccountId.toString();

        await accountHandler
          .connect(connectedWallet)
          .createDisputeResolver(disputeResolver, disputeResolverFees, sellerAllowList);
        DRs.push({
          wallet: connectedWallet,
          id: disputeResolver.id,
          disputeResolver,
          disputeResolverFees,
          sellerAllowList,
        });

        if (versionsWithActivateDRFunction.includes(isBefore ? versionTags.oldVersion : versionTags.newVersion)) {
          //ADMIN role activates Dispute Resolver
          await accountHandler.connect(deployer).activateDisputeResolver(disputeResolver.id);
        }
        break;
      }

      case entityType.SELLER: {
        const clerkAddress = versionsWithClerkRole.includes(isBefore ? versionTags.oldVersion : versionTags.newVersion)
          ? await wallet.getAddress()
          : ZeroAddress;
        const seller = mockSeller(await wallet.getAddress(), await wallet.getAddress(), clerkAddress, await wallet.getAddress(), true);
        const id = (seller.id = nextAccountId.toString());

        let authToken;

        // randomly decide if auth token is used or not
        if (Math.random() > 0.5) {
          // no auth token
          authToken = mockAuthToken();
        } else {
          // use auth token
          seller.admin = ZeroAddress;
          await mockAuthERC721Contract.connect(connectedWallet).mint(101 * id, 1);
          authToken = new AuthToken(`${101 * id}`, AuthTokenType.Lens);
        }
        // set unique new voucherInitValues
        const voucherInitValues = new VoucherInitValues(`http://seller${id}.com/uri`, id * 10);
        await accountHandler.connect(connectedWallet).createSeller(seller, authToken, voucherInitValues);

        const voucherContractAddress = calculateContractAddress(await accountHandler.getAddress(), voucherIndex++);
        sellers.push({
          wallet: connectedWallet,
          id,
          seller,
          authToken,
          voucherInitValues,
          offerIds: [],
          voucherContractAddress,
        });

        // mint mock token to sellers just in case they need them
        await mockToken.mint(await connectedWallet.getAddress(), "10000000000");
        await mockToken.connect(connectedWallet).approve(protocolDiamondAddress, "10000000000");
        break;
      }
      case entityType.AGENT: {
        const agent = mockAgent(await wallet.getAddress());

        await accountHandler.connect(connectedWallet).createAgent(agent);

        agent.id = nextAccountId.toString();
        agents.push({ wallet: connectedWallet, id: agent.id, agent });
        break;
      }
      case entityType.BUYER: {
        // no need to explicitly create buyer, since it's done automatically during commitToOffer
        const buyer = mockBuyer(await wallet.getAddress());
        buyer.id = nextAccountId.toString();
        buyers.push({ wallet: connectedWallet, id: buyer.id, buyer });

        // mint them conditional token in case they need it
        await mockConditionalToken.mint(await wallet.getAddress(), "10");
        break;
      }
    }

    nextAccountId++;
  }

  // Make explicit allowed sellers list for some DRs
  const sellerIds = sellers.map((s) => s.seller.id);
  for (let i = 0; i < DRs.length; i = i + 2) {
    const DR = DRs[i];
    DR.sellerAllowList = sellerIds;
    await accountHandler.connect(DR.wallet).addSellersToAllowList(DR.disputeResolver.id, sellerIds);
  }

  // create offers - first seller has 5 offers, second 4, third 3 etc
  let offerId = (await offerHandler.getNextOfferId()).toNumber();
  for (let i = 0; i < sellers.length; i++) {
    for (let j = i; j >= 0; j--) {
      // Mock offer, offerDates and offerDurations
      const { offer, offerDates, offerDurations } = await mockOffer();

      // Set unique offer properties based on offer id
      offer.id = `${offerId}`;
      offer.sellerId = sellers[j].seller.id;
      offer.price = `${offerId * 1000}`;
      offer.sellerDeposit = `${offerId * 100}`;
      offer.buyerCancelPenalty = `${offerId * 50}`;
      offer.quantityAvailable = `${(offerId + 1) * 10}`;

      // Default offer is in native token. Change every other to mock token
      if (offerId % 2 == 0) {
        offer.exchangeToken = await mockToken.getAddress();
      }

      // Set unique offer dates based on offer id
      const now = offerDates.validFrom;
      offerDates.validFrom = BigInt(now)
        +oneMonth + offerId * 1000
        .toString();
      offerDates.validUntil = BigInt(now)
        +oneMonth * 6 * (offerId + 1)
        .toString();

      // Set unique offerDurations based on offer id
      offerDurations.disputePeriod = `${(offerId + 1) * oneMonth}`;
      offerDurations.voucherValid = `${(offerId + 1) * oneMonth}`;
      offerDurations.resolutionPeriod = `${(offerId + 1) * oneDay}`;

      // choose one DR and agent
      const disputeResolverId = DRs[offerId % 3].disputeResolver.id;
      const agentId = agents[offerId % 2].agent.id;

      // create an offer
      await offerHandler
        .connect(sellers[j].wallet)
        .createOffer(offer, offerDates, offerDurations, disputeResolverId, agentId);

      offers.push({ offer, offerDates, offerDurations, disputeResolverId, agentId });
      sellers[j].offerIds.push(offerId);

      // Deposit seller funds so the commit will succeed
      const sellerPool = BigInt(offer.quantityAvailable)*offer.price.toString();
      const msgValue = offer.exchangeToken == ZeroAddress ? sellerPool : "0";
      await fundsHandler
        .connect(sellers[j].wallet)
        .depositFunds(sellers[j].seller.id, offer.exchangeToken, sellerPool, { value: msgValue });

      offerId++;
    }
  }

  // group some offers
  let groupId = (await groupHandler.getNextGroupId()).toNumber();
  for (let i = 0; i < sellers.length; i = i + 2) {
    const seller = sellers[i];
    const group = new Group(groupId, seller.seller.id, seller.offerIds); // group all seller's offers
    const condition = mockCondition({
      tokenAddress: await mockConditionalToken.getAddress(),
      maxCommits: "10",
    });
    await groupHandler.connect(seller.wallet).createGroup(group, condition);

    groups.push(group);

    groupId++;
  }

  // create some twins and bundles
  let twinId = (await twinHandler.getNextTwinId()).toNumber();
  let bundleId = (await bundleHandler.getNextBundleId()).toNumber();
  for (let i = 1; i < sellers.length; i = i + 2) {
    const seller = sellers[i];
    const sellerId = seller.id;
    let twinIds = []; // used for bundle

    // non fungible token
    await mockTwinTokens[0].connect(seller.wallet).setApprovalForAll(protocolDiamondAddress, true);
    await mockTwinTokens[1].connect(seller.wallet).setApprovalForAll(protocolDiamondAddress, true);

    // create multiple ranges
    const twin721 = mockTwin(ZeroAddress, TokenType.NonFungibleToken);
    twin721.amount = "0";

    // min supply available for twin721 is the total amount to cover all offers bundled
    const minSupplyAvailable = offers
      .map((o) => o.offer)
      .filter((o) => seller.offerIds.includes(Number(o.id)))
      .reduce((acc, o) => acc + Number(o.quantityAvailable), 0);

    for (let j = 0; j < 7; j++) {
      twin721.tokenId = `${sellerId * 1000000 + j * 100000}`;
      twin721.supplyAvailable = minSupplyAvailable;
      twin721.tokenAddress = mockTwinTokens[j % 2].address; // oscilate between twins
      twin721.id = twinId;

      // mint tokens to be transferred on redeem
      await mockTwinTokens[j % 2].connect(seller.wallet).mint(twin721.tokenId, twin721.supplyAvailable);
      await twinHandler.connect(seller.wallet).createTwin(twin721);

      twins.push(twin721);
      twinIds.push(twinId);

      twinId++;
    }

    // fungible
    const twin20 = mockTwin(await mockTwin20.getAddress(), TokenType.FungibleToken);

    twin20.id = twinId;
    twin20.amount = sellerId;
    twin20.supplyAvailable = twin20.amount * 100000000;

    await mockTwin20.connect(seller.wallet).approve(protocolDiamondAddress, twin20.supplyAvailable);

    // mint tokens to be transferred on redeem
    await mockTwin20.connect(seller.wallet).mint(seller.await wallet.getAddress(), twin20.supplyAvailable * twin20.amount);
    await twinHandler.connect(seller.wallet).createTwin(twin20);

    twins.push(twin20);
    twinIds.push(twinId);
    twinId++;

    // multitoken twin
    const twin1155 = mockTwin(await mockTwin1155.getAddress(), TokenType.MultiToken);
    await mockTwin1155.connect(seller.wallet).setApprovalForAll(protocolDiamondAddress, true);
    for (let j = 0; j < 3; j++) {
      twin1155.tokenId = `${j * 30000 + sellerId * 300}`;
      twin1155.amount = sellerId + j;
      twin1155.supplyAvailable = `${300000 * (sellerId + 1)}`;
      twin1155.id = twinId;

      // mint tokens to be transferred on redeem
      await mockTwin1155.connect(seller.wallet).mint(twin1155.tokenId, twin1155.supplyAvailable);
      await twinHandler.connect(seller.wallet).createTwin(twin1155);

      twins.push(twin1155);
      twinIds.push(twinId);
      twinId++;
    }

    // create bundle with all seller's twins and offers
    const bundle = new Bundle(bundleId, seller.seller.id, seller.offerIds, twinIds);
    await bundleHandler.connect(seller.wallet).createBundle(bundle);
    bundles.push(bundle);
    bundleId++;
  }

  // commit to some offers: first buyer commit to 1 offer, second to 2, third to 3 etc
  await setNextBlockTimestamp(Number(offers[offers.length - 1].offerDates.validFrom)); // When latest offer is valid, also other offers are valid
  let exchangeId = (await exchangeHandler.getNextExchangeId()).toNumber();
  for (let i = 0; i < buyers.length; i++) {
    for (let j = i; j < buyers.length; j++) {
      const offer = offers[i + j].offer; // some offers will be picked multiple times, some never.
      const offerPrice = offer.price;
      const buyerWallet = buyers[j].wallet;
      let msgValue;
      if (offer.exchangeToken == ZeroAddress) {
        msgValue = offerPrice;
      } else {
        // approve token transfer
        msgValue = 0;
        await mockToken.connect(buyerWallet).approve(protocolDiamondAddress, offerPrice);
        await mockToken.mint(await buyerWallet.getAddress(), offerPrice);
      }
      await exchangeHandler.connect(buyerWallet).commitToOffer(await buyerWallet.getAddress(), offer.id, { value: msgValue });
      exchanges.push({ exchangeId: exchangeId, offerId: offer.id, buyerIndex: j });
      exchangeId++;
    }
  }

  // redeem some vouchers #4
  for (const id of [2, 5, 11, 8]) {
    const exchange = exchanges[id - 1];
    await exchangeHandler.connect(buyers[exchange.buyerIndex].wallet).redeemVoucher(exchange.exchangeId);
  }

  // cancel some vouchers #3
  for (const id of [10, 3, 13]) {
    const exchange = exchanges[id - 1];
    await exchangeHandler.connect(buyers[exchange.buyerIndex].wallet).cancelVoucher(exchange.exchangeId);
  }

  // revoke some vouchers #2
  for (const id of [4, 6]) {
    const exchange = exchanges[id - 1];
    const offer = offers.find((o) => o.offer.id == exchange.offerId);
    const seller = sellers.find((s) => s.seller.id == offer.offer.sellerId);
    await exchangeHandler.connect(seller.wallet).revokeVoucher(exchange.exchangeId);
  }

  // raise dispute on some exchanges #1
  const id = 5; // must be one of redeemed ones
  const exchange = exchanges[id - 1];
  await disputeHandler.connect(buyers[exchange.buyerIndex].wallet).raiseDispute(exchange.exchangeId);

  return { DRs, sellers, buyers, agents, offers, exchanges, bundles, groups, twins };
}

// Returns protocol state for provided entities
async function getProtocolContractState(
  protocolDiamondAddress,
  {
    accountHandler,
    exchangeHandler,
    offerHandler,
    fundsHandler,
    disputeHandler,
    bundleHandler,
    groupHandler,
    twinHandler,
    configHandler,
  },
  { mockToken, mockTwinTokens },
  { DRs, sellers, buyers, agents, offers, exchanges, bundles, groups, twins }
) {
  rando = (await getSigners())[10]; // random account making the calls

  const [
    accountContractState,
    offerContractState,
    exchangeContractState,
    bundleContractState,
    configContractState,
    disputeContractState,
    fundsContractState,
    groupContractState,
    twinContractState,
    metaTxContractState,
    metaTxPrivateContractState,
    protocolStatusPrivateContractState,
    protocolLookupsPrivateContractState,
  ] = await Promise.all([
    getAccountContractState(accountHandler, { DRs, sellers, buyers, agents }),
    getOfferContractState(offerHandler, offers),
    getExchangeContractState(exchangeHandler, exchanges),
    getBundleContractState(bundleHandler, bundles),
    getConfigContractState(configHandler),
    getDisputeContractState(disputeHandler, exchanges),
    getFundsContractState(fundsHandler, { DRs, sellers, buyers, agents }),
    getGroupContractState(groupHandler, groups),
    getTwinContractState(twinHandler, twins),
    getMetaTxContractState(),
    getMetaTxPrivateContractState(protocolDiamondAddress),
    getProtocolStatusPrivateContractState(protocolDiamondAddress),
    getProtocolLookupsPrivateContractState(
      protocolDiamondAddress,
      { mockToken, mockTwinTokens },
      { sellers, DRs, agents, buyers, offers, groups }
    ),
  ]);

  return {
    accountContractState,
    offerContractState,
    exchangeContractState,
    bundleContractState,
    configContractState,
    disputeContractState,
    fundsContractState,
    groupContractState,
    twinContractState,
    metaTxContractState,
    metaTxPrivateContractState,
    protocolStatusPrivateContractState,
    protocolLookupsPrivateContractState,
  };
}

async function getAccountContractState(accountHandler, { DRs, sellers, buyers, agents }) {
  const accountHandlerRando = accountHandler.connect(rando);
  // all accounts
  const accounts = [...sellers, ...DRs, ...buyers, ...agents];
  let DRsState = [];
  let sellerState = [];
  let buyersState = [];
  let agentsState = [];
  let allowedSellersState = [];
  let sellerByAddressState = [];
  let sellerByAuthTokenState = [];
  let DRbyAddressState = [];
  let nextAccountId;

  // Query even the ids where it's not expected to get the entity
  for (const account of accounts) {
    const id = account.id;

    DRsState.push(await getDisputeResolver(accountHandlerRando, id, { getBy: "id" }));
    try {
      sellerState.push(await getSeller(accountHandlerRando, id, { getBy: "id" }));
    } catch (e) {
      console.log(e);
    }
    agentsState.push(await getAgent(accountHandlerRando, id));
    buyersState.push(await getBuyer(accountHandlerRando, id));

    for (const account2 of accounts) {
      const id2 = account2.id;
      allowedSellersState.push(await accountHandlerRando.areSellersAllowed(id2, [id]));
    }
  }

  for (const seller of sellers) {
    const sellerAddress = seller.await wallet.getAddress();
    const sellerAuthToken = seller.authToken;

    sellerByAddressState.push(await getSeller(accountHandlerRando, sellerAddress, { getBy: "address" }));
    sellerByAddressState.push(await getSeller(accountHandlerRando, sellerAuthToken, { getBy: "authToken" }));
    DRbyAddressState.push(await getDisputeResolver(accountHandlerRando, sellerAddress, { getBy: "address" }));
  }

  const otherAccounts = [...DRs, ...agents, ...buyers];

  for (const account of otherAccounts) {
    const accountAddress = account.await wallet.getAddress();

    sellerByAddressState.push(await getSeller(accountHandlerRando, accountAddress, { getBy: "address" }));
    DRbyAddressState.push(await getDisputeResolver(accountHandlerRando, accountAddress, { getBy: "address" }));
  }

  nextAccountId = (await accountHandlerRando.getNextAccountId()).toString();

  return {
    DRsState,
    sellerState,
    buyersState,
    sellerByAddressState,
    sellerByAuthTokenState,
    DRbyAddressState,
    nextAccountId,
  };
}

async function getOfferContractState(offerHandler, offers) {
  const offerHandlerRando = offerHandler.connect(rando);
  // get offers
  let offersState = [];
  let isOfferVoidedState = [];
  let agentIdByOfferState = [];
  for (const offer of offers) {
    const id = offer.offer.id;
    const [singleOffersState, singleIsOfferVoidedState, singleAgentIdByOfferState] = await Promise.all([
      offerHandlerRando.getOffer(id),
      offerHandlerRando.isOfferVoided(id),
      offerHandlerRando.getAgentIdByOffer(id),
    ]);

    let [exist, offerStruct, offerDates, offerDurations, disputeResolutionTerms, offerFees] = singleOffersState;
    offerStruct = Offer.fromStruct(offerStruct);
    offerDates = OfferDates.fromStruct(offerDates);
    offerDurations = OfferDurations.fromStruct(offerDurations);
    disputeResolutionTerms = DisputeResolutionTerms.fromStruct(disputeResolutionTerms);
    offerFees = OfferFees.fromStruct(offerFees);

    offersState.push([exist, offerStruct, offerDates, offerDurations, disputeResolutionTerms, offerFees]);
    isOfferVoidedState.push(singleIsOfferVoidedState);
    agentIdByOfferState.push(singleAgentIdByOfferState.toString());
  }

  let nextOfferId = (await offerHandlerRando.getNextOfferId()).toString();

  return { offersState, isOfferVoidedState, agentIdByOfferState, nextOfferId };
}

async function getExchangeContractState(exchangeHandler, exchanges) {
  const exchangeHandlerRando = exchangeHandler.connect(rando);
  // get exchanges
  let exchangesState = [];
  let exchangeStateState = [];
  let isExchangeFinalizedState = [];
  let receiptsState = [];

  for (const exchange of exchanges) {
    const id = exchange.exchangeId;
    const [singleExchangesState, singleExchangeStateState, singleIsExchangeFinalizedState] = await Promise.all([
      exchangeHandlerRando.getExchange(id),
      exchangeHandlerRando.getExchangeState(id),
      exchangeHandlerRando.isExchangeFinalized(id),
    ]);

    let [exists, exchangeState] = singleExchangesState;
    exchangeState = Exchange.fromStruct(exchangeState);

    exchangesState.push([exists, exchangeState]);
    exchangeStateState.push(singleExchangeStateState);
    isExchangeFinalizedState.push(singleIsExchangeFinalizedState);

    try {
      const receipt = await exchangeHandlerRando.getReceipt(id);
      receiptsState.push(Receipt.fromStruct(receipt));
    } catch {
      receiptsState.push(["NOT_FINALIZED"]);
    }
  }

  let nextExchangeId = (await exchangeHandlerRando.getNextExchangeId()).toString();
  return { exchangesState, exchangeStateState, isExchangeFinalizedState, receiptsState, nextExchangeId };
}

async function getBundleContractState(bundleHandler, bundles) {
  // get bundles
  const bundleHandlerRando = bundleHandler.connect(rando);
  let bundlesState = [];
  let bundleIdByOfferState = [];
  let bundleIdByTwinState = [];
  for (const bundle of bundles) {
    const id = bundle.id;
    const [singleBundlesState, singleBundleIdByOfferState, singleBundleIdByTwinState] = await Promise.all([
      bundleHandlerRando.getBundle(id),
      bundleHandlerRando.getBundleIdByOffer(id),
      bundleHandlerRando.getBundleIdByTwin(id),
    ]);
    bundlesState.push(singleBundlesState);
    bundleIdByOfferState.push(singleBundleIdByOfferState);
    bundleIdByTwinState.push(singleBundleIdByTwinState);
  }

  let nextBundleId = await bundleHandlerRando.getNextBundleId();
  return { bundlesState, bundleIdByOfferState, bundleIdByTwinState, nextBundleId };
}

async function getConfigContractState(configHandler) {
  const configHandlerRando = configHandler.connect(rando);
  const [
    tokenAddress,
    treasuryAddress,
    voucherBeaconAddress,
    beaconProxyAddress,
    protocolFeePercentage,
    protocolFeeFlatBoson,
    maxOffersPerBatch,
    maxOffersPerGroup,
    maxTwinsPerBundle,
    maxOffersPerBundle,
    maxTokensPerWithdrawal,
    maxFeesPerDisputeResolver,
    maxEscalationResponsePeriod,
    maxDisputesPerBatch,
    maxTotalOfferFeePercentage,
    maxAllowedSellers,
    buyerEscalationDepositPercentage,
    authTokenContractNone,
    authTokenContractCustom,
    authTokenContractLens,
    authTokenContractENS,
    maxExchangesPerBatch,
    maxRoyaltyPecentage,
    maxResolutionPeriod,
    minDisputePeriod,
    accessControllerAddress,
  ] = await Promise.all([
    configHandlerRando.getTokenAddress(),
    configHandlerRando.getTreasuryAddress(),
    configHandlerRando.getVoucherBeaconAddress(),
    configHandlerRando.getBeaconProxyAddress(),
    configHandlerRando.getProtocolFeePercentage(),
    configHandlerRando.getProtocolFeeFlatBoson(),
    configHandlerRando.getMaxOffersPerBatch(),
    configHandlerRando.getMaxOffersPerGroup(),
    configHandlerRando.getMaxTwinsPerBundle(),
    configHandlerRando.getMaxOffersPerBundle(),
    configHandlerRando.getMaxTokensPerWithdrawal(),
    configHandlerRando.getMaxFeesPerDisputeResolver(),
    configHandlerRando.getMaxEscalationResponsePeriod(),
    configHandlerRando.getMaxDisputesPerBatch(),
    configHandlerRando.getMaxTotalOfferFeePercentage(),
    configHandlerRando.getMaxAllowedSellers(),
    configHandlerRando.getBuyerEscalationDepositPercentage(),
    configHandlerRando.getAuthTokenContract(AuthTokenType.None),
    configHandlerRando.getAuthTokenContract(AuthTokenType.Custom),
    configHandlerRando.getAuthTokenContract(AuthTokenType.Lens),
    configHandlerRando.getAuthTokenContract(AuthTokenType.ENS),
    configHandlerRando.getMaxExchangesPerBatch(),
    configHandlerRando.getMaxRoyaltyPecentage(),
    configHandlerRando.getMaxResolutionPeriod(),
    configHandlerRando.getMinDisputePeriod(),
    configHandlerRando.getAccessControllerAddress(),
  ]);

  return {
    tokenAddress,
    treasuryAddress,
    voucherBeaconAddress,
    beaconProxyAddress,
    protocolFeePercentage: protocolFeePercentage.toString(),
    protocolFeeFlatBoson: protocolFeeFlatBoson.toString(),
    maxOffersPerBatch: maxOffersPerBatch.toString(),
    maxOffersPerGroup: maxOffersPerGroup.toString(),
    maxTwinsPerBundle: maxTwinsPerBundle.toString(),
    maxOffersPerBundle: maxOffersPerBundle.toString(),
    maxTokensPerWithdrawal: maxTokensPerWithdrawal.toString(),
    maxFeesPerDisputeResolver: maxFeesPerDisputeResolver.toString(),
    maxEscalationResponsePeriod: maxEscalationResponsePeriod.toString(),
    maxDisputesPerBatch: maxDisputesPerBatch.toString(),
    maxTotalOfferFeePercentage: maxTotalOfferFeePercentage.toString(),
    maxAllowedSellers: maxAllowedSellers.toString(),
    buyerEscalationDepositPercentage: buyerEscalationDepositPercentage.toString(),
    authTokenContractNone,
    authTokenContractCustom,
    authTokenContractLens,
    authTokenContractENS,
    maxExchangesPerBatch: maxExchangesPerBatch.toString(),
    maxRoyaltyPecentage: maxRoyaltyPecentage.toString(),
    maxResolutionPeriod: maxResolutionPeriod.toString(),
    minDisputePeriod: minDisputePeriod.toString(),
    accessControllerAddress,
  };
}

async function getDisputeContractState(disputeHandler, exchanges) {
  const disputeHandlerRando = disputeHandler.connect(rando);
  let disputesState = [];
  let disputesStatesState = [];
  let disputeTimeoutState = [];
  let isDisputeFinalizedState = [];

  for (const exchange of exchanges) {
    const id = exchange.exchangeId;
    const [singleDisputesState, singleDisputesStatesState, singleDisputeTimeoutState, singleIsDisputeFinalizedState] =
      await Promise.all([
        disputeHandlerRando.getDispute(id),
        disputeHandlerRando.getDisputeState(id),
        disputeHandlerRando.getDisputeTimeout(id),
        disputeHandlerRando.isDisputeFinalized(id),
      ]);
    disputesState.push(singleDisputesState);
    disputesStatesState.push(singleDisputesStatesState);
    disputeTimeoutState.push(singleDisputeTimeoutState);
    isDisputeFinalizedState.push(singleIsDisputeFinalizedState);
  }

  return { disputesState, disputesStatesState, disputeTimeoutState, isDisputeFinalizedState };
}

async function getFundsContractState(fundsHandler, { DRs, sellers, buyers, agents }) {
  const fundsHandlerRando = fundsHandler.connect(rando);

  // Query even the ids where it's not expected to get the entity
  const accountIds = [...DRs, ...sellers, ...buyers, ...agents].map((account) => account.id);
  const groupsState = await Promise.all(accountIds.map((id) => fundsHandlerRando.getAvailableFunds(id)));

  return { groupsState };
}

async function getGroupContractState(groupHandler, groups) {
  const groupHandlerRando = groupHandler.connect(rando);
  const groupIds = [...Array(groups.length + 1).keys()].slice(1);
  const groupsState = await Promise.all(groupIds.map((id) => groupHandlerRando.getGroup(id)));

  const nextGroupId = await groupHandlerRando.getNextGroupId();
  return { groupsState, nextGroupId };
}

async function getTwinContractState(twinHandler, twins) {
  const twinHandlerRando = twinHandler.connect(rando);
  const twinIds = [...Array(twins.length + 1).keys()].slice(1);
  const twinsState = await Promise.all(twinIds.map((id) => twinHandlerRando.getTwin(id)));

  const nextTwinId = await twinHandlerRando.getNextTwinId();
  return { twinsState, nextTwinId };
}

async function getMetaTxContractState() {
  return {};
}

async function getMetaTxPrivateContractState(protocolDiamondAddress) {
  /*
        ProtocolMetaTxInfo storage layout
    
        #0 [ currentSenderAddress + isMetaTransaction ]
        #1 [ domain separator ]
        #2 [ ] // placeholder for usedNonce
        #3 [ cachedChainId ]
        #4 [ ] // placeholder for inputType
        #5 [ ] // placeholder for hashInfo
        #6 [ ] // placeholder for isAllowlisted
        */

  // starting slot
  const metaTxStorageSlot = keccak256(toUtf8Bytes("boson.protocol.metaTransactions"));
  const metaTxStorageSlotNumber = BigInt(metaTxStorageSlot);

  // current sender address + isMetaTransaction (they are packed since they are shorter than one slot)
  // should be always be 0x
  const inTransactionInfo = await getStorageAt(protocolDiamondAddress, metaTxStorageSlotNumber+"0");

  // domain separator
  const domainSeparator = await getStorageAt(protocolDiamondAddress, metaTxStorageSlotNumber+"1");

  // cached chain id
  const cachedChainId = await getStorageAt(protocolDiamondAddress, metaTxStorageSlotNumber+"3");

  // input type
  const inputTypeKeys = [
    "commitToOffer(address,uint256)",
    "cancelVoucher(uint256)",
    "redeemVoucher(uint256)",
    "completeExchange(uint256)",
    "withdrawFunds(uint256,address[],uint256[])",
    "retractDispute(uint256)",
    "raiseDispute(uint256)",
    "escalateDispute(uint256)",
    "resolveDispute(uint256,uint256,bytes32,bytes32,uint8)",
  ];

  const inputTypesState = [];
  for (const inputTypeKey of inputTypeKeys) {
    const storageSlot = getMappingStoragePosition(metaTxStorageSlotNumber+"4", inputTypeKey, paddingType.NONE);
    inputTypesState.push(await getStorageAt(protocolDiamondAddress, storageSlot));
  }

  // hashInfo
  const hashInfoTypes = {
    Generic: 0,
    CommitToOffer: 1,
    Exchange: 2,
    Funds: 3,
    RaiseDispute: 4,
    ResolveDispute: 5,
  };

  const hashInfoState = [];
  for (const hashInfoType of Object.values(hashInfoTypes)) {
    const storageSlot = getMappingStoragePosition(metaTxStorageSlotNumber+"5", hashInfoType, paddingType.START);
    // get also hashFunction
    hashInfoState.push({
      typeHash: await getStorageAt(protocolDiamondAddress, storageSlot),
      functionPointer: await getStorageAt(protocolDiamondAddress, BigInt(storageSlot)+1),
    });
  }
  const isAllowlistedState = {};

  const facets = [
    "AccountHandlerFacet",
    "SellerHandlerFacet",
    "BuyerHandlerFacet",
    "DisputeResolverHandlerFacet",
    "AgentHandlerFacet",
    "BundleHandlerFacet",
    "DisputeHandlerFacet",
    "ExchangeHandlerFacet",
    "FundsHandlerFacet",
    "GroupHandlerFacet",
    "OfferHandlerFacet",
    "TwinHandlerFacet",
    "PauseHandlerFacet",
    "MetaTransactionsHandlerFacet",
    "OrchestrationHandlerFacet1",
    "OrchestrationHandlerFacet2",
  ];

  const selectors = await getMetaTransactionsHandlerFacetInitArgs(facets);

  for (const selector of Object.values(selectors)) {
    const storageSlot = getMappingStoragePosition(metaTxStorageSlotNumber+"6", selector, paddingType.START);
    isAllowlistedState[selector] = await getStorageAt(protocolDiamondAddress, storageSlot);
  }

  return { inTransactionInfo, domainSeparator, cachedChainId, inputTypesState, hashInfoState, isAllowlistedState };
}

async function getProtocolStatusPrivateContractState(protocolDiamondAddress) {
  /*
        ProtocolStatus storage layout
    
        #0 [ pauseScenario ]
        #1 [ reentrancyStatus ]
        #2 [ ] // placeholder for initializedInterfaces
        #3 [ ] // placeholder for initializedVersions
        #4 [ version ] - not here as should be updated one very upgrade
        */

  // starting slot
  const protocolStatusStorageSlot = keccak256(toUtf8Bytes("boson.protocol.initializers"));
  const protocolStatusStorageSlotNumber = BigInt(protocolStatusStorageSlot);

  // pause scenario
  const pauseScenario = await getStorageAt(protocolDiamondAddress, protocolStatusStorageSlotNumber+"0");

  // reentrancy status
  // default: NOT_ENTERED = 1
  const reentrancyStatus = await getStorageAt(protocolDiamondAddress, protocolStatusStorageSlotNumber+"1");

  // initializedInterfaces
  if (!preUpgradeInterfaceIds) {
    // Only interfaces registered before upgrade are relevant for tests, so we load them only once
    preUpgradeInterfaceIds = await getInterfaceIds();
  }

  const initializedInterfacesState = [];
  for (const interfaceId of Object.values(preUpgradeInterfaceIds)) {
    const storageSlot = getMappingStoragePosition(
      protocolStatusStorageSlotNumber+"2",
      interfaceId,
      paddingType.END
    );
    initializedInterfacesState.push(await getStorageAt(protocolDiamondAddress, storageSlot));
  }

  if (!preUpgradeVersions) {
    preUpgradeVersions = getVersionsBeforeTarget(Object.keys(facets.upgrade), versionTags.newVersion);
  }

  const initializedVersionsState = [];
  for (const version of preUpgradeVersions) {
    const storageSlot = getMappingStoragePosition(protocolStatusStorageSlotNumber+"3", version, paddingType.END);
    initializedVersionsState.push(await getStorageAt(protocolDiamondAddress, storageSlot));
  }

  return { pauseScenario, reentrancyStatus, initializedInterfacesState, initializedVersionsState };
}

async function getProtocolLookupsPrivateContractState(
  protocolDiamondAddress,
  { mockToken, mockTwinTokens },
  { sellers, DRs, agents, buyers, offers, groups }
) {
  /*
        ProtocolLookups storage layout
    
        Variables marked with X have an external getter and are not handled here
        #0  [ ] // placeholder for exchangeIdsByOffer
        #1  [X] // placeholder for bundleIdByOffer
        #2  [X] // placeholder for bundleIdByTwin
        #3  [ ] // placeholder for groupIdByOffer
        #4  [X] // placeholder for agentIdByOffer
        #5  [X] // placeholder for sellerIdByAssistant
        #6  [X] // placeholder for sellerIdByAdmin
        #7  [X] // placeholder for sellerIdByClerk
        #8  [ ] // placeholder for buyerIdByWallet
        #9  [X] // placeholder for disputeResolverIdByAssistant
        #10 [X] // placeholder for disputeResolverIdByAdmin
        #11 [X] // placeholder for disputeResolverIdByClerk
        #12 [ ] // placeholder for disputeResolverFeeTokenIndex
        #13 [ ] // placeholder for agentIdByWallet
        #14 [X] // placeholder for availableFunds
        #15 [X] // placeholder for tokenList
        #16 [ ] // placeholder for tokenIndexByAccount
        #17 [ ] // placeholder for cloneAddress
        #18 [ ] // placeholder for voucherCount
        #19 [ ] // placeholder for conditionalCommitsByAddress
        #20 [X] // placeholder for authTokenContracts
        #21 [X] // placeholder for sellerIdByAuthToken
        #22 [ ] // placeholder for twinRangesBySeller
        #23 [ ] // placeholder for twinIdsByTokenAddressAndBySeller
        #24 [X] // placeholder for twinReceiptsByExchange
        #25 [X] // placeholder for allowedSellers
        #26 [ ] // placeholder for allowedSellerIndex
        #27 [X] // placeholder for exchangeCondition
        #28 [ ] // placeholder for offerIdIndexByGroup
        #29 [ ] // placeholder for pendingAddressUpdatesBySeller
        #30 [ ] // placeholder for pendingAuthTokenUpdatesBySeller
        #31 [ ] // placeholder for pendingAddressUpdatesByDisputeResolver
        */

  // starting slot
  const protocolLookupsSlot = keccak256(toUtf8Bytes("boson.protocol.lookups"));
  const protocolLookupsSlotNumber = BigInt(protocolLookupsSlot);

  // exchangeIdsByOffer and groupIdByOffer
  let exchangeIdsByOfferState = [];
  let groupIdByOfferState = [];
  for (const offer of offers) {
    const id = Number(offer.offer.id);
    // exchangeIdsByOffer
    let exchangeIdsByOffer = [];
    const arraySlot = BigNumber.from(
      getMappingStoragePosition(protocolLookupsSlotNumber+"0", id, paddingType.START)
    );
    const arrayLength = BigInt(await getStorageAt(protocolDiamondAddress, arraySlot)).toNumber();
    const arrayStart = BigInt(keccak256(arraySlot));
    for (let i = 0; i < arrayLength; i++) {
      exchangeIdsByOffer.push(await getStorageAt(protocolDiamondAddress, arrayStart+i));
    }
    exchangeIdsByOfferState.push(exchangeIdsByOffer);

    // groupIdByOffer
    groupIdByOfferState.push(
      await getStorageAt(
        protocolDiamondAddress,
        getMappingStoragePosition(protocolLookupsSlotNumber+"3", id, paddingType.START)
      )
    );
  }

  // buyerIdByWallet, agentIdByWallet, conditionalCommitsByAddress
  let buyerIdByWallet = [];
  let agentIdByWallet = [];
  let conditionalCommitsByAddress = [];

  const accounts = [...sellers, ...DRs, ...agents, ...buyers];

  for (const account of accounts) {
    const accountAddress = account.await wallet.getAddress();

    // buyerIdByWallet
    buyerIdByWallet.push(
      await getStorageAt(
        protocolDiamondAddress,
        getMappingStoragePosition(protocolLookupsSlotNumber+"8", accountAddress, paddingType.START)
      )
    );

    // agentIdByWallet
    agentIdByWallet.push(
      await getStorageAt(
        protocolDiamondAddress,
        getMappingStoragePosition(protocolLookupsSlotNumber+"13", accountAddress, paddingType.START)
      )
    );

    // conditionalCommitsByAddress
    const firstMappingStorageSlot = BigNumber.from(
      getMappingStoragePosition(protocolLookupsSlotNumber+"19", accountAddress, paddingType.START)
    );
    let commitsPerGroup = [];
    for (const group of groups) {
      const id = group.id;
      commitsPerGroup.push(
        await getStorageAt(
          protocolDiamondAddress,
          getMappingStoragePosition(firstMappingStorageSlot, id, paddingType.START)
        )
      );
    }
    conditionalCommitsByAddress.push(commitsPerGroup);
  }

  // disputeResolverFeeTokenIndex, tokenIndexByAccount, cloneAddress, voucherCount
  let disputeResolverFeeTokenIndex = [];
  let tokenIndexByAccount = [];
  let cloneAddress = [];
  let voucherCount = [];

  // all account ids
  const accountIds = accounts.map((account) => Number(account.id));

  // loop over all ids even where no data is expected
  for (const id of accountIds) {
    // disputeResolverFeeTokenIndex
    let firstMappingStorageSlot = BigNumber.from(
      getMappingStoragePosition(protocolLookupsSlotNumber+"12", id, paddingType.START)
    );
    disputeResolverFeeTokenIndex.push({
      native: await getStorageAt(
        protocolDiamondAddress,
        getMappingStoragePosition(firstMappingStorageSlot, ZeroAddress, paddingType.START)
      ),
      mockToken: await getStorageAt(
        protocolDiamondAddress,
        getMappingStoragePosition(firstMappingStorageSlot, await mockToken.getAddress(), paddingType.START)
      ),
    });

    // tokenIndexByAccount
    firstMappingStorageSlot = BigNumber.from(
      getMappingStoragePosition(protocolLookupsSlotNumber+"16", id, paddingType.START)
    );
    tokenIndexByAccount.push({
      native: await getStorageAt(
        protocolDiamondAddress,
        getMappingStoragePosition(firstMappingStorageSlot, ZeroAddress, paddingType.START)
      ),
      mockToken: await getStorageAt(
        protocolDiamondAddress,
        getMappingStoragePosition(firstMappingStorageSlot, await mockToken.getAddress(), paddingType.START)
      ),
    });

    // cloneAddress
    cloneAddress.push(
      await getStorageAt(
        protocolDiamondAddress,
        getMappingStoragePosition(protocolLookupsSlotNumber+"17", id, paddingType.START)
      )
    );

    // voucherCount
    voucherCount.push(
      await getStorageAt(
        protocolDiamondAddress,
        getMappingStoragePosition(protocolLookupsSlotNumber+"18", id, paddingType.START)
      )
    );
  }

  // twinRangesBySeller
  let twinRangesBySeller = [];
  for (const id of accountIds) {
    const firstMappingStorageSlot = BigNumber.from(
      getMappingStoragePosition(protocolLookupsSlotNumber+"22", id, paddingType.START)
    );
    let ranges = {};
    for (let mockTwin of mockTwinTokens) {
      ranges[await mockTwin.getAddress()] = [];
      const arraySlot = getMappingStoragePosition(firstMappingStorageSlot, await mockTwin.getAddress(), paddingType.START);
      const arrayLength = BigInt(await getStorageAt(protocolDiamondAddress, arraySlot)).toNumber();
      const arrayStart = BigInt(keccak256(arraySlot));
      for (let i = 0; i < arrayLength * 2; i = i + 2) {
        // each BosonTypes.TokenRange has length 2
        ranges[await mockTwin.getAddress()].push({
          start: await getStorageAt(protocolDiamondAddress, arrayStart+i),
          end: await getStorageAt(protocolDiamondAddress, arrayStart+i + 1),
        });
      }
    }
    twinRangesBySeller.push(ranges);
  }

  // twinIdsByTokenAddressAndBySeller
  let twinIdsByTokenAddressAndBySeller = [];
  for (const id of accountIds) {
    const firstMappingStorageSlot = BigNumber.from(
      getMappingStoragePosition(protocolLookupsSlotNumber+"23", id, paddingType.START)
    );
    let twinIds = {};
    for (let mockTwin of mockTwinTokens) {
      twinIds[await mockTwin.getAddress()] = [];
      const arraySlot = getMappingStoragePosition(firstMappingStorageSlot, await mockTwin.getAddress(), paddingType.START);
      const arrayLength = BigInt(await getStorageAt(protocolDiamondAddress, arraySlot)).toNumber();
      const arrayStart = BigInt(keccak256(arraySlot));
      for (let i = 0; i < arrayLength; i++) {
        twinIds[await mockTwin.getAddress()].push(await getStorageAt(protocolDiamondAddress, arrayStart+i));
      }
    }
    twinIdsByTokenAddressAndBySeller.push(twinIds);
  }

  // allowedSellerIndex
  let allowedSellerIndex = [];
  for (const DR of DRs) {
    const firstMappingStorageSlot = BigNumber.from(
      getMappingStoragePosition(
        protocolLookupsSlotNumber+"26",
        BigInt(DR.disputeResolver.id).toHexString(),
        paddingType.START
      )
    );
    let sellerStatus = [];
    for (const seller of sellers) {
      sellerStatus.push(
        await getStorageAt(
          protocolDiamondAddress,
          getMappingStoragePosition(
            firstMappingStorageSlot,
            BigInt(seller.seller.id).toHexString(),
            paddingType.START
          )
        )
      );
    }
    allowedSellerIndex.push(sellerStatus);
  }

  // offerIdIndexByGroup
  let offerIdIndexByGroup = [];
  for (const group of groups) {
    const id = group.id;
    const firstMappingStorageSlot = BigNumber.from(
      getMappingStoragePosition(protocolLookupsSlotNumber+"28", id, paddingType.START)
    );
    let offerInidices = [];
    for (const offer of offers) {
      const id2 = Number(offer.offer.id);
      offerInidices.push(
        await getStorageAt(
          protocolDiamondAddress,
          getMappingStoragePosition(firstMappingStorageSlot, id2, paddingType.START)
        )
      );
    }
    offerIdIndexByGroup.push(offerInidices);
  }

  // pendingAddressUpdatesBySeller, pendingAuthTokenUpdatesBySeller, pendingAddressUpdatesByDisputeResolver
  let pendingAddressUpdatesBySeller = [];
  let pendingAuthTokenUpdatesBySeller = [];
  let pendingAddressUpdatesByDisputeResolver = [];

  // Although pending address/auth token update is not yet defined in 2.0.0, we can check that storage slots are empty
  for (const id of accountIds) {
    // pendingAddressUpdatesBySeller
    let structStorageSlot = BigNumber.from(
      getMappingStoragePosition(protocolLookupsSlotNumber+"29", id, paddingType.START)
    );
    let structFields = [];
    for (let i = 0; i < 5; i++) {
      // BosonTypes.Seller has 6 fields, but last bool is packed in one slot with previous field
      structFields.push(await getStorageAt(protocolDiamondAddress, structStorageSlot+i));
    }
    pendingAddressUpdatesBySeller.push(structFields);

    // pendingAuthTokenUpdatesBySeller
    structStorageSlot = BigNumber.from(
      getMappingStoragePosition(protocolLookupsSlotNumber+"30", id, paddingType.START)
    );
    structFields = [];
    for (let i = 0; i < 2; i++) {
      // BosonTypes.AuthToken has 2 fields
      structFields.push(await getStorageAt(protocolDiamondAddress, structStorageSlot+i));
    }
    pendingAuthTokenUpdatesBySeller.push(structFields);

    // pendingAddressUpdatesByDisputeResolver
    structStorageSlot = BigNumber.from(
      getMappingStoragePosition(protocolLookupsSlotNumber+"31", id, paddingType.START)
    );
    structFields = [];
    for (let i = 0; i < 8; i++) {
      // BosonTypes.DisputeResolver has 8 fields
      structFields.push(await getStorageAt(protocolDiamondAddress, structStorageSlot+i));
    }
    structFields[6] = await getStorageAt(protocolDiamondAddress, keccak256(structStorageSlot+6)); // represents field string metadataUri. Technically this value represents the length of the string, but since it should be 0, we don't do further decoding
    pendingAddressUpdatesByDisputeResolver.push(structFields);
  }

  return {
    exchangeIdsByOfferState,
    groupIdByOfferState,
    buyerIdByWallet,
    disputeResolverFeeTokenIndex,
    agentIdByWallet,
    tokenIndexByAccount,
    cloneAddress,
    voucherCount,
    conditionalCommitsByAddress,
    twinRangesBySeller,
    twinIdsByTokenAddressAndBySeller,
    allowedSellerIndex,
    offerIdIndexByGroup,
    pendingAddressUpdatesBySeller,
    pendingAuthTokenUpdatesBySeller,
    pendingAddressUpdatesByDisputeResolver,
  };
}

async function getStorageLayout(contractName) {
  const { sourceName } = await hre.artifacts.readArtifact(contractName);
  const buildInfo = await hre.artifacts.getBuildInfo(`${sourceName}:${contractName}`);

  const storage = buildInfo.output?.contracts?.[sourceName]?.[contractName]?.storageLayout?.storage;

  return storage;
}

function compareStorageLayouts(storageBefore, storageAfter) {
  // All old variables must be present in new layout in the same slots
  // New variables can be added if they don't affect the layout
  let storageOk = true;
  for (const stateVariableBefore of storageBefore) {
    const { label } = stateVariableBefore;
    if (label == "__gap") {
      // __gap is special variable that does not store any data and can potentially be modified
      // TODO: if changed, validate against new variables
      continue;
    }
    const stateVariableAfter = storageAfter.find((stateVariable) => stateVariable.label === label);
    if (
      !stateVariableAfter ||
      stateVariableAfter.slot != stateVariableBefore.slot ||
      stateVariableAfter.offset != stateVariableBefore.offset ||
      stateVariableAfter.type != stateVariableBefore.type
    ) {
      storageOk = false;
      console.error("Storage layout mismatch");
      console.log("State variable before", stateVariableBefore);
      console.log("State variable after", stateVariableAfter);
    }
  }

  return storageOk;
}

async function populateVoucherContract(
  deployer,
  protocolDiamondAddress,
  { accountHandler, exchangeHandler, offerHandler, fundsHandler },
  { mockToken },
  existingEntities,
  isBefore = false
) {
  let DR;
  let sellers = [];
  let buyers = [];
  let offers = [];
  let bosonVouchers = [];
  let exchanges = [];

  let voucherIndex = 1;

  if (existingEntities) {
    // If existing entities are provided, we use them instead of creating new ones
    ({ DR, sellers, buyers, offers, bosonVouchers } = existingEntities);
  } else {
    const entityType = {
      SELLER: 0,
      DR: 1,
      AGENT: 2,
      BUYER: 3,
    };

    const entities = [
      entityType.DR,
      entityType.SELLER,
      entityType.SELLER,
      entityType.SELLER,
      entityType.SELLER,
      entityType.SELLER,
      entityType.BUYER,
      entityType.BUYER,
      entityType.BUYER,
      entityType.BUYER,
      entityType.BUYER,
    ];

    let nextAccountId = await accountHandler.getNextAccountId();
    for (const entity of entities) {
      const wallet = Wallet.createRandom();
      const connectedWallet = wallet.connect(provider);
      //Fund the new wallet
      let tx = {
        to: await connectedWallet.getAddress(),
        // Convert currency unit from ether to wei
        value: parseEther("10"),
      };
      await deployer.sendTransaction(tx);

      // create entities
      switch (entity) {
        case entityType.DR: {
          const disputeResolver = mockDisputeResolver(
            await wallet.getAddress(),
            await wallet.getAddress(),
            await wallet.getAddress(),
            await wallet.getAddress(),
            true,
            true
          );
          const disputeResolverFees = [
            new DisputeResolverFee(ZeroAddress, "Native", "0"),
            new DisputeResolverFee(await mockToken.getAddress(), "MockToken", "0"),
          ];
          const sellerAllowList = [];

          disputeResolver.id = nextAccountId.toString();

          await accountHandler
            .connect(connectedWallet)
            .createDisputeResolver(disputeResolver, disputeResolverFees, sellerAllowList);
          DR = {
            wallet: connectedWallet,
            id: disputeResolver.id,
            disputeResolver,
            disputeResolverFees,
            sellerAllowList,
          };

          if (versionsWithActivateDRFunction.includes(isBefore ? versionTags.oldVersion : versionTags.newVersion)) {
            //ADMIN role activates Dispute Resolver
            await accountHandler.connect(deployer).activateDisputeResolver(disputeResolver.id);
          }
          break;
        }
        case entityType.SELLER: {
          const seller = mockSeller(await wallet.getAddress(), await wallet.getAddress(), await wallet.getAddress(), await wallet.getAddress(), true, undefined, {
            refreshModule: true,
          });
          const id = (seller.id = nextAccountId.toString());
          let authToken = mockAuthToken();

          // set unique new voucherInitValues
          const voucherInitValues = new VoucherInitValues(`http://seller${id}.com/uri`, id * 10);
          await accountHandler.connect(connectedWallet).createSeller(seller, authToken, voucherInitValues);

          // calculate voucher contract address and cast it to contract instance
          const voucherContractAddress = calculateContractAddress(await accountHandler.getAddress(), voucherIndex++);
          const bosonVoucher = await getContractAt("BosonVoucher", voucherContractAddress);

          sellers.push({
            wallet: connectedWallet,
            id,
            seller,
            authToken,
            voucherInitValues,
            offerIds: [],
            bosonVoucher,
          });
          bosonVouchers.push(bosonVoucher);

          // mint mock token to sellers just in case they need them
          await mockToken.mint(await connectedWallet.getAddress(), "10000000000");
          await mockToken.connect(connectedWallet).approve(protocolDiamondAddress, "10000000000");
          break;
        }
        case entityType.BUYER: {
          // no need to explicitly create buyer, since it's done automatically during commitToOffer
          const buyer = mockBuyer(await wallet.getAddress());
          buyer.id = nextAccountId.toString();
          buyers.push({ wallet: connectedWallet, id: buyer.id, buyer });
          break;
        }
      }

      nextAccountId++;
    }
  }

  // create offers - first seller has 5 offers, second 4, third 3 etc
  let offerId = (await offerHandler.getNextOfferId()).toNumber();
  for (let i = 0; i < sellers.length; i++) {
    for (let j = i; j >= 0; j--) {
      // Mock offer, offerDates and offerDurations
      const { offer, offerDates, offerDurations } = await mockOffer();

      // Set unique offer properties based on offer id
      offer.id = `${offerId}`;
      offer.sellerId = sellers[j].seller.id;
      offer.price = `${offerId * 1000}`;
      offer.sellerDeposit = `${offerId * 100}`;
      offer.buyerCancelPenalty = `${offerId * 50}`;
      offer.quantityAvailable = `${(offerId + 1) * 15}`;

      // Default offer is in native token. Change every other to mock token
      if (offerId % 2 == 0) {
        offer.exchangeToken = await mockToken.getAddress();
      }

      // Set unique offer dates based on offer id
      const now = offerDates.validFrom;
      offerDates.validFrom = BigInt(now)
        +oneMonth + offerId * 1000
        .toString();
      offerDates.validUntil = BigInt(now)
        +oneMonth * 6 * (offerId + 1)
        .toString();

      // Set unique offerDurations based on offer id
      offerDurations.disputePeriod = `${(offerId + 1) * oneMonth}`;
      offerDurations.voucherValid = `${(offerId + 1) * oneMonth}`;
      offerDurations.resolutionPeriod = `${(offerId + 1) * oneDay}`;

      // choose one DR and agent
      const disputeResolverId = DR.disputeResolver.id;
      const agentId = "0";

      // create an offer
      await offerHandler
        .connect(sellers[j].wallet)
        .createOffer(offer, offerDates, offerDurations, disputeResolverId, agentId);

      offers.push({ offer, offerDates, offerDurations, disputeResolverId, agentId });
      sellers[j].offerIds.push(offerId);

      // Deposit seller funds so the commit will succeed
      const sellerPool = BigInt(offer.quantityAvailable)*offer.price.toString();
      const msgValue = offer.exchangeToken == ZeroAddress ? sellerPool : "0";
      await fundsHandler
        .connect(sellers[j].wallet)
        .depositFunds(sellers[j].seller.id, offer.exchangeToken, sellerPool, { value: msgValue });

      offerId++;
    }
  }

  // commit to some offers: first buyer commit to 1 offer, second to 2, third to 3 etc
  await setNextBlockTimestamp(Number(offers[offers.length - 1].offerDates.validFrom)); // When latest offer is valid, also other offers are valid
  let exchangeId = (await exchangeHandler.getNextExchangeId()).toNumber();
  for (let i = 0; i < buyers.length; i++) {
    for (let j = i; j < buyers.length; j++) {
      const offer = offers[i + j].offer; // some offers will be picked multiple times, some never.
      const offerPrice = offer.price;
      const buyerWallet = buyers[j].wallet;
      let msgValue;
      if (offer.exchangeToken == ZeroAddress) {
        msgValue = offerPrice;
      } else {
        // approve token transfer
        msgValue = 0;
        await mockToken.connect(buyerWallet).approve(protocolDiamondAddress, offerPrice);
        await mockToken.mint(await buyerWallet.getAddress(), offerPrice);
      }
      await exchangeHandler.connect(buyerWallet).commitToOffer(await buyerWallet.getAddress(), offer.id, { value: msgValue });
      exchanges.push({ exchangeId: exchangeId, offerId: offer.id, buyerIndex: j });
      exchangeId++;
    }
  }

  return { DR, sellers, buyers, offers, exchanges, bosonVouchers };
}

async function getVoucherContractState({ bosonVouchers, exchanges, sellers, buyers }) {
  let bosonVouchersState = [];
  for (const bosonVoucher of bosonVouchers) {
    // supports interface
    const interfaceIds = await getInterfaceIds(false);
    const suppportstInterface = await Promise.all(
      [interfaceIds["IBosonVoucher"], interfaceIds["IERC721"], interfaceIds["IERC2981"]].map((i) =>
        bosonVoucher.supportsInterface(i)
      )
    );

    // no arg getters
    const [sellerId, contractURI, getRoyaltyPercentage, owner, name, symbol] = await Promise.all([
      bosonVoucher.getSellerId(),
      bosonVoucher.contractURI(),
      bosonVoucher.getRoyaltyPercentage(),
      bosonVoucher.owner(),
      bosonVoucher.name(),
      bosonVoucher.symbol(),
    ]);

    // tokenId related
    const tokenIds = exchanges.map((exchange) => exchange.exchangeId); // tokenId and exchangeId are interchangeable
    const ownerOf = await Promise.all(
      tokenIds.map((tokenId) => bosonVoucher.ownerOf(tokenId).catch(() => "invalid token"))
    );
    const tokenURI = await Promise.all(
      tokenIds.map((tokenId) => bosonVoucher.tokenURI(tokenId).catch(() => "invalid token"))
    );
    const getApproved = await Promise.all(
      tokenIds.map((tokenId) => bosonVoucher.getApproved(tokenId).catch(() => "invalid token"))
    );
    const royaltyInfo = await Promise.all(
      tokenIds.map((tokenId) => bosonVoucher.royaltyInfo(tokenId, "100").catch(() => "invalid token"))
    );

    // balanceOf(address owner)
    // isApprovedForAll(address owner, address assistant)
    const addresses = [...sellers, ...buyers].map((acc) => acc.await wallet.getAddress());
    const balanceOf = await Promise.all(addresses.map((address) => bosonVoucher.balanceOf(address)));
    const isApprovedForAll = await Promise.all(
      addresses.map((address1) =>
        Promise.all(addresses.map((address2) => bosonVoucher.isApprovedForAll(address1, address2)))
      )
    );

    bosonVouchersState.push({
      suppportstInterface,
      sellerId,
      contractURI,
      getRoyaltyPercentage,
      owner,
      name,
      symbol,
      ownerOf,
      tokenURI,
      getApproved,
      royaltyInfo,
      balanceOf,
      isApprovedForAll,
    });
  }
  return bosonVouchersState;
}

function revertState() {
  shell.exec(`rm -rf contracts/* scripts/*`);
  shell.exec(`git checkout HEAD contracts scripts`);
  shell.exec(`git reset HEAD contracts scripts`);
}

async function getDisputeResolver(accountHandler, value, { getBy }) {
  let exist, DR, DRFees, sellerAllowList;
  if (getBy == "address") {
    [exist, DR, DRFees, sellerAllowList] = await accountHandler.getDisputeResolverByAddress(value);
  } else {
    [exist, DR, DRFees, sellerAllowList] = await accountHandler.getDisputeResolver(value);
  }
  DR = DisputeResolver.fromStruct(DR);
  DRFees = DRFees.map((fee) => DisputeResolverFee.fromStruct(fee));
  sellerAllowList = sellerAllowList.map((sellerId) => sellerId.toString());

  return { exist, DR, DRFees, sellerAllowList };
}

async function getSeller(accountHandler, value, { getBy }) {
  let exist, seller, authToken;

  if (getBy == "address") {
    [exist, seller, authToken] = await accountHandler.getSellerByAddress(value);
  } else if (getBy == "authToken") {
    [exist, seller, authToken] = await accountHandler.getSellerByAuthToken(value);
  } else {
    [exist, seller, authToken] = await accountHandler.getSeller(value);
  }

  seller = Seller.fromStruct(seller);
  authToken = AuthToken.fromStruct(authToken);

  return { exist, seller, authToken };
}

async function getAgent(accountHandler, id) {
  let exist, agent;
  [exist, agent] = await accountHandler.getAgent(id);
  agent = Agent.fromStruct(agent);
  return { exist, agent };
}

async function getBuyer(accountHandler, id) {
  let exist, buyer;
  [exist, buyer] = await accountHandler.getBuyer(id);
  buyer = Buyer.fromStruct(buyer);
  return { exist, buyer };
}

exports.deploySuite = deploySuite;
exports.upgradeSuite = upgradeSuite;
exports.upgradeClients = upgradeClients;
exports.populateProtocolContract = populateProtocolContract;
exports.getProtocolContractState = getProtocolContractState;
exports.getStorageLayout = getStorageLayout;
exports.compareStorageLayouts = compareStorageLayouts;
exports.populateVoucherContract = populateVoucherContract;
exports.getVoucherContractState = getVoucherContractState;
exports.revertState = revertState;
