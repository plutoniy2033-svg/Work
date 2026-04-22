import { useCallback, useEffect, useMemo, useState } from 'react';

type ChecklistSubstep = { title: string };

type ChecklistStepMeta = {
  id: string;
  title: string;
  hideVideo?: boolean;
  substeps?: ChecklistSubstep[];
};

type ChecklistMeta = {
  id: string;
  name: string;
  description?: string;
  steps: ChecklistStepMeta[];
};

type NetProbe = {
  name: string;
  path?: string;
  statusCode?: number;
  via?: string;
  error?: string;
  note?: string;
};

type NetworkState =
  | { loading: true }
  | {
      loading: false;
      ok: boolean;
      host?: string;
      reason?: string;
      dnsOk?: boolean;
      probes?: NetProbe[];
      note?: string;
    };

type StepUiStatus = 'pending' | 'running' | 'passed' | 'failed' | 'skipped';

type StepRow = {
  id: string;
  title: string;
  status: StepUiStatus;
  durationMs?: number;
  /** Для подсказки подшагов во время running */
  startedAt?: number;
  hideVideo?: boolean;
  substeps?: ChecklistSubstep[];
  videoUrl: string | null;
  screenshotUrl: string | null;
  logUrl: string | null;
  /** Только шаг с вложением smtp.log (напр. 05-email-to-case) */
  smtpLogUrl: string | null;
  error: string | null;
};

type HistoryStepBrief = {
  stepId: string;
  title: string;
  status: string;
  ok: boolean;
  durationMs?: number;
};

type HistoryItem = {
  runId: string;
  checklistId: string;
  checklistName: string;
  startedAt: string;
  finishedAt?: string;
  ok: boolean;
  steps?: HistoryStepBrief[];
};

type RunDetail = HistoryItem & {
  steps: {
    stepId: string;
    title: string;
    status?: string;
    ok: boolean;
    durationMs?: number;
    videoUrl: string | null;
    screenshotUrl?: string | null;
    logUrl?: string | null;
    smtpLogUrl?: string | null;
    hideVideo?: boolean;
    substeps?: ChecklistSubstep[];
    error: string | null;
  }[];
};

/** Грубая оценка «текущего» подшага по времени (без стриминга из Playwright). */
const SUBSTEP_HINT_MS = 14_000;

function activeSubstepIndex(
  status: StepUiStatus,
  subCount: number,
  startedAt?: number,
): number {
  if (subCount <= 0) return -1;
  if (status === 'passed' || status === 'skipped') return subCount - 1;
  if (status === 'failed') return Math.max(0, subCount - 1);
  if (status !== 'running' || !startedAt) return -1;
  const elapsed = Date.now() - startedAt;
  return Math.min(subCount - 1, Math.floor(elapsed / SUBSTEP_HINT_MS));
}

const api = (path: string) =>
  import.meta.env.VITE_API_URL
    ? `${import.meta.env.VITE_API_URL.replace(/\/$/, '')}${path}`
    : path;

