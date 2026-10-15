// SPDX-License-Identifier: Apache-2.0
// Projects one decoded public ledger state into explorer rows (§7.1). Everything here is
// already public on-chain; the explorer adds no information, only indexes it.
import { toHex } from '@mulenet/crypto';
import type { MuleNet } from '@mulenet/contract';

type Ledger = MuleNet.Ledger;

export type Snapshot = {
  height: number;
  txHash: string;
  entryPoint: string;
  counters: { flagCount: number; revocationCount: number; attestationCount: number; currentEpoch: number; membershipGen: number };
  params: { corroborationK: number; epochTtl: number; guardianThreshold: number; nextEpochAt: number; epochLength: number };
  root: string;
  attestations: { attKey: string; epoch: number; k: number; typology: number; escalationCtHash: string }[];
  proposals: { id: string; kind: number; payload: string; approvals: number; executed: boolean; createdEpoch: number }[];
  warrants: { attKey: string; epoch: number }[];
};

export const project = (l: Ledger, height: number, txHash: string, entryPoint: string): Snapshot => ({
  height,
  txHash,
  entryPoint,
  counters: {
    flagCount: Number(l.flagCount),
    revocationCount: Number(l.revocationCount),
    attestationCount: Number(l.attestationCount),
    currentEpoch: Number(l.currentEpoch),
    membershipGen: Number(l.membershipGen),
  },
  params: {
    corroborationK: Number(l.corroborationK),
    epochTtl: Number(l.epochTtl),
    guardianThreshold: Number(l.guardianThreshold),
    nextEpochAt: Number(l.nextEpochAt),
    epochLength: Number(l.epochLength),
  },
  root: l.flags.root().field.toString(16),
  attestations: [...l.attestations].map(([k, a]) => ({
    attKey: toHex(k),
    epoch: Number(a.epoch),
    k: Number(a.k),
    typology: Number(a.typology),
    escalationCtHash: toHex(a.escalationCtHash),
  })),
  proposals: [...l.proposals].map(([id, p]) => ({
    id: toHex(id),
    kind: Number(p.kind),
    payload: toHex(p.payload),
    approvals: Number(p.approvals),
    executed: p.executed,
    createdEpoch: Number(p.createdEpoch),
  })),
  warrants: [...l.disclosures].map(([k, e]) => ({ attKey: toHex(k), epoch: Number(e) })),
});

export const PROPOSAL_KINDS: Record<number, string> = {
  1: 'RegisterInstitution',
  2: 'RotateMembership',
  3: 'SetCorroborationK',
  4: 'AuthorizeDisclosure',
  5: 'SetTtl',
};
