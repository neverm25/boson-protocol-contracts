const environments = require("../environments");
const hre = require("hardhat");
const { ZeroAddress, getContractAt, getSigners, getContractFactory, provider } = hre.ethers;
const network = hre.network.name;
const confirmations = network == "hardhat" ? 1 : environments.confirmations;
const tipMultiplier = BigInt(environments.tipMultiplier);
const tipSuggestion = "1500000000"; // ethers.js always returns this constant, it does not vary per block
const maxPriorityFeePerGas = BigInt(tipSuggestion) * tipMultiplier;

const packageFile = require("../package.json");
const authTokenAddresses = require("./config/auth-token-addresses");
const { getFacets } = require("./config/facet-deploy");

const Role = require("./domain/Role");
const { deployProtocolDiamond } = require("./util/deploy-protocol-diamond.js");
const { deployProtocolClients } = require("./util/deploy-protocol-clients.js");
const { deployAndCutFacets } = require("./util/deploy-protocol-handler-facets.js");
const { verifyOnTestEnv } = require("./util/report-verify-deployments");
const { getInterfaceIds, interfaceImplementers } = require("./config/supported-interfaces.js");
const { deploymentComplete, getFees, writeContracts } = require("./util/utils");
const AuthTokenType = require("../scripts/domain/AuthTokenType");
const clientConfig = require("./config/client-upgrade");
const { WrappedNative } = require("./config/protocol-parameters");

/**
 * Deploy Boson Protocol V2 contract suite
 *
 * Running with the appropriate npm script in package.json:
 * `npm run deploy-suite:local`
 *
 * Running with hardhat
 * `npx hardhat deploy-suite --network hardhat --env test`
 */

/**
 * Get the contract addresses for supported NFT Auth token contracts
 * @returns {lensAddress: string, ensAddress: string}
 */
function getAuthTokenContracts() {
  return {
    lensAddress: process.env.LENS_ADDRESS || authTokenAddresses.LENS[network],
    ensAddress: process.env.ENS_ADDRESS || authTokenAddresses.ENS[network],
  };
}

