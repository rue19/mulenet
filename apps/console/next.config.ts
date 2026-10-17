// SPDX-License-Identifier: Apache-2.0
import { resolve } from 'node:path';
import type { NextConfig } from 'next';

// MuleNet packages read consortium config and secrets from the repo at runtime (server-side only),
// so they are loaded from node_modules rather than bundled.
const config: NextConfig = {
  serverExternalPackages: ['@mulenet/sdk', '@mulenet/crypto', '@mulenet/service-kit'],
  // Self-contained server for the container image (infra/Dockerfile, target `console`).
  output: 'standalone',
  outputFileTracingRoot: resolve(import.meta.dirname, '../..'),
  poweredByHeader: false,
};
export default config;
