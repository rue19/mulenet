import { execFileSync, spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { repoRoot } from '@mulenet/sdk/config';
import { startStack } from '../integration/src/stack.js';

const env = { ...process.env, MULENET_NETWORK: 'undeployed', MULENET_DEPLOYMENT: 'demo', MN_PROOF_SERVER: process.env.MN_PROOF_SERVER ?? 'http://127.0.0.1:6301' };

export default async function globalSetup() {
  Object.assign(process.env, env);
  const root = repoRoot();
  // Fresh demo deployment: 60 s epochs, TTL 1, k = 2, bank-e left unregistered.
  execFileSync('npx', ['tsx', 'scripts/bootstrap.ts', 'undeployed', '--epoch', '60', '--ttl', '1', '--k', '2', '--skip', 'bank-e'], {
    cwd: resolve(root, 'packages/sdk'),
    env,
    stdio: 'inherit',
  });
  const stack = await startStack('undeployed', { guardians: true, explorer: true, keeper: 'manual', demoHooks: true });

  const consoleProc = spawn('npx', ['next', 'start', '-p', '3000'], { cwd: resolve(root, 'apps/console'), env, detached: true, stdio: 'ignore' });
  for (let i = 0; i < 120; i++) {
    const up = await fetch('http://127.0.0.1:3000/xray').then((r) => r.ok, () => false);
    if (up) break;
    await new Promise((r) => setTimeout(r, 1_000));
  }

  return async () => {
    try {
      process.kill(-consoleProc.pid!, 'SIGTERM');
    } catch {
      // gone
    }
    await stack.stop();
  };
}
