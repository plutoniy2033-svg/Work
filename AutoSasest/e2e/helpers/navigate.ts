import type { Page } from '@playwright/test';
import { creatioLoginButtonLocator } from './creatio-login';
import { creatioLoginEntryPath, creatioAppPath } from './entry';
import { CreatioSelectors } from './selectors';

const networkIdleMs = Number(process.env.CREATIO_NETWORK_IDLE_MS || 15_000);
const loginSettleMs = Number(process.env.CREATIO_LOGIN_SETTLE_MS || 1_000);

/** Старт сценариев с формы логина NUI (как в браузере у пользователя). */
export async function gotoLoginEntry(page: Page) {
  const target = creatioLoginEntryPath();
  const res = await page.goto(target, {
    waitUntil: 'domcontentloaded',
    timeout: 90_000,
  });
  await page.waitForLoadState('load', { timeout: 60_000 }).catch(() => {});
  const login = page.locator(CreatioSelectors.loginInput);
  const pass = page.locator(CreatioSelectors.passwordInput);
  await login.or(pass).first().waitFor({ state: 'visible', timeout: 90_000 });
  await page.waitForLoadState('networkidle', { timeout: networkIdleMs }).catch(() => {});
  await page.evaluate(async () => {
    await new Promise<void>((r) => {
      requestAnimationFrame(() => requestAnimationFrame(() => r()));
    });
  });
  await page.waitForTimeout(loginSettleMs);
  await page.mouse.move(640, 360).catch(() => {});
  return res;
}

/** Дождаться, пока поля логина реально готовы к вводу (ExtJS часто visible раньше, чем editable). */
export async function waitForLoginFormReady(page: Page) {
  const login = page.locator(CreatioSelectors.loginInput);
  const pass = page.locator(CreatioSelectors.passwordInput);
  const fieldTimeout = Number(process.env.CREATIO_LOGIN_FIELD_TIMEOUT_MS || 90_000);
  await login.waitFor({ state: 'visible', timeout: fieldTimeout });
  await pass.waitFor({ state: 'visible', timeout: fieldTimeout });
  await creatioLoginButtonLocator(page).waitFor({
    state: 'visible',
    timeout: fieldTimeout,
  });
  const stableMs = Number(process.env.CREATIO_LOGIN_STABLE_MS || 400);
  await page.waitForTimeout(stableMs);
}

/** Шаги уже после сохранения storageState — открываем рабочий NUI. */
export async function gotoAppShell(page: Page) {
  const target = creatioAppPath();
  const res = await page.goto(target, {
    waitUntil: 'domcontentloaded',
    timeout: 90_000,
  });
  await page.waitForLoadState('load', { timeout: 60_000 }).catch(() => {});
  await page.waitForLoadState('networkidle', { timeout: networkIdleMs }).catch(() => {});
  return res;
}
