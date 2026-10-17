// SPDX-License-Identifier: Apache-2.0
// P3: capture the submission screenshots at 1600 px wide into docs/media/.
// Run by scripts/screenshots.sh straight after judge.spec.ts, against the same running console
// (judge-mode.png is judge.spec.ts's completed view, copied by the script).
import { expect, test } from '@playwright/test';

const OUT = '../../docs/media';
test.skip(!process.env.SCREENSHOTS, 'set SCREENSHOTS=1 to capture submission screenshots');
test.use({ viewport: { width: 1600, height: 1000 } });

test('submission screenshots', async ({ page }) => {
  test.setTimeout(10 * 60_000);

  // Privacy X-ray: the account judge mode just flagged → 0 hits. The account lives in the console's memory,
  // so this must run against the same console process as judge.spec.ts.
  await page.goto('/judge');
  const code = page.locator('code').first();
  await expect(code).toHaveText(/^acct:v1:IN:ICIC0000104:\d{12}$/, { timeout: 30_000 });
  const account = (await code.innerText()).trim();
  await page.goto('/xray');
  await page.getByRole('textbox').fill(account);
  await page.getByRole('button', { name: 'Search everything public' }).click();
  await expect(page.getByText(/hits$/)).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText(/hits$/), 'the flagged account must not appear in any public data').toHaveText('0 hits');
  await page.screenshot({ path: `${OUT}/xray-zero-hits.png`, fullPage: true });

  await page.goto('/transparency');
  await page.screenshot({ path: `${OUT}/transparency.png`, fullPage: true });

  await page.goto('/state');
  await page.screenshot({ path: `${OUT}/on-chain-state.png`, fullPage: true });

  // Regulator: a fresh warrant proposal with one approval shows the execute button disabled (quorum).
  // Proposal ids carry a nonce, so a second warrant proposal on the judge run's attestation is allowed.
  const explorer = process.env.EXPLORER_URL ?? 'http://127.0.0.1:7600';
  const deployment = process.env.MULENET_DEPLOYMENT ?? 'demo';
  const [att] = (await (await page.request.get(`${explorer}/v1/${deployment}/attestations`)).json()) as { attKey: string }[];
  expect(att, 'run judge mode first: no attestation on this deployment').toBeTruthy();
  const proposed = await page.request.post('/api/gov/1/propose', { data: { kind: 4, payload: att.attKey }, timeout: 180_000 });
  expect(proposed.ok()).toBe(true);
  const { proposalId } = (await proposed.json()) as { proposalId: string };
  expect((await page.request.post('/api/gov/1/approve', { data: { id: proposalId }, timeout: 180_000 })).ok()).toBe(true);
  await page.goto('/regulator');
  await expect(page.getByText('1 / 2').first()).toBeVisible({ timeout: 60_000 });
  await page.screenshot({ path: `${OUT}/regulator.png`, fullPage: true });
});
