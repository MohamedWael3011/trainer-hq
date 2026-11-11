import { tmpdir } from 'os';

export const app = { isPackaged: false, getAppPath: () => process.cwd(), getPath: () => tmpdir() };
