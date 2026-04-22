import type { Page } from '@playwright/test';
import { CreatioSelectors } from './selectors';

/**
 * Кнопка «Войти» в NUI — это span (ExtJS), не role=button.
 * Стабильнее всего data-item-marker / класс; при необходимости — CREATIO_LOGIN_BTN_SEL.
 */
export function creatioLoginButtonLocator(page: Page) {
  const custom = process.env.CREATIO_LOGIN_BTN_SEL?.trim();
  if (custom) {
    return page.locator(custom).first();
  }
  return page
    .locator('[data-item-marker="btnLogin"]')
    .or(page.locator('span.login-button-login'))
    .or(
      page.locator(
        'span.t-btn-wrapper.login-button-login, .login-button-login',
      ),
    )
    .or(page.getByText(CreatioSelectors.loginButtonName, { exact: true }))
    .or(
      page.getByRole('button', { name: CreatioSelectors.loginButtonName }),
    )
    .first();
}

export async function clickCreatioLogin(page: Page) {
  const btn = creatioLoginButtonLocator(page);
  await btn.scrollIntoViewIfNeeded().catch(() => {});
  await btn.waitFor({ state: 'visible', timeout: 60_000 });
  await btn.click({ timeout: 60_000 });
}
