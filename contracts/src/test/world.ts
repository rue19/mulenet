// SPDX-License-Identifier: Apache-2.0
// Simulator harness: a small in-memory MuleNet world with named banks and guardians.
// Each circuit call either succeeds and advances the context or throws and leaves it
// untouched, which mirrors on-chain atomicity.
import { randomBytes } from 'node:crypto';
import {
  type CircuitContext,
  createCircuitContext,
  createConstructorContext,
  sampleContractAddress,
} from '@midnight-ntwrk/compact-runtime';
import {
  Contract,
  type FlagSlot,
  type Ledger,
  ledger,
  pureCircuits as pc,
} from '../managed/mulenet/contract/index.js';
import { type MuleNetPrivateState, witnesses } from '../witnesses.js';

export const KIND = { Register: 1n, Rotate: 2n, SetK: 3n, Disclose: 4n, SetTtl: 5n } as const;
export const EPOCH_LEN = 86_400n;
export const T0 = 1_800_000_000;

type MerklePath = FlagSlot['path'];

export type WorldOptions = {
  threshold?: bigint;
  k?: bigint;
  ttl?: bigint;
  flagQuota?: bigint;
  revokeQuota?: bigint;
  witnessOverrides?: Partial<typeof witnesses>;
};

export type FlagRecord = {
  t: Uint8Array;
  epoch: bigint;
  typology: bigint;
  ctHash: Uint8Array;
  index: bigint;
  leaf: Uint8Array;
  pseudonym: Uint8Array;
};

export const bytes = (n = 32): Uint8Array => new Uint8Array(randomBytes(n));
export const subject = (label: string): Uint8Array => {
  const b = new Uint8Array(32);
  b.set(new TextEncoder().encode(label).slice(0, 32));
  return b;
};

export class World {
  readonly contract: Contract<MuleNetPrivateState>;
  ctx: CircuitContext<MuleNetPrivateState>;
  readonly guardianSecrets: Uint8Array[] = [bytes(), bytes(), bytes()];
  readonly banks = new Map<string, Uint8Array>();
  readonly flagsOf = new Map<string, FlagRecord[]>();
  private readonly quotaUsed = new Map<string, bigint>();
  private readonly revokeQuotaUsed = new Map<string, bigint>();
  private time = T0;

  constructor(opts: WorldOptions = {}) {
    this.contract = new Contract<MuleNetPrivateState>({ ...witnesses, ...opts.witnessOverrides });
    const [g0, g1, g2] = this.guardianSecrets.map((g) => pc.guardianLeaf(g));
    const { currentPrivateState, currentContractState, currentZswapLocalState } = this.contract.initialState(
      createConstructorContext<MuleNetPrivateState>({}, '00'.repeat(32)),
      g0,
      g1,
      g2,
      opts.threshold ?? 2n,
      opts.k ?? 3n,
      EPOCH_LEN,
      BigInt(T0) + EPOCH_LEN,
      opts.ttl ?? 30n,
      opts.flagQuota ?? 500n,
      opts.revokeQuota ?? 3n,
    );
    this.ctx = createCircuitContext(
      sampleContractAddress(),
      currentZswapLocalState,
      currentContractState,
      currentPrivateState,
      undefined,
      undefined,
      this.time,
    );
  }

  get state(): Ledger {
    return ledger(this.ctx.currentQueryContext.state);
  }

  // ── context plumbing ──

  setTime(seconds: number): this {
    this.time = seconds;
    this.ctx.currentQueryContext.block = {
      ...this.ctx.currentQueryContext.block,
      secondsSinceEpoch: BigInt(seconds),
    };
    return this;
  }

  as(ps: MuleNetPrivateState): this {
    this.ctx = { ...this.ctx, currentPrivateState: ps };
    return this;
  }

  asBank(name: string): this {
    return this.as({ institutionSecret: this.secretOf(name) });
  }

  asGuardian(i: number): this {
    return this.as({ guardianSecret: this.guardianSecrets[i] });
  }

  call<K extends keyof Contract<MuleNetPrivateState>['impureCircuits']>(
    name: K,
    ...args: Parameters<Contract<MuleNetPrivateState>['impureCircuits'][K]> extends [unknown, ...infer R] ? R : never
  ): this {
    const fn = this.contract.impureCircuits[name] as (...a: unknown[]) => { context: CircuitContext<MuleNetPrivateState> };
    this.ctx = fn(this.ctx, ...args).context;
    return this;
  }

  // ── paths ──

  guardianPath(i: number): MerklePath {
    return this.state.guardians.pathForLeaf(BigInt(i), pc.guardianLeaf(this.guardianSecrets[i]));
  }

  institutionPath(name: string): MerklePath {
    const leaf = pc.institutionLeaf(this.secretOf(name), this.state.membershipGen);
    const path = this.state.institutions.findPathForLeaf(leaf);
    if (!path) throw new Error(`${name} not registered at gen ${this.state.membershipGen}`);
    return path;
  }

