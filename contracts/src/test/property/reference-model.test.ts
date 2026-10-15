// SPDX-License-Identifier: Apache-2.0
// Reference-model property test (ARCHITECTURE §14.3). Model and runner: ./model.ts.
// PROPERTY_RUNS=100 npx vitest run src/test/property (default 25); see scripts/property-chunks.sh.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { op, run } from './model.js';

const RUNS = Number(process.env.PROPERTY_RUNS ?? 25);

describe('reference model', () => {
  it(`contract accepts exactly what the model accepts (${RUNS} runs)`, () => {
    const stats = { attestOk: 0, attestFail: 0 };
    fc.assert(
      fc.property(fc.array(op, { minLength: 12, maxLength: 40 }), (ops) => {
        run(ops, stats);
      }),
      // PROPERTY_SHRINK=0 reports the first counterexample immediately instead of shrinking it
      // (shrinking replays whole simulated contracts and can take hours). PROPERTY_TIME_LIMIT_MS
      // turns a run that takes too long into a reported failure with its seed, never a silent hang.
      {
        numRuns: RUNS,
        verbose: 2,
        endOnFailure: process.env.PROPERTY_SHRINK === '0',
        seed: process.env.PROPERTY_SEED ? Number(process.env.PROPERTY_SEED) : undefined,
        path: process.env.PROPERTY_PATH,
        interruptAfterTimeLimit: process.env.PROPERTY_TIME_LIMIT_MS ? Number(process.env.PROPERTY_TIME_LIMIT_MS) : undefined,
        markInterruptAsFailure: true,
      },
    );
    // Guard against a vacuous pass: both outcomes must actually have been exercised.
    expect(stats.attestOk).toBeGreaterThan(0);
    expect(stats.attestFail).toBeGreaterThan(0);
    console.log(`reference model: ${RUNS} runs, ${stats.attestOk} attestations accepted, ${stats.attestFail} rejected`);
  }, Math.max(600_000, RUNS * 5_000));
});
