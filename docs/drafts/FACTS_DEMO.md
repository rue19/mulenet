# Fact sheet: DEMO.md (Raaj writes the guide)

## Judge mode, 11 steps
- Source: `apps/console/lib/judge.ts`.
- Screenshot of a full green run: `test-artifacts/e2e-results/judge-complete.png` (15 Oct; Playwright, 12.4 min).

## Durations from that run (local network)
- Step 1: 88.6 s (3 flags)
- Steps 2–5: about 1.1 s each (refused before proof)
- Step 6: 34.7 s
- Step 7: 0.2 s
- Step 8: 30.9 s
- Step 9: 94.4 s
- Step 10: 0.6 s
- Step 11: 52.5 s

## Expected outcomes per step
- Source: the `expected` field of each step in `apps/console/lib/judge.ts`.

## How to run
- **Locally:** README "Run it locally"; `MULENET_DEMO_HOOKS=1 npm run dev:up`; `/judge`.
- **Containers:** `infra/docker-compose.services.yml`, with `MULENET_DEPLOYMENT=demo SPONSOR_KEEPER=manual MULENET_DEMO_HOOKS=1`.
- **Demo deployment parameters:** 60 s epochs, TTL 1, k = 2, bank-e unregistered (`tests/e2e/global-setup.ts`).

## What the refusal badges mean
- **"refused as designed":** a contract assert fails while the call is built; nothing is proven or submitted. Source: `services/bank-node/src/flows.ts`; `packages/sdk/src/sponsored-chain.ts` (comment on `sponsoredCall`).
