import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import YAML from 'yaml';
import { EngineAdapter } from '@shared/constants';
import type { ProfileSettingsType } from '@shared/types';
import { DEFAULT_ALWAYS_DENY } from './config';

const PROFILE_FILE = 'profile.yaml';

const text = (value: unknown, fallback = ''): string => (typeof value === 'string' ? value : value === undefined || value === null ? fallback : String(value));
const record = (value: unknown): Record<string, unknown> => (value && typeof value === 'object' ? (value as Record<string, unknown>) : {});

export const readSettings = (vault: string): ProfileSettingsType => {
  const file = join(vault, PROFILE_FILE);
  const data = record(existsSync(file) ? YAML.parse(readFileSync(file, 'utf8')) : {});
  const guard = record(data.guard);
  const fullAuto = record(guard.fullAuto);
  const daycare = record(data.daycare);
  const lab = record(data.lab);
  const clock = record(lab.clock);
  const engines = Object.entries(record(data.engines)).map(([name, value]) => {
    const raw = record(value);
    return {
      name,
      adapter: raw.adapter === EngineAdapter.CLAUDE ? EngineAdapter.CLAUDE : EngineAdapter.CLI,
      bin: text(raw.bin, name),
      args: Array.isArray(raw.args) ? raw.args.map(String) : [],
    };
  });
  if (!engines.some((engine) => engine.name === 'claude')) engines.unshift({ name: 'claude', adapter: EngineAdapter.CLAUDE, bin: 'claude', args: [] });
  return {
    name: text(data.name, 'Trainer'),
    vault,
    claudeConfigDir: text(data.claudeConfigDir),
    repos: Object.entries(record(data.repos)).map(([name, path]) => ({ name, path: text(path) })),
    engines,
    guard: {
      maxMinutes: Number(fullAuto.maxMinutes) > 0 ? Number(fullAuto.maxMinutes) : 45,
      maxPlanUsage: Number(fullAuto.maxPlanUsage) > 0 ? Number(fullAuto.maxPlanUsage) : 0.85,
      worktree: fullAuto.worktree !== false,
      alwaysDeny: Array.isArray(guard.alwaysDeny) ? guard.alwaysDeny.map(String) : [],
      builtInDeny: DEFAULT_ALWAYS_DENY,
    },
    daycare: {
      autoPropose: daycare.autoPropose !== false,
      autoApproveFullAuto: daycare.autoApproveFullAuto === true,
    },
    env: Object.entries(record(data.env)).map(([key, value]) => ({ key, value: text(value) })),
    lab: {
      enabled: Object.keys(lab).length > 0 && lab.enabled !== false,
      title: text(lab.title, 'Lab'),
      home: text(lab.home),
      skill: text(lab.skill),
      examples: text(lab.examples, 'examples'),
      markerFile: text(lab.markerFile, '.render-commit'),
      refFile: text(lab.refFile, '.render-ref'),
      serverScript: text(lab.serverScript, 'app/harness/bin/restart_server.sh'),
      readyPath: text(lab.readyPath, 'app/node_modules'),
      port: Number(lab.port) > 0 ? Number(lab.port) : 8787,
      now: text(clock.now),
      tz: text(clock.tz),
    },
  };
};

export const writeSettings = (vault: string, settings: ProfileSettingsType): void => {
  const file = join(vault, PROFILE_FILE);
  const doc = YAML.parseDocument(existsSync(file) ? readFileSync(file, 'utf8') : '');
  doc.set('name', settings.name.trim() || 'Trainer');
  if (settings.claudeConfigDir.trim()) doc.set('claudeConfigDir', settings.claudeConfigDir.trim());
  else doc.delete('claudeConfigDir');
  doc.set('repos', Object.fromEntries(settings.repos.filter((repo) => repo.name.trim() && repo.path.trim()).map((repo) => [repo.name.trim(), repo.path.trim()])));
  doc.set('engines', Object.fromEntries(settings.engines.filter((engine) => engine.name.trim()).map((engine) => [
    engine.name.trim(),
    engine.adapter === EngineAdapter.CLAUDE
      ? { adapter: engine.adapter, bin: engine.bin.trim() || 'claude' }
      : { adapter: engine.adapter, bin: engine.bin.trim(), args: engine.args.filter((arg) => arg.length > 0) },
  ])));
  doc.setIn(['guard', 'fullAuto', 'maxMinutes'], settings.guard.maxMinutes);
  doc.setIn(['guard', 'fullAuto', 'maxPlanUsage'], settings.guard.maxPlanUsage);
  doc.setIn(['guard', 'fullAuto', 'worktree'], settings.guard.worktree);
  doc.setIn(['guard', 'alwaysDeny'], settings.guard.alwaysDeny.map((rule) => rule.trim()).filter(Boolean));
  doc.setIn(['daycare', 'autoPropose'], settings.daycare.autoPropose);
  doc.setIn(['daycare', 'autoApproveFullAuto'], settings.daycare.autoApproveFullAuto);
  const env = settings.env.filter((entry) => entry.key.trim());
  if (env.length > 0) doc.set('env', Object.fromEntries(env.map((entry) => [entry.key.trim(), entry.value])));
  else doc.delete('env');
  if (settings.lab.enabled && settings.lab.home.trim() && settings.lab.skill.trim()) {
    const lab = settings.lab;
    doc.set('lab', {
      title: lab.title,
      home: lab.home.trim(),
      skill: lab.skill.trim(),
      examples: lab.examples,
      markerFile: lab.markerFile,
      refFile: lab.refFile,
      serverScript: lab.serverScript,
      readyPath: lab.readyPath,
      port: lab.port,
      ...(lab.now || lab.tz ? { clock: { ...(lab.now ? { now: lab.now } : {}), ...(lab.tz ? { tz: lab.tz } : {}) } } : {}),
    });
  } else if (doc.has('lab')) {
    doc.setIn(['lab', 'enabled'], false);
  }
  writeFileSync(file, doc.toString());
};
