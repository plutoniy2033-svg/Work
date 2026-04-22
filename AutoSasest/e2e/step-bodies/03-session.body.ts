import type { BrowserContext, Page } from '@playwright/test';
import { expect } from '@playwright/test';
import { gotoAppShell } from '../helpers/navigate';
import { CreatioSelectors } from '../helpers/selectors';

/** Сохранённая сессия: рабочий NUI без формы логина, в контексте есть cookies. */
export async function runStep03(page: Page, context: BrowserContext) {
  await gotoAppShell(page);
  await expect(page.locator(CreatioSelectors.loginInput)).toBeHidden({
    timeout: 90_000,
  });
  const cookies = await context.cookies();
  expect(cookies.length, 'ожидаются cookies после входа').toBeGreaterThan(0);
}