/** Старые прогоны могли отдавать длинный error — в карточке шага не раздуваем. */
function truncateDisplay(s: string, max: number) {
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1)}…`;
}

type LogModalState = {
  stepTitle: string;
  tab: 'main' | 'smtp';
  mainUrl: string | null;
  smtpUrl: string | null;
  mainText: string;
  smtpText: string;
  loading: boolean;
  fetchErr: string | null;
};

async function readNdjsonStream(
  res: Response,
  onLine: (obj: Record<string, unknown>) => void,
) {
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let buf = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const parts = buf.split('\n');
    buf = parts.pop() ?? '';
    for (const line of parts) {
      const t = line.trim();
      if (!t) continue;
      try {
        onLine(JSON.parse(t) as Record<string, unknown>);
      } catch {
        /* ignore */
      }
    }
  }
  const tail = buf.trim();
  if (tail) {
    try {
      onLine(JSON.parse(tail) as Record<string, unknown>);
    } catch {
      /* ignore */
    }
  }
}

export default function App() {
  const [lists, setLists] = useState<ChecklistMeta[]>([]);
  const [selectedId, setSelectedId] = useState<string>('');
  const [net, setNet] = useState<NetworkState>({ loading: true });
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [detail, setDetail] = useState<RunDetail | null>(null);
  const [steps, setSteps] = useState<StepRow[]>([]);
  const [videoSrc, setVideoSrc] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [logErr, setLogErr] = useState<string | null>(null);
  const [runTick, setRunTick] = useState(0);
  const [logModal, setLogModal] = useState<LogModalState | null>(null);

  const closeLogModal = useCallback(() => setLogModal(null), []);

  const openLogModal = useCallback(
    async (
      stepTitle: string,
      mainUrl: string | null,
      smtpUrl: string | null,
    ) => {
      if (!mainUrl && !smtpUrl) return;
      const tab: 'main' | 'smtp' = mainUrl ? 'main' : 'smtp';
      setLogModal({
        stepTitle,
        tab,
        mainUrl,
        smtpUrl,
        mainText: '',
        smtpText: '',
        loading: true,
        fetchErr: null,
      });
      try {
        const [mainText, smtpText] = await Promise.all([
          mainUrl
            ? fetch(api(mainUrl)).then((r) =>
                r.ok ? r.text() : Promise.reject(new Error(`HTTP ${r.status}`)),
              )
            : Promise.resolve(''),
          smtpUrl
            ? fetch(api(smtpUrl)).then((r) =>
                r.ok ? r.text() : Promise.reject(new Error(`SMTP HTTP ${r.status}`)),
              )
            : Promise.resolve(''),
        ]);
        setLogModal((prev) =>
          prev && prev.loading
            ? { ...prev, mainText, smtpText, loading: false }
            : prev,
        );
      } catch (e) {
        setLogModal((prev) =>
          prev
            ? {
                ...prev,
                loading: false,
                fetchErr: e instanceof Error ? e.message : String(e),
              }
            : prev,
        );
      }
    },
    [],
  );

  useEffect(() => {
    if (!logModal) return;
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeLogModal();
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [logModal, closeLogModal]);

  const selected = useMemo(
    () => lists.find((l) => l.id === selectedId) ?? null,
    [lists, selectedId],
  );

  const hasVideoableSteps = useMemo(
    () => selected?.steps?.some((st) => st.hideVideo !== true) ?? true,
    [selected],
  );

  const runProgressPct = useMemo(() => {
    void runTick;
    const n = steps.length;
    if (!n) return 0;
    let done = 0;
    for (const s of steps) {
      if (
        s.status === 'passed' ||
        s.status === 'failed' ||
        s.status === 'skipped'
      ) {
        done++;
      }
    }
    const hasRun = steps.some((s) => s.status === 'running');
    const frac = done / n + (hasRun ? 0.35 / n : 0);
    return Math.min(100, Math.round(frac * 100));
  }, [steps, runTick]);

  const refreshNet = useCallback(async () => {
    try {
      const r = await fetch(api('/api/network'));
      const j = (await r.json()) as {
        ok: boolean;
        host?: string;
        reason?: string;
        dnsOk?: boolean;
        probes?: NetProbe[];
        note?: string;
      };
      setNet({
        loading: false,
        ok: j.ok,
        host: j.host,
        reason: j.reason,
        dnsOk: j.dnsOk,
        probes: j.probes,
        note: j.note,
      });
    } catch {
      setNet({
        loading: false,
        ok: false,
        reason: 'API недоступен (запустите npm run dev:api)',
      });
    }
  }, []);

  const refreshHistory = useCallback(async () => {
    try {
      const r = await fetch(api('/api/history'));
      setHistory((await r.json()) as HistoryItem[]);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        const r = await fetch(api('/api/checklists'));
        const data = (await r.json()) as ChecklistMeta[];
        setLists(data);
        setSelectedId((prev) => prev || data[0]?.id || '');
      } catch {
        setLogErr('Не удалось загрузить чек-листы');
      }
    })();
  }, []);

  useEffect(() => {
    void refreshNet();
    const t = setInterval(() => void refreshNet(), 30_000);
    return () => clearInterval(t);
  }, [refreshNet]);

  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => setRunTick((n) => n + 1), 450);
    return () => window.clearInterval(id);
  }, [running]);

  useEffect(() => {
    void refreshHistory();
  }, [refreshHistory]);

  useEffect(() => {
    if (!selected) {
      setSteps([]);
      return;
    }
    setSteps(
      selected.steps.map((s) => ({
        id: s.id,
        title: s.title,
        status: 'pending' as StepUiStatus,
        hideVideo: s.hideVideo === true,
        substeps: s.substeps?.length ? [...s.substeps] : undefined,
        videoUrl: null,
        screenshotUrl: null,
        logUrl: null,
        smtpLogUrl: null,
        error: null,
      })),
    );
    setVideoSrc(null);
  }, [selected]);

  const run = async () => {
    if (!selectedId || running) return;
    setRunning(true);
    setLogErr(null);
    setVideoSrc(null);
    setSteps((prev) =>
      prev.map((s) => ({
        ...s,
        status: 'pending',
        videoUrl: null,
        screenshotUrl: null,
        logUrl: null,
        smtpLogUrl: null,
        error: null,
        startedAt: undefined,
      })),
    );

    let res: Response;
    try {
      res = await fetch(api('/api/run'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ checklistId: selectedId }),
      });
    } catch (e) {
      setRunning(false);
      setLogErr(e instanceof Error ? e.message : String(e));
      return;
    }

    if (!res.ok) {
      setRunning(false);
      try {
        const j = (await res.json()) as { message?: string; detail?: unknown };
        setLogErr(
          j.message ||
            `Ошибка ${res.status}: ${JSON.stringify(j.detail ?? j)}`,
        );
      } catch {
        setLogErr(`HTTP ${res.status}`);
      }
      return;
    }

    await readNdjsonStream(res, (ev) => {
      const type = ev.type as string | undefined;
      if (type === 'step_start') {
        const sid = ev.stepId as string;
        const t0 = Date.now();
        setSteps((prev) =>
          prev.map((s) =>
            s.id === sid
              ? { ...s, status: 'running', error: null, startedAt: t0 }
              : { ...s, status: s.status === 'running' ? 'pending' : s.status },
          ),
        );
      }
      if (type === 'step_done') {
        const sid = ev.stepId as string;
        const st = (ev.status as string) || ((ev.ok as boolean) ? 'passed' : 'failed');
        const ui: StepUiStatus =
          st === 'passed'
            ? 'passed'
            : st === 'skipped'
              ? 'skipped'
              : 'failed';
        const v = (ev.videoUrl as string) || null;
        const png = (ev.screenshotUrl as string) || null;
        const log = (ev.logUrl as string) || null;
        const smtpLog = (ev.smtpLogUrl as string) || null;
        const hideV = (ev.hideVideo as boolean) === true;
        const err = (ev.error as string) || null;
        const durationMs = typeof ev.durationMs === 'number' ? ev.durationMs : undefined;
        setSteps((prev) =>
          prev.map((s) =>
            s.id === sid
              ? {
                  ...s,
                  status: ui,
                  durationMs,
                  videoUrl: v,
                  screenshotUrl: png,
                  logUrl: log,
                  smtpLogUrl: smtpLog,
                  hideVideo: Boolean(hideV || s.hideVideo),
                  startedAt: undefined,
                  error: err,
                }
              : s,
          ),
        );
        if (v && !hideV) setVideoSrc(v);
      }
      if (type === 'run_done') {
        void refreshHistory();
      }
      if (type === 'run_error') {
        setLogErr(String(ev.message ?? 'run_error'));
      }
    });

    setRunning(false);
    void refreshHistory();
  };

  const openHistoryRow = async (runId: string) => {
    try {
      const r = await fetch(api(`/api/history/${runId}`));
      if (!r.ok) return;
      const d = (await r.json()) as RunDetail;
      setDetail(d);
      const firstVid =
        d.steps?.find((s) => s.videoUrl && !s.hideVideo)?.videoUrl ?? null;
      setVideoSrc(firstVid);
    } catch {
      /* ignore */
    }
  };

  const netLabel = net.loading
    ? 'Сеть: …'
    : net.ok
      ? (() => {
          const bits =
            net.probes?.map((p) =>
              p.error != null ? `${p.name}:×` : `${p.name}:${p.statusCode}`,
            ) ?? [];
          const tail = bits.length ? ` · ${bits.join(', ')}` : '';
          return `Сеть: OK · ${net.host ?? ''}${tail}`;
        })()
      : `Нет доступа к CRM · ${net.reason ?? ''}`;

  const netTitle =
    !net.loading && net.note
      ? net.note
      : !net.loading && net.ok && net.probes?.length
        ? net.probes
            .map(
              (p) =>
                `${p.name} ${p.path ?? ''} → ${p.error ?? p.statusCode ?? '?'}`,
            )
            .join('\n')
        : undefined;

  return (
    <div className="layout">
      <header className="top">
        <h1>AutoSasest · Creatio</h1>
        <span
          className={`net-pill ${net.loading ? '' : net.ok ? 'ok' : 'bad'}`}
          title={netTitle}
        >
          {netLabel}
        </span>
      </header>

      <div className="grid grid-main">
        <div className="panel">
          <h2>Чек-лист</h2>
          <div className="toolbar">
            <select
              value={selectedId}
              onChange={(e) => setSelectedId(e.target.value)}
              disabled={running}
            >
              {lists.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="primary"
              onClick={() => void run()}
              disabled={running || !selectedId || net.loading}
            >
              {running ? 'Выполняется…' : 'Запустить'}
            </button>
          </div>
          {!net.loading && net.ok === false && (
            <p className="err" style={{ marginTop: '0.35rem', marginBottom: 0 }}>
              CRM по сети недоступен — «Запустить» вернёт 403, пока нет VPN. Для
              локальной отладки без корп. сети добавьте в{' '}
              <span className="mono">AutoSasest/.env</span> переменную{' '}
              <span className="mono">AUTOSASEST_SKIP_CORP_NETWORK=1</span> и
              перезапустите <span className="mono">npm run dev:api</span> (или{' '}
              <span className="mono">npm start</span>).
            </p>
          )}
          {selected?.description && (
            <p className="mono" style={{ marginTop: 0 }}>
              {selected.description}
            </p>
          )}
          {steps.length > 0 && (
            <div className="run-progress" aria-label="Прогресс чек-листа">
              <div
                className="run-progress-bar"
                style={{ width: `${runProgressPct}%` }}
              />
              <span className="run-progress-label">{runProgressPct}%</span>
            </div>
          )}
          <ul className="steps">
            {steps.map((s) => (
              <li key={s.id}>
                <span
                  className={`badge ${
                    s.status === 'passed'
                      ? 'ok'
                      : s.status === 'failed'
                        ? 'fail'
                        : s.status === 'skipped'
                          ? 'skip'
                          : s.status === 'running'
                            ? 'run'
                            : 'pending'
                  }`}
                >
                  {s.status === 'passed'
                    ? 'ok'
                    : s.status === 'failed'
                      ? 'fail'
                      : s.status === 'skipped'
                        ? 'skip'
                        : s.status === 'running'
                          ? '…'
                          : '—'}
                </span>
                <div>
                  <div>{s.title}</div>
                  {s.durationMs != null && s.durationMs > 0 && (
                    <div className="step-meta">
                      длительность шага (Playwright): ~{Math.round(s.durationMs / 1000)} с
                    </div>
                  )}
                  {s.error && (
                    <div className="err">{truncateDisplay(s.error, 960)}</div>
                  )}
                  {s.substeps && s.substeps.length > 0 && (
                    <ul className="substeps">
                      {s.substeps.map((sub, i) => {
                        const cur = activeSubstepIndex(
                          s.status,
                          s.substeps!.length,
                          s.startedAt,
                        );
                        let subCls = 'sub-pending';
                        if (s.status === 'passed' || s.status === 'skipped') {
                          subCls = 'sub-done';
                        } else if (s.status === 'failed') {
                          subCls = 'sub-bad';
                        } else if (s.status === 'running') {
                          if (i < cur) subCls = 'sub-done';
                          else if (i === cur) subCls = 'sub-run';
                        }
                        return (
                          <li key={`${s.id}-sub-${i}`} className={subCls}>
                            {sub.title}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                  <div className="step-links">
                    {s.videoUrl && !s.hideVideo && (
                      <button
                        type="button"
                        className="linkish"
                        onClick={() => setVideoSrc(s.videoUrl)}
                      >
                        Видео
                      </button>
                    )}
                    {s.screenshotUrl && (
                      <a
                        href={api(s.screenshotUrl)}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Скриншот
                      </a>
                    )}
                    {(s.logUrl || s.smtpLogUrl) && (
                      <>
                        <button
                          type="button"
                          className="linkish"
                          onClick={() =>
                            void openLogModal(s.title, s.logUrl, s.smtpLogUrl)
                          }
                        >
                          Лог
                        </button>
                        {s.logUrl && (
                          <a
                            className="log-file-link"
                            href={api(s.logUrl)}
                            target="_blank"
                            rel="noreferrer"
                            title="Сырой файл в новой вкладке"
                          >
                            ↗
                          </a>
                        )}
                      </>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ul>
          {logErr && <div className="err">{logErr}</div>}
        </div>

        <div className="panel">
          <h2>Запись экрана (по шагам)</h2>
          {!hasVideoableSteps ? (
            <div className="video-placeholder">
              Для этого чек-листа запись браузера не используется (только SMTP /
              API).
            </div>
          ) : (
            <div className="video-wrap">
              {videoSrc ? (
                <video
                  key={videoSrc}
                  src={api(videoSrc)}
                  controls
                  playsInline
                />
              ) : (
                <div className="video-placeholder">
                  Нажмите «Видео» у шага с записью экрана. Шаги только с SMTP — см.
                  «Лог SMTP».
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="grid" style={{ marginTop: '1rem' }}>
        <div className="panel">
          <h2>История прогонов</h2>
          <table className="history-table">
            <thead>
              <tr>
                <th>Время</th>
                <th>Чек-лист</th>
                <th>Шаги</th>
                <th>Итог</th>
              </tr>
            </thead>
            <tbody>
              {history.map((h) => (
                <tr key={h.runId} onClick={() => void openHistoryRow(h.runId)}>
                  <td className="mono">{h.startedAt?.replace('T', ' ')}</td>
                  <td>{h.checklistName}</td>
                  <td onClick={(e) => e.stopPropagation()}>
                    <div className="hist-steps">
                      {(h.steps || []).map((st, i) => {
                        const raw =
                          st.status ||
                          (st.ok ? 'passed' : 'failed');
                        const cls =
                          raw === 'passed'
                            ? 'passed'
                            : raw === 'skipped'
                              ? 'skipped'
                              : 'failed';
                        const sym =
                          raw === 'skipped'
                            ? '⊘'
                            : raw === 'passed'
                              ? '✓'
                              : '✗';
                        return (
                          <span
                            key={st.stepId}
                            className={`hist-step ${cls}`}
                            title={`${i + 1}. ${st.title} (${raw})`}
                          >
                            {sym}
                          </span>
                        );
                      })}
                    </div>
                  </td>
                  <td>
                    <span className={`badge ${h.ok ? 'ok' : 'fail'}`}>
                      {h.ok ? 'ok' : 'fail'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {detail && (
          <div className="panel">
            <h2>Детали · {detail.runId}</h2>
            <p className="mono" style={{ marginTop: 0 }}>
              {detail.checklistName} · {detail.startedAt}
            </p>
            <ul className="steps">
              {detail.steps?.map((s) => {
                const st = s.status || (s.ok ? 'passed' : 'failed');
                const badge =
                  st === 'passed'
                    ? 'ok'
                    : st === 'skipped'
                      ? 'skip'
                      : 'fail';
                const label =
                  st === 'passed' ? 'ok' : st === 'skipped' ? 'skip' : 'fail';
                return (
                  <li key={s.stepId}>
                    <span className={`badge ${badge}`}>{label}</span>
                    <div>
                      <div>{s.title}</div>
                      {s.durationMs != null && s.durationMs > 0 && (
                        <div className="step-meta">
                          ~{Math.round(s.durationMs / 1000)} с
                        </div>
                      )}
                      {s.error && (
                        <div className="err">
                          {truncateDisplay(s.error, 960)}
                        </div>
                      )}
                      {s.substeps && s.substeps.length > 0 && (
                        <ul className="substeps">
                          {s.substeps.map((sub, i) => {
                            const stt =
                              (s.status as StepUiStatus) ||
                              (s.ok ? 'passed' : 'failed');
                            const cur = activeSubstepIndex(
                              stt,
                              s.substeps!.length,
                              undefined,
                            );
                            let subCls = 'sub-pending';
                            if (stt === 'passed' || stt === 'skipped') {
                              subCls = 'sub-done';
                            } else if (stt === 'failed') {
                              subCls = 'sub-bad';
                            } else if (stt === 'running') {
                              if (i < cur) subCls = 'sub-done';
                              else if (i === cur) subCls = 'sub-run';
                            }
                            return (
                              <li key={`${s.stepId}-h-${i}`} className={subCls}>
                                {sub.title}
                              </li>
                            );
                          })}
                        </ul>
                      )}
                      <div className="step-links">
                        {s.videoUrl && !s.hideVideo && (
                          <button
                            type="button"
                            className="linkish"
                            onClick={(e) => {
                              e.stopPropagation();
                              setVideoSrc(s.videoUrl);
                            }}
                          >
                            Видео
                          </button>
                        )}
                        {s.screenshotUrl && (
                          <a
                            href={api(s.screenshotUrl)}
                            target="_blank"
                            rel="noreferrer"
                            onClick={(e) => e.stopPropagation()}
                          >
                            Скриншот
                          </a>
                        )}
                        {(s.logUrl || s.smtpLogUrl) && (
                          <>
                            <button
                              type="button"
                              className="linkish"
                              onClick={(e) => {
                                e.stopPropagation();
                                void openLogModal(
                                  s.title,
                                  s.logUrl ?? null,
                                  s.smtpLogUrl ?? null,
                                );
                              }}
                            >
                              Лог
                            </button>
                            {s.logUrl && (
                              <a
                                className="log-file-link"
                                href={api(s.logUrl)}
                                target="_blank"
                                rel="noreferrer"
                                title="Файл"
                                onClick={(e) => e.stopPropagation()}
                              >
                                ↗
                              </a>
                            )}
                          </>
                        )}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </div>

      {logModal && (
        <div
          className="log-modal-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="log-modal-title"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) closeLogModal();
          }}
        >
          <div className="log-modal">
            <div className="log-modal-head">
              <h3 id="log-modal-title">Лог · {logModal.stepTitle}</h3>
              <button type="button" className="log-modal-close" onClick={closeLogModal}>
                Закрыть
              </button>
            </div>
            {logModal.mainUrl && logModal.smtpUrl ? (
              <div className="log-modal-tabs">
                <button
                  type="button"
                  className={logModal.tab === 'main' ? 'active' : ''}
                  onClick={() =>
                    setLogModal((m) => (m ? { ...m, tab: 'main' } : m))
                  }
                >
                  Шаг
                </button>
                <button
                  type="button"
                  className={logModal.tab === 'smtp' ? 'active' : ''}
                  onClick={() =>
                    setLogModal((m) => (m ? { ...m, tab: 'smtp' } : m))
                  }
                >
                  SMTP
                </button>
              </div>
            ) : null}
            <div className="log-modal-body">
              {logModal.loading && <p className="muted">Загрузка…</p>}
              {logModal.fetchErr && (
                <p className="err">{logModal.fetchErr}</p>
              )}
              {!logModal.loading && !logModal.fetchErr && (
                <pre className="log-modal-pre">
                  {logModal.tab === 'smtp'
                    ? logModal.smtpText || '(нет текста SMTP)'
                    : logModal.mainText || '(нет основного лога)'}
                </pre>
              )}
            </div>
            <div className="log-modal-foot">
              {logModal.mainUrl && (
                <a href={api(logModal.mainUrl)} target="_blank" rel="noreferrer">
                  Открыть файл шага
                </a>
              )}
              {logModal.smtpUrl && (
                <a href={api(logModal.smtpUrl)} target="_blank" rel="noreferrer">
                  Открыть SMTP-файл
                </a>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
