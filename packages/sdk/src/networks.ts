// SPDX-License-Identifier: Apache-2.0
// Network endpoints (§12.2). Built at call time, never at import, so env is read late
// and the Blockfrost token never ends up in a module-level constant.

export type NetworkName = 'undeployed' | 'preprod';

export type NetworkConfig = {
  networkId: NetworkName;
  node: string;
  indexer: string;
  indexerWS: string;
  proofServer: string;
};

const must = (v: string | undefined, name: string): string => {
  if (!v) throw new Error(`${name} is not set`);
  return v;
};

// Each bank node and guardian runs its own local proof server (§4.2); never point this remotely.
const proofServer = () => process.env.MN_PROOF_SERVER ?? 'http://127.0.0.1:6300';

export const networks: Record<NetworkName, () => NetworkConfig> = {
  undeployed: () => ({
    networkId: 'undeployed',
    node: 'http://127.0.0.1:9944',
    indexer: 'http://127.0.0.1:8088/api/v4/graphql',
    indexerWS: 'ws://127.0.0.1:8088/api/v4/graphql/ws',
    proofServer: proofServer(),
  }),
  preprod: () => {
    const id = must(process.env.BLOCKFROST_PROJECT_ID, 'BLOCKFROST_PROJECT_ID');
    installTokenRedaction(id);
    const q = (u: string) => `${u}?project_id=${encodeURIComponent(id)}`;
    return {
      networkId: 'preprod',
      node: q('https://rpc.midnight-preprod.blockfrost.io'),
      indexer: q('https://midnight-preprod.blockfrost.io/api/v0'),
      indexerWS: q('wss://midnight-preprod.blockfrost.io/api/v0/ws'),
      proofServer: proofServer(),
    };
  },
};

// Strips query strings (the Blockfrost token) before a URL goes anywhere near a log.
export const redact = (url: string): string => url.replace(/\?.*$/, '?…');

// Third-party libraries (e.g. the Polkadot RPC client inside the wallet SDK) print connection URLs,
// query string included, to stdout/stderr. Once a Blockfrost token is in use, mask it in everything
// this process writes, so it can never reach a log file or container log (instruction set rule 4).
let redacting = false;
export const installTokenRedaction = (token: string): void => {
  if (redacting || !token) return;
  redacting = true;
  const mask = (chunk: unknown): unknown =>
    typeof chunk === 'string'
      ? chunk.split(token).join('REDACTED').replace(/project_id=[^&"\s]+/g, 'project_id=REDACTED')
      : Buffer.isBuffer(chunk)
        ? Buffer.from(mask(chunk.toString('utf8')) as string)
        : chunk;
  for (const stream of [process.stdout, process.stderr]) {
    const write = stream.write.bind(stream) as (...a: unknown[]) => boolean;
    stream.write = ((chunk: unknown, ...rest: unknown[]) => write(mask(chunk), ...rest)) as typeof stream.write;
  }
};
