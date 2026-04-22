import dns from 'node:dns/promises';
import net from 'node:net';
import util from 'node:util';
import nodemailer from 'nodemailer';

/** Миниатюра PNG — вложение «фото». */
const MINI_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

/** Тема: «Тестирование release CRM» + актуальная дата/время (локаль ru-RU). */
function defaultReleaseCrmSubject(): string {
  const d = new Date();
  const when = d.toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  return `Тестирование release CRM (${when})`;
}

function escapeHtml(s: string) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const inspectOpts = {
  depth: 20,
  breakLength: 120,
  maxStringLength: 500_000,
  colors: false,
} as const;

/** Строки вида «<< 220 …» / «>> EHLO …» как в почтовых клиентах. */
function appendSmtpTranscriptFromDebug(
  transcript: string[],
  entry: unknown,
  message: unknown,
) {
  if (typeof message !== 'string') {
    if (message !== undefined && message !== null && message !== '') {
      transcript.push(
        `** ${util.inspect(message, { depth: 8, maxStringLength: 40_000, colors: false })}`,
      );
    }
    return;
  }
  const raw = message.replace(/\r?\n$/, '');
  const tnx =
    entry &&
    typeof entry === 'object' &&
    entry !== null &&
    'tnx' in (entry as object)
      ? String((entry as { tnx?: string }).tnx)
      : '';
  const arrow =
    tnx === 'client' ? '>>' : tnx === 'server' ? '<<' : '**';
  for (const line of raw.split(/\r?\n/)) {
    const L = line.replace(/\r$/, '').trimEnd();
    if (L.length) transcript.push(`${arrow} ${L}`);
  }
}

/**
 * technical — полный nodemailer-лог;
 * transcript — человекочитаемый протокол (<< >>) + ** для прочего.
 */
function createSmtpDualLogger(technical: string[], transcript: string[]) {
  const push = (
    level: string,
    entry?: unknown,
    message?: unknown,
    ...rest: unknown[]
  ) => {
    const t = new Date().toISOString();
    const msg =
      message !== undefined && message !== null && message !== ''
        ? typeof message === 'string'
          ? message
          : util.inspect(message, inspectOpts)
        : '';
    const meta =
      entry !== undefined && entry !== null
        ? typeof entry === 'object'
          ? util.inspect(entry, inspectOpts)
          : String(entry)
        : '';
    const extra = rest.length
      ? rest
          .map((a) =>
            a !== null && typeof a === 'object'
              ? util.inspect(a, inspectOpts)
              : String(a),
          )
          .join(' | ')
      : '';
    const body = [msg && `line: ${msg}`, meta && `meta: ${meta}`, extra && `more: ${extra}`]
      .filter(Boolean)
      .join('\n  ');
    technical.push(`${t} [nodemailer ${level}]${body ? `\n  ${body}` : ''}`);

    if (level === 'debug') {
      appendSmtpTranscriptFromDebug(transcript, entry, message);
    } else if (msg || extra || (entry && typeof entry === 'object')) {
      const bits = [msg, meta, extra].filter(Boolean).join(' | ');
      if (bits) transcript.push(`** [${level}] ${bits}`);
    }
  };
  return {
    level: 'trace',
    trace: (e?: unknown, m?: unknown, ...r: unknown[]) => push('trace', e, m, ...r),
    debug: (e?: unknown, m?: unknown, ...r: unknown[]) => push('debug', e, m, ...r),
    info: (e?: unknown, m?: unknown, ...r: unknown[]) => push('info', e, m, ...r),
    warn: (e?: unknown, m?: unknown, ...r: unknown[]) => push('warn', e, m, ...r),
    error: (e?: unknown, m?: unknown, ...r: unknown[]) => push('error', e, m, ...r),
    fatal: (e?: unknown, m?: unknown, ...r: unknown[]) => push('fatal', e, m, ...r),
  };
}

function connectedUrlLine(host: string, port: number, secure: boolean): string {
  if (secure || port === 465) {
    return `Connected to smtp://${host}:${port}/?ssl=true`;
  }
  return `Connected to smtp://${host}:${port}/?starttls=when-available`;
}

/** Поля errno-событий Node + цепочка cause. */
function serializeErr(err: unknown, depth = 0): string {
  if (depth > 6) return '[depth limit]';
  if (err === null || err === undefined) return String(err);
  if (typeof err !== 'object') return String(err);
  const o = err as NodeJS.ErrnoException & {
    code?: string;
    cause?: unknown;
    address?: string;
    port?: number;
  };
  const pick: Record<string, unknown> = {};
  for (const k of [
    'name',
    'message',
    'code',
    'errno',
    'syscall',
    'address',
    'port',
    'stack',
  ]) {
    const v = (o as Record<string, unknown>)[k];
    if (v !== undefined) pick[k] = v;
  }
  if (o.cause !== undefined) {
    pick.cause = serializeErr(o.cause, depth + 1);
  }
  return JSON.stringify(pick, null, 2);
}

