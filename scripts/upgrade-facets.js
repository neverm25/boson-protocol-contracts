const hre = require("hardhat");
const ethers = hre.ethers;
const network = hre.network.name;
const { getFacets } = require("./config/facet-upgrade");
const environments = require("../environments");
const tipMultiplier = ethers.BigNumber.from(environments.tipMultiplier);
const tipSuggestion = "1500000000"; // ethers.js always returns this constant, it does not vary per block
const maxPriorityFeePerGas = ethers.BigNumber.from(tipSuggestion).mul(tipMultiplier);
const { deployProtocolFacets } = require("./util/deploy-protocol-handler-facets.js");
const {
  FacetCutAction,
  getSelectors,
  removeSelectors,
  cutDiamond,
  getInitializeCalldata,
} = require("./util/diamond-utils.js");
const { deploymentComplete, readContracts, writeContracts, checkRole, addressNotFound } = require("./util/utils.js");
const { getInterfaceIds, interfaceImplementers } = require("./config/supported-interfaces.js");
const Role = require("./domain/Role");
const packageFile = require("../package.json");
const readline = require("readline");
const FacetCut = require("./domain/FacetCut");
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

/**
 * Upgrades or removes existing facets, or adds new facets.
 *
 * Prerequisite:
 * - Admin must have UPGRADER role. Use `manage-roles.js` to grant it.
 *
 * Process:
 *  1.  Edit scripts/config/facet-upgrade.js.
 *  1a. Provide a list of facets that needs to be upgraded (field "addOrUpgrade") or removed completely (field "remove")
 *  1b. Optionally you can specify which selectors should be ignored (field "skip"). You don't have to specify "initialize()" since it's ignored by default
 *  2. Update protocol version in package.json. If not, script will prompt you to confirm that version remains unchanged.
 *  2. Run the appropriate npm script in package.json to upgrade facets for a given network
 *  3. Save changes to the repo as a record of what was upgraded
 */
