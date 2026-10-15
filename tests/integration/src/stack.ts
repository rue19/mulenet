// SPDX-License-Identifier: Apache-2.0
// Starts the MuleNet service stack as child processes against a running chain:
//   oracle ×3, relay, sponsor, bank nodes. Logs go to .data/<network>/logs/<service>.log.
// Prerequisites: infra/local stack up, keygen and bootstrap done.
//   npm run dev:up -w tests/integration            (Ctrl-C stops everything)
import { spawn, type ChildProcess } from 'node:child_process';
import { createWriteStream, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadPublicConfig, repoRoot } from '@mulenet/sdk/config';

export type Stack = { stop(): Promise<void>; urls: Record<string, string> };

const waitHealthy = async (name: string, url: string, timeoutMs: number) => {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    try {
      const r = await fetch(`${url}/v1/health`, { signal: AbortSignal.timeout(2_000) });
      if (r.ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`${name} did not become healthy at ${url}`);
};

export const startStack = async (network = 'undeployed', banks?: string[]): Promise<Stack> => {
  const root = repoRoot();
  const cfg = loadPublicConfig(network);
  const logDir = resolve(root, `.data/${network}/logs`);
  mkdirSync(logDir, { recursive: true });
  const children: { name: string; proc: ChildProcess }[] = [];
  const urls: Record<string, string> = {};

  const run = (name: string, cwd: string, env: Record<string, string>, url: string) => {
    const log = createWriteStream(resolve(logDir, `${name}.log`), { flags: 'a' });
    const proc = spawn('npx', ['tsx', 'src/main.ts'], {
      cwd: resolve(root, cwd),
      env: { ...process.env, MULENET_NETWORK: network, MN_PROOF_SERVER: process.env.MN_PROOF_SERVER ?? 'http://127.0.0.1:6301', ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    proc.stdout!.pipe(log);
    proc.stderr!.pipe(log);
    children.push({ name, proc });
    urls[name] = url;
  };

  for (const o of cfg.oracles.members) run(`oracle-${o.index}`, 'services/oracle', { ORACLE_INDEX: String(o.index) }, o.url);
  run('relay', 'services/relay', {}, cfg.relay.url);
  run('sponsor', 'services/sponsor', {}, cfg.sponsor.url);
  // Light services first; the sponsor and banks sync wallets and take longer.
  await Promise.all(Object.entries(urls).filter(([n]) => n !== 'sponsor').map(([n, u]) => waitHealthy(n, u, 60_000)));
  await waitHealthy('sponsor', cfg.sponsor.url, 300_000);
  for (const b of cfg.institutions.filter((i) => !banks || banks.includes(i.id))) run(b.id, 'services/bank-node', { BANK_ID: b.id }, b.url);
  await Promise.all(cfg.institutions.filter((i) => !banks || banks.includes(i.id)).map((b) => waitHealthy(b.id, b.url, 300_000)));

  return {
    urls,
    async stop() {
      for (const c of children) c.proc.kill('SIGTERM');
      await new Promise((r) => setTimeout(r, 1_000));
    },
  };
};

if (import.meta.url === `file://${process.argv[1]}`) {
  const stack = await startStack(process.env.MULENET_NETWORK ?? 'undeployed');
  console.log('MuleNet stack up:');
  for (const [n, u] of Object.entries(stack.urls)) console.log(`  ${n.padEnd(10)} ${u}`);
  process.on('SIGINT', () => void stack.stop().then(() => process.exit(0)));
}
