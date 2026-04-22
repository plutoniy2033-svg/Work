import type { Page } from '@playwright/test';
import { expect } from '@playwright/test';
import { CreatioSelectors } from '../helpers/selectors';
import { gotoAppShell } from '../helpers/navigate';

export async function runStep04(page: Page) {
  await gotoAppShell(page);
  await expect(page.locator(CreatioSelectors.loginInput)).toBeHidden({
    timeout: 30_000,
  });
  await page.locator('body').click({ trial: true }).catch(() => {});
  await expect(page.locator('body')).toBeVisible();
}
