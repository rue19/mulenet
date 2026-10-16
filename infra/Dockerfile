# One image for every MuleNet service; the command picks the service (§4.7).
# Build from the repo root after `npm run compact` (the compiled contract and keys are copied in):
#   docker build -f infra/Dockerfile --target services -t mulenet/services .
# (Always pass --target: without it Docker builds the last stage, which is the console.)
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

FROM node:22-slim AS services
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app /app
COPY services services
USER node
# e.g. docker run mulenet/services services/oracle
ENTRYPOINT ["sh", "-c", "cd \"$0\" && exec npx tsx src/main.ts"]
CMD ["services/oracle"]

# ── console (Next.js standalone) ──
#   docker build -f infra/Dockerfile --target console -t mulenet/console .
FROM deps AS console-deps
COPY apps/console/package.json apps/console/
RUN npm install --no-audit --no-fund -w apps/console

FROM console-deps AS console-build
COPY tsconfig.base.json ./
COPY contracts contracts
COPY packages packages
COPY apps/console apps/console
RUN npm run build -w contracts -w packages/crypto -w packages/service-kit -w packages/sdk && npm run build -w apps/console

FROM node:22-slim AS console
WORKDIR /app
ENV NODE_ENV=production HOSTNAME=0.0.0.0 PORT=3000
COPY --from=console-build /app/apps/console/.next/standalone ./
COPY --from=console-build /app/apps/console/.next/static ./apps/console/.next/static
COPY versions.json ./
USER node
CMD ["node", "apps/console/server.js"]
