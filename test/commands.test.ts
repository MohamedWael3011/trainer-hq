import { mkdirSync, mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
import { describeCommands } from '../src/main/commands';

const put = (path: string, text: string): void => {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, text);
};

describe('describeCommands', () => {
  const root = mkdtempSync(join(tmpdir(), 'thq-cmd-'));
  const config = join(root, 'config');
  const project = join(root, 'project');
  put(join(config, 'skills', 'craft', 'SKILL.md'), '---\nname: craft\ndescription: Polish UI code.\n---\nbody');
  put(join(project, '.claude', 'commands', 'deploy', 'staging.md'), '---\ndescription: Deploy to staging\n---\nsteps');
  put(join(config, 'plugins', 'cache', 'acme', '.claude-plugin', 'plugin.json'), '{"name":"acme"}');
  put(join(config, 'plugins', 'cache', 'acme', 'skills', 'pdf', 'SKILL.md'), '---\ndescription: Read and write PDFs.\n---');

  it('describes skills, project commands, plugin skills and built-ins Claude Code reported', () => {
    const list = describeCommands(['craft', 'deploy:staging', 'acme:pdf', 'compact', 'mystery'], [project], config);
    const by = Object.fromEntries(list.map((entry) => [entry.name, entry]));
    expect(by.craft).toEqual({ name: 'craft', description: 'Polish UI code.', kind: 'skill' });
    expect(by['deploy:staging']).toEqual({ name: 'deploy:staging', description: 'Deploy to staging', kind: 'command' });
    expect(by['acme:pdf'].description).toBe('Read and write PDFs.');
    expect(by.compact.kind).toBe('builtin');
    expect(by.mystery.description).toBe('');
  });
});
