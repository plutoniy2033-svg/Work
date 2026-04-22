import { spawn } from 'node:child_process';
import fs, { stat, rm } from 'node:fs/promises';
import path from 'node:path';
import { glob } from 'glob';

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

async function clearTestResults(root) {
  await rm(path.join(root, 'test-results'), { recursive: true, force: true }).catch(
    () => {},
  );
}

/**
 * @param {string} root
 * @param {string} specRelative e2e/steps/foo.spec.ts
 */
export async function runPlaywrightSpec(root, specRelative) {
  const specPath = path.join(root, specRelative).replace(/\\/g, '/');
  const before = Date.now();

  await clearTestResults(root);

  const json = await new Promise((resolve, reject) => {
    const chunks = [];
    const errChunks = [];
    const cli = path.join(root, 'node_modules', '@playwright', 'test', 'cli.js');
    const proc = spawn(process.execPath, [cli, 'test', specPath, '--reporter=json'], {
      cwd: root,
      shell: false,
      env: {
        ...process.env,
        FORCE_COLOR: '0',
        PW_RUNNER_SUBPROCESS: '1',
      },
    });
    proc.stdout.on('data', (d) => chunks.push(d));
    proc.stderr.on('data', (d) => errChunks.push(d));
    proc.on('error', reject);
    proc.on('close', (code) => {
      const out = Buffer.concat(chunks).toString('utf8');
      const err = Buffer.concat(errChunks).toString('utf8');
      let report = tryParsePlaywrightJson(out);
      if (!report) {
        report = {
          parseError: true,
          stdout: out.slice(0, 8000),
          stderr: err.slice(0, 8000),
        };
      }
      resolve({ code, report, stderr: err, stdoutFull: out });
    });
  });

  await delay(400);

  const videoSrc = await pickFreshFile(root, before, '.webm');
  const screenshotSrc = await pickFreshFile(root, before, '.png');
  const parsed = summarizeReport(json.report, json.code);
  return {
    exitCode: json.code,
    stdoutFull: json.stdoutFull,
    stderr: json.stderr,
    videoRelative: videoSrc,
    screenshotRelative: screenshotSrc,
    rawReport: json.report,
    ...parsed,
  };
}

async function pickFreshFile(root, sinceMs, ext) {
  const pattern = `test-results/**/*${ext}`;
  const files = await glob(pattern, { cwd: root, nodir: true, absolute: true });
  const stamped = await Promise.all(
    files.map(async (f) => {
      const s = await stat(f);
      return { f, mtimeMs: s.mtimeMs, size: s.size };
    }),
  );
  const fresh = stamped.filter((x) => x.mtimeMs >= sinceMs - 3000);
  fresh.sort((a, b) => b.mtimeMs - a.mtimeMs);
  if (!fresh.length) return null;
  const best = fresh[0];
  if (best.size < 32) return null;
  return path.relative(root, best.f).replace(/\\/g, '/');
}

function tryParsePlaywrightJson(out) {
  try {
    return JSON.parse(out);
  } catch {
    /* npx / лишний вывод */
  }
  const first = out.indexOf('{');
  const last = out.lastIndexOf('}');
  if (first === -1 || last <= first) return null;
  try {
    return JSON.parse(out.slice(first, last + 1));
  } catch {
    return null;
  }
}

function summarizeReport(report, exitCode) {
  if (!report || report.parseError) {
    return {
      tests: [],
      summary: { expected: 0, unexpected: 0, skipped: 0 },
      durationMs: 0,
      status: 'failed',
      ok: false,
    };
  }
  const suites = report.suites || [];
  const tests = [];
  for (const e of report.errors || []) {
    tests.push({
      title: 'playwright',
      suite: '',
      status: 'failed',
      duration: 0,
      error: e.message || String(e),
    });
  }
  const walk = (suite, prefix = '') => {
    const title = suite.title ? `${prefix}${suite.title}` : prefix;
    for (const t of suite.specs || []) {
      const tr = (t.tests && t.tests[0]) || {};
      const result = (tr.results && tr.results[0]) || {};
      tests.push({
        title: t.title,
        suite: title,
        status: result.status || 'unknown',
        duration: result.duration,
        error: result.error?.message || result.errors?.[0]?.message,
      });
    }
    for (const ch of suite.suites || []) walk(ch, `${title} › `);
  };
  for (const s of suites) walk(s);
  const summary = {
    expected: report.stats?.expected ?? 0,
    unexpected: report.stats?.unexpected ?? 0,
    skipped: report.stats?.skipped ?? 0,
  };
  const durationMs = Math.round(report.stats?.duration ?? 0);

  let status = 'failed';
  if (exitCode === 0 && !report.errors?.length) {
    if (summary.unexpected > 0) {
      status = 'failed';
    } else if (summary.expected === 0 && summary.skipped > 0) {
      status = 'skipped';
    } else if (summary.expected > 0) {
      status = 'passed';
    } else {
      status = 'failed';
    }
  }

  const ok = status === 'passed';

  return { tests, summary, durationMs, status, ok };
}

