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
