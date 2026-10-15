#!/usr/bin/env bash
# Runs the reference-model property test as CHUNKS × RUNS runs, each with its own seed and log,
# so a failure shows up in its own chunk with a seed that replays it:
#   PROPERTY_SEED=<seed> PROPERTY_RUNS=<runs> npx vitest run src/test/property   (in contracts/)
# Usage: scripts/property-chunks.sh [chunks=10] [runs=100] [base-seed=random]
set -u
CHUNKS=${1:-10}; RUNS=${2:-100}; BASE=${3:-$((RANDOM * 32768 + RANDOM))}
ROOT=$(cd "$(dirname "$0")/.." && pwd); OUT="$ROOT/test-artifacts/property"; mkdir -p "$OUT"
SUMMARY="$OUT/summary.txt"; : > "$SUMMARY"
echo "base seed $BASE, $CHUNKS chunks x $RUNS runs, started $(date -u +%FT%TZ)" | tee -a "$SUMMARY"
fail=0
for i in $(seq 1 "$CHUNKS"); do
  seed=$((BASE + i)); log="$OUT/chunk-$i.log"
  (cd "$ROOT/contracts" && PROPERTY_RUNS=$RUNS PROPERTY_SEED=$seed PROPERTY_SHRINK=0 PROPERTY_TIME_LIMIT_MS=$((RUNS * 4000)) \
    /usr/bin/time -f "%es %MKB" npx vitest run src/test/property --reporter=verbose > "$log" 2>&1)
  code=$?
  stats=$(grep -oE "reference model: .*" "$log" | head -1)
  res=$(grep -oE "Tests +[0-9]+ (passed|failed)[^\n]*" "$log" | head -1)
  echo "chunk $i seed $seed exit $code | ${res:-no result} | ${stats:-} | $(tail -1 "$log")" | tee -a "$SUMMARY"
  [ $code -ne 0 ] && fail=1
done
echo "finished $(date -u +%FT%TZ): $([ $fail -eq 0 ] && echo ALL CHUNKS PASSED || echo FAILURES)" | tee -a "$SUMMARY"
exit $fail