  flagPath(index: bigint, leaf: Uint8Array): MerklePath {
    return this.state.flags.pathForLeaf(index, leaf);
  }

  // ── governance ──

  propose(guardian: number, kind: bigint, payload: Uint8Array): Uint8Array {
    const id = pc.proposalId(kind, payload, this.state.proposalNonce);
    this.asGuardian(guardian).call('propose', kind, payload, this.guardianPath(guardian));
    return id;
  }

  approve(guardian: number, id: Uint8Array): this {
    return this.asGuardian(guardian).call('approve', id, this.guardianPath(guardian));
  }

  execute(id: Uint8Array, value = 0n): this {
    return this.as({}).call('execute', id, value);
  }

  // Full 2-of-3 pass: propose by guardian 0, approvals by 0 and 1, execute.
  govern(kind: bigint, payload: Uint8Array, value = 0n): Uint8Array {
    const id = this.propose(0, kind, payload);
    this.approve(0, id).approve(1, id).execute(id, value);
    return id;
  }

  secretOf(name: string): Uint8Array {
    let sk = this.banks.get(name);
    if (!sk) {
      sk = bytes();
      this.banks.set(name, sk);
    }
    return sk;
  }

  register(...names: string[]): this {
    for (const name of names) {
      this.govern(KIND.Register, pc.institutionLeaf(this.secretOf(name), this.state.membershipGen));
    }
    return this;
  }

  // ── epochs ──

  advanceEpochs(n = 1): this {
    for (let i = 0; i < n; i++) {
      this.setTime(Number(this.state.nextEpochAt));
      this.as({}).call('advanceEpoch');
    }
    return this;
  }

  // ── flags ──

  nextQuotaSlot(name: string): bigint {
    const key = `${name}:${this.state.currentEpoch}`;
    const slot = this.quotaUsed.get(key) ?? 0n;
    this.quotaUsed.set(key, slot + 1n);
    return slot;
  }

  nextRevokeSlot(name: string): bigint {
    const key = `${name}:${this.state.currentEpoch}`;
    const slot = this.revokeQuotaUsed.get(key) ?? 0n;
    this.revokeQuotaUsed.set(key, slot + 1n);
    return slot;
  }

  flag(name: string, t: Uint8Array, typology = 1n, opts: { quotaSlot?: bigint } = {}): FlagRecord {
    const sk = this.secretOf(name);
    const ctHash = bytes();
    const epoch = this.state.currentEpoch;
    const index = this.state.flags.firstFree();
    const quotaSlot = opts.quotaSlot ?? this.nextQuotaSlot(name);
    this.asBank(name).call('submitFlag', t, typology, ctHash, quotaSlot, this.institutionPath(name));
    const pseudonym = pc.pseudonym(sk, t);
    const rec: FlagRecord = {
      t,
      epoch,
      typology,
      ctHash,
      index,
      leaf: pc.flagLeaf(t, pseudonym, epoch, typology, ctHash),
      pseudonym,
    };
    this.flagsOf.set(name, [...(this.flagsOf.get(name) ?? []), rec]);
    return rec;
  }

  lastFlag(name: string, t: Uint8Array): FlagRecord {
    const rec = (this.flagsOf.get(name) ?? []).filter((r) => eq(r.t, t)).at(-1);
    if (!rec) throw new Error(`${name} has no flag on this subject`);
    return rec;
  }

  revoke(name: string, t: Uint8Array, opts: { index?: bigint; path?: MerklePath } = {}): this {
    const r = this.lastFlag(name, t);
    return this.asBank(name).call(
      'revokeFlag',
      r.t,
      r.epoch,
      r.typology,
      r.ctHash,
      opts.index ?? r.index,
      this.nextRevokeSlot(name),
      opts.path ?? this.flagPath(r.index, r.leaf),
      this.institutionPath(name),
    );
  }

  slotOf(name: string, t: Uint8Array): FlagSlot {
    const r = this.lastFlag(name, t);
    return { pseudonym: r.pseudonym, epoch: r.epoch, ctHash: r.ctHash, path: this.flagPath(r.index, r.leaf) };
  }

  attest(name: string, t: Uint8Array, slots: FlagSlot[], typology = 1n, escalationCtHash = bytes()): Uint8Array {
    const circuit = slots.length === 3 ? 'attestCorroboration3' : 'attestCorroboration2';
    this.asBank(name).call(circuit, t, typology, slots, this.institutionPath(name), escalationCtHash);
    return pc.attestationKey(t, this.state.currentEpoch, typology);
  }
}

export const eq = (a: Uint8Array, b: Uint8Array): boolean =>
  a.length === b.length && a.every((v, i) => v === b[i]);
