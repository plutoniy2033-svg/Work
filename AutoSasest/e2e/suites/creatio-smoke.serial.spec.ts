import fs from 'node:fs';
import path from 'node:path';
import { test } from '../fixtures/stepScope';
import { CORP_AUTH_STORAGE } from '../helpers/auth-storage';
import { runStep02 } from '../step-bodies/02-authorization.body';

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

test.describe.serial('Creatio smoke (по порядку)', () => {
  test('[02-authorization] ввод логина и пароля, «Войти»', async ({
    page,
    context,
  }) => {
    test.skip(
      !process.env.CREATIO_USER || !process.env.CREATIO_PASSWORD,
      'CREATIO_USER и CREATIO_PASSWORD в .env',
    );
    await runStep02(page, context, { reuseLoginPage: false });
  });
});
