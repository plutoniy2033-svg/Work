import type { Page } from '@playwright/test';
import { expect } from '@playwright/test';
import {
  webadminAuthConfigured,
  webadminEntryUrl,
} from '../helpers/webadmin-env';

/**
 * WebAdmin (ExtJS) → кнопка «Открыть личный кабинет» → в ЛК: «Помощь» → «Поддержка».
 * Один tab или popup — обрабатываем оба варианта.
 */
export async function runStep03WebadminLk(page: Page) {
  if (!webadminAuthConfigured()) {
    throw new Error(
      'Задайте WEBADMIN_USER и WEBADMIN_PASSWORD в .env (см. .env.example)',
    );
  }
  const user = process.env.WEBADMIN_USER!.trim();
  const pass = process.env.WEBADMIN_PASSWORD!.trim();
  const entry = webadminEntryUrl();

  await page.goto(entry, {
    waitUntil: 'domcontentloaded',
    timeout: 120_000,
  });

  const userField = page.locator('#sswa-login-username');
  await expect(userField).toBeVisible({ timeout: 90_000 });
  await userField.fill(user, { timeout: 30_000 });

  const passField = page
    .locator('input[type="password"].x-form-field')
    .or(page.locator('input[name="password"][type="password"]'))
    .first();
  await expect(passField).toBeVisible({ timeout: 30_000 });
  await passField.fill(pass, { timeout: 30_000 });

  const loginBtn = page
    .getByRole('button', { name: /^Войти$/ })
    .or(page.locator('#ext-gen79'))
    .first();
  await loginBtn.click({ timeout: 30_000 });

  await expect(userField).toBeHidden({ timeout: 120_000 });

  const openCabinet = page.locator(
    'button.ics-logo[title="Открыть личный кабинет"]',
  );
  await expect(openCabinet).toBeVisible({ timeout: 120_000 });

  const popupPromise = page
    .waitForEvent('popup', { timeout: 3_000 })
    .catch(() => null as Page | null);
  await openCabinet.click();
  const maybePopup = await popupPromise;
  const cabinet = maybePopup ?? page;
  await cabinet.waitForLoadState('domcontentloaded', { timeout: 90_000 });

  const help = cabinet.locator('[data-test-id="help-button"]');
  await expect(help).toBeVisible({ timeout: 120_000 });
  await help.click({ timeout: 30_000 });

  const support = cabinet.locator('[data-test-id="support-link"]');
  await expect(support).toBeVisible({ timeout: 30_000 });
  await support.click({ timeout: 30_000 });

  await expect(cabinet).toHaveURL(/\/cabinet\/support/i, { timeout: 60_000 });
}
