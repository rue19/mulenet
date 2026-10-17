// SPDX-License-Identifier: Apache-2.0
// Fixed counterexamples found by the reference-model property test (seed policy, docs/TESTING.md).
// Each JSON file under regressions/ is an op sequence that once diverged; all must now pass.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'vitest';
import { run, type Op } from './model.js';

const dir = resolve(import.meta.dirname, 'regressions');
const revive = (_: string, v: unknown) => (typeof v === 'string' && /^\d+n$/.test(v) ? BigInt(v.slice(0, -1)) : v);
const files = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.json')) : [];

describe('property-test regressions', () => {
  it.each(files.length ? files : ['(none yet)'])('%s', (f) => {
    if (f === '(none yet)') return;
    const { ops } = JSON.parse(readFileSync(resolve(dir, f), 'utf8'), revive) as { ops: Op[] };
    run(ops);
  });
});
