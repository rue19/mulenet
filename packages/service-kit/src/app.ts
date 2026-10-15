// SPDX-License-Identifier: Apache-2.0
// Fastify app factory shared by every MuleNet service (decision X1).
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import { AuthError, type Verifier } from './auth.js';

// Never log these, wherever they appear (decision X1).
export const REDACT = [
  'req.headers["x-mulenet-sig"]',
  'req.headers["x-mulenet-nonce"]',
  'req.headers.authorization',
  '*.seed',
  '*.secret',
  '*.secretKey',
  '*.identifier',
  '*.T',
  '*.tag',
  '*.project_id',
  '*.password',
];

declare module 'fastify' {
  interface FastifyRequest {
    rawBody?: Buffer;
    caller?: string;
  }
}

export type AppOptions = { name: string; logLevel?: string; logger?: boolean };

export const createApp = ({ name, logLevel = process.env.LOG_LEVEL ?? 'info', logger = true }: AppOptions): FastifyInstance => {
  const app = Fastify({
    logger: logger
      ? {
          level: logLevel,
          name,
          redact: { paths: REDACT, censor: '[redacted]' },
          // Strip query strings: a Blockfrost project_id must never reach a log line.
          serializers: { req: (req: FastifyRequest) => ({ method: req.method, url: req.url.replace(/\?.*$/, '') }) },
        }
      : false,
    bodyLimit: 256 * 1024,
  });

  // Keep the raw bytes: request signatures cover the exact body.
  app.addContentTypeParser('application/json', { parseAs: 'buffer' }, (req, body: Buffer, done) => {
    req.rawBody = body;
    if (body.length === 0) return done(null, {});
    try {
      done(null, JSON.parse(body.toString('utf8')));
    } catch {
      const err = new Error('invalid JSON') as Error & { statusCode: number };
      err.statusCode = 400;
      done(err, undefined);
    }
  });

  app.get('/v1/health', async () => ({ service: name, ok: true }));
  return app;
};

// preHandler that rejects unsigned or badly signed requests with 401.
export const requireSignature = (verify: Verifier) => async (req: FastifyRequest) => {
  try {
    req.caller = verify(req.headers, req.method, req.url, new Uint8Array(req.rawBody ?? Buffer.alloc(0)));
  } catch (e) {
    const err = new Error(e instanceof AuthError ? e.message : 'unauthorised') as Error & { statusCode: number };
    err.statusCode = 401;
    throw err;
  }
};
