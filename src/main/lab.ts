import { spawn, type ChildProcess } from 'child_process';
import { existsSync, readdirSync, readFileSync, rmSync, statSync } from 'fs';
import { join, relative, resolve, sep } from 'path';
import { randomUUID } from 'crypto';
import { LabJobKind, LabJobStatus, type LabJobKindType } from '@shared/constants';
import type { LabJobType, LabRunType, LabShootRequestType, LabStateType, LabWorkspaceType } from '@shared/types';
import type { LabConfigType } from './config';

const KEEP_LINES = 40;
const KEEP_FULL_WORKSPACES = 2;
const IDLE_BEFORE_SLIM_MS = 6 * 60 * 60 * 1000;
const PRUNE_EVERY_MS = 60 * 60 * 1000;
const APP_DIR = 'app';
const HARNESS_DIR = join(APP_DIR, 'harness');
const SERVER_PID = /^\.devserver\.\d+\.pid$/;
const MAX_RUNS = 12;
const MAX_SHOTS = 400;
const SHOT_PREFIX = 'shots-';
const SKIP_DIR = /^_/;
const PNG = /\.png$/i;
const SAFE = /[^a-zA-Z0-9-]+/g;
const HTTPS_ENV = {
  GIT_CONFIG_COUNT: '2',
  GIT_CONFIG_KEY_0: 'url.https://github.com/.insteadOf',
  GIT_CONFIG_VALUE_0: 'ssh://git@github.com/',
  GIT_CONFIG_KEY_1: 'url.https://github.com/.insteadOf',
  GIT_CONFIG_VALUE_1: 'git@github.com:',
  GIT_TERMINAL_PROMPT: '0',
};

const readText = (file: string): string | undefined => (existsSync(file) ? readFileSync(file, 'utf8').trim() : undefined);

const isAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

const listPngs = (dir: string, base: string, out: string[]): void => {
  if (out.length >= MAX_SHOTS || !existsSync(dir)) return;
  for (const name of readdirSync(dir).sort()) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (!SKIP_DIR.test(name)) listPngs(full, base, out);
      continue;
    }
    else if (PNG.test(name)) out.push(relative(base, full));
    if (out.length >= MAX_SHOTS) return;
  }
};

const mtime = (path: string): number => {
  try {
    return statSync(path).mtimeMs;
  } catch {
    return 0;
  }
};

const entries = (dir: string): string[] => (existsSync(dir) ? readdirSync(dir).map((name) => join(dir, name)) : []);

const lastUsed = (dir: string): number =>
  Math.max(mtime(dir), ...entries(dir).map(mtime), ...entries(join(dir, HARNESS_DIR)).map(mtime));

const liveServerPids = (dir: string): number[] =>
  entries(join(dir, HARNESS_DIR))
    .filter((file) => SERVER_PID.test(file.slice(file.lastIndexOf(sep) + 1)))
    .map((file) => Number(readText(file)))
    .filter((pid) => pid > 0 && isAlive(pid));

export class Lab {
  private jobs: LabJobType[] = [];
  private processes = new Map<string, ChildProcess>();
  private pruneTimer: NodeJS.Timeout | undefined;

  constructor(
    private readonly settings: () => { config?: LabConfigType; env: Record<string, string> },
    private readonly onChange: () => void,
  ) {}

  private config(): LabConfigType {
    const config = this.settings().config;
    if (!config) throw new Error('The Lab is not set up. Add a lab: block to profile.yaml or enable it in Settings.');
    return config;
  }

  home(): string {
    return this.config().home;
  }

  private workspace(id: string): string {
    const dir = resolve(this.home(), id);
    if (!dir.startsWith(resolve(this.home()) + sep) || !existsSync(join(dir, this.config().markerFile))) throw new Error(`No lab workspace "${id}".`);
    return dir;
  }

  private serverPid(dir: string, port: number): number | undefined {
    const pid = Number(readText(join(dir, 'app', 'harness', `.devserver.${port}.pid`)));
    return pid > 0 && isAlive(pid) ? pid : undefined;
  }

  private runs(dir: string): LabRunType[] {
    return readdirSync(dir)
      .filter((name) => name.startsWith(SHOT_PREFIX) && statSync(join(dir, name)).isDirectory())
      .map((name) => {
        const shots: string[] = [];
        listPngs(join(dir, name), join(dir, name), shots);
        return { id: name, at: statSync(join(dir, name)).mtimeMs, shots };
      })
      .sort((a, b) => b.at - a.at)
      .slice(0, MAX_RUNS);
  }

