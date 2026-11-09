import { app } from 'electron';
import { homedir } from 'os';
import { isAbsolute, join, resolve } from 'path';

export const expandHome = (value: string, base?: string): string => {
  if (value === '~') return homedir();
  if (value.startsWith('~/')) return join(homedir(), value.slice(2));
  if (isAbsolute(value)) return value;
  return base ? resolve(base, value) : resolve(value);
};

export const appHome = (): string => (process.env.THQ_HOME ? expandHome(process.env.THQ_HOME) : join(homedir(), '.trainer-hq'));

export const profileHome = (profileId: string): string => join(appHome(), 'profiles', profileId);

export const resourcesDir = (): string =>
  app.isPackaged ? join(process.resourcesPath, 'resources') : join(app.getAppPath(), 'resources');

export const vaultTemplateDir = (): string =>
  app.isPackaged ? join(process.resourcesPath, 'vault-template') : join(app.getAppPath(), 'vault-template');