async function main(env, facetConfig, create3) {
  if (create3) {
    const code = await provider.getCode(environments.create3.address);
    if (code === "0x") {
      console.log("CREATE3 factory contract is not deployed on this network.");
      process.exit(1);
    }
  }

  // Compile everything (in case run by node)
  await hre.run("compile");

  // Deployed contracts
  let contracts = [];
  const interfaceIds = await getInterfaceIds();
  const interfaceIdFromFacetName = (facetName) => interfaceIds[interfaceImplementers[facetName]];

  let transactionResponse;

  // Output script header
  const divider = "-".repeat(80);
  console.log(`${divider}\nBoson Protocol V2 Contract Suite Deployer\n${divider}`);
  console.log(`⛓  Network: ${network}\n📅 ${new Date()}`);

  const authTokenContracts = getAuthTokenContracts();

  // Get the accounts
  const accounts = await getSigners();
  const deployer = accounts[0];

  // If hardhat, get an address generated by the mnemonic
  const adminAddress = network === "hardhat" ? accounts[0].address : environments[network].adminAddress;

  // If admin address is unspecified, exit the deployment process
  if (adminAddress == ZeroAddress || !adminAddress) {
    console.log("Admin address must not be zero address");
    process.exit(1);
  }

  console.log("🔱 Deployer account: ", deployer ? await deployer.getAddress() : "not found" && process.exit());
  console.log(divider);

  console.log(`💎 Deploying AccessController, ProtocolDiamond, and Diamond utility facets...`);

  // Deploy the Diamond
  const [protocolDiamond, dlf, dcf, erc165f, accessController, diamondArgs] = await deployProtocolDiamond(
    maxPriorityFeePerGas,
    create3 ? environments.create3 : null
  );
  deploymentComplete("AccessController", await accessController.getAddress(), [deployer.address], "", contracts);
  deploymentComplete(
    "DiamondLoupeFacet",
    await dlf.getAddress(),
    [],
    interfaceIdFromFacetName("DiamondLoupeFacet"),
    contracts
  );
  deploymentComplete(
    "DiamondCutFacet",
    await dcf.getAddress(),
    [],
    interfaceIdFromFacetName("DiamondCutFacet"),
    contracts
  );
  deploymentComplete("ERC165Facet", await erc165f.getAddress(), [], interfaceIdFromFacetName("ERC165Facet"), contracts);
  deploymentComplete("ProtocolDiamond", await protocolDiamond.getAddress(), diamondArgs, "", contracts);

  console.log(`\n💎 Granting UPGRADER role...`);

  // Temporarily grant UPGRADER role to deployer account
  transactionResponse = await accessController.grantRole(
    Role.UPGRADER,
    await deployer.getAddress(),
    await getFees(maxPriorityFeePerGas)
  );
  await transactionResponse.wait(confirmations);

  // Deploy Boson Price Discovery Client
  console.log("\n💸 Deploying Boson Price Discovery Client...");
  const constructorArgs = [WrappedNative[network], await protocolDiamond.getAddress()];
  const bosonPriceDiscoveryFactory = await getContractFactory("BosonPriceDiscovery");
  const bosonPriceDiscovery = await bosonPriceDiscoveryFactory.deploy(...constructorArgs);
  await bosonPriceDiscovery.waitForDeployment();

  deploymentComplete(
    "BosonPriceDiscoveryClient",
    await bosonPriceDiscovery.getAddress(),
    constructorArgs,
    "",
    contracts
  );

  console.log(`\n💎 Deploying and initializing protocol handler facets...`);

  // Deploy and cut facets
  let facetData;

  if (facetConfig) {
    // facetConfig was passed in as a JSON object
    const facetConfigObject = JSON.parse(facetConfig);
    facetData = facetConfigObject;
  } else {
    // Get values from default config file
    facetData = await getFacets();
  }

  // Update boson price discovery address in config init
  facetData["ConfigHandlerFacet"].init[0].priceDiscovery = await bosonPriceDiscovery.getAddress();

  const { version } = packageFile;
  let { deployedFacets } = await deployAndCutFacets(
    await protocolDiamond.getAddress(),
    facetData,
    maxPriorityFeePerGas,
    version
  );

  for (const deployedFacet of deployedFacets) {
    deploymentComplete(
      deployedFacet.name,
      deployedFacet.contract.target,
      deployedFacet.constructorArgs,
      interfaceIdFromFacetName(deployedFacet.name),
      contracts
    );
  }

  console.log(`\n⧉ Deploying Protocol Client implementation/proxy pairs...`);

  // Deploy the Protocol Client implementation/proxy pairs
  const protocolClientArgs = [await protocolDiamond.getAddress()];
  const clientImplementationArgs = Object.values(clientConfig).map(
    (config) => process.env.FORWARDER_ADDRESS || config[network]
  );
  const [impls, beacons] = await deployProtocolClients(
    protocolClientArgs,
    maxPriorityFeePerGas,
    clientImplementationArgs
  );
  const [bosonVoucherImpl] = impls;
  const [bosonClientBeacon] = beacons;

  // Gather the complete args that were used to create the proxies
  const bosonVoucherProxyArgs = [...protocolClientArgs, await bosonVoucherImpl.getAddress()];

  // Report and prepare for verification
  deploymentComplete(
    "BosonVoucher Logic",
    await bosonVoucherImpl.getAddress(),
    clientImplementationArgs,
    "",
    contracts
  );
  deploymentComplete("BosonVoucher Beacon", await bosonClientBeacon.getAddress(), bosonVoucherProxyArgs, "", contracts);

  console.log(`\n🌐️Configuring and granting roles...`);

  // Cast Diamond to the IBosonConfigHandler interface for further interaction with it
  const bosonConfigHandler = await getContractAt("IBosonConfigHandler", await protocolDiamond.getAddress());

  // Add Voucher addresses to protocol config
  transactionResponse = await bosonConfigHandler.setVoucherBeaconAddress(
    await bosonClientBeacon.getAddress(),
    await getFees(maxPriorityFeePerGas)
  );
  await transactionResponse.wait(confirmations);

  // Add NFT auth token addresses to protocol config
  // LENS
  // Skip the step if the LENS is not available on the network
  if (authTokenContracts.lensAddress && authTokenContracts.lensAddress != "") {
    transactionResponse = await bosonConfigHandler.setAuthTokenContract(
      AuthTokenType.Lens,
      authTokenContracts.lensAddress,
      await getFees(maxPriorityFeePerGas)
    );
    await transactionResponse.wait(confirmations);
  }

  // ENS
  // Skip the step if the LENS is not available on the network
  if (authTokenContracts.ensAddress && authTokenContracts.ensAddress != "") {
    transactionResponse = await bosonConfigHandler.setAuthTokenContract(
      AuthTokenType.ENS,
      authTokenContracts.ensAddress,
      await getFees(maxPriorityFeePerGas)
    );
    await transactionResponse.wait(confirmations);
  }

  console.log(`✅ ConfigHandlerFacet updated with remaining post-initialization config.`);

  // Renounce temporarily granted UPGRADER role for deployer account
  transactionResponse = await accessController.renounceRole(
    Role.UPGRADER,
    await deployer.getAddress(),
    await getFees(maxPriorityFeePerGas)
  );
  await transactionResponse.wait(confirmations);

  // Grant PROTOCOL role to the ProtocolDiamond contract
  transactionResponse = await accessController.grantRole(
    Role.PROTOCOL,
    await protocolDiamond.getAddress(),
    await getFees(maxPriorityFeePerGas)
  );
  await transactionResponse.wait(confirmations);

  if (adminAddress.toLowerCase() != (await deployer.getAddress()).toLowerCase()) {
    // Grant ADMIN role to the specified admin address
    // Skip this step if adminAddress is the deployer
    transactionResponse = await accessController.grantRole(
      Role.ADMIN,
      adminAddress,
      await getFees(maxPriorityFeePerGas)
    );
    await transactionResponse.wait(confirmations);
  }

  console.log(`✅ Granted roles to appropriate contract and addresses.`);

  const contractsPath = await writeContracts(contracts, env, version);
  console.log(`✅ Contracts written to ${contractsPath}`);

  // Verify on test node if test env
  // Just checks that there is contract code at the expected addresses
  if (network === "test" || network === "localhost") {
    await verifyOnTestEnv(contracts);
  }
}

exports.deploySuite = main;
