FROM node:12.22 AS build-env

COPY . /build
WORKDIR /build
RUN npm install -D
RUN npx tsc

FROM node:12-alpine

COPY --from=build-env /build/dist /app
COPY --from=build-env /build/node_modules /app/node_modules
WORKDIR /app
ENTRYPOINT ["node", "index.js"]
