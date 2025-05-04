The bridge application is a bot to help relay between Nine Chronicles network's `NCG` and Ethereum network's `WNCG` token, which is a wrapper token of the NCG.

The purpose of this document is to describe to help you to running the bridge application in your local development environment from setting development environment.

If you have a question about this join.

## 0. Setup

### macOS (Intel)

1. Install [`brew`](https://brew.sh/)
1. Install nvm, docker, docker-compose
   ```
   brew install nvm docker docker-compose
   ```
1. Install nodejs 16.17
   ```
   nvm install 16.17
   nvm use 16.17
   ```
1. Install `yarn`
   ```
   npm i -g yarn
   ```

### macOS (Apple Silicon)

1. Install [`brew`](https://brew.sh/)
1. Install nvm, podman, podman-compose
   ```
   brew install nvm podman podman-compose
   ```
1. Install nodejs 16.17
   ```
   nvm install 16.17
   nvm use 16.17
   ```
1. Install `yarn`
   ```
   npm i -g yarn
   ```
1. Initialize podman
   ```
   podman machine init
   podman machine start
   ```
1. [Optional] Alias podman as docker. This step is optional but you should manually replace the `docker`, `docker-compose` command in the below guides with `podman`, `podman-compose`.
   ```
   alias docker=podman
   alias docker-compose=podman-compose
   ```

## 1. Run headless in local

Currently, there is a prepared `docker-compose.yaml` file. It'll run the local headless, which builds a new local chain from the genesis block.

Run the below command to run the headless.

```
docker-compose up -d
```

And you can stop with the below command:

```
docker-compose down
```

And you can see the logs with the below command:

```
docker-compose logs
```

You may see the logs like the below text:

```
[07:04:54 DBG] Secp256K1CryptoBackend initialized.
[07:04:55 DBG] Migrating RocksDB.
[07:04:55 DBG] RocksDB is initialized.
[07:04:55 DBG] Number of chain ids: 0
[07:04:55 DBG] Canonical chain id: 
[07:04:55 DBG] [BlockChain] Trying to append block #0 15e07324f162d7f28037dc2ab88439c4103602c204af9052befb8a44249ef1fb
[07:04:55 DBG] [BlockChain] Executing actions in the block #0 15e07324f162d7f28037dc2ab88439c4103602c204af9052befb8a44249ef1fb...
[07:04:55 DBG] Evaluating actions in the block #0 pre-evaluation hash: e766a4baeb94d3a60f6894a40b63dc79cc467f9d448a5fd3083607cbb40c3c17...
[07:04:55 DBG] 1 actions ["InitializeStates"] in transaction ba1580182a6b3c03a76d6336028f6c61f248f06eb8eea9910a361164262332d9 by 0x2c2A05E29e8f57C4661Fb8FFf5e0C7A7e0f3c4Fc with timestamp 2022-05-18T05:08:41.963700Z evaluated in 24ms.
[07:04:55 DBG] Evaluating policy block action for block #0 System.Collections.Immutable.ImmutableArray`1[System.Byte]
```

### Q. In the macOS, it says like `Port 5000 already in use`

The macOS takes 5000 port for Airplay receiver. You can turn off the feature. Look the below article.

https://medium.com/pythonistas/port-5000-already-in-use-macos-monterey-issue-d86b02edd36c

## 2. Prepare AWS KMS

This bridge application depends on AWS KMS service. So you should make a new AWS KMS.

### 2-1. Sign in AWS

Because the AWS KMS is a service of AWS' services, you must sign up and sign in AWS.

https://aws.amazon.com/

### 2-2. Make AWS KMS instance

Go to https://us-east-2.console.aws.amazon.com/kms/home?region=us-east-2#/kms/keys

![image](https://user-images.githubusercontent.com/26626194/185340000-915046ea-0609-4ecd-a12d-aa2ef77aef3b.png)

And click the `Create Key` button. In the next page, you should choose:
- `Asymmetric` for `Key type`
- `Sign and verify` for `Key usage`
- `ECC_SECG_P256K1` for `Key spec`

![image](https://user-images.githubusercontent.com/26626194/185340493-1316588f-c815-42c7-9f46-f4cb03211ed8.png)

In the next page, you must set the key's name. You can name it as you want.

![image](https://user-images.githubusercontent.com/26626194/185341360-f61b7ccf-525f-49e4-ad4f-75c9fc7eca8c.png)

And you can skip to last page by clicking the `Next` buttons.

![image](https://user-images.githubusercontent.com/26626194/185346183-0f5214af-b8d8-413f-9017-97f925525099.png)

### 2-3. Assign the KMS instance to IAM user

At the `Key users` section, you can see the `Add` button and click the button.s

![image](https://user-images.githubusercontent.com/26626194/185346677-94933dda-5024-41fa-932a-d14db3569caf.png)

Then the popup to search users to allow cryptographic operations will appear. Search the user to use for the bridge development. And choose and add it.

![image](https://user-images.githubusercontent.com/26626194/185346876-c255bbf7-c6b5-4349-ae22-d30d08402d88.png)

![image](https://user-images.githubusercontent.com/26626194/185347472-e0cd57ef-9932-4bdc-b5cb-625cf30bdbb6.png)

## 3. Deploy WNCG contract

### 3-1. Setup
Under the `contracts` directory, there are contracts for `WNCG` ERC-20 token.

![image](https://user-images.githubusercontent.com/26626194/185365185-4bee0f09-244d-46a4-89ec-05343935c13a.png)

At first, you should turn on terminal and run the below command to install dependencies:

```
yarn
```

### 3-2. Prepare Ethereum gRPC endpoint

You should prepare Ethereum gRPC endpoint to use for WNCG contract migration. In simple case, you can use free services like Infura. Then let's use Infura at this time.

https://infura.io/

And you should sign up and sign in. Then you can see the button to turn on the popup to create new key.

https://infura.io/dashboard

![image](https://user-images.githubusercontent.com/26626194/185369129-4141d98b-b342-46c8-b14d-6820c99ff718.png)


Click the `CREATE NEW KEY` and choose `Web3 API` network type.

<img width="513" alt="image" src="https://user-images.githubusercontent.com/26626194/185369240-b2800f6e-debe-4d25-b731-5eca5f228a8a.png">

And click the `CREATE` button.

<img width="515" alt="image" src="https://user-images.githubusercontent.com/26626194/185369384-d0bb4d6f-6546-4efc-a89f-ffca29053565.png">

Then you will see your `API KEY` and your Ethereum network endpoint.

And you can get the Ethereum Ropsten network endpoint after setting up the network with ropsten. If you changed the network type well, the endpoint will be like `https://ropsten.infura.io/v3/*`.

### 3-3. Setup `.env` file to deploy WNCG contract

The truffle suite uses `.env` called `dotenv`. And there is `.env.example` file so you can duplicate the example file to fill them easily.

```
INFURA_PROJECT_ID="{PROJECT_ID}"
MNEMONIC="{MNEMONIC}"
MNEMONIC_INDEX=0
```

It requires `INFURA_PROJECT_ID`, `MNEMONIC`, `MNEMONIC_INDEX`.

You can fill `INFURA_PROJECT_ID` with the `API_KEY` in the Infura page of the project you made in the previous step.

`MNEMONIC` is a [HD wallet][hd-wallet] key (see also [BIP39](https://github.com/bitcoin/bips/blob/master/bip-0039.mediawiki)) and `MNEMONIC_INDEX` is a number that determines which number of private keys to use.

You can use the `MNEMONIC` code from MetaMask or other wallet too. Or, if you want to generate a new one, you can run the command `deno run --allow-env=NODE_DEBUG ./contracts/scripts/generate-mnemonic.ts`. Then it will print like the below:

```
$ deno run --allow-env=NODE_DEBUG ./contracts/scripts/generate-mnemonic.ts
# DO NOT USE THIS MNEMONIC CODE
coconut census scorpion popular twelve craft engage wet fantasy man speed emotion
0xD1aa04C2D1B3Dfb13f24AD33Ad4e31b3Ad197B92
```

The first line can be used as `MNEMONIC` enviorment variable and the second line is its address.

Then the `.env` will be like

```
INFURA_PROJECT_ID="?"
MNEMONIC="coconut census scorpion popular twelve craft engage wet fantasy man speed emotion"
MNEMONIC_INDEX=0
```

Then let's get some ethers to deploy contracts.

[hd-wallet]: https://en.bitcoinwiki.org/wiki/Deterministic_wallet

### 3-4. Get testnet ethers from Faucet

Today is August 23, 2022 and the Ropsten testnet will be deprecated at about 2022 Q4. But there is not enough peers and infrastructures in Sepolia testnet yet so this document will use ropsten now.

You got your address while running `contracts/scripts/generate-mnemonic.ts` in the before step. You should find a faucet that can give you testnet Ethereum. While writing this document, I used the below faucet.

https://faucet.egorfine.com/

Enter your address and submit the button.

![image](https://user-images.githubusercontent.com/26626194/186072111-4fbf1ee4-f306-4157-80c1-68a1d40a5d9a.png)

You should check your ETH balance and you can check it with Etherscan like `https://ropsten.etherscan.io/address/0xd1aa04c2d1b3dfb13f24ad33ad4e31b3ad197b92`

![image](https://user-images.githubusercontent.com/26626194/186072244-3073732c-6ebe-4af6-9f8a-4d4273348503.png)

Okay, if you have some Ethereums, you're ready to deploy contracts now.

### 3-5. Deploy WNCG contract!

You followed steps well 💪🏼 It's simple to deploy WNCG contract. At first, move to `contracts` directory and run `yarn truffle migrate --network ropsten`.

Then it will show the output like the below screenshot.
<img width="1023" alt="image" src="https://user-images.githubusercontent.com/26626194/186073103-83e16f24-e222-4b64-a77a-65935cd6fb39.png">

And it shows also contract address.

```
...
2_deploy_wrapped_ncg.js
=======================

   Deploying 'WrappedNCG'
   ----------------------
   > transaction hash:    0xab49f57fb9242428b14c2359969aea357e40754c9f188c72f2eef04ce408d6d7
   > Blocks: 3            Seconds: 37
   > contract address:    0x5F2e568E7085Ce18fA7b68e13fd5C04e99F044C4
   > block number:        12846076
   > block timestamp:     1661230560
   > account:             0xD1aa04C2D1B3Dfb13f24AD33Ad4e31b3Ad197B92
   > balance:             9.997948036985636259
   > gas used:            1804860 (0x1b8a3c)
   > gas price:           1.000000007 gwei
   > value sent:          0 ETH
   > total cost:          0.00180486001263402 ETH


   > Saving migration to chain.
   > Saving artifacts
   -------------------------------------
   > Total cost:     0.00180486001263402 ETH


Summary
=======
> Total deployments:   2
> Final cost:          0.002006047014042329 ETH


✨  Done in 116.18s.
```

Then copy the `contract address` (e.g. `0x5F2e568E7085Ce18fA7b68e13fd5C04e99F044C4`), and visit Etherscan like https://ropsten.etherscan.io/address/0x5F2e568E7085Ce18fA7b68e13fd5C04e99F044C4.

If the page exists with `Contract Creation` transaction, you deployed the WNCG contract succesfully!!

### 3-6. Move ownership to AWS KMS account.

Move ownership