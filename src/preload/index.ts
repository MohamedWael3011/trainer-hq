import { contextBridge, ipcRenderer, webUtils } from 'electron';
import { Ipc, type AutonomyType, type SurfaceType } from '@shared/constants';
import type { HqApiType } from '@shared/api';
import type {
  AppStateType,
  AttachmentInfoType,
  ProfileCreateRequestType,
  SkillInstallRequestType,
  ThreadCreateRequestType,
  LabShootRequestType,
  LabStateType,
  PrerequisiteType,
  ProfileSettingsType,
  DockSizeType,
  ApprovalDecisionType,
  ChatRequestType,
  DaycareDecisionType,
  HatchRequestType,
  NotchMetricsType,
} from '@shared/types';

const subscribe = <T>(channel: string, callback: (payload: T) => void): (() => void) => {
  const listener = (_event: Electron.IpcRendererEvent, payload: T) => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
};

const api: HqApiType = {
  getState: (): Promise<AppStateType> => ipcRenderer.invoke(Ipc.STATE_GET),
  onState: (callback: (state: AppStateType) => void) => subscribe(Ipc.STATE_CHANGED, callback),
  onNotchToggle: (callback: (payload: { instant: boolean }) => void) => subscribe(Ipc.NOTCH_TOGGLE, callback),
  onFocusCreature: (callback: (creatureId: string) => void) => subscribe(Ipc.FOCUS_CREATURE, callback),
  onDockToggle: (callback: () => void) => subscribe(Ipc.DOCK_TOGGLE, callback),
  onDockExpand: (callback: () => void) => subscribe(Ipc.DOCK_EXPAND, callback),
  setDockHidden: (hidden: boolean): Promise<void> => ipcRenderer.invoke(Ipc.DOCK_SET_HIDDEN, hidden),
  resizeDock: (size: DockSizeType, persist: boolean): Promise<DockSizeType> => ipcRenderer.invoke(Ipc.DOCK_RESIZE, size, persist),
  pathForFile: (file: File): string => webUtils.getPathForFile(file),
  inspectAttachment: (path: string): Promise<AttachmentInfoType> => ipcRenderer.invoke(Ipc.ATTACHMENT_INSPECT, path),
  installSkill: (request: SkillInstallRequestType): Promise<string> => ipcRenderer.invoke(Ipc.SKILL_INSTALL, request),
  chat: (request: ChatRequestType): Promise<string> => ipcRenderer.invoke(Ipc.CHAT_SEND, request),
  hatch: (request: HatchRequestType): Promise<string> => ipcRenderer.invoke(Ipc.HATCH_START, request),
  cancelQuest: (questId: string): Promise<void> => ipcRenderer.invoke(Ipc.QUEST_CANCEL, questId),
  decideApproval: (decision: ApprovalDecisionType): Promise<void> => ipcRenderer.invoke(Ipc.APPROVAL_DECIDE, decision),
  setAutonomy: (id: string, autonomy: AutonomyType): Promise<void> => ipcRenderer.invoke(Ipc.CREATURE_AUTONOMY, id, autonomy),
  setModel: (id: string, model: string): Promise<void> => ipcRenderer.invoke(Ipc.CREATURE_MODEL, id, model),
  setEngine: (id: string, engine: string): Promise<void> => ipcRenderer.invoke(Ipc.CREATURE_ENGINE, id, engine),
  setSprite: (id: string, file: File): Promise<void> => ipcRenderer.invoke(Ipc.CREATURE_SPRITE, id, webUtils.getPathForFile(file)),
  resetSprite: (id: string): Promise<void> => ipcRenderer.invoke(Ipc.CREATURE_SPRITE_RESET, id),
  decideDaycare: (decision: DaycareDecisionType): Promise<void> => ipcRenderer.invoke(Ipc.DAYCARE_DECIDE, decision),
  switchProfile: (profileId: string): Promise<void> => ipcRenderer.invoke(Ipc.PROFILE_SWITCH, profileId),
  createProfile: (request: ProfileCreateRequestType): Promise<string> => ipcRenderer.invoke(Ipc.PROFILE_CREATE, request),
  refreshAuth: (): Promise<void> => ipcRenderer.invoke(Ipc.AUTH_REFRESH),
  reorderCreatures: (ids: string[]): Promise<void> => ipcRenderer.invoke(Ipc.CREATURES_REORDER, ids),
  createThread: (request: ThreadCreateRequestType): Promise<string> => ipcRenderer.invoke(Ipc.THREAD_CREATE, request),
  archiveThread: (id: string, removeWorktree: boolean): Promise<void> => ipcRenderer.invoke(Ipc.THREAD_ARCHIVE, id, removeWorktree),
  onOpenView: (callback: (view: string) => void) => subscribe(Ipc.OPEN_VIEW, callback),
  labState: (): Promise<LabStateType> => ipcRenderer.invoke(Ipc.LAB_STATE),
  getSettings: (): Promise<ProfileSettingsType> => ipcRenderer.invoke(Ipc.SETTINGS_GET),
  saveSettings: (settings: ProfileSettingsType): Promise<void> => ipcRenderer.invoke(Ipc.SETTINGS_SAVE, settings),
  pickFolder: (defaultPath?: string): Promise<string | undefined> => ipcRenderer.invoke(Ipc.PICK_FOLDER, defaultPath),
  checkPrerequisites: (): Promise<PrerequisiteType[]> => ipcRenderer.invoke(Ipc.PREREQS),
  setOnboarded: (done: boolean): Promise<void> => ipcRenderer.invoke(Ipc.ONBOARDING_DONE, done),
  pointCreaturesAt: (repoPath: string): Promise<number> => ipcRenderer.invoke(Ipc.CREATURES_POINT, repoPath),
  onLabChanged: (callback: () => void) => subscribe(Ipc.LAB_STATE, callback),
  labStartServer: (workspaceId: string): Promise<string> => ipcRenderer.invoke(Ipc.LAB_START_SERVER, workspaceId),
  labStopServer: (workspaceId: string): Promise<void> => ipcRenderer.invoke(Ipc.LAB_STOP_SERVER, workspaceId),
  labShoot: (request: LabShootRequestType): Promise<string> => ipcRenderer.invoke(Ipc.LAB_SHOOT, request),
  labCreate: (topic: string, ref: string): Promise<string> => ipcRenderer.invoke(Ipc.LAB_CREATE, topic, ref),
  labImport: (workspaceId: string, flow: string): Promise<string> => ipcRenderer.invoke(Ipc.LAB_IMPORT, workspaceId, flow),
  labCancel: (jobId: string): Promise<void> => ipcRenderer.invoke(Ipc.LAB_CANCEL, jobId),
  openLogin: (): Promise<void> => ipcRenderer.invoke(Ipc.AUTH_LOGIN),
  openDashboard: (creatureId?: string): Promise<void> => ipcRenderer.invoke(Ipc.OPEN_DASHBOARD, creatureId),
  setInteractive: (surface: SurfaceType, interactive: boolean): Promise<void> => ipcRenderer.invoke(Ipc.SURFACE_INTERACTIVE, surface, interactive),
  openPath: (target?: string): Promise<string> => ipcRenderer.invoke(Ipc.OPEN_PATH, target),
  getOpenAtLogin: (): Promise<boolean> => ipcRenderer.invoke(Ipc.LOGIN_ITEM_GET),
  getNotchMetrics: (): Promise<NotchMetricsType> => ipcRenderer.invoke(Ipc.NOTCH_METRICS),
  setOpenAtLogin: (enabled: boolean): Promise<void> => ipcRenderer.invoke(Ipc.LOGIN_ITEM_SET, enabled),
};

contextBridge.exposeInMainWorld('hq', api);
