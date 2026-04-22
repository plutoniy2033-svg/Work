import dns from 'node:dns/promises';
import https from 'node:https';
import { URL } from 'node:url';

const DEFAULT_HOST = 'creatio.corp.mango.ru';

/** Путь без hash — hash на HTTP не уходит, для пробы достаточно aspx+query */
const DEFAULT_LOGIN_PROBE_PATH =
  '/Login/NuiLogin.aspx?ReturnUrl=%2f0%2fNui%2fViewModule.aspx';

function getHost(env = process.env) {
  const raw =
    env.CREATIO_BASE_URL ||
    env.CREATIO_HOST ||
    `https://${DEFAULT_HOST}`;
  try {
    return new URL(raw.includes('://') ? raw : `https://${raw}`).hostname;
  } catch {
    return DEFAULT_HOST;
  }
}

function statusAcceptable(code) {
  return typeof code === 'number' && code >= 200 && code < 500;
}

function requestOnce(host, pathStr, method) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        host,
        port: 443,
        method,
        path: pathStr,
        rejectUnauthorized: false,
        servername: host,
        timeout: 12_000,
        headers: {
          'User-Agent': 'AutoSasest-corp-probe/1.0',
          Accept: '*/*',
        },
      },
      (res) => {
        res.resume();
        resolve({ statusCode: res.statusCode ?? 0, path: pathStr, method });
      },
    );
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.end();
  });
}

async function probeHttpPath(host, pathStr) {
  try {
    const head = await requestOnce(host, pathStr, 'HEAD');
    if (head.statusCode === 405 || head.statusCode === 501) {
      const get = await requestOnce(host, pathStr, 'GET');
      return { statusCode: get.statusCode, path: pathStr, via: 'GET' };
    }
    return { statusCode: head.statusCode, path: pathStr, via: 'HEAD' };
  } catch (e) {
    const get = await requestOnce(host, pathStr, 'GET');
    return {
      statusCode: get.statusCode,
      path: pathStr,
      via: 'GET',
      note: `HEAD failed: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
}

/**
 * Проверка «есть ли маршрут до хоста и отвечает ли IIS/приложение».
 * Не гарантирует, что headless Chromium отрисует тот же UI, что и обычный Chrome.
 */
export async function probeCorpAccess(env = process.env) {
  if (
    env.AUTOSASEST_SKIP_CORP_NETWORK === '1' ||
    env.AUTOSASEST_SKIP_CORP_NETWORK === 'true'
  ) {
    return {
      ok: true,
      host: getHost(env),
      dnsOk: true,
      probes: [],
      note:
        'Проверка CRM отключена (AUTOSASEST_SKIP_CORP_NETWORK). Только для отладки вне корп. сети.',
    };
  }

  const host = getHost(env);
  let dnsOk = false;
  try {
    await dns.lookup(host);
    dnsOk = true;
  } catch (e) {
    return {
      ok: false,
      host,
      dnsOk: false,
      probes: [],
      reason: `DNS: ${e instanceof Error ? e.message : String(e)}`,
    };
  }

  if (env.CREATIO_SKIP_HTTP_PROBE === '1') {
    return {
      ok: true,
      host,
      dnsOk: true,
      probes: [],
      note: 'HTTP отключён (CREATIO_SKIP_HTTP_PROBE=1). OK = только DNS.',
    };
  }

  const loginPath =
    env.CREATIO_HTTP_PROBE_LOGIN_PATH?.trim() || DEFAULT_LOGIN_PROBE_PATH;

  const probeDefs = [
    { name: 'root', path: '/' },
    { name: 'loginAspx', path: loginPath },
  ];

  const probes = [];
  for (const p of probeDefs) {
    try {
      const r = await probeHttpPath(host, p.path);
      probes.push({
        name: p.name,
        path: p.path,
        statusCode: r.statusCode,
        via: r.via,
        note: r.note,
      });
    } catch (e) {
      probes.push({
        name: p.name,
        path: p.path,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  const failed = probes.find((x) => x.error);
  if (failed) {
    return {
      ok: false,
      host,
      dnsOk,
      probes,
      reason: `${failed.name}: ${failed.error}`,
    };
  }

  const loginProbe = probes.find((x) => x.name === 'loginAspx');
  if (loginProbe && !statusAcceptable(loginProbe.statusCode)) {
    return {
      ok: false,
      host,
      dnsOk,
      probes,
      reason: `Страница логина недоступна (HTTP ${loginProbe.statusCode}). Проверьте CREATIO_HTTP_PROBE_LOGIN_PATH.`,
    };
  }

  return {
    ok: true,
    host,
    dnsOk,
    probes,
    note:
      'OK = DNS + HTTP-ответ по корню и Login/NuiLogin.aspx. Это не проверка отрисовки SPA в headless.',
  };
}