async function logDnsTechnical(technical: string[], transcript: string[], host: string) {
  const t = new Date().toISOString();
  try {
    const all = await dns.lookup(host, { all: true, verbatim: true });
    technical.push(`${t} [dns.lookup] ${JSON.stringify({ host, all })}`);
    transcript.push(`** DNS ${host}: ${JSON.stringify(all)}`);
  } catch (e) {
    technical.push(`${t} [dns.lookup] FAILED ${serializeErr(e)}`);
    transcript.push(`** DNS FAILED: ${serializeErr(e)}`);
  }
  try {
    const r4 = await dns.resolve4(host).catch(() => null as string[] | null);
    if (r4?.length) {
      technical.push(`${t} [dns.resolve4] ${JSON.stringify({ host, addresses: r4 })}`);
      transcript.push(`** DNS A ${host}: ${r4.join(', ')}`);
    }
  } catch {
    /* ignore */
  }
  try {
    const r6 = await dns.resolve6(host).catch(() => null as string[] | null);
    if (r6?.length) {
      technical.push(`${t} [dns.resolve6] ${JSON.stringify({ host, addresses: r6 })}`);
      transcript.push(`** DNS AAAA ${host}: ${r6.join(', ')}`);
    }
  } catch {
    /* ignore */
  }
}

function probeTcp(
  host: string,
  port: number,
  timeoutMs: number,
): Promise<{ ok: boolean; line: string }> {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const socket = net.connect({ host, port, family: 0 }, () => {
      const local = `${socket.localAddress}:${socket.localPort}`;
      const remote = `${socket.remoteAddress}:${socket.remotePort}`;
      socket.destroy();
      resolve({
        ok: true,
        line: `TCP connect OK in ${Date.now() - t0}ms local=${local} remote=${remote}`,
      });
    });
    socket.setTimeout(timeoutMs, () => {
      socket.destroy();
      resolve({
        ok: false,
        line: `TCP connect TIMEOUT after ${timeoutMs}ms to ${host}:${port}`,
      });
    });
    socket.on('error', (err: NodeJS.ErrnoException) => {
      resolve({
        ok: false,
        line: `TCP connect ERROR ${serializeErr(err)}`,
      });
    });
  });
}

export function mailOutboundConfigured(): boolean {
  return Boolean(
    process.env.SMTP_HOST?.trim() &&
      process.env.SMTP_USER?.trim() &&
      process.env.SMTP_PASSWORD?.trim(),
  );
}

type SmtpEnvSlot = 'missing' | 'empty' | 'set';

function smtpEnvSlot(raw: string | undefined): SmtpEnvSlot {
  if (raw === undefined) return 'missing';
  if (!raw.trim()) return 'empty';
  return 'set';
}

function slotRu(name: string, slot: SmtpEnvSlot): string {
  const human =
    slot === 'set'
      ? 'задано (значение в лог не выводится)'
      : slot === 'empty'
        ? 'переменная есть, но пустая или одни пробелы'
        : 'переменная отсутствует в process.env';
  return `  • ${name}: ${human}`;
}

/**
 * Если SMTP не настроен — многострочное объяснение для skip/reporter.
 * Если всё ок — `null`.
 */
export function explainMailOutboundSkipReason(): string | null {
  if (mailOutboundConfigured()) return null;
  const host = smtpEnvSlot(process.env.SMTP_HOST);
  const user = smtpEnvSlot(process.env.SMTP_USER);
  const pass = smtpEnvSlot(process.env.SMTP_PASSWORD);
  const dotenvPath =
    'Корень проекта AutoSasest: playwright.config.ts вызывает dotenv с path = <корень>/.env — переменные должны быть там (или уже экспортированы в окружение до запуска npx playwright).';
  return [
    'Шаг [05-email-to-case] пропущен: без исходящего SMTP тест не посылает письмо и не проверяет заявку по теме.',
    'Условие запуска: все три переменные непустые после trim — SMTP_HOST, SMTP_USER, SMTP_PASSWORD.',
    dotenvPath,
    '',
    'Состояние переменных сейчас:',
    slotRu('SMTP_HOST', host),
    slotRu('SMTP_USER', user),
    slotRu('SMTP_PASSWORD', pass),
    '',
    'Подсказка: если в UI сервера (node server) письма ходят, а в Playwright — skip, часто .env не подхватывается из другого cwd; запускайте тесты из каталога AutoSasest.',
  ].join('\n');
}

