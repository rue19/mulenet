import type { NextConfig } from 'next';

// MuleNet packages read consortium config and secrets from the repo at runtime (server-side only),
// so they are loaded from node_modules rather than bundled.
const config: NextConfig = {
  serverExternalPackages: ['@mulenet/sdk', '@mulenet/crypto', '@mulenet/service-kit'],
  poweredByHeader: false,
};
export default config;