async function main(env, facetConfig) {
  // Bail now if hardhat network, unless the upgrade is tested
  if (network === "hardhat" && env !== "upgrade-test") process.exit();

  const chainId = (await ethers.provider.getNetwork()).chainId;
  const contractsFile = readContracts(chainId, network, env);
  let contracts = contractsFile.contracts;
  const interfaceIds = await getInterfaceIds();
  const interfaceIdFromFacetName = (facetName) => interfaceIds[interfaceImplementers[facetName]];

  const divider = "-".repeat(80);
  console.log(`${divider}\nBoson Protocol Contract Suite Upgrader\n${divider}`);
  console.log(`⛓  Network: ${network}\n📅 ${new Date()}`);

  const { version } = packageFile;

  // Check that package.json version was updated
  if (version == contractsFile.protocolVersion && env !== "upgrade-test") {
    const answer = await getUserResponse("Protocol version has not been updated. Proceed anyway? (y/n) ", [
      "y",
      "yes",
      "n",
      "no",
    ]);
    switch (answer.toLowerCase()) {
      case "y":
      case "yes":
        break;
      case "n":
      case "no":
      default:
        process.exit(1);
    }
  }

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

  // Get addresses of currently deployed contracts
  const protocolAddress = contracts.find((c) => c.name === "ProtocolDiamond")?.address;

  // Check if admin has UPGRADER role
  checkRole(contracts, Role.UPGRADER, adminAddress);

  if (!protocolAddress) {
    return addressNotFound("ProtocolDiamond");
  }

  // Get facets to upgrade
  let facets;

  if (facetConfig) {
    // facetConfig was passed in as a JSON object
    facets = JSON.parse(facetConfig);
  } else {
    // Get values from default config file
    facets = await getFacets();
  }

  // Deploy new facets
  let deployedFacets = await deployProtocolFacets(facets.addOrUpgrade, facets.facetsToInit, maxPriorityFeePerGas);

  // Cast Diamond to DiamondCutFacet, DiamondLoupeFacet and IERC165Extended
  const diamondCutFacet = await ethers.getContractAt("DiamondCutFacet", protocolAddress);
  const diamondLoupe = await ethers.getContractAt("DiamondLoupeFacet", protocolAddress);

  const facetCutRemove = [];
  const interfacesToRemove = [],
    interfacesToAdd = [];

  // Manage new or upgraded facets
  for (const [index, newFacet] of deployedFacets.entries()) {
    // Get currently registered selectors
    const oldFacet = contracts.find((i) => i.name === newFacet.name);
    let registeredSelectors;
    if (oldFacet) {
      // Facet already exists and is only upgraded
      registeredSelectors = await diamondLoupe.facetFunctionSelectors(oldFacet.address);
    } else {
      // Facet is new
      registeredSelectors = [];
    }

    // Remove old entry from contracts
    contracts = contracts.filter((i) => i.name !== newFacet.name);

    const newFacetInterfaceId = interfaceIdFromFacetName(newFacet.name);
    deploymentComplete(newFacet.name, newFacet.contract.address, [], newFacetInterfaceId, contracts);

    // Get new selectors from compiled contract
    const selectors = getSelectors(newFacet.contract, true);
    let newSelectors = selectors.selectors;

    if (newFacet.name !== "ProtocolInitializationFacet") {
      // Initialization data for facets with no-arg initializers
      const noArgInitFunction = "initialize()";
      const noArgInitInterface = new ethers.utils.Interface([`function ${noArgInitFunction}`]);
      const noArgCallData = noArgInitInterface.encodeFunctionData("initialize");

      try {
        // Slice to get function selector (first 4 bytes)
        newSelectors = selectors.selectors.remove([newFacet.initialize?.slice(0, 10) || noArgCallData]);
      } catch {
        // @TODO handle when facet has no initialize function or initialize has parameters (e.g ConfigHandlerFacet)
      }
    } else {
      const signature = newFacet.contract.interface.getSighash(
        "initialize(bytes32,address[],bytes[],bool,bytes4[],bytes4[])"
      );
      newSelectors = selectors.selectors.remove([signature]);
    }

    // Determine actions to be made
    let selectorsToReplace = registeredSelectors.filter((value) => newSelectors.includes(value)); // intersection of old and new selectors
    let selectorsToRemove = registeredSelectors.filter((value) => !selectorsToReplace.includes(value)); // unique old selectors
    let selectorsToAdd = newSelectors.filter((value) => !selectorsToReplace.includes(value)); // unique new selectors

    // Skip selectors if set in config
    let selectorsToSkip = facets.skipSelectors[newFacet.name] ? facets.skipSelectors[newFacet.name] : [];
    selectorsToReplace = removeSelectors(selectorsToReplace, selectorsToSkip);
    selectorsToRemove = removeSelectors(selectorsToRemove, selectorsToSkip);
    selectorsToAdd = removeSelectors(selectorsToAdd, selectorsToSkip);

    // Check if selectors that are being added are not registered yet on some other facet
    // If collision is found, user must choose to either (s)kip it or (r)eplace it.
    for (const selectorToAdd of selectorsToAdd) {
      const existingFacetAddress = await diamondLoupe.facetAddress(selectorToAdd);
      if (existingFacetAddress != ethers.constants.AddressZero) {
        // Selector exist on some other facet
        const selectorName = selectors.signatureToNameMapping[selectorToAdd];
        const prompt = `Selector ${selectorName} is already registered on facet ${existingFacetAddress}. Do you want to (r)eplace or (s)kip it? `;
        const answer = await getUserResponse(prompt, ["r", "s"]);
        if (answer == "r") {
          // User chose to replace
          selectorsToReplace.push(selectorToAdd);
        } else {
          // User chose to skip
          selectorsToSkip.push(selectorName);
        }
        // In any case, remove it from selectorsToAdd
        selectorsToAdd = removeSelectors(selectorsToAdd, [selectorName]);
      }
    }

    const newFacetAddress = newFacet.contract.address;
    if (selectorsToAdd.length > 0) {
      deployedFacets[index].cut.push([newFacetAddress, FacetCutAction.Add, selectorsToAdd]);
    }
    if (selectorsToReplace.length > 0) {
      deployedFacets[index].cut.push([newFacetAddress, FacetCutAction.Replace, selectorsToReplace]);
    }
    if (selectorsToRemove.length > 0) {
      deployedFacets[index].cut.push([ethers.constants.AddressZero, FacetCutAction.Remove, selectorsToRemove]);
    }

    if (oldFacet && (selectorsToAdd.length > 0 || selectorsToRemove.length > 0)) {
      if (!oldFacet.interfaceId) {
        console.log(
          `Could not find interface id for old facet ${oldFacet.name}.\nYou might need to remove its interfaceId from "supportsInterface" manually.`
        );
      } else {
        if (oldFacet.interfaceId == newFacetInterfaceId) {
          // This can happen if interface is shared across facets and interface was updated already
          continue;
        }

        interfacesToRemove.push(oldFacet.interfaceId);

        // Check if interface was shared across other facets and update contracts info
        contracts = contracts.map((entry) => {
          if (entry.interfaceId == oldFacet.interfaceId) {
            entry.interfaceId = newFacetInterfaceId;
          }
          return entry;
        });
      }

      const erc165 = await ethers.getContractAt("IERC165", protocolAddress);
      const support = await erc165.supportsInterface(newFacetInterfaceId);
      if (!support) {
        interfacesToAdd.push(newFacetInterfaceId);
      }
    }
  }

  for (const facetToRemove of facets.remove) {
    // Get currently registered selectors
    const oldFacet = contracts.find((i) => i.name === facetToRemove);

    let registeredSelectors;
    if (oldFacet) {
      // Facet already exists and is only upgraded
      registeredSelectors = await diamondLoupe.facetFunctionSelectors(oldFacet.address);
    } else {
      // Facet does not exist, skip next steps
      continue;
    }

    // Remove old entry from contracts
    contracts = contracts.filter((i) => i.name !== facetToRemove);

    // All selectors must be removed
    let selectorsToRemove = registeredSelectors; // all selectors must be removed

    // Removing the selectors
    facetCutRemove.push([ethers.constants.AddressZero, FacetCutAction.Remove, selectorsToRemove]);

    if (oldFacet) {
      // Remove support for old interface
      if (!oldFacet.interfaceId) {
        console.log(
          `Could not find interface id for old facet ${oldFacet.name}.\nYou might need to remove its interfaceId from "supportsInterface" manually.`
        );
      } else {
        // Remove from smart contract
        interfacesToRemove.push(oldFacet.interfaceId);

        // Check if interface was shared across other facets and update contracts info
        contracts = contracts.map((entry) => {
          if (entry.interfaceId == oldFacet.interfaceId) {
            entry.interfaceId = "";
          }
          return entry;
        });
      }
    }
  }

  // Get ProtocolInitializationFacet from deployedFacets when added/replaced in this upgrade or get it from contracts if already deployed
  let protocolInitializationFacet = await getInitializationFacet(deployedFacets, contracts);
  const facetsToInit = deployedFacets.filter((facet) => facet.initialize) ?? [];
  const initializeCalldata = getInitializeCalldata(
    facetsToInit,
    version,
    true,
    protocolInitializationFacet,
    interfacesToRemove,
    interfacesToAdd
  );

  await cutDiamond(
    diamondCutFacet.address,
    maxPriorityFeePerGas,
    deployedFacets,
    protocolInitializationFacet.address,
    initializeCalldata,
    facetCutRemove
  );

  // Logs
  for (const facet of deployedFacets) {
    console.log(`\n📋 Facet: ${facet.name}`);

    let { cut } = facet;
    cut = cut.map((c) => {
      const facetCut = FacetCut.fromStruct(c);
      return facetCut.toObject();
    });

    const selectors = getSelectors(facet.contract, true);
    logFacetCut(cut, selectors);
  }

  console.log(`\n💀 Removed facets:\n\t${facets.remove.join("\n\t")}`);

  interfacesToAdd.length && console.log(`📋 Added interfaces:\n\t${interfacesToAdd.join("\n\t")}`);
  interfacesToRemove.length && console.log(`💀 Removed interfaces:\n\t${interfacesToRemove.join("\n\t")}`);

  console.log(divider);

  // Cast diamond to ProtocolInitializationFacet
  protocolInitializationFacet = await ethers.getContractAt("ProtocolInitializationFacet", protocolAddress);
  const newVersion = await protocolInitializationFacet.getVersion();
  console.log(`\n📋 New version: ${newVersion}`);

  const contractsPath = await writeContracts(contracts, env);
  console.log(divider);
  console.log(`✅ Contracts written to ${contractsPath}`);
  console.log(divider);

  console.log(`\n📋 Diamond upgraded.`);
  console.log("\n");
}

