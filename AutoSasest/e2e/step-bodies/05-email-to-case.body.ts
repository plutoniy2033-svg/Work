import type { Page } from '@playwright/test';
import { expect, test } from '../fixtures/stepScope';
import {
  applyCaseResponsibleGroupFilter,
  openCasesSectionFromSidebar,
} from '../helpers/creatio-cases-ui';
import { sendCreatioHelpTestEmail } from '../helpers/send-test-email';

/**
 * Письмо → без полного goto (сессия с шага 02): сайдбар «Обращения»,
 * фильтр по группе ответственных, ожидание темы в списке.
 */
export async function runStep05(page: Page) {
  const sent = await sendCreatioHelpTestEmail();
  await test.info().attach('smtp.log', {
    body: sent.smtpLog,
    contentType: 'text/plain; charset=utf-8',
  });

  const { subject } = sent;
  /** Тема с датой длинная; в списке Creatio иногда обрезают — ищем по началу. */
  const needle =
    subject.length > 120 ? subject.slice(0, 120).trim() : subject.trim();

  await openCasesSectionFromSidebar(page);
  await applyCaseResponsibleGroupFilter(page);

  const waitMs = Number(process.env.CREATIO_MAIL_CASE_WAIT_MS || 180_000);
  const pollMs = Number(process.env.CREATIO_MAIL_CASE_POLL_MS || 8_000);
  const deadline = Date.now() + waitMs;
  const allowReload =
    process.env.CREATIO_MAIL_CASE_ALLOW_RELOAD === '1' ||
    process.env.CREATIO_MAIL_CASE_ALLOW_RELOAD === 'true';

  while (Date.now() < deadline) {
    const loc = page.getByText(needle, { exact: false }).first();
    try {
      await expect(loc).toBeVisible({ timeout: pollMs });
      return;
    } catch {
      /* ждём появления заявки */
    }
    if (allowReload) {
      await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
      await openCasesSectionFromSidebar(page).catch(() => {});
      await applyCaseResponsibleGroupFilter(page).catch(() => {});
    }
    await page.waitForTimeout(pollMs);
  }

  throw new Error(
    `За ${waitMs} мс не найдена заявка с темой «${needle}». Проверьте фильтры, почту Creatio, CREATIO_MAIL_CASE_WAIT_MS. При необходимости CREATIO_MAIL_CASE_ALLOW_RELOAD=1.`,
  );
}