function toRelArtifact(root, p) {
  if (!p) return null;
  const s = String(p);
  if (!path.isAbsolute(s)) {
    return s.replace(/\\/g, '/');
  }
  return path.relative(root, path.normalize(s)).replace(/\\/g, '/');
}

function mergeResultAttachments(tr) {
  const results = tr?.results;
  if (!Array.isArray(results) || !results.length) return [];
  const seen = new Set();
  const out = [];
  for (const r of results) {
    for (const a of r.attachments || []) {
      if (!a) continue;
      const key = a.path
        ? `p:${a.path}`
        : a.body != null
          ? `b:${a.name || 'attachment'}`
          : null;
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(a);
    }
  }
  return out;
}

function pickVideoAttachment(attachments) {
  if (!Array.isArray(attachments)) return null;
  return attachments.find(
    (a) =>
      a.path &&
      (a.name === 'video' ||
        String(a.contentType || '').includes('video') ||
        String(a.path).toLowerCase().endsWith('.webm')),
  );
}

function pickScreenshotAttachment(attachments) {
  if (!Array.isArray(attachments)) return null;
  return attachments.find(
    (a) =>
      a.path &&
      (a.name === 'screenshot' ||
        String(a.path).toLowerCase().endsWith('.png')),
  );
}

function pickSmtpLogAttachment(attachments) {
  if (!Array.isArray(attachments)) return null;
  return attachments.find(
    (a) =>
      (a.name === 'smtp.log' ||
        String(a.path || '').toLowerCase().endsWith('smtp.log')) &&
      (a.path || a.body != null),
  );
}

/** Playwright кладёт inline-вложения как base64 в `body`, без `path`. */
function smtpAttachmentToUtf8(a) {
  if (!a?.body || typeof a.body !== 'string') return null;
  try {
    return Buffer.from(a.body, 'base64').toString('utf8');
  } catch {
    return null;
  }
}

export function flattenReportSpecs(report) {
  const out = [];
  function walk(suite, prefix = '') {
    const name = [prefix, suite.title].filter(Boolean).join(' › ');
    for (const spec of suite.specs || []) {
      const tr = spec.tests?.[0];
      const results = tr?.results || [];
      const res = results.length ? results[results.length - 1] : {};
      const merged = mergeResultAttachments(tr);
      out.push({
        title: String(spec.title || ''),
        fullTitle: name ? `${name} › ${spec.title || ''}` : String(spec.title || ''),
        status: res?.status || 'unknown',
        duration: Math.round(res?.duration ?? 0),
        error: res?.error?.message || res?.errors?.[0]?.message,
        attachments: merged.length ? merged : res?.attachments || [],
      });
    }
    for (const ch of suite.suites || []) walk(ch, name);
  }
  for (const s of report.suites || []) walk(s, '');
  return out;
}

/** Один контекст = одно webm; размножаем путь на шаги без своего attachment. */
function fillBundleVideoFallback(stepResults) {
  if (!Array.isArray(stepResults) || stepResults.length < 2) return;
  const first = stepResults.find((s) => s.videoRelative)?.videoRelative;
  if (!first) return;
  for (const s of stepResults) {
    if (!s.videoRelative) s.videoRelative = first;
  }
}

/**
 * Ручной browser.newContext({ recordVideo }) часто не попадает в attachments JSON по тестам —
 * webm всё равно лежит в test-results. Подхватываем самый свежий файл.
 */
async function fillBundleVideoFromGlob(root, stepResults) {
  if (!Array.isArray(stepResults) || !stepResults.length) return;
  if (stepResults.every((s) => s.videoRelative)) return;

  const pattern = 'test-results/**/*.webm';
  let best = null;
  for (let attempt = 0; attempt < 20; attempt++) {
    const files = await glob(pattern, { cwd: root, nodir: true, absolute: true });
    const stamped = await Promise.all(
      files.map(async (f) => {
        const s = await stat(f);
        return { f, mtimeMs: s.mtimeMs, size: s.size };
      }),
    );
    const ok = stamped.filter((x) => x.size >= 32);
    if (ok.length) {
      ok.sort((a, b) => b.mtimeMs - a.mtimeMs);
      best = path.relative(root, ok[0].f).replace(/\\/g, '/');
      break;
    }
    await delay(250);
  }
  if (!best) return;
  for (const s of stepResults) {
    if (!s.videoRelative) s.videoRelative = best;
  }
}

