# Wrapped NCG contracts

## Installation

```
npm install
```

## Setup environment variables

There is `truffle-config.js` script file to configure `truffle` with `MNEMONIC`, `MNEMONIC_INDEX` and `INFURA_PROJECT_ID` from environment variables.

You can copy `.env.example` to `.env` and you should fill the environment variables' value.

You can get `INFURA_PROJECT_ID` from [infura's Dashboard](https://infura.io).

## Deployment

To deploy `WrappedNCG` contract, you can use `truffle migrate` command with `--network` option. `truffle-config.js` contains multiple network configurations and you can select what network you want to use with `--network` option.

```
truffle migrate --network=ropsten
```

Then, it will generate `build/WrappedNCG.json` and the JSON file will contain the contract's address, ABI, transaction hash, etc. You can get the each value from:

- address: `"networks"."{CHAIN_ID}"."address"`
- transactionHash: `"networks"."{CHAIN_ID}"."transactionHash"`
- ABI: `"abi"`

## Use deployed contract in interactive console.

First, you should run `truffle console` and enter to interactive console.

```
npx truffle console
```

And you can get deployed contract with below script:

```
const wNCG = await WrappedNCG.deployed();
```

And you can use any methods of the contract like:

```
truffle(ropsten)> wNCG.owner()
'0xbc02Cc6262B0B7e58C4953dE9900E1F430aed101'
truffle(ropsten)> wNCG.mint("0xDac65eCE9CB3E7a538773e08DE31F973233F064f", 100)
{
  tx: '0x28b19565710ba1a53368b3d9ff1a314e23556d7b02d7c7a078155b20e63d0936',
  receipt: {
    blockHash: '0x657303bc5ce59ab4a2da384b83b14bac7e1dae92b276eacfdab35bd78fa6b4c7',
    blockNumber: 10394380,
    contractAddress: null,
    cumulativeGasUsed: 942025,
    from: '0xbc02cc6262b0b7e58c4953de9900e1f430aed101',
    gasUsed: 37109,
    logs: [ [Object] ],
    logsBloom: '0x00000000000000000000000000000000000000000000000000000000000000000000800000000000000000000000000000000000000000000000000000002000000000000000000000200008000000000000000000000000000000000000000000000000020000000000000000000800000000000000000000000010000000000000000000000000000000000010000000000000000000000000400000000000000000000000000000000000000000000000000000000000000000000000000002000002000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000000000000',
    status: true,
    to: '0x2395900038eef1814161a76621912b3599d7d242',
    transactionHash: '0x28b19565710ba1a53368b3d9ff1a314e23556d7b02d7c7a078155b20e63d0936',
    transactionIndex: 3,
    type: '0x0',
    rawLogs: [ [Object] ]
  },
  logs: [
    {
      address: '0x2395900038eEf1814161A76621912B3599D7d242',
      blockHash: '0x657303bc5ce59ab4a2da384b83b14bac7e1dae92b276eacfdab35bd78fa6b4c7',
      blockNumber: 10394380,
      logIndex: 0,
      removed: false,
      transactionHash: '0x28b19565710ba1a53368b3d9ff1a314e23556d7b02d7c7a078155b20e63d0936',
      transactionIndex: 3,
      id: 'log_72b97b3c',
      event: 'Transfer',
      args: [Result]
    }
  ]
}
truffle(ropsten)> wNCG.burn(100, "0x2395900038eEf1814161A76621912B3599D7d242")
```