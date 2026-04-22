import express from 'express';
import cors from 'cors';
import { config as loadEnv } from 'dotenv';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { nanoid } from 'nanoid';
import { checkCorpNetwork } from './network-check.mjs';
import { runPlaywrightSpec, runPlaywrightBundle } from './runner.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
loadEnv({ path: path.join(ROOT, '.env') });
const CHECKLISTS_DIR = path.join(ROOT, 'checklists');
const HISTORY_DIR = path.join(ROOT, 'history');
const RECORDINGS_DIR = path.join(ROOT, 'recordings');

const PORT = Number(process.env.PORT || 5174);

async function ensureDirs() {
  await fs.mkdir(HISTORY_DIR, { recursive: true });
  await fs.mkdir(RECORDINGS_DIR, { recursive: true });
}

async function loadChecklists() {
  const names = await fs.readdir(CHECKLISTS_DIR).catch(() => []);
  const out = [];
  for (const n of names) {
    if (!n.endsWith('.json')) continue;
    const raw = await fs.readFile(path.join(CHECKLISTS_DIR, n), 'utf8');
    out.push(JSON.parse(raw));
  }
  return out;
}

async function getChecklist(id) {
  const all = await loadChecklists();
  return all.find((c) => c.id === id) || null;
}

const app = express();
app.use(cors({ origin: true }));
app.use(express.json({ limit: '2mb' }));

app.use('/recordings', express.static(RECORDINGS_DIR));

const distPath = path.join(ROOT, 'dist');
app.use(express.static(distPath));

app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});

app.get('/api/network', async (_req, res) => {
  const r = await checkCorpNetwork();
  res.json(r);
});

app.get('/api/checklists', async (_req, res) => {
  try {
    const list = await loadChecklists();
    res.json(
      list.map((c) => ({
        id: c.id,
        name: c.name,
        description: c.description,
        steps: (c.steps || []).map((s) => ({
          id: s.id,
          title: s.title,
          hideVideo: s.hideVideo === true,
          substeps: Array.isArray(s.substeps) ? s.substeps : undefined,
        })),
      })),
    );
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

app.get('/api/checklists/:id', async (req, res) => {
  const c = await getChecklist(req.params.id);
  if (!c) return res.status(404).json({ error: 'not found' });
  res.json(c);
});

app.get('/api/history', async (_req, res) => {
  const files = await fs.readdir(HISTORY_DIR).catch(() => []);
  const items = [];
  for (const f of files) {
    if (!f.endsWith('.json')) continue;
    try {
      const raw = await fs.readFile(path.join(HISTORY_DIR, f), 'utf8');
      const j = JSON.parse(raw);
      items.push({
        runId: j.runId,
        checklistId: j.checklistId,
        checklistName: j.checklistName,
        startedAt: j.startedAt,
        finishedAt: j.finishedAt,
        ok: j.ok,
        steps: (j.steps || []).map((s) => ({
          stepId: s.stepId,
          title: s.title,
          status: s.status || (s.ok ? 'passed' : 'failed'),
          ok: s.ok,
          durationMs: s.durationMs,
        })),
      });
    } catch {
      /* skip */
    }
  }
  items.sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt)));
  res.json(items);
});

app.get('/api/history/:runId', async (req, res) => {
  try {
    const raw = await fs.readFile(
      path.join(HISTORY_DIR, `${req.params.runId}.json`),
      'utf8',
    );
    res.json(JSON.parse(raw));
  } catch {
    res.status(404).json({ error: 'not found' });
  }
});

