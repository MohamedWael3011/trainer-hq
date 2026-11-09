import { useCallback, useEffect, useMemo, useState } from 'react';
import { LAB_DEVICE_SETS, LAB_PROTOCOL, LabJobStatus, LabLang, LabScheme, type LabLangType, type LabSchemeType } from '@shared/constants';
import type { LabStateType } from '@shared/types';
import Badge from '../../components/Badge/Badge';
import { renderIf } from '../../lib/renderIf';
import { BadgeTone } from '../../lib/format';
import './styles.css';

type PropsType = {
  auditorId?: string;
  auditorName?: string;
  onAudit: (creatureId: string, text: string) => void;
};

const REFRESH_MS = 4000;
const GALLERY_LIMIT = 60;

const shotUrl = (workspaceId: string, runId: string, shot: string): string =>
  `${LAB_PROTOCOL}://shots/${[workspaceId, runId, ...shot.split('/')].map(encodeURIComponent).join('/')}`;

const cleanError = (error: unknown): string => (error as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '');

const Lab = ({ auditorId, auditorName, onAudit }: PropsType) => {
  const [lab, setLab] = useState<LabStateType | null>(null);
  const [workspaceId, setWorkspaceId] = useState('');
  const [flow, setFlow] = useState('');
  const [devices, setDevices] = useState(LAB_DEVICE_SETS[0]);
  const [lang, setLang] = useState<LabLangType>(LabLang.EN);
  const [scheme, setScheme] = useState<LabSchemeType>(LabScheme.LIGHT);
  const [now, setNow] = useState<string | null>(null);
  const [tz, setTz] = useState<string | null>(null);
  const [runId, setRunId] = useState('');
  const [preview, setPreview] = useState<string | null>(null);
  const [example, setExample] = useState('');
  const [topic, setTopic] = useState('');
  const [ref, setRef] = useState('origin/master');
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    void window.hq.labState().then(setLab);
  }, []);

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, REFRESH_MS);
    const unsubscribe = window.hq.onLabChanged(refresh);
    return () => {
      clearInterval(timer);
      unsubscribe();
    };
  }, [refresh]);

  const workspace = lab?.workspaces.find((entry) => entry.id === workspaceId) ?? lab?.workspaces[0];
  const run = workspace?.runs.find((entry) => entry.id === runId) ?? workspace?.runs[0];
  const jobs = useMemo(() => (lab?.jobs ?? []).filter((job) => !workspace || job.workspaceId === workspace.id).slice(0, 4), [lab, workspace]);
  const activeFlow = flow && workspace?.flows.includes(flow) ? flow : workspace?.flows[0] ?? '';

  const act = useCallback(async (action: () => Promise<unknown>) => {
    setError(null);
    try {
      await action();
    } catch (failure) {
      setError(cleanError(failure));
    }
    refresh();
  }, [refresh]);

  const audit = useCallback((shot: string) => {
    if (!workspace || !run || !auditorId) return;
    const path = `${workspace.path}/${run.id}/${shot}`;
    onAudit(auditorId, `Audit this lab render against Figma: ${path}\n\nIt was rendered by the ${lab?.title ?? 'Lab'} render harness (workspace ${workspace.id}, ref ${workspace.ref} at ${workspace.commit}, run ${run.id}). Use the figma-audit skill with this PNG as the build screenshot. Ask me for the Figma frame link if you don't have it.`);
  }, [workspace, run, auditorId, onAudit, lab]);

  if (!lab) return <section className="lab"><p className="muted">Loading the lab…</p></section>;
  if (!lab.enabled) {
    return (
      <section className="lab">
        <h2>Lab</h2>
        <p className="muted">The Lab drives a render harness skill that screenshots your app's real screens with mocked data. Turn it on in Settings (or add a lab: block to profile.yaml) and point it at the harness folder and a workspace home.</p>
      </section>
    );
  }
  const clockValue = now ?? lab.now;
  const tzValue = tz ?? lab.tz;

  return (
    <section className="lab">
      <header className="lab-head">
        <div>
          <h2>{lab.title} lab</h2>
          <p className="muted">Real app screens rendered in headless Chrome by your render harness, across phones and foldables, languages and themes.</p>
        </div>
        {renderIf(!lab.skillReady, <Badge tone={BadgeTone.FAIL}>harness skill missing</Badge>)}
      </header>

      {renderIf(!!error, <p className="lab-error selectable">{error}</p>)}

      <div className="lab-grid">
        <div className="panel lab-card">
          <div className="eyebrow">Workspace</div>
          {renderIf(lab.workspaces.length === 0, <p className="faint">No workspaces in {lab.home} yet.</p>)}
          {renderIf(lab.workspaces.length > 0, (
            <select className="lab-select" value={workspace?.id ?? ''} onChange={(event) => setWorkspaceId(event.target.value)}>
              {lab.workspaces.map((entry) => <option key={entry.id} value={entry.id}>{entry.id}</option>)}
            </select>
          ))}
          {renderIf(!!workspace, workspace ? (
            <div className="lab-meta">
              <Badge>{workspace.ref || 'ref?'} · {workspace.commit}</Badge>
              <Badge tone={workspace.ready ? BadgeTone.DONE : BadgeTone.WAIT}>{workspace.ready ? 'ready' : 'building'}</Badge>
              <Badge tone={workspace.server.running ? BadgeTone.RUN : BadgeTone.NEUTRAL} dot>{workspace.server.running ? `server :${workspace.server.port}` : 'server stopped'}</Badge>
            </div>
          ) : null)}
          {renderIf(!!workspace, workspace ? (
            <div className="lab-actions">
              {renderIf(!workspace.server.running, <button className="btn primary sm" disabled={!workspace.ready} onClick={() => void act(() => window.hq.labStartServer(workspace.id))}>Start server</button>)}
              {renderIf(workspace.server.running, <button className="btn sm" onClick={() => void act(() => window.hq.labStopServer(workspace.id))}>Stop server</button>)}
              <button className="btn sm ghost" onClick={() => void window.hq.openPath(workspace.path)}>Open folder</button>
            </div>
          ) : null)}
          <details className="lab-new">
            <summary>New workspace</summary>
            <div className="lab-row">
              <input value={topic} onChange={(event) => setTopic(event.target.value)} placeholder="topic, e.g. reschedule" />
              <input value={ref} onChange={(event) => setRef(event.target.value)} placeholder="origin/master or a branch" spellCheck={false} />
              <button className="btn sm" disabled={!topic.trim()} onClick={() => void act(() => window.hq.labCreate(topic, ref))}>Build</button>
            </div>
            <p className="faint">About 10 minutes cold and 3.5 GB. Exports committed code only; your checkout is never touched.</p>
          </details>
        </div>

        <div className="panel lab-card">
          <div className="eyebrow">Shoot</div>
          {renderIf(!!workspace && workspace.flows.length === 0, <p className="faint">No scenarios yet. Import an example flow below.</p>)}
          {renderIf(!!workspace && workspace.flows.length > 0, (
            <div className="lab-flows">
              {workspace?.flows.map((name) => (
                <button key={name} className="lab-chip" aria-pressed={name === activeFlow} onClick={() => setFlow(name)}>{name}</button>
              ))}
            </div>
          ))}
          <div className="lab-row">
            <select className="lab-select" value={devices} onChange={(event) => setDevices(event.target.value)}>
              {LAB_DEVICE_SETS.map((name) => <option key={name} value={name}>{name}</option>)}
            </select>
            <div className="seg" role="group" aria-label="Language">
              <button aria-pressed={lang === LabLang.EN} onClick={() => setLang(LabLang.EN)}>English</button>
              <button aria-pressed={lang === LabLang.AR} onClick={() => setLang(LabLang.AR)}>العربية</button>
            </div>
            <div className="seg" role="group" aria-label="Theme">
              <button aria-pressed={scheme === LabScheme.LIGHT} onClick={() => setScheme(LabScheme.LIGHT)}>Light</button>
              <button aria-pressed={scheme === LabScheme.DARK} onClick={() => setScheme(LabScheme.DARK)}>Dark</button>
            </div>
          </div>
          <div className="lab-row">
            <input value={clockValue} onChange={(event) => setNow(event.target.value)} placeholder="clock (ISO), empty = now" spellCheck={false} title="--now" />
            <input value={tzValue} onChange={(event) => setTz(event.target.value)} placeholder="time zone" spellCheck={false} title="--tz" />
          </div>
          <div className="lab-actions">
            <button
              className="btn primary sm"
              disabled={!workspace?.server.running || !activeFlow}
              onClick={() => workspace && void act(() => window.hq.labShoot({ workspaceId: workspace.id, flow: activeFlow, devices, lang, colorScheme: scheme, now: clockValue, tz: tzValue }))}
            >
              Shoot {activeFlow || 'flow'}
            </button>
            {renderIf(!workspace?.server.running, <span className="faint">Start the server first.</span>)}
          </div>
          {renderIf(!!workspace && (lab.examples ?? []).length > 0, (
            <div className="lab-row">
              <select className="lab-select" value={example} onChange={(event) => setExample(event.target.value)}>
                <option value="">Import an example flow…</option>
                {(lab.examples ?? []).map((name) => <option key={name} value={name}>{name}</option>)}
              </select>
              <button className="btn sm" disabled={!example || !workspace} onClick={() => workspace && void act(() => window.hq.labImport(workspace.id, example))}>Import</button>
            </div>
          ))}
        </div>
      </div>

      {renderIf(jobs.length > 0, (
        <div className="lab-jobs">
          {jobs.map((job) => (
            <div key={job.id} className="panel lab-job">
              <div className="lab-job-head">
                <b>{job.label}</b>
                <Badge tone={job.status === LabJobStatus.RUNNING ? BadgeTone.RUN : job.status === LabJobStatus.DONE ? BadgeTone.DONE : BadgeTone.FAIL} dot>{job.status}</Badge>
                {renderIf(job.status === LabJobStatus.RUNNING, <button className="btn sm ghost danger" onClick={() => void window.hq.labCancel(job.id)}>Stop</button>)}
              </div>
              <pre className="lab-log selectable">{job.lines.slice(-8).join('\n') || '…'}</pre>
            </div>
          ))}
        </div>
      ))}

      {renderIf(!!workspace && workspace.runs.length > 0, workspace && run ? (
        <div className="lab-gallery-wrap">
          <div className="lab-row">
            <div className="eyebrow">Renders</div>
            <select className="lab-select" value={run.id} onChange={(event) => setRunId(event.target.value)}>
              {workspace.runs.map((entry) => <option key={entry.id} value={entry.id}>{entry.id} · {entry.shots.length} shots</option>)}
            </select>
            <button className="btn sm ghost" onClick={() => void window.hq.openPath(`${workspace.path}/${run.id}`)}>Open folder</button>
          </div>
          <div className="lab-gallery">
            {run.shots.slice(0, GALLERY_LIMIT).map((shot) => (
              <figure key={shot} className="lab-shot">
                <button className="lab-thumb" onClick={() => setPreview(shot)}>
                  <img src={shotUrl(workspace.id, run.id, shot)} alt={shot} loading="lazy" />
                </button>
                <figcaption title={shot}>{shot}</figcaption>
                {renderIf(!!auditorId, <button className="btn sm lab-audit" onClick={() => audit(shot)}>Audit with {auditorName}</button>)}
              </figure>
            ))}
          </div>
        </div>
      ) : null)}

      {renderIf(!!preview && !!workspace && !!run, workspace && run && preview ? (
        <div className="lab-lightbox" onClick={() => setPreview(null)}>
          <img src={shotUrl(workspace.id, run.id, preview)} alt={preview} />
          <div className="lab-lightbox-bar" onClick={(event) => event.stopPropagation()}>
            <span className="selectable">{preview}</span>
            {renderIf(!!auditorId, <button className="btn primary sm" onClick={() => { audit(preview); setPreview(null); }}>Audit with {auditorName}</button>)}
            <button className="btn sm" onClick={() => setPreview(null)}>Close</button>
          </div>
        </div>
      ) : null)}
    </section>
  );
};

export default Lab;