async function getUserResponse(question, validResponses) {
  console.error(question);
  const answer = await new Promise((resolve) => {
    rl.question("", resolve);
  });
  if (validResponses.includes(answer)) {
    return answer;
  } else {
    console.error("Invalid response!");
    return await getUserResponse(question, validResponses);
  }
}

const getInitializationFacet = async (deployedFacets, contracts) => {
  let protocolInitializationFacet;

  const protocolInitializationName = "ProtocolInitializationFacet";
  const protocolInitializationDeployed = deployedFacets.find((f) => f.name == protocolInitializationName);

  if (protocolInitializationDeployed) {
    protocolInitializationFacet = protocolInitializationDeployed.contract;
  } else {
    protocolInitializationFacet = await ethers.getContractAt(
      protocolInitializationName,
      contracts.find((i) => i.name == protocolInitializationName).address
    );
  }

  if (!protocolInitializationFacet) {
    console.error("Could not find ProtocolInitializationFacet");
    process.exit(1);
  }

  return protocolInitializationFacet;
};

const logFacetCut = (cut, selectors) => {
  for (const action in FacetCutAction) {
    cut
      .filter((c) => c.action == FacetCutAction[action])
      .forEach((c) => {
        console.log(
          `💎 ${action} selectors:\n\t${c.functionSelectors
            .map((selector) => `${selectors.signatureToNameMapping[selector]}: ${selector}`)
            .join("\n\t")}`
        );
      });
  }
};

exports.upgradeFacets = main;
