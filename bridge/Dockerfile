FROM node:14.17 AS build-env

COPY . /build
WORKDIR /build
RUN yarn
RUN yarn tsc --project tsconfig.production.json

FROM node:14.17-alpine

COPY --from=build-env /build/dist /app
COPY --from=build-env /build/node_modules /app/node_modules
WORKDIR /app
ENTRYPOINT ["node", "index.js"]
