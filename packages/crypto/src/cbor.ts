// SPDX-License-Identifier: Apache-2.0
// Deterministic-enough CBOR for small fixed-shape bodies: plain maps, no cbor-x record extension.
import { Encoder } from 'cbor-x';

const enc = new Encoder({ useRecords: false, mapsAsObjects: true, tagUint8Array: false });

export const encodeCbor = (v: unknown): Uint8Array => new Uint8Array(enc.encode(v));
export const decodeCbor = <T>(b: Uint8Array): T => enc.decode(b) as T;
