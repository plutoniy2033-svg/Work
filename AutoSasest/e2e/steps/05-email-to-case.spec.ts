import fs from 'node:fs';
import { test } from '../fixtures/stepScope';
import { CORP_AUTH_STORAGE } from '../helpers/auth-storage';
import { explainMailOutboundSkipReason } from '../helpers/send-test-email';
import { runStep05 } from '../step-bodies/05-email-to-case.body';

if (fs.existsSync(CORP_AUTH_STORAGE)) {
  test.use({ storageState: CORP_AUTH_STORAGE });
}

test.describe('Шаг 05 — письмо → заявка', () => {
  test('SMTP письмо и появление темы в списке', async ({ page }) => {
    const smtpSkip = explainMailOutboundSkipReason();
    test.skip(
      smtpSkip !== null,
      smtpSkip ?? 'SMTP: внутренняя ошибка описания пропуска',
    );
    test.skip(
      !fs.existsSync(CORP_AUTH_STORAGE),
      'Нет corp.json: сначала прогон шага 02 с CREATIO_USER/PASSWORD',
    );
    await runStep05(page);
  });
});
