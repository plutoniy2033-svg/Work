import fs from 'node:fs';
import path from 'node:path';
import type { BrowserContext, Page } from '@playwright/test';
import { test, stabilizePageForVideo } from '../fixtures/stepScope';
import { CORP_AUTH_STORAGE } from '../helpers/auth-storage';
import { explainMailOutboundSkipReason } from '../helpers/send-test-email';
import { runStep05 } from '../step-bodies/05-email-to-case.body';

const baseURL =
  process.env.CREATIO_BASE_URL?.replace(/\/$/, '') ||
  'https://creatio.corp.mango.ru';

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

test.describe.serial('Creatio — только письмо (05)', () => {
  test.beforeAll(async ({ browser }) => {
    sharedCtx = await browser.newContext({
      baseURL,
      storageState: CORP_AUTH_STORAGE,
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

  test('[05-email-to-case] письмо на help → заявка в списке', async () => {
    const smtpSkip = explainMailOutboundSkipReason();
    test.skip(
      smtpSkip !== null,
      smtpSkip ?? 'SMTP: внутренняя ошибка описания пропуска',
    );
    await runStep05(sharedPage);
    await stabilizePageForVideo(sharedPage);
  });
});