app.post('/api/run', async (req, res) => {
  const net = await checkCorpNetwork();
  if (!net.ok) {
    return res.status(403).json({
      error: 'network',
      message:
        'Запуск возможен только при доступе к корпоративной сети (CRM недоступен).',
      detail: net,
    });
  }

  const checklistId = req.body?.checklistId;
  if (!checklistId) {
    return res.status(400).json({ error: 'checklistId required' });
  }

  const checklist = await getChecklist(checklistId);
  if (!checklist) {
    return res.status(404).json({ error: 'checklist not found' });
  }

  const steps = checklist.steps || [];

  const runId = nanoid(12);
  const runDir = path.join(RECORDINGS_DIR, runId);
  await fs.mkdir(runDir, { recursive: true });

  const startedAt = new Date().toISOString();
  const stepsOut = [];
  let allOk = true;

  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
  res.setHeader('Transfer-Encoding', 'chunked');
  res.flushHeaders?.();

  const writeEvent = (obj) => {
    res.write(`${JSON.stringify(obj)}\n`);
  };

  writeEvent({
    type: 'run_start',
    runId,
    checklistId,
    startedAt,
    totalSteps: steps.length,
  });

  try {
    async function finalizeStep(step, result) {
      const optionalSkip =
        step.optional === true && String(result.status || '') === 'skipped';
      const stepOk = !!result.ok || optionalSkip;
      if (!stepOk) allOk = false;

      let publicVideo = null;
      if (result.videoRelative) {
        const abs = path.isAbsolute(result.videoRelative)
          ? result.videoRelative
          : path.join(ROOT, result.videoRelative);
        const destName = `${step.id}.webm`;
        const dest = path.join(runDir, destName);
        try {
          await fs.copyFile(abs, dest);
          const st = await fs.stat(dest);
          if (st.size >= 32) publicVideo = `/recordings/${runId}/${destName}`;
        } catch {
          publicVideo = null;
        }
      }

      let publicScreenshot = null;
      if (result.screenshotRelative) {
        const abs = path.isAbsolute(result.screenshotRelative)
          ? result.screenshotRelative
          : path.join(ROOT, result.screenshotRelative);
        const destName = `${step.id}.png`;
        const dest = path.join(runDir, destName);
        try {
          await fs.copyFile(abs, dest);
          publicScreenshot = `/recordings/${runId}/${destName}`;
        } catch {
          publicScreenshot = null;
        }
      }

      const logName = `${step.id}.log`;
      const logPath = path.join(runDir, logName);
      let logBody = buildStepLog(result);
      let publicSmtpLog = null;
      let smtpContent = null;
      if (
        typeof result.smtpLogText === 'string' &&
        result.smtpLogText.trim().length
      ) {
        smtpContent = result.smtpLogText;
      } else if (result.smtpLogRelative) {
        try {
          const abs = path.isAbsolute(result.smtpLogRelative)
            ? result.smtpLogRelative
            : path.join(ROOT, result.smtpLogRelative);
          smtpContent = await fs.readFile(abs, 'utf8');
        } catch (e) {
          logBody += `\n\n--- smtp.log (не прочитан) ---\n${
            e instanceof Error ? e.message : String(e)
          }`;
        }
      }
      if (smtpContent != null && smtpContent.length >= 1) {
        logBody += `\n\n--- smtp.log (шаг почты) ---\n\n${smtpContent}`;
        const smtpName = `${step.id}-smtp.log`;
        const smtpPath = path.join(runDir, smtpName);
        try {
          await fs.writeFile(smtpPath, smtpContent, 'utf8');
          const stSmtp = await fs.stat(smtpPath);
          if (stSmtp.size >= 1) {
            publicSmtpLog = `/recordings/${runId}/${smtpName}`;
          }
        } catch (e) {
          logBody += `\n\n--- smtp.log (не записан) ---\n${
            e instanceof Error ? e.message : String(e)
          }`;
        }
      }
      await fs.writeFile(logPath, logBody, 'utf8');
      const publicLog = `/recordings/${runId}/${logName}`;

      const skipped = result.tests?.filter((t) => t.status === 'skipped') || [];
      const errMsg = optionalSkip
        ? null
        : result.status !== 'passed'
          ? result.tests?.find((t) => t.error)?.error ||
            (skipped.length
              ? `skipped: ${skipped.map((t) => t.title).join(', ')}`
              : null) ||
            result.stderr?.slice(0, 4000) ||
            `status: ${result.status}`
          : null;

      return {
        stepId: step.id,
        title: step.title,
        status: result.status,
        ok: stepOk,
        exitCode: result.exitCode,
        durationMs: result.durationMs,
        videoUrl: publicVideo,
        screenshotUrl: publicScreenshot,
        logUrl: publicLog,
        smtpLogUrl: publicSmtpLog,
        hideVideo: step.hideVideo === true,
        substeps: Array.isArray(step.substeps) ? step.substeps : undefined,
        tests: result.tests,
        summary: result.summary,
        error: shortUiError(errMsg),
      };
    }

    if (checklist.specBundle) {
      const bundle = await runPlaywrightBundle(ROOT, checklist.specBundle, steps);
      for (const step of steps) {
        writeEvent({
          type: 'step_start',
          stepId: step.id,
          title: step.title,
        });
        const sr = bundle.stepResults.find((r) => r.stepId === step.id);
        const result = sr
          ? {
              exitCode: bundle.exitCode,
              stderr: bundle.stderr,
              stdoutFull: bundle.stdoutFull,
              ok: sr.ok,
              status: sr.status,
              durationMs: sr.durationMs,
              tests: sr.tests,
              summary: sr.summary,
              videoRelative: sr.videoRelative,
              screenshotRelative: sr.screenshotRelative,
              smtpLogRelative: sr.smtpLogRelative ?? null,
              smtpLogText: sr.smtpLogText ?? null,
            }
          : {
              exitCode: 1,
              stderr: bundle.stderr,
              stdoutFull: bundle.stdoutFull,
              ok: false,
              status: 'failed',
              durationMs: 0,
              tests: [],
              summary: { expected: 0, unexpected: 1, skipped: 0 },
              videoRelative: null,
              screenshotRelative: null,
              smtpLogRelative: null,
              smtpLogText: null,
            };
        const stepRecord = await finalizeStep(step, result);
        stepsOut.push(stepRecord);
        writeEvent({ type: 'step_done', runId, ...stepRecord });
      }
    } else {
      for (const step of steps) {
        const specFile = step.specFile || `${step.id}.spec.ts`;
        const specRel = path.join('e2e', 'steps', specFile);
        writeEvent({
          type: 'step_start',
          stepId: step.id,
          title: step.title,
        });
        const result = await runPlaywrightSpec(ROOT, specRel);
        const stepRecord = await finalizeStep(step, result);
        stepsOut.push(stepRecord);
        writeEvent({ type: 'step_done', runId, ...stepRecord });
      }
    }

    const finishedAt = new Date().toISOString();
    const record = {
      runId,
      checklistId: checklist.id,
      checklistName: checklist.name,
      startedAt,
      finishedAt,
      ok: allOk,
      steps: stepsOut,
    };
    await fs.writeFile(
      path.join(HISTORY_DIR, `${runId}.json`),
      JSON.stringify(record, null, 2),
      'utf8',
    );

    writeEvent({ type: 'run_done', runId, ok: allOk, finishedAt });
  } catch (e) {
    writeEvent({
      type: 'run_error',
      message: e instanceof Error ? e.message : String(e),
    });
  } finally {
    res.end();
  }
});

