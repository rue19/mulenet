#!/usr/bin/env bash
# P3: capture the submission screenshots (1600 px) into docs/media/ from the docker compose stack.
# Fresh demo deployment on the local chain → judge mode once (Playwright) → screenshots spec.
# Prerequisites: local chain (infra/local) up, keygen done, images built.
set -u
ROOT=$(cd "$(dirname "$0")/.." && pwd); cd "$ROOT"
OUT="$ROOT/test-artifacts/screenshots"; mkdir -p "$OUT" docs/media
export MN_PROOF_SERVER=http://127.0.0.1:6301 MULENET_NETWORK=undeployed MULENET_EXTERNAL_STACK=1 MULENET_DEPLOYMENT=demo
COMPOSE="docker compose -f infra/docker-compose.services.yml -p mulenet-services"
SVCS="oracle-1 oracle-2 oracle-3 relay sponsor bank-a bank-b bank-c bank-d bank-e guardian-1 guardian-2 guardian-3 explorer console"
log() { echo "$(date -u +%T) $*" | tee -a "$OUT/summary.txt"; }

$COMPOSE down > /dev/null 2>&1
(cd packages/sdk && npx tsx scripts/bootstrap.ts undeployed --epoch 60 --ttl 1 --k 2 --skip bank-e > "$OUT/bootstrap.log" 2>&1); c=$?
log "bootstrap demo exit $c"; [ $c -ne 0 ] && exit 1
SPONSOR_KEEPER=manual MULENET_DEMO_HOOKS=1 $COMPOSE up -d --no-build $SVCS > "$OUT/compose.log" 2>&1
(cd tests/e2e && npx playwright test judge.spec.ts > "$OUT/judge.log" 2>&1); c=$?
log "judge exit $c"
[ $c -eq 0 ] && cp test-artifacts/e2e-results/judge-complete.png docs/media/judge-mode.png
if [ $c -eq 0 ]; then
  (cd tests/e2e && SCREENSHOTS=1 npx playwright test screenshots.spec.ts > "$OUT/screenshots.log" 2>&1); c=$?
  log "screenshots exit $c"
fi
$COMPOSE down > /dev/null 2>&1
exit $c
