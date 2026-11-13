import type { AutonomyType, SurfaceType } from './constants';
import type { SignInKindType } from './signIn';
import type {
  DisplayInfoType,
  CommandInfoType,
  AppStateType,
  QuestLiveType,
  UpdateInfoType,
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
  BrainHealthType,
  CreatureContextRequestType,
  ScheduleSaveRequestType,
  SessionAdoptRequestType,
} from './types';

export type HqApiType = {
  getState: () => Promise<AppStateType>;
  onState: (callback: (state: AppStateType) => void) => () => void;
  getLive: () => Promise<Record<string, QuestLiveType>>;
  onLive: (callback: (live: Record<string, QuestLiveType>) => void) => () => void;
  onNotchToggle: (callback: (payload: { instant: boolean }) => void) => () => void;
  onFocusCreature: (callback: (creatureId: string) => void) => () => void;
  onDockToggle: (callback: () => void) => () => void;
  onDockExpand: (callback: () => void) => () => void;
  onDisplaysChanged: (callback: () => void) => () => void;
  listDisplays: () => Promise<DisplayInfoType[]>;
  setOverlayDisplay: (surface: 'notch' | 'dock', displayId: number) => Promise<void>;
  setDockHidden: (hidden: boolean) => Promise<void>;
  resizeDock: (size: DockSizeType, persist: boolean) => Promise<DockSizeType>;
  pathForFile: (file: File) => string;
  inspectAttachment: (path: string) => Promise<AttachmentInfoType>;
  savePastedFile: (data: ArrayBuffer, type: string) => Promise<string>;
  installSkill: (request: SkillInstallRequestType) => Promise<string>;
  chat: (request: ChatRequestType) => Promise<string>;
  hatch: (request: HatchRequestType) => Promise<string>;
  cancelQuest: (questId: string) => Promise<void>;
  decideApproval: (decision: ApprovalDecisionType) => Promise<void>;
  setAutonomy: (id: string, autonomy: AutonomyType) => Promise<void>;
  setModel: (id: string, model: string) => Promise<void>;
  setEffort: (id: string, effort: string) => Promise<void>;
  setEngine: (id: string, engine: string) => Promise<void>;
  engineModels: (engine: string) => Promise<{ id: string; label: string }[] | null>;
  setSprite: (id: string, file: File) => Promise<void>;
  resetSprite: (id: string) => Promise<void>;
  decideDaycare: (decision: DaycareDecisionType) => Promise<void>;
  switchProfile: (profileId: string) => Promise<void>;
  createProfile: (request: ProfileCreateRequestType) => Promise<string>;
  refreshAuth: () => Promise<void>;
  reorderCreatures: (ids: string[]) => Promise<void>;
  createThread: (request: ThreadCreateRequestType) => Promise<string>;
  archiveThread: (id: string, removeWorktree: boolean) => Promise<void>;
  clearThread: (creatureId: string, threadId?: string) => Promise<void>;
  restoreThread: (id: string) => Promise<void>;
  deleteThread: (id: string) => Promise<void>;
  compactThread: (creatureId: string, threadId?: string) => Promise<string>;
  openThreadInTerminal: (creatureId: string, threadId?: string) => Promise<void>;
  sendHeldNow: (creatureId: string, threadId?: string) => Promise<void>;
  listCommands: (creatureId: string) => Promise<CommandInfoType[]>;
  cancelQueued: (creatureId: string, threadId?: string) => Promise<void>;
  cancelHeld: (creatureId: string, threadId?: string) => Promise<void>;
  checkUpdate: () => Promise<UpdateInfoType | undefined>;
  installUpdate: () => Promise<void>;
  onOpenView: (callback: (view: string) => void) => () => void;
  labState: () => Promise<LabStateType>;
  getSettings: () => Promise<ProfileSettingsType>;
  saveSettings: (settings: ProfileSettingsType) => Promise<void>;
  pickFolder: (defaultPath?: string) => Promise<string | undefined>;
  checkPrerequisites: () => Promise<PrerequisiteType[]>;
  setOnboarded: (done: boolean) => Promise<void>;
  pointCreaturesAt: (repoPath: string) => Promise<number>;
  onLabChanged: (callback: () => void) => () => void;
  labStartServer: (workspaceId: string) => Promise<string>;
  labStopServer: (workspaceId: string) => Promise<void>;
  labShoot: (request: LabShootRequestType) => Promise<string>;
  labCreate: (topic: string, ref: string) => Promise<string>;
  labImport: (workspaceId: string, flow: string) => Promise<string>;
  labCancel: (jobId: string) => Promise<void>;
  labFreeSpace: (workspaceId: string) => Promise<void>;
  openLogin: () => Promise<void>;
  openDashboard: (creatureId?: string) => Promise<void>;
  setInteractive: (surface: SurfaceType, interactive: boolean) => Promise<void>;
  openPath: (target?: string) => Promise<string>;
  signIn: (kind: SignInKindType) => Promise<void>;
  openLocal: (target: string, baseDir?: string) => Promise<{ ok: boolean; path?: string; revealed?: boolean; error?: string }>;
  getOpenAtLogin: () => Promise<boolean>;
  getNotchMetrics: () => Promise<NotchMetricsType>;
  setOpenAtLogin: (enabled: boolean) => Promise<void>;
  setCreatureContext: (request: CreatureContextRequestType) => Promise<void>;
  setCreatureBudget: (creatureId: string, weeklyUsd: number) => Promise<void>;
  brainHealth: (creatureId: string) => Promise<BrainHealthType>;
  saveSchedule: (request: ScheduleSaveRequestType) => Promise<string>;
  deleteSchedule: (id: string) => Promise<void>;
  runSchedule: (id: string) => Promise<void>;
  adoptSession: (request: SessionAdoptRequestType) => Promise<string>;
};
