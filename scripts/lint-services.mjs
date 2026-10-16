// Hardening §4.2: services log through pino (with redaction), never console.*.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const bad = [];
const walk = (d) => {
  for (const n of readdirSync(d)) {
    const p = join(d, n);
    if (statSync(p).isDirectory()) {
      if (n !== 'test' && n !== 'node_modules') walk(p);
    } else if (p.endsWith('.ts')) {
      readFileSync(p, 'utf8').split('\n').forEach((l, i) => /\bconsole\.(log|info|warn|error|debug)\(/.test(l) && bad.push(`${p}:${i + 1}`));
    }
  }
};
for (const s of readdirSync('services')) walk(join('services', s, 'src'));
if (bad.length) {
  console.error(`console.* in service code (use pino):\n  ${bad.join('\n  ')}`);
  process.exit(1);
}
console.log('✓ no console.* in services');
