require("dotenv").config();

const HDWalletProvider = require("@truffle/hdwallet-provider");

module.exports = {
  networks: {
    development: {
      provider: () => new HDWalletProvider({
        mnemonic: "two artist ribbon scene clown bachelor rail ivory grant budget clutch wrong",
        providerOrUrl: `http://localhost:7545/`,
        addressIndex: 0,
      }),
      network_id: "7777"
    },
    test: {
      host: "127.0.0.1",
      port: 7545,
      network_id: "*"
    },
    mainnet: {
      provider: () =>
        new HDWalletProvider({
            mnemonic: process.env.MNEMONIC,
            providerOrUrl: `https://mainnet.infura.io/v3/${process.env.INFURA_PROJECT_ID}`,
            addressIndex: process.env.MNEMONIC_INDEX,
        }),
      network_id: 1, // Mainnet's id
      gasPrice: 40000000000,
      confirmations: 10, // # of confs to wait between deployments. (default: 0)
      timeoutBlocks: 200, // # of blocks before a deployment times out  (minimum/default: 50)
      skipDryRun: false, // Skip dry run before migrations? (default: false for public nets )
      networkCheckTimeout: 1000000000,
    },
    ropsten: {
      provider: () =>
        new HDWalletProvider({
          mnemonic: process.env.MNEMONIC,
          providerOrUrl: `https://ropsten.infura.io/v3/${process.env.INFURA_PROJECT_ID}`,
          addressIndex: process.env.MNEMONIC_INDEX,
        }),
      network_id: 3, // Ropsten's id
      gas: 5500000, // Ropsten has a lower block limit than mainnet
      confirmations: 0, // # of confs to wait between deployments. (default: 0)
      timeoutBlocks: 200, // # of blocks before a deployment times out  (minimum/default: 50)
      skipDryRun: true, // Skip dry run before migrations? (default: false for public nets )
      networkCheckTimeout: 1000000000,
    },
    goerli: {
      provider: () =>
        new HDWalletProvider({
          mnemonic: process.env.MNEMONIC,
          providerOrUrl: `https://goerli.infura.io/v3/${process.env.INFURA_PROJECT_ID}`,
          addressIndex: process.env.MNEMONIC_INDEX,
        }),
      network_id: 5, // Goerli's id
      //gas: 5500000, // # use default gas
      confirmations: 0,
      timeoutBlocks: 200,
      skipDryRun: true,
      networkCheckTimeout: 1000000000,
    },
    sepolia: {
      provider: () =>
        new HDWalletProvider({
          mnemonic: process.env.MNEMONIC,
          providerOrUrl: `https://sepolia.infura.io/v3/${process.env.INFURA_PROJECT_ID}`,
          addressIndex: process.env.MNEMONIC_INDEX,
        }),
      network_id: 11155111, // Sepolia's id
      gas: 5500000,
      confirmations: 0,
      timeoutBlocks: 200,
      skipDryRun: true,
      networkCheckTimeout: 1000000000,
    },
  },
  compilers: {
    solc: {
      version: "0.8.0"
    },
  },
};
