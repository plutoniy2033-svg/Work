import fs from 'node:fs';
import { test } from '../fixtures/stepScope';
import { CORP_AUTH_STORAGE } from '../helpers/auth-storage';
import { runStep03 } from '../step-bodies/03-session.body';

if (fs.existsSync(CORP_AUTH_STORAGE)) {
  test.use({ storageState: CORP_AUTH_STORAGE });
}

test.describe('Шаг 03 — сессия после входа', () => {
  test('есть cookie и нет поля логина (сессия сохранена)', async ({
    page,
    context,
  }) => {
    test.skip(
      !fs.existsSync(CORP_AUTH_STORAGE),
      'Нет сохранённой сессии: сначала шаг 02 с CREATIO_USER и CREATIO_PASSWORD в .env',
    );
    await runStep03(page, context);
  });
});
