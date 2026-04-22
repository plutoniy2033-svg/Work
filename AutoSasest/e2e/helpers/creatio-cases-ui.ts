import type { Page } from '@playwright/test';

/** Пункт сайдбара «Обращения» (Case), без полного page.goto — сессия та же. */
const CASE_SIDEBAR_SEL =
  process.env.CREATIO_CASE_SIDEBAR_SEL ||
  '[data-item-marker="Обращения"][module-name="Case"]';

const FILTER_BTN_TEXT =
  process.env.CREATIO_CASE_FILTER_BTN_TEXT || 'Фильтры/группы';

const FILTER_COLUMN_TEXT =
  process.env.CREATIO_CASE_FILTER_COLUMN_TEXT || 'Группа ответственных';

const FILTER_GROUP_LABEL =
  process.env.CREATIO_CASE_FILTER_GROUP_LABEL ||
  'Техническая поддержка crm';

export async function openCasesSectionFromSidebar(page: Page) {
  const item = page.locator(CASE_SIDEBAR_SEL).first();
  await item.waitFor({ state: 'visible', timeout: 90_000 });
  await item.scrollIntoViewIfNeeded().catch(() => {});
  await item.click({ timeout: 30_000 });
  await page.waitForTimeout(
    Number(process.env.CREATIO_CASE_SECTION_SETTLE_MS || 2_000),
  );
}

/**
 * Фильтры/группы → колонка «Группа ответственных» → значение «Техническая поддержка crm».
 * ID вида t-comp* не используем — только стабильные маркеры/текст.
 */
export async function applyCaseResponsibleGroupFilter(page: Page) {
  await page
    .getByText(FILTER_BTN_TEXT, { exact: true })
    .first()
    .click({ timeout: 45_000 });

  await page.waitForTimeout(
    Number(process.env.CREATIO_CASE_FILTER_PANEL_MS || 1_200),
  );

  const colPlaceholder = process.env.CREATIO_CASE_COLUMN_INPUT_PLACEHOLDER || 'Колонка';
  const colInput = page.locator(
    `input.base-edit-input[placeholder="${colPlaceholder}"]`,
  );
  if ((await colInput.count()) > 0) {
    await colInput.first().click({ timeout: 15_000 }).catch(() => {});
    await page.waitForTimeout(400);
  }

  await page
    .getByText(FILTER_COLUMN_TEXT, { exact: true })
    .first()
    .click({ timeout: 20_000 })
    .catch(() => {});

  await page.waitForTimeout(500);

  await page
    .getByText(FILTER_GROUP_LABEL, { exact: true })
    .first()
    .click({ timeout: 25_000 });

  await page.waitForTimeout(
    Number(process.env.CREATIO_CASE_FILTER_APPLY_SETTLE_MS || 1_500),
  );
}
