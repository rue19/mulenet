// P3: capture the submission screenshots at 1600 px wide into docs/media/.
// Run on demand against a stack that has been through judge mode at least once:
//   SCREENSHOTS=1 MULENET_EXTERNAL_STACK=1 npx playwright test screenshots.spec.ts
import { expect, test } from '@playwright/test';

const OUT = '../../docs/media';
test.skip(!process.env.SCREENSHOTS, 'set SCREENSHOTS=1 to capture submission screenshots');
test.use({ viewport: { width: 1600, height: 1000 } });

test('submission screenshots', async ({ page }) => {
  test.setTimeout(10 * 60_000);

  // Privacy X-ray: an account identifier → 0 hits.
  await page.goto('/xray');
  await page.getByRole('button', { name: 'Search everything public' }).click();
  await expect(page.getByText(/hits$/)).toBeVisible({ timeout: 60_000 });
  await page.screenshot({ path: `${OUT}/xray-zero-hits.png`, fullPage: true });

  await page.goto('/transparency');
  await page.screenshot({ path: `${OUT}/transparency.png`, fullPage: true });

  await page.goto('/state');
  await page.screenshot({ path: `${OUT}/on-chain-state.png`, fullPage: true });

  // Regulator: a fresh warrant proposal with one approval shows the execute button disabled (quorum).
  await page.goto('/regulator');
  await page.screenshot({ path: `${OUT}/regulator.png`, fullPage: true });

  await page.goto('/judge');
  await page.screenshot({ path: `${OUT}/judge-mode.png`, fullPage: true });
});
