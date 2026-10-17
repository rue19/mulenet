// SPDX-License-Identifier: Apache-2.0
import { expect, test } from '@playwright/test';

// 1600 px wide, so the completed view doubles as the submission screenshot (scripts/screenshots.sh).
test.use({ viewport: { width: 1600, height: 1000 } });

test('judge mode runs all 11 steps with the expected outcome each time', async ({ page }) => {
  await page.goto('/judge');
  await page.getByRole('button', { name: 'Reset with a fresh account' }).click();
  await expect(page.getByText(/^Demo account:/)).toBeVisible();

  const cards = page.locator('.card.stack');
  await expect(cards).toHaveCount(11);
  for (let i = 0; i < 11; i++) {
    const card = cards.nth(i);
    await card.getByRole('button', { name: /^Run/ }).click();
    const badge = card.locator('.badge');
    await expect(badge).toBeVisible({ timeout: 8 * 60_000 });
    await expect(badge, `step ${i + 1}: ${await card.locator('strong').innerText()}`).toHaveText(/as expected|refused as designed/);
  }
  await page.screenshot({ path: '../../test-artifacts/e2e-results/judge-complete.png', fullPage: true });
});
