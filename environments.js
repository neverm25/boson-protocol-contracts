/**
 *  Build and test environment configuration.
 *
 *  - Translates environment vars into JSON objects
 *  - Environment vars are defined in .env and
 */

require("dotenv").config();

module.exports = {
  // Transaction controls
  confirmations: parseInt(process.env.CONFIRMATIONS),
  tipMultiplier: parseInt(process.env.TIP_MULTIPLIER),

  // For deploying with CREATE3
  create3: {
    address: process.env.CREATE3_FACTORY_ADDRESS,
    salt: process.env.CREATE3_SALT,
  },

  // Needed for verifying contract code on Etherscan
  etherscan: {
    apiKey: process.env.DEPLOYER_ETHERSCAN_API_KEY,
  },

  // Needed for verifying contract code on Polygonscan
  polygonscan: {
    apiKey: process.env.DEPLOYER_POLYGONSCAN_API_KEY,
  },

  // Needed for verifying contract code on okLink
  okLink: {
    apiKey: process.env.DEPLOYER_OKLINK_API_KEY,
  },

  // Needed for Gas Reporter
  coinmarketcap: {
    apiKey: process.env.GAS_REPORTER_COINMARKETCAP_API_KEY,
  },

  /*
    NETWORK SPECIFIC ENVIRONMENT CONFIGURATIONS
    - txNode: blockchain node url (e.g. local, infura, alchemy etc.)
    - keys: private key used for deployment
    - gasLimit: maximum gas spent per transaction
    - adminAddress: address that is granted ADMIN role during the deployment
    - nftAuthTokenHolders: address that are given test auth tokens during the deployment. Relevant only for test networks.
    */

  // Hardhat testnet
  //  - throwaway HDWallet mnemonic for running unit tests, which require more than one address
  hardhat: {
    mnemonic: process.env.DEPLOYER_HARDHAT_MNEMONIC,
  },

  // Local node
  //  - if you are running hardhat node, do not specify "keys". Use keys only if you run different local node.
  //  - if no DEPLOYER_LOCAL_TXNODE is specified, default "http://127.0.0.1:8545" will be used
  localhost: {
    txNode: process.env.DEPLOYER_LOCAL_TXNODE,
    keys: [process.env.DEPLOYER_LOCAL_KEY],
    adminAddress: process.env.ADMIN_ADDRESS_LOCAL,
    nftAuthTokenHolders: process.env.AUTH_TOKEN_OWNERS_LOCAL,
  },

  // Internal test env
  test: {
    txNode: process.env.DEPLOYER_TEST_TXNODE,
    keys: [process.env.DEPLOYER_TEST_KEY],
    adminAddress: process.env.ADMIN_ADDRESS_TEST,
    nftAuthTokenHolders: process.env.AUTH_TOKEN_OWNERS_TEST,
  },

  // Ethereum Mainnet
  mainnet: {
    txNode: process.env.DEPLOYER_MAINNET_TXNODE,
    keys: [process.env.DEPLOYER_MAINNET_KEY],
    adminAddress: process.env.ADMIN_ADDRESS_MAINNET,
  },

  // Ethereum testnet Sepolia
  sepolia: {
    txNode: process.env.DEPLOYER_SEPOLIA_TXNODE,
    keys: [process.env.DEPLOYER_SEPOLIA_KEY],
    adminAddress: process.env.ADMIN_ADDRESS_SEPOLIA,
  },

  // Polygon Mumbai testnet
  mumbai: {
    txNode: process.env.DEPLOYER_MUMBAI_TXNODE,
    keys: [process.env.DEPLOYER_MUMBAI_KEY],
    adminAddress: process.env.ADMIN_ADDRESS_MUMBAI,
  },

  // Polygon Amoy testnet
  amoy: {
    txNode: process.env.DEPLOYER_AMOY_TXNODE,
    keys: [process.env.DEPLOYER_AMOY_KEY],
    adminAddress: process.env.ADMIN_ADDRESS_AMOY,
  },

  // Polygon Mainnet
  polygon: {
    txNode: process.env.DEPLOYER_POLYGON_TXNODE,
    keys: [process.env.DEPLOYER_POLYGON_KEY],
    adminAddress: process.env.ADMIN_ADDRESS_POLYGON,
  },
};
