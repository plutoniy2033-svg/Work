import fs from 'node:fs';
import { test } from '../fixtures/stepScope';
import { CORP_AUTH_STORAGE } from '../helpers/auth-storage';
import { runStep04 } from '../step-bodies/04-navigation.body';

if (fs.existsSync(CORP_AUTH_STORAGE)) {
  test.use({ storageState: CORP_AUTH_STORAGE });
}

test.describe('Шаг 04 — базовая навигация (под сессией)', () => {
  test('главная открывается, пользователь остаётся в приложении', async ({
    page,
  }) => {
    test.skip(
      !fs.existsSync(CORP_AUTH_STORAGE),
      'Нет сохранённой сессии: сначала шаг 02 с CREATIO_USER и CREATIO_PASSWORD в .env',
    );
    await runStep04(page);
  });
});
