/**
 * Точки входа Creatio: отдельно форма логина и (после входа) основной NUI.
 * Задаются через CREATIO_START_URL / CREATIO_APP_URL либо дефолты под mango.
 */

const DEFAULT_LOGIN_FULL =
  'https://creatio.corp.mango.ru/Login/NuiLogin.aspx?ReturnUrl=%2f0%2fNui%2fViewModule.aspx#SectionModuleV2/CaseSection/';

const DEFAULT_APP_PATH = '/0/Nui/ViewModule.aspx#SectionModuleV2/CaseSection/';

function baseOrigin(): string {
  const b = (process.env.CREATIO_BASE_URL || 'https://creatio.corp.mango.ru').replace(
    /\/$/,
    '',
  );
  return new URL(b.includes('://') ? b : `https://${b}`).origin;
}

/** pathname + search + hash для page.goto относительно baseURL */
export function creatioLoginEntryPath(): string {
  const raw = (
    process.env.CREATIO_START_URL ||
    process.env.CREATIO_ENTRY_URL ||
    ''
  ).trim();
  if (!raw) {
    const u = new URL(DEFAULT_LOGIN_FULL);
    return u.pathname + u.search + u.hash;
  }
  if (raw.startsWith('http')) {
    const u = new URL(raw);
    const base = baseOrigin();
    if (u.origin !== base) {
      throw new Error(
        `CREATIO_START_URL (${u.origin}) должен совпадать с origin из CREATIO_BASE_URL (${base})`,
      );
    }
    return u.pathname + u.search + u.hash;
  }
  return raw.startsWith('/') ? raw : `/${raw}`;
}

/** После авторизации — основной модуль (hash для клиентского роутера). */
export function creatioAppPath(): string {
  const raw = (process.env.CREATIO_APP_URL || '').trim();
  if (!raw) return DEFAULT_APP_PATH;
  if (raw.startsWith('http')) {
    const u = new URL(raw);
    const base = baseOrigin();
    if (u.origin !== base) {
      throw new Error(
        `CREATIO_APP_URL (${u.origin}) должен совпадать с CREATIO_BASE_URL (${base})`,
      );
    }
    return u.pathname + u.search + u.hash;
  }
  return raw.startsWith('/') ? raw : `/${raw}`;
}
