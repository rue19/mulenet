// SPDX-License-Identifier: Apache-2.0
// Identifier normalisation, spec `mulenet-id/v1` (§5.1). Every institution must produce
// byte-identical input for the same account; a mismatch is a silent false negative, so
// anything that does not match the strict forms below is rejected rather than guessed at.

export type Identifier =
  | { kind: 'IN'; ifsc: string; account: string }
  | { kind: 'VPA'; vpa: string }
  | { kind: 'GB'; sortCode: string; account: string };

export class IdentifierError extends Error {}

const IFSC = /^[A-Z]{4}0[A-Z0-9]{6}$/;
const IN_ACCOUNT = /^[0-9]{9,18}$/;
// NPCI handles: alphanumerics plus . _ - ; PSP suffix: letters then alphanumerics.
const VPA = /^[a-z0-9][a-z0-9._-]{1,255}@[a-z][a-z0-9]{1,63}$/;
const GB_SORT = /^[0-9]{6}$/;
const GB_ACCOUNT = /^[0-9]{8}$/;

const CANONICAL = [
  /^acct:v1:IN:[A-Z]{4}0[A-Z0-9]{6}:[0-9]{9,18}$/,
  /^vpa:v1:[a-z0-9][a-z0-9._-]{1,255}@[a-z][a-z0-9]{1,63}$/,
  /^acct:v1:GB:[0-9]{6}:[0-9]{8}$/,
];

const stripSpaces = (s: string) => s.replace(/\s+/g, '');

const check = (re: RegExp, value: string, what: string): string => {
  if (!re.test(value)) throw new IdentifierError(`invalid ${what}`);
  return value;
};

export const normalise = (id: Identifier): string => {
  switch (id.kind) {
    case 'IN': {
      const ifsc = check(IFSC, stripSpaces(id.ifsc).toUpperCase(), 'IFSC');
      const account = check(IN_ACCOUNT, stripSpaces(id.account), 'Indian account number');
      return `acct:v1:IN:${ifsc}:${account}`;
    }
    case 'VPA':
      return `vpa:v1:${check(VPA, id.vpa.trim().toLowerCase(), 'UPI VPA')}`;
    case 'GB': {
      const sortCode = check(GB_SORT, id.sortCode.replace(/[\s-]/g, ''), 'sort code');
      const account = check(GB_ACCOUNT, stripSpaces(id.account), 'UK account number');
      return `acct:v1:GB:${sortCode}:${account}`;
    }
    default:
      throw new IdentifierError('unknown identifier kind');
  }
};

export const isCanonical = (s: string): boolean => CANONICAL.some((re) => re.test(s));

// The OPRF input. Only canonical strings are ever hashed.
export const oprfInput = (canonical: string): Uint8Array => {
  if (!isCanonical(canonical)) throw new IdentifierError('not a canonical mulenet-id/v1 string');
  return new TextEncoder().encode(canonical);
};