export type SentTestEmail = {
  subject: string;
  messageId?: string;
  /** Сначала человекочитаемый SMTP (<< >>), затем блок raw. */
  smtpLog: string;
};

/**
 * Письмо: тема «Тестирование release CRM (дата)», текст, вложения — фото (PNG) и файл (.txt).
 * Получатель по умолчанию — CREATIO_HELP_MAIL_TO или crmhelp@mangotele.com.
 */
export async function sendCreatioHelpTestEmail(): Promise<SentTestEmail> {
  if (!mailOutboundConfigured()) {
    throw new Error(
      'Задайте SMTP_HOST, SMTP_USER, SMTP_PASSWORD в .env (см. .env.example)',
    );
  }

  const host = process.env.SMTP_HOST!.trim();
  const port = Number(process.env.SMTP_PORT || 587);
  const secure =
    process.env.SMTP_SECURE === '1' || process.env.SMTP_SECURE === 'true';
  const user = process.env.SMTP_USER!.trim();
  const pass = process.env.SMTP_PASSWORD!.trim();
  const from = (process.env.SMTP_FROM || user).trim();
  const to = (process.env.CREATIO_HELP_MAIL_TO || 'crmhelp@mangotele.com').trim();
  const subject =
    (process.env.CREATIO_MAIL_SUBJECT || '').trim() || defaultReleaseCrmSubject();
  const textBody =
    (process.env.CREATIO_MAIL_BODY_TEXT || '').trim() ||
    'Привет, ты видишь мой текст?';

  const technical: string[] = [];
  const transcript: string[] = [];
  const iso = () => new Date().toISOString();

  transcript.push(connectedUrlLine(host, port, secure));
  transcript.push(
    `** Session: ${iso()} user=${user} from=${from} to=${to} (password не логируется)`,
  );

  technical.push(
    `${iso()} [meta] host=${host} port=${port} secure=${String(secure)} auth_user=${user} from=${from} to=${to} node=${process.version} platform=${process.platform}`,
  );

  await logDnsTechnical(technical, transcript, host);

  const tcpTimeout = Number(process.env.SMTP_TCP_PROBE_TIMEOUT_MS || 12_000);
  const tcp = await probeTcp(host, port, tcpTimeout);
  technical.push(`${iso()} [tcp.probe] ${tcp.line}`);
  transcript.push(`** TCP probe: ${tcp.line}`);

  const logger = createSmtpDualLogger(technical, transcript);

  const transporter = nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user, pass },
    tls:
      process.env.SMTP_TLS_REJECT_UNAUTHORIZED === '0'
        ? { rejectUnauthorized: false }
        : undefined,
    logger,
    debug: true,
    transactionLog: true,
    connectionTimeout: Number(process.env.SMTP_CONNECTION_TIMEOUT_MS || 60_000),
    greetingTimeout: Number(process.env.SMTP_GREETING_TIMEOUT_MS || 30_000),
    socketTimeout: Number(process.env.SMTP_SOCKET_TIMEOUT_MS || 60_000),
  });

  const html = `<p>${escapeHtml(textBody)}</p>`;

  try {
    const info = await transporter.sendMail({
      from,
      to,
      subject,
      text: textBody,
      html,
      attachments: [
        {
          filename: 'release-test-photo.png',
          content: MINI_PNG,
          contentType: 'image/png',
          contentDisposition: 'attachment',
        },
        {
          filename: 'release-test-file.txt',
          content: 'Тестовый файл\n',
          contentType: 'text/plain; charset=utf-8',
          contentDisposition: 'attachment',
        },
      ],
    });

    technical.push(
      `${iso()} [result] messageId=${info.messageId ?? ''} response=${info.response ?? ''}`,
    );
    if (info.response) {
      transcript.push(`<< ${info.response}`);
    }

    const smtpLog = [
      transcript.join('\n'),
      '',
      '--- raw (nodemailer / диагностика) ---',
      '',
      technical.join('\n'),
    ].join('\n');

    return {
      subject,
      messageId: info.messageId,
      smtpLog,
    };
  } catch (e) {
    technical.push(`${iso()} [sendMail.catch] ${serializeErr(e)}`);
    transcript.push(`** ERROR ${serializeErr(e)}`);
    const smtpLog = [
      transcript.join('\n'),
      '',
      '--- raw (nodemailer / диагностика) ---',
      '',
      technical.join('\n'),
    ].join('\n');
    throw new Error(
      `SMTP sendMail failed: ${e instanceof Error ? e.message : String(e)}\n\n--- smtp.log ---\n${smtpLog}`,
    );
  }
}
