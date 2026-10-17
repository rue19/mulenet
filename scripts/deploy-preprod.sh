#!/usr/bin/env bash
# Deploys MuleNet to Preprod (plan P1 steps 3-4). Usage: scripts/deploy-preprod.sh main|demo
# Requires: .env with BLOCKFROST_PROJECT_ID, infra/.env.sponsors.preprod with DUST on sponsor 0,
# infra/config/preprod.json + infra/secrets/preprod (keygen), and the contract-v1 tag (rule 7).
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd); cd "$ROOT"
NAME=${1:?main or demo}
git rev-parse -q --verify refs/tags/contract-v1 >/dev/null || { echo "tag contract-v1 first (contract freeze, rule 7)"; exit 1; }
git diff --quiet contract-v1 -- contracts/src/mulenet.compact || { echo "contract differs from contract-v1: stop and ask Raaj"; exit 1; }

# Proof server 8.1.3 (Preprod's matrix version) on :6302, local only.
if ! curl -sf -o /dev/null http://127.0.0.1:6302/version; then
  docker run -d --rm --name mulenet-proof-813 -p 127.0.0.1:6302:6300 midnightntwrk/proof-server:8.1.3 midnight-proof-server -v >/dev/null
  until curl -sf -o /dev/null http://127.0.0.1:6302/version; do sleep 2; done
fi

set -a; . ./.env; set +a
export MULENET_NETWORK=preprod MN_PROOF_SERVER=http://127.0.0.1:6302
DEPLOYER_SEED=$(grep '^SPONSOR_SEED_0=' infra/.env.sponsors.preprod | cut -d= -f2); export DEPLOYER_SEED
cd packages/sdk
case "$NAME" in
  main) npx tsx scripts/bootstrap.ts preprod --epoch 86400 --ttl 30 --k 3 ;;
  demo) MULENET_DEPLOYMENT=demo npx tsx scripts/bootstrap.ts preprod --epoch 300 --ttl 2 --k 2 --skip bank-e ;;
  *) echo "main or demo"; exit 1 ;;
esac
