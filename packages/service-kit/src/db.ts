// SPDX-License-Identifier: Apache-2.0
// Per-service storage on built-in node:sqlite in WAL mode (decision X3): no native module to build.
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export const openDb = (path: string, schema: string): DatabaseSync => {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('pragma journal_mode = wal; pragma busy_timeout = 5000; pragma foreign_keys = on;');
  db.exec(schema);
  return db;
};

export type { DatabaseSync };
