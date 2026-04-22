import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { Page } from '@playwright/test';

function resolveBoosterAbsPath(): string | null {
  const raw = process.env.WEBADMIN_MANGO_BOOSTER_SCRIPT?.trim();
  if (!raw) return null;
  return path.normalize(
    path.isAbsolute(raw) ? raw : path.resolve(process.cwd(), raw),
  );
}

/** Читаем исходник, BOM, патч getJquery (иначе при уже загруженном jQuery callback не вызывается). */
export async function readPatchedMangoBoosterSource(absPath: string): Promise<string> {
  let src = await fs.readFile(absPath, 'utf8');
  if (src.charCodeAt(0) === 0xfeff) {
    src = src.slice(1);
  }
  src = src.replace(
    /getJquery\(callback,\s*false\)/,
    'getJquery(callback, true) /* Playwright: init и при уже загруженном jQuery */',
  );
  return `${src}\n;window.__MANGO_BOOSTER_PW_LOADED__=1;\n`;
}

/**
 * Выполняет MangoBooster в контексте уже открытой страницы (как <script> в DOM).
 * Надёжнее, чем addInitScript + путь к файлу на Windows / при строгом CSP.
 */
export async function injectMangoBoosterIntoPage(page: Page): Promise<void> {
  const abs = resolveBoosterAbsPath();
  if (!abs) return;
  if (!existsSync(abs)) {
    throw new Error(`WEBADMIN_MANGO_BOOSTER_SCRIPT: файл не найден: ${abs}`);
  }
  const content = await readPatchedMangoBoosterSource(abs);
  await page.addScriptTag({ content });
  await page
    .waitForFunction(
      () =>
        (window as unknown as { __MANGO_BOOSTER_PW_LOADED__?: number })
          .__MANGO_BOOSTER_PW_LOADED__ === 1,
      { timeout: 45_000 },
    )
    .catch(() => {
      throw new Error(
        'MangoBooster: после addScriptTag маркер __MANGO_BOOSTER_PW_LOADED__ не появился — проверь консоль страницы (ошибка в скрипте или CSP).',
      );
    });
}
