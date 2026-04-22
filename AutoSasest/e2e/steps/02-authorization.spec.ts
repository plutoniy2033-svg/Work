import { test } from '../fixtures/stepScope';
import { runStep02 } from '../step-bodies/02-authorization.body';

const user = process.env.CREATIO_USER;
const password = process.env.CREATIO_PASSWORD;

test.describe('Шаг 02 — авторизация', () => {
  test('ввод логина и пароля, нажатие «Войти», успешный вход', async ({
    page,
    context,
  }) => {
    test.skip(
      !user || !password,
      'Задайте CREATIO_USER и CREATIO_PASSWORD в .env (см. .env.example)',
    );
    await runStep02(page, context);
  });
});
