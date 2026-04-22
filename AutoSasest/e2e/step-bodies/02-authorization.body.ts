import type { BrowserContext, Page } from '@playwright/test';
import { expect } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import { CORP_AUTH_STORAGE } from '../helpers/auth-storage';
import { CreatioSelectors } from '../helpers/selectors';
import { clickCreatioLogin } from '../helpers/creatio-login';
import { gotoLoginEntry, waitForLoginFormReady } from '../helpers/navigate';

const user = process.env.CREATIO_USER;
const password = process.env.CREATIO_PASSWORD;

export async function runStep02(
  page: Page,
  context: BrowserContext,
  options?: { reuseLoginPage?: boolean },
) {
  if (!user || !password) {
    throw new Error(
      'Задайте CREATIO_USER и CREATIO_PASSWORD в .env (см. .env.example)',
    );
  }

  await fs.rm(CORP_AUTH_STORAGE, { force: true }).catch(() => {});

  if (options?.reuseLoginPage) {
    await waitForLoginFormReady(page);
  } else {
    await gotoLoginEntry(page);
    await waitForLoginFormReady(page);
  }

  const loginLoc = page.locator(CreatioSelectors.loginInput);
  const passLoc = page.locator(CreatioSelectors.passwordInput);
  await loginLoc.scrollIntoViewIfNeeded().catch(() => {});
  await passLoc.scrollIntoViewIfNeeded().catch(() => {});

  await loginLoc.fill(user, { timeout: 60_000 });
  await passLoc.fill(password, { timeout: 60_000 });
  await clickCreatioLogin(page);

  await expect(page.locator(CreatioSelectors.loginInput)).toBeHidden({
    timeout: 120_000,
  });

  await fs.mkdir(path.dirname(CORP_AUTH_STORAGE), { recursive: true });
  await context.storageState({ path: CORP_AUTH_STORAGE });
}