  state(): LabStateType {
    const config = this.settings().config;
    if (!config) return { enabled: false, title: 'Lab', home: '', skillReady: false, workspaces: [], jobs: this.jobs, now: '', tz: '' };
    const home = config.home;
    const skillReady = existsSync(join(config.skill, 'SKILL.md'));
    const base = { enabled: true, title: config.title, home, skillReady, jobs: this.jobs, now: config.now, tz: config.tz };
    if (!existsSync(home)) return { ...base, workspaces: [] };
    const workspaces: LabWorkspaceType[] = readdirSync(home)
      .map((name) => join(home, name))
      .filter((dir) => statSync(dir).isDirectory() && existsSync(join(dir, config.markerFile)))
      .map((dir) => {
        const scenarios = join(dir, 'scenarios');
        const flows = existsSync(scenarios)
          ? readdirSync(scenarios).filter((name) => statSync(join(scenarios, name)).isDirectory()).sort()
          : [];
        const pid = this.serverPid(dir, config.port);
        return {
          id: relative(home, dir),
          path: dir,
          commit: readText(join(dir, config.markerFile)) ?? '',
          ref: readText(join(dir, config.refFile)) ?? '',
          ready: existsSync(join(dir, config.serverScript)) && existsSync(join(dir, config.readyPath)),
          slim: !existsSync(join(dir, APP_DIR)),
          inUse: this.inUse(dir, relative(home, dir)),
          flows,
          server: { running: !!pid, port: config.port, pid },
          runs: this.runs(dir),
        };
      });
    return { ...base, workspaces };
  }

  private run(kind: LabJobKindType, workspaceId: string, label: string, command: string, args: string[], cwd: string): string {
    const job: LabJobType = { id: randomUUID().slice(0, 8), kind, workspaceId, label, status: LabJobStatus.RUNNING, lines: [], startedAt: Date.now() };
    this.jobs.unshift(job);
    this.jobs = this.jobs.slice(0, 20);
    const port = this.settings().config?.port;
    const child = spawn(command, args, { cwd, env: { ...process.env, ...this.settings().env, ...HTTPS_ENV, ...(port ? { HARNESS_PORT: String(port) } : {}) }, stdio: ['ignore', 'pipe', 'pipe'] });
    this.processes.set(job.id, child);
    const push = (chunk: Buffer) => {
      chunk.toString().split('\n').filter((line) => line.trim()).forEach((line) => job.lines.push(line));
      if (job.lines.length > KEEP_LINES) job.lines.splice(0, job.lines.length - KEEP_LINES);
      this.onChange();
    };
    child.stdout?.on('data', push);
    child.stderr?.on('data', push);
    child.on('close', (code) => {
      this.processes.delete(job.id);
      job.status = code === 0 ? LabJobStatus.DONE : LabJobStatus.FAILED;
      job.endedAt = Date.now();
      this.tryPrune();
      this.onChange();
    });
    child.on('error', (error) => {
      job.lines.push(error.message);
      job.status = LabJobStatus.FAILED;
      this.onChange();
    });
    this.onChange();
    return job.id;
  }

  startServer(workspaceId: string): string {
    const dir = this.workspace(workspaceId);
    return this.run(LabJobKind.SERVER, workspaceId, 'Start dev server', 'bash', [join(dir, this.config().serverScript)], dir);
  }

  stopServer(workspaceId: string): void {
    const dir = this.workspace(workspaceId);
    const pid = this.serverPid(dir, this.config().port);
    if (pid) process.kill(pid);
    this.tryPrune();
    this.onChange();
  }

  private inUse(dir: string, id: string): boolean {
    return liveServerPids(dir).length > 0 || this.jobs.some((job) => job.workspaceId === id && job.status === LabJobStatus.RUNNING);
  }

  freeSpace(workspaceId: string): void {
    const dir = this.workspace(workspaceId);
    if (this.inUse(dir, workspaceId)) throw new Error(`Workspace "${workspaceId}" is in use. Stop its server and jobs first.`);
    rmSync(join(dir, APP_DIR), { recursive: true, force: true });
    this.onChange();
  }

