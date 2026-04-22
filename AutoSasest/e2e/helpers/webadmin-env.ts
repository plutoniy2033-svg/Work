/** Учётка для входа в WebAdmin (ExtJS) и дальнейших действий в ЛК. */
export function webadminAuthConfigured(): boolean {
  return Boolean(
    process.env.WEBADMIN_USER?.trim() &&
      process.env.WEBADMIN_PASSWORD?.trim(),
  );
}

type Slot = 'missing' | 'empty' | 'set';

function slot(raw: string | undefined): Slot {
  if (raw === undefined) return 'missing';
  if (!raw.trim()) return 'empty';
  return 'set';
}

function line(name: string, s: Slot): string {
  const h =
    s === 'set'
      ? 'задано'
      : s === 'empty'
        ? 'пусто / пробелы'
        : 'нет в process.env';
  return `  • ${name}: ${h}`;
}

/** Текст для test.skip, если нет логина/пароля WebAdmin. */
export function explainWebadminSkipReason(): string | null {
  if (webadminAuthConfigured()) return null;
  const u = slot(process.env.WEBADMIN_USER);
  const p = slot(process.env.WEBADMIN_PASSWORD);
  return [
    'Шаг [03-webadmin-lk] пропущен: без WEBADMIN_USER и WEBADMIN_PASSWORD не выполняется вход в WebAdmin и сценарий ЛК.',
    'Задайте переменные в .env в корне AutoSasest (dotenv в playwright.config).',
    '',
    'Состояние:',
    line('WEBADMIN_USER', u),
    line('WEBADMIN_PASSWORD', p),
    '',
    'Опционально: WEBADMIN_ENTRY_URL — полный URL страницы входа (по умолчанию …/wa/#p=sswa-module-softplatform-cdrs).',
  ].join('\n');
}

export function webadminEntryUrl(): string {
  const custom = process.env.WEBADMIN_ENTRY_URL?.trim();
  if (custom) return custom;
  const base = (process.env.WEBADMIN_BASE_URL || 'https://webadmin.by.mgo.su').replace(
    /\/$/,
    '',
  );
  return `${base}/wa/#p=sswa-module-softplatform-cdrs`;
}
