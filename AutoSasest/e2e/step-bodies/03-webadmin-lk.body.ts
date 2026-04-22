import type { Page } from '@playwright/test';
import { expect } from '@playwright/test';
import { injectMangoBoosterIntoPage } from '../helpers/mango-booster-playwright';
import {
  webadminAuthConfigured,
  webadminEntryUrl,
} from '../helpers/webadmin-env';

/**
 * WebAdmin (ExtJS) → кнопка «Открыть личный кабинет» → в ЛК: «Помощь» → «Поддержка».
 * MangoBooster: после load — addScriptTag({ content }) (полный исходник из Node; без file://).
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
  await page.waitForLoadState('load').catch(() => {});

  await injectMangoBoosterIntoPage(page);

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
  await cabinet.waitForLoadState('load').catch(() => {});

  const boosterAlready = await cabinet.evaluate(
    () =>
      (window as unknown as { __MANGO_BOOSTER_PW_LOADED__?: number })
        .__MANGO_BOOSTER_PW_LOADED__ === 1,
  );
  if (!boosterAlready) {
    await injectMangoBoosterIntoPage(cabinet);
  }

  const help = cabinet.locator('[data-test-id="help-button"]');
  await expect(help).toBeVisible({ timeout: 120_000 });
  await help.click({ timeout: 30_000 });

  const support = cabinet.locator('[data-test-id="support-link"]');
  await expect(support).toBeVisible({ timeout: 30_000 });
  await support.click({ timeout: 30_000 });

  const lkSupportUrl =
    /^https:\/\/lk\.mango-office\.ru\/cabinet\/support\/?(?:[?#].*)?$/i;
  await expect(cabinet).toHaveURL(lkSupportUrl, { timeout: 10_000 });
  await cabinet.waitForLoadState('load', { timeout: 10_000 });
  await cabinet.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});
}