  pruneOld(): string[] {
    const config = this.settings().config;
    if (!config || !existsSync(config.home)) return [];
    const now = Date.now();
    const slimmed = readdirSync(config.home)
      .map((name) => join(config.home, name))
      .filter((dir) => statSync(dir).isDirectory() && existsSync(join(dir, config.markerFile)) && existsSync(join(dir, APP_DIR)))
      .map((dir) => ({ dir, id: relative(config.home, dir), used: lastUsed(dir) }))
      .sort((a, b) => b.used - a.used)
      .slice(KEEP_FULL_WORKSPACES)
      .filter((entry) => now - entry.used > IDLE_BEFORE_SLIM_MS && !this.inUse(entry.dir, entry.id))
      .map((entry) => {
        rmSync(join(entry.dir, APP_DIR), { recursive: true, force: true });
        return entry.id;
      });
    if (slimmed.length > 0) this.onChange();
    return slimmed;
  }

  private tryPrune(): void {
    try {
      this.pruneOld();
    } catch {
      return;
    }
  }

  startAutoPrune(): void {
    if (this.pruneTimer) clearInterval(this.pruneTimer);
    this.tryPrune();
    this.pruneTimer = setInterval(() => this.tryPrune(), PRUNE_EVERY_MS);
  }

  shoot(request: LabShootRequestType): string {
    const dir = this.workspace(request.workspaceId);
    const stamp = new Date().toISOString().slice(5, 16).replace(/[-:T]/g, '');
    const out = `${SHOT_PREFIX}${request.flow.replace(SAFE, '-')}-${request.lang}-${request.colorScheme}-${stamp}`;
    const args = [
      join('runner', 'shoot.mjs'),
      request.flow,
      `--base=http://localhost:${this.config().port}`,
      `--devices=${request.devices}`,
      `--out=${out}`,
    ];
    if (request.lang === 'ar') args.push('--lang=ar');
    if (request.colorScheme === 'dark') args.push('--color-scheme=dark');
    if (request.now?.trim()) args.push(`--now=${request.now.trim()}`);
    if (request.tz?.trim()) args.push(`--tz=${request.tz.trim()}`);
    return this.run(LabJobKind.SHOOT, request.workspaceId, `Shoot ${request.flow} · ${request.devices} · ${request.lang}`, 'node', args, dir);
  }

  createWorkspace(topic: string, ref: string): string {
    const name = `${topic.toLowerCase().replace(SAFE, '-').replace(/^-|-$/g, '') || 'lab'}-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}`;
    const target = join(this.home(), name);
    const setup = join(this.config().skill, 'scripts', 'setup.sh');
    if (!existsSync(setup)) throw new Error(`No setup script at ${setup}. Check lab.skill in profile.yaml.`);
    return this.run(LabJobKind.SETUP, name, `Build workspace ${name} (${ref})`, 'bash', [setup, target, ref], this.config().skill);
  }

  importExamples(workspaceId: string, flow: string): string {
    const dir = this.workspace(workspaceId);
    const source = join(this.config().skill, this.config().examples, flow);
    if (!existsSync(source)) throw new Error(`No example flow "${flow}".`);
    return this.run(LabJobKind.IMPORT, workspaceId, `Import example ${flow}`, 'bash', ['-c', `mkdir -p scenarios && rsync -a "${source}/" "scenarios/${flow}/" && node "${join(this.config().skill, 'scripts', 'gen_registry.mjs')}" "${dir}"`], dir);
  }

  exampleFlows(): string[] {
    const config = this.settings().config;
    if (!config) return [];
    const dir = join(config.skill, config.examples);
    return existsSync(dir) ? readdirSync(dir).filter((name) => statSync(join(dir, name)).isDirectory()).sort() : [];
  }

  cancel(jobId: string): void {
    this.processes.get(jobId)?.kill('SIGTERM');
  }

  resolveShot(relativePath: string): string | undefined {
    const home = this.settings().config?.home;
    if (!home) return undefined;
    const full = resolve(home, relativePath);
    return full.startsWith(resolve(home) + sep) && PNG.test(full) && existsSync(full) ? full : undefined;
  }

  stopAll(): void {
    if (this.pruneTimer) clearInterval(this.pruneTimer);
    this.processes.forEach((child) => child.kill('SIGTERM'));
  }
}

