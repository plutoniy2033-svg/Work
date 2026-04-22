import fs from 'node:fs';
import path from 'node:path';
import type { BrowserContext, Page } from '@playwright/test';
import { test, stabilizePageForVideo } from '../fixtures/stepScope';
import { CORP_AUTH_STORAGE } from '../helpers/auth-storage';
import { runStep02 } from '../step-bodies/02-authorization.body';
import { explainWebadminSkipReason } from '../helpers/webadmin-env';
import { runStep03WebadminLk } from '../step-bodies/03-webadmin-lk.body';

const baseURL =
  process.env.CREATIO_BASE_URL?.replace(/\/$/, '') ||
  'https://creatio.corp.mango.ru';

/** Пустой storage, чтобы при необходимости подставлялся валидный путь. */
try {
  if (!fs.existsSync(CORP_AUTH_STORAGE)) {
    fs.mkdirSync(path.dirname(CORP_AUTH_STORAGE), { recursive: true });
    fs.writeFileSync(
      CORP_AUTH_STORAGE,
      JSON.stringify({ cookies: [], origins: [] }),
      'utf8',
    );
  }
} catch {
  /* ignore */
}

let sharedCtx!: BrowserContext;
let sharedPage!: Page;

test.describe.serial('Creatio CRM (одно окно)', () => {
  test.beforeAll(async ({ browser }) => {
    sharedCtx = await browser.newContext({
      baseURL,
      viewport: { width: 1280, height: 720 },
      ignoreHTTPSErrors: true,
      recordVideo: {
        dir: 'test-results',
        size: { width: 1280, height: 720 },
      },
    });
    sharedPage = await sharedCtx.newPage();
  });

  test.afterAll(async () => {
    await sharedCtx?.close().catch(() => {});
  });

  test('[02-authorization] ввод логина и пароля, «Войти»', async () => {
    test.skip(
      !process.env.CREATIO_USER || !process.env.CREATIO_PASSWORD,
      'CREATIO_USER и CREATIO_PASSWORD в .env',
    );
    await runStep02(sharedPage, sharedCtx, { reuseLoginPage: false });
    await stabilizePageForVideo(sharedPage);
  });

  test('[03-webadmin-lk] WebAdmin → ЛК → Помощь → Поддержка', async () => {
    const waSkip = explainWebadminSkipReason();
    test.skip(waSkip !== null, waSkip ?? 'WebAdmin: нет описания пропуска');
    await runStep03WebadminLk(sharedPage);
    await stabilizePageForVideo(sharedPage);
  });
});
