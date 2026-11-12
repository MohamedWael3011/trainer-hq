import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { DEFAULT_DOCK_SIZE } from '@shared/constants';
import type { UiStateType } from '@shared/types';
import { appHome } from './paths';

const UI_FILE = 'ui.json';
const DEFAULT_UI: UiStateType = { dockHidden: false, dockSize: { ...DEFAULT_DOCK_SIZE }, onboarded: false, notchDisplay: 0, dockDisplay: 0 };

const uiPath = (): string => join(appHome(), UI_FILE);

export const loadUi = (): UiStateType => {
  try {
    return existsSync(uiPath()) ? { ...DEFAULT_UI, ...(JSON.parse(readFileSync(uiPath(), 'utf8')) as Partial<UiStateType>) } : { ...DEFAULT_UI };
  } catch {
    return { ...DEFAULT_UI };
  }
};

export const saveUi = (ui: UiStateType): void => {
  mkdirSync(appHome(), { recursive: true });
  writeFileSync(uiPath(), JSON.stringify(ui));
};
