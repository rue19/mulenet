# One image for every MuleNet service; the command picks the service (§4.7).
# Build from the repo root after `npm run compact` (the compiled contract and keys are copied in):
#   docker build -f infra/Dockerfile -t mulenet/services .
FROM node:22-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY contracts/package.json contracts/
COPY packages/crypto/package.json packages/crypto/
COPY packages/sdk/package.json packages/sdk/
COPY packages/service-kit/package.json packages/service-kit/
COPY services/oracle/package.json services/oracle/
COPY services/relay/package.json services/relay/
COPY services/sponsor/package.json services/sponsor/
COPY services/bank-node/package.json services/bank-node/
COPY tests/integration/package.json tests/integration/
RUN npm ci --no-audit --no-fund

FROM deps AS build
COPY tsconfig.base.json ./
COPY contracts contracts
COPY packages packages
RUN npm run build -w contracts -w packages/crypto -w packages/service-kit -w packages/sdk

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app /app
COPY services services
USER node
# e.g. docker run mulenet/services services/oracle
ENTRYPOINT ["sh", "-c", "cd \"$0\" && exec npx tsx src/main.ts"]
CMD ["services/oracle"]
