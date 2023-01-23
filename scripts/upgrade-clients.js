const hre = require("hardhat");
const ethers = hre.ethers;
const network = hre.network.name;
const environments = require("../environments");
const tipMultiplier = ethers.BigNumber.from(environments.tipMultiplier);
const tipSuggestion = "1500000000"; // ethers.js always returns this constant, it does not vary per block
const maxPriorityFeePerGas = ethers.BigNumber.from(tipSuggestion).mul(tipMultiplier);
const {
  deploymentComplete,
  getFees,
  readContracts,
  writeContracts,
  checkRole,
  addressNotFound,
} = require("./util/utils.js");
const { deployProtocolClientImpls } = requireUncached("./util/deploy-protocol-client-impls.js");
const Role = require("./domain/Role");

/**
 * Upgrades clients
 *
 * Prerequisite:
 * - Admin must have UPGRADER role. Use `manage-roles.js` to grant it.
 *
 * Currently script upgrades the only existing client - BosonVoucher.
 * If new clients are introduced, this script should be modified to get the list of clients to upgrade from the config.
 */
async function main(env, clientConfig) {
  // Bail now if hardhat network, unless the upgrade is tested
  if (network === "hardhat" && env !== "upgrade-test") process.exit();

  const { chainId } = await ethers.provider.getNetwork();
  let { contracts } = readContracts(chainId, network, env);

  const divider = "-".repeat(80);
  console.log(`${divider}\nBoson Protocol Client Upgrader\n${divider}`);
  console.log(`⛓  Network: ${network}\n📅 ${new Date()}`);

  // If hardhat, get an address generated by the mnemonic
  const adminAddress =
    network === "hardhat" ? (await ethers.getSigners())[0].address : environments[network].adminAddress;

  // If admin address is unspecified, exit the process
  if (adminAddress == ethers.constants.AddressZero || !adminAddress) {
    console.log("Admin address must not be zero address");
    process.exit(1);
  }

  // Get list of accounts managed by node
  const nodeAccountList = (await ethers.provider.listAccounts()).map((address) => address.toLowerCase());

  if (nodeAccountList.includes(adminAddress.toLowerCase())) {
    console.log("🔱 Admin account: ", adminAddress);
  } else {
    console.log("🔱 Admin account not found");
    process.exit(1);
  }
  console.log(divider);

  // Get signer for admin address
  const adminSigner = await ethers.getSigner(adminAddress);

  // Get addresses of currently deployed Beacon contract
  const beaconAddress = contracts.find((c) => c.name === "BosonVoucher Beacon")?.address;
  if (!beaconAddress) {
    return addressNotFound("BosonVoucher Beacon");
  }

  // Validate that admin has UPGRADER role
  checkRole(contracts, Role.UPGRADER, adminAddress);

  clientConfig = JSON.parse(clientConfig) || require("./config/client-upgrade");

  // Deploy Protocol Client implementation contracts
  console.log(`\n📋 Deploying new logic contract`);

  const implementationArgs = Object.values(clientConfig).map((config) => config[network]);
  const [bosonVoucherImplementation] = await deployProtocolClientImpls(implementationArgs, maxPriorityFeePerGas);

  // Update implementation address on beacon contract
  console.log(`\n📋 Updating implementation address on beacon`);
  const beacon = await ethers.getContractAt("BosonClientBeacon", beaconAddress);
  await beacon
    .connect(adminSigner)
    .setImplementation(bosonVoucherImplementation.address, await getFees(maxPriorityFeePerGas));

  // Remove old entry from contracts
  contracts = contracts.filter((i) => i.name !== "BosonVoucher Logic");
  deploymentComplete("BosonVoucher Logic", bosonVoucherImplementation.address, [], "", contracts);

  const contractsPath = await writeContracts(contracts, env);
  console.log(divider);
  console.log(`✅ Contracts written to ${contractsPath}`);
  console.log(divider);

  console.log(`\n📋 Client upgraded.`);
  console.log("\n");
}

/**
 * Require uncached node module
 *
 * Normally, if the same module is required multiple times, the first time it is loaded and cached.
 * If the module is changed during the execution, the cache is not updated, so the old version is returned.
 * This function deletes the cache for the specified module and requires it again.
 *
 * Use case:
 * Upgrade test `test/upgrade/clients/BosonVoucher-2.1.0-2.2.0.js` deploys version 2.1.0 of the contract and then upgrades it to 2.2.0.
 * Since deployment script changed between versions, current deployment script cannot be used to deploy 2.1.0.
 * For first deployment, we checkout old deployment script, which uses `deployProtocolHandlerFacets` from `./util/deploy-protocol-handler-facets.js`.
 * To upgrade to 2.2.0, we switch back to current upgrade script, which uses `deployProtocolFacets` from `./util/deploy-protocol-handler-facets.js`.
 * If the cache is not cleared, requiring module `./util/deploy-protocol-handler-facets.js` returns the old version, where `deployProtocolFacets` does not
 * exist yet and the upgrade fails.
 * If the cache is cleared, the new version is required and the upgrade succeeds.
 *
 * @param {string} module - Module to require
 */
function requireUncached(module) {
  delete require.cache[require.resolve(module)];
  return require(module);
}

exports.upgradeClients = main;
