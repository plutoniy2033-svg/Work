import type { Page } from '@playwright/test';
import { test as base, expect } from '@playwright/test';

/**
 * После тела теста даём странице и кодеку видео время зафиксировать последний кадр
 * (иначе webm иногда уходит с нулевой длительностью в плеере).
 */
export async function stabilizePageForVideo(page: Page) {
  try {
    await page.waitForLoadState('load', { timeout: 4000 });
  } catch {
    /* ignore */
  }
  await page.evaluate(async () => {
    await new Promise<void>((r) => {
      requestAnimationFrame(() => requestAnimationFrame(() => r()));
    });
  }).catch(() => {});
  await page.waitForTimeout(400);
}

export const test = base.extend({
  page: async ({ page }, use) => {
    await use(page);
    await stabilizePageForVideo(page);
  },
});

export { expect };