export function mapBundleStepResults(root, flatList, checklistSteps) {
  return checklistSteps.map((step) => {
    const tag = `[${step.id}]`;
    const hit = flatList.find(
      (f) => f.title.includes(tag) || f.fullTitle.includes(tag),
    );
    if (!hit) {
      return {
        stepId: step.id,
        title: step.title,
        status: 'failed',
        ok: false,
        durationMs: 0,
        error: `Нет теста с маркером ${tag} в отчёте`,
        videoRelative: null,
        screenshotRelative: null,
        smtpLogRelative: null,
        smtpLogText: null,
        tests: [],
        summary: { expected: 0, unexpected: 1, skipped: 0 },
      };
    }
    let status = 'failed';
    let ok = false;
    if (hit.status === 'passed') {
      status = 'passed';
      ok = true;
    } else if (hit.status === 'skipped') {
      status = 'skipped';
      ok = false;
    }
    const vid = pickVideoAttachment(hit.attachments);
    const shot = pickScreenshotAttachment(hit.attachments);
    const smtp = pickSmtpLogAttachment(hit.attachments);
    const smtpLogText = smtp ? smtpAttachmentToUtf8(smtp) : null;
    return {
      stepId: step.id,
      title: step.title,
      status,
      ok,
      durationMs: hit.duration,
      error:
        status === 'passed'
          ? null
          : hit.error ||
            (status === 'skipped' ? `skipped: ${hit.title}` : null),
      videoRelative: toRelArtifact(root, vid?.path),
      screenshotRelative: toRelArtifact(root, shot?.path),
      smtpLogRelative: smtp?.path ? toRelArtifact(root, smtp.path) : null,
      smtpLogText,
      tests: [
        {
          title: hit.title,
          suite: hit.fullTitle,
          status: hit.status,
          duration: hit.duration,
          error: hit.error,
        },
      ],
      summary: {
        expected: status === 'passed' ? 1 : 0,
        unexpected: status === 'failed' ? 1 : 0,
        skipped: status === 'skipped' ? 1 : 0,
      },
    };
  });
}

/**
 * Один процесс Playwright: все шаги в одном окне (serial spec).
 * @param {string} root
 * @param {string} specRelative e2e/suites/creatio-crm.serial.spec.ts
 * @param {Array<{ id: string, title: string }>} checklistSteps
 */
export async function runPlaywrightBundle(root, specRelative, checklistSteps) {
  const specPath = path.join(root, specRelative).replace(/\\/g, '/');
  await clearTestResults(root);

  const json = await new Promise((resolve, reject) => {
    const chunks = [];
    const errChunks = [];
    const cli = path.join(root, 'node_modules', '@playwright', 'test', 'cli.js');
    const proc = spawn(process.execPath, [cli, 'test', specPath, '--reporter=json'], {
      cwd: root,
      shell: false,
      env: {
        ...process.env,
        FORCE_COLOR: '0',
        PW_RUNNER_SUBPROCESS: '1',
      },
    });
    proc.stdout.on('data', (d) => chunks.push(d));
    proc.stderr.on('data', (d) => errChunks.push(d));
    proc.on('error', reject);
    proc.on('close', (code) => {
      const out = Buffer.concat(chunks).toString('utf8');
      const err = Buffer.concat(errChunks).toString('utf8');
      let report = tryParsePlaywrightJson(out);
      if (!report) {
        report = {
          parseError: true,
          stdout: out.slice(0, 8000),
          stderr: err.slice(0, 8000),
        };
      }
      resolve({ code, report, stderr: err, stdoutFull: out });
    });
  });

  await delay(800);

  const report = json.report;
  if (!report || report.parseError || !Array.isArray(report.suites)) {
    const stepResults = (checklistSteps || []).map((step) => ({
      stepId: step.id,
      title: step.title,
      status: 'failed',
      ok: false,
      durationMs: 0,
      error: 'Не удалось разобрать JSON-отчёт Playwright',
      videoRelative: null,
      screenshotRelative: null,
      smtpLogRelative: null,
      smtpLogText: null,
      tests: [],
      summary: { expected: 0, unexpected: 1, skipped: 0 },
    }));
    return {
      exitCode: json.code,
      stderr: json.stderr,
      stdoutFull: json.stdoutFull,
      rawReport: report,
      stepResults,
    };
  }

  const flat = flattenReportSpecs(report);
  const stepResults = mapBundleStepResults(root, flat, checklistSteps);
  fillBundleVideoFallback(stepResults);
  await fillBundleVideoFromGlob(root, stepResults);
  return {
    exitCode: json.code,
    stderr: json.stderr,
    stdoutFull: json.stdoutFull,
    rawReport: report,
    stepResults,
  };
}