function truncateText(s, max) {
  if (!s) return '';
  const t = String(s);
  if (t.length <= max) return t;
  return `${t.slice(0, max - 20)}\n… [ещё ${t.length - max + 20} символов]`;
}

/** Короткая строка для UI и NDJSON (без километра stack trace). */
function shortUiError(full) {
  if (!full) return null;
  const s = String(full).trim();
  const head = s.split(/\n\s+at\s+/)[0].trim();
  const max = 480;
  return head.length > max ? `${head.slice(0, max - 1)}…` : head;
}

function tryParsePlaywrightJson(out) {
  if (!out || typeof out !== 'string') return null;
  try {
    return JSON.parse(out);
  } catch {
    /* continue */
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

function collectPlaywrightDigest(report) {
  const rows = [];
  function walk(suite, prefix) {
    const seg = [prefix, suite.title].filter(Boolean).join(' › ');
    for (const spec of suite.specs || []) {
      for (const t of spec.tests || []) {
        const tr = (t.results && t.results[t.results.length - 1]) || {};
        const err =
          tr.error?.message ||
          tr.errors?.[0]?.message ||
          (Array.isArray(tr.errors) && tr.errors[0]?.message);
        rows.push({
          title: String(spec.title || ''),
          suite: seg,
          status: String(tr.status || 'unknown'),
          durationMs: tr.duration,
          error: err ? String(err) : null,
        });
      }
    }
    for (const ch of suite.suites || []) walk(ch, seg);
  }
  for (const s of report.suites || []) walk(s, '');
  return rows;
}

/** Читаемый лог файла: сценарий → сводка → stderr → краткий разбор JSON (без мегабайт stdout). */
function buildStepLog(result) {
  const durS = Math.round((result.durationMs ?? 0) / 1000);
  const lines = [
    '# Отчёт по шагу (читаемый)',
    '',
    '## Итог',
    `- Статус шага: ${result.status}`,
    `- Код выхода Playwright: ${result.exitCode}`,
    `- Длительность: ${durS} с`,
    '',
  ];

  const tests = result.tests || [];
  if (tests.length) {
    lines.push('## Тесты (как в UI чек-листа)');
    for (const t of tests) {
      const sym =
        t.status === 'passed' ? '✓' : t.status === 'skipped' ? '⊘' : '✗';
      const sec =
        typeof t.duration === 'number'
          ? ` ~${Math.round(t.duration / 1000)} с`
          : '';
      lines.push(`- ${sym} ${t.title} — ${t.status}${sec}`);
      if (t.suite) lines.push(`  сьют: ${t.suite}`);
      if (t.error) {
        const one = String(t.error).split(/\n\s+at\s+/)[0].trim();
        lines.push(`  суть ошибки: ${truncateText(one, 700)}`);
      }
    }
    lines.push('');
  }

  const stderr = (result.stderr || '').trim();
  lines.push('## Stderr');
  lines.push(stderr ? truncateText(stderr, 8000) : '(пусто)');
  lines.push('');

  const primaryErr =
    tests.find((t) => t.error)?.error ||
    (stderr ? stderr.split('\n')[0] : null);
  if (primaryErr) {
    lines.push('## Ошибка (полный текст, если была)');
    lines.push(String(primaryErr).trim());
    lines.push('');
  }

  const parsed = tryParsePlaywrightJson(result.stdoutFull || '');
  lines.push('## Сводка из JSON-отчёта Playwright');
  if (parsed?.stats) {
    lines.push(`- expected: ${parsed.stats.expected ?? '?'}`);
    lines.push(`- unexpected: ${parsed.stats.unexpected ?? '?'}`);
    lines.push(`- skipped: ${parsed.stats.skipped ?? '?'}`);
    lines.push(`- duration (report): ${Math.round((parsed.stats.duration ?? 0) / 1000)} с`);
    lines.push('');
  }
  if (parsed?.suites?.length) {
    const digest = collectPlaywrightDigest(parsed).slice(0, 50);
    for (const r of digest) {
      const sym =
        r.status === 'passed' ? '✓' : r.status === 'skipped' ? '⊘' : '✗';
      const path = r.suite ? `${r.suite} › ${r.title}` : r.title;
      lines.push(`- ${sym} [${r.status}] ${path}`);
      if (r.error) {
        const one = String(r.error).split(/\n\s+at\s+/)[0].trim();
        lines.push(`    ${truncateText(one, 500)}`);
      }
    }
  } else {
    lines.push(
      '(JSON из stdout не разобран — ниже только начало сырого вывода.)',
    );
    lines.push(truncateText(result.stdoutFull || '', 14_000));
  }
  lines.push('');
  lines.push(
    '---\nПодсказка: развёрнутый сырой вывод при падении смотрите в артефактах Playwright (test-results / playwright-report), здесь намеренно без мегабайт JSON.',
  );
  lines.push('');
  return lines.join('\n');
}

await ensureDirs();

app.listen(PORT, '127.0.0.1', () => {
  console.log(`AutoSasest API http://127.0.0.1:${PORT}`);
});
