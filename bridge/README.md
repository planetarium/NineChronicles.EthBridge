# Bridge

This application relays between `wNCG` on [Ethereum] and `NCG` on Nine Chronicles network.

## Installation

```
npm install
```

## Build

```
npm run build
```

## Test

```
npm test
```

## Run

```
npm run start
```

## Build (Docker)

It builds Docker image and push it automatically with GitHub Actions workflows. You can look up images in [Docker Hub](https://hub.docker.com/r/planetariumhq/9c-ethereum-bridge/tags) and the tag matches with the rule, `git-{GIT_SHA}` (e.g, `git-ccbc0e90c8a011736ba1f39dfd7980a9d415d94a`).

```
docker build .
```

[Ethereum]: https://ethereum.org/
