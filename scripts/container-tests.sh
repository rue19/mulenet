#!/usr/bin/env bash
# P0-4 / P0-5: integration and judge-mode tests against the docker compose stack (not host processes).
# Prerequisites: local chain (infra/local) up, keygen done, main deployment bootstrapped, images built.
# Usage: scripts/container-tests.sh [e2e-rounds=2]
set -u
ROOT=$(cd "$(dirname "$0")/.." && pwd); cd "$ROOT"
OUT="$ROOT/test-artifacts/containers"; mkdir -p "$OUT"; S="$OUT/summary.txt"; : > "$S"
export MN_PROOF_SERVER=http://127.0.0.1:6301 MULENET_NETWORK=undeployed MULENET_EXTERNAL_STACK=1
COMPOSE="docker compose -f infra/docker-compose.services.yml -p mulenet-services"
SVCS="oracle-1 oracle-2 oracle-3 relay sponsor bank-a bank-b bank-c bank-d bank-e guardian-1 guardian-2 guardian-3 explorer console"
log() { echo "$(date -u +%T) $*" | tee -a "$S"; }
up() { $COMPOSE up -d --no-build $SVCS > "$OUT/compose-$1.log" 2>&1; }
down() { $COMPOSE down > /dev/null 2>&1; }
fail=0

log "P0-4: phase 4 flag-check against containers (deployment main, keeper off)"
down; MULENET_DEPLOYMENT=main SPONSOR_KEEPER=0 MULENET_DEMO_HOOKS=0 up main
(cd tests/integration && MULENET_DEPLOYMENT=main npx vitest run src/flag-check.test.ts > "$OUT/flag-check.log" 2>&1); c=$?
log "flag-check exit $c: $(grep -oE 'Tests +[0-9]+ (passed|failed)[^|]*' "$OUT/flag-check.log" | head -1)"; [ $c -ne 0 ] && fail=1
down

for round in $(seq 1 "${1:-2}"); do
  log "P0-5 round $round: fresh demo deployment"
  (cd packages/sdk && MULENET_DEPLOYMENT=demo npx tsx scripts/bootstrap.ts undeployed --epoch 60 --ttl 1 --k 2 --skip bank-e > "$OUT/bootstrap-demo-$round.log" 2>&1); c=$?
  log "bootstrap exit $c"; [ $c -ne 0 ] && { fail=1; continue; }
  MULENET_DEPLOYMENT=demo SPONSOR_KEEPER=manual MULENET_DEMO_HOOKS=1 up demo-$round
  if [ "$round" = 1 ]; then
    (cd tests/integration && npx vitest run src/demo.test.ts > "$OUT/demo-$round.log" 2>&1); c=$?
    log "phase 5 demo test exit $c: $(grep -oE 'Tests +[0-9]+ (passed|failed)[^|]*' "$OUT/demo-$round.log" | head -1)"; [ $c -ne 0 ] && fail=1
  fi
  (cd tests/e2e && npx playwright test > "$OUT/e2e-$round.log" 2>&1); c=$?
  log "playwright judge exit $c: $(grep -E '^\s+[0-9]+ (passed|failed)' "$OUT/e2e-$round.log" | head -2 | tr '\n' ' ')"; [ $c -ne 0 ] && fail=1
  down
done
log "finished: $([ $fail -eq 0 ] && echo ALL GREEN || echo FAILURES)"
exit $fail
