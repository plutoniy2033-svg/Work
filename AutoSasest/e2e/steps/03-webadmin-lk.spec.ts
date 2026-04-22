import { test } from '../fixtures/stepScope';
import { explainWebadminSkipReason } from '../helpers/webadmin-env';
import { runStep03WebadminLk } from '../step-bodies/03-webadmin-lk.body';

test.describe('Шаг 03 — WebAdmin → ЛК → Поддержка', () => {
  test('вход, личный кабинет, Помощь → Поддержка', async ({ page }) => {
    const skip = explainWebadminSkipReason();
    test.skip(skip !== null, skip ?? 'WebAdmin: нет описания пропуска');
    await runStep03WebadminLk(page);
  });
});
