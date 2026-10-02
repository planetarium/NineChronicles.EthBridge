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


### Ethereum scan ranges and checkpoints

The burn monitor uses a dedicated RPC provider instance so its pinned reads do
not alter concurrent Safe/legacy minting or receipt checks. The same primary and
secondary URLs are used; no additional environment variables are required.
A range holds one endpoint through the tip, header and log checks. An RPC failure
releases the range and retries from the last consumer-acknowledged position on
the selected endpoint. Confirmation checks use that endpoint's actual tip, even
when the fallback is behind the primary.

With only one newly confirmed block, scanning retains the single-block path
(two header reads and one log query). Gaps of two or more use at most 2,000
confirmed blocks per range. This is a maximum, not a minimum waiting period.
Explicit log-range limits shrink the remembered chunk size; quota/transport
errors instead follow normal retry/failover. The existing 10-block confirmation
setting and idle polling interval are unchanged. Nine Chronicles GraphQL batches
retain their per-item acknowledgement cursor.

Only blocks containing burns and the verified end of an empty suffix are
persisted. The range's final header is checked before delivering each event block
or empty checkpoint. A failed read cannot advance across an uncommitted empty
gap. Restart validates confirmation depth and the saved canonical header; a null
transaction cursor replays that block through the persistent exchange history.
A missing non-null cursor fails closed. An orphan checkpoint is rewound only
when archived parent headers prove a common ancestor (maximum depth: 1,000).

Offline transport-level tests measure 74 RPC calls for 10,000 empty backlog
blocks: 15 block headers, 5 log queries, 5 tip reads and 49 chain-ID checks.
Startup recovery is excluded. An event-bearing block requires additional header
checks; these backlog numbers are not a steady-state billing reduction estimate.
Tests also exercise real SQLite reopening, ambiguous payout replies, partial
same-block processing, RPC failover and re-included source transactions.

Keep one active bridge instance and retain its exchange-history database across
upgrades. These tests do not make an external payout and a SQLite commit atomic,
or reverse payouts after deep reorganizations. During live scanning, a deep
reorganization can also replace already acknowledged blocks; the live cursor
does not automatically rewind that prefix, so reconciliation may be needed. A missing archive/checkpoint
must be investigated instead of deleting the history and restarting from scratch.
