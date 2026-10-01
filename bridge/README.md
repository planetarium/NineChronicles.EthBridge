# Bridge

This application relays between `wNCG` on [Ethereum] and `NCG` on Nine Chronicles network.

## Prerequisite

```
# Nodejs LTS
$ node --version
v16.17.0

# https://yarnpkg.com/
$ yarn --version
1.22.19

# Python 2 should be installed and alias via python
$ python --version
Python 2.7.18

# SQLite3 should be installed because it uses SQLite3 as database.
$ command -v sqlite3
/usr/bin/sqlite3
```

## Installation

```
yarn
```

## Build

```
yarn build
```

## Run test

```
yarn test
```

### Run only tests related to bridge

```
yarn test:bridge
```

### Run only tests dependent to AWS

```
yarn test:aws
```

### To run a single test

```
# Insatll Yarn
$ npm install --global yarn

# Run via yarn jest
$ yarn jest test/observers/burn-event-observer.spec.ts
```

## Run

```
yarn start
```

## Build (Docker)

It builds Docker image and push it automatically with GitHub Actions workflows. You can look up images in [Docker Hub](https://hub.docker.com/r/planetariumhq/9c-ethereum-bridge/tags) and the tag matches with the rule, `git-{GIT_SHA}` (e.g, `git-ccbc0e90c8a011736ba1f39dfd7980a9d415d94a`).

```
docker build .
```

[Ethereum]: https://ethereum.org/

## RPC routing

Set `KMS_PROVIDER_URL` to the NodeReal endpoint and `KMS_PROVIDER_SUB_URL`
to the Infura endpoint for the same chain. Use the URLs issued by each dashboard;
credentials belong in the deployment secret store. An empty secondary URL keeps
single-endpoint operation. Set `ETHEREUM_CHAIN_ID` explicitly for test networks
(default: 1). Each endpoint's chain ID is checked before use; a wrong chain
fails closed. The secondary is first checked when failover is needed.

Reads use the primary only while healthy. Timeouts, connection failures, quota
errors and server outages switch reads to the secondary. Requests time out after
10 seconds; after a primary failure the secondary is used for 30 seconds before
probing the primary again. Invalid requests, contract reverts and log range limits
are passed to the caller instead of retried on another endpoint. Transaction
broadcasts are sent once; an ambiguous timeout must be reconciled using the
transaction hash/history, not by creating another payment.

The Safe and legacy Web3 minters share this routing. The legacy minter uses the
existing AWS KMS ethers signer, so address lookup no longer starts a separate
RPC block tracker. Preserve the configured KMS key and persistent exchange-history
database when deploying. Existing pending/failed payments are not automatically
resubmitted.
