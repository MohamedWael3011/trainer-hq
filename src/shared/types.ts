import type {
  AttachmentKindType,
  EngineAdapterType,
  LabJobKindType,
  LabJobStatusType,
  LabLangType,
  LabSchemeType,
  AutonomyType,
  DaycareModeType,
  DaycareActionType,
  DecisionType,
  EventKindType,
  QuestKindType,
  QuestStatusType,
} from './constants';

export type CreatureToolsType = {
  allow: string[];
  ask: string[];
  deny: string[];
};

export type CreatureType = {
  id: string;
  no: number;
  name: string;
  role: string;
  blurb: string;
  types: string[];
  sprite: string;
  engine: string;
  model?: string;
  cwd?: string;
  addDirs: string[];
  brain: string[];
  skills: string[];
  tools: CreatureToolsType;
  autonomy: AutonomyType;
  learnsInto: string;
  learnsReview: boolean;
  dir: string;
};

export type QuestEventType = {
  kind: EventKindType;
  text: string;
  at: number;
};

export type QuestType = {
  id: string;
  creatureId: string;
  kind: QuestKindType;
  title: string;
  status: QuestStatusType;
  startedAt: number;
  endedAt?: number;
  events: QuestEventType[];
  sessionId?: string;
  cwd?: string;
  parentId?: string;
  askedBy?: string;
  threadId?: string;
};

export type ThreadType = {
  id: string;
  creatureId: string;
  title: string;
  repo?: string;
  cwd?: string;
  branch?: string;
  pr?: string;
  worktree?: string;
  note?: string;
  createdAt: number;
  updatedAt: number;
  archived: boolean;
};

export type ThreadCreateRequestType = {
  creatureId: string;
  title: string;
  repo?: string;
  branch?: string;
  pr?: string;
  worktree: boolean;
};

export type ApprovalType = {
  id: string;
  questId: string;
  creatureId: string;
  toolName: string;
  summary: string;
  at: number;
};

export type DaycareNoteType = {
  id: string;
  creatureId: string;
  target: string;
  source: string;
  body: string;
};

export type ProfileSummaryType = {
  id: string;
  name: string;
  vault: string;
};

export type StatsType = {
  questsDone: number;
  notesLearned: number;
  sessionsByDay: number[];
};

export type UsageType = {
  status: string;
  fiveHour?: number;
  sevenDay?: number;
  resetsAt?: number;
  updatedAt: number;
};

export type DockSizeType = {
  width: number;
  height: number;
};

export type AuthStatusType = {
  loggedIn: boolean;
  email?: string;
  plan?: string;
  method?: string;
  expiresAt?: number;
  checkedAt: number;
  error?: string;
};

export type UiStateType = {
  dockHidden: boolean;
  dockSize: DockSizeType;
  onboarded: boolean;
};

export type AppStateType = {
  profile: ProfileSummaryType;
  profiles: ProfileSummaryType[];
  creatures: CreatureType[];
  quests: QuestType[];
  threads: ThreadType[];
  approvals: ApprovalType[];
  daycare: DaycareNoteType[];
  repos: string[];
  engines: string[];
  spriteRev: Record<string, number>;
  stats: StatsType;
  usage?: UsageType;
  ui: UiStateType;
  labEnabled: boolean;
  auth?: AuthStatusType;
  errors: string[];
};

export type NotchMetricsType = {
  barHeight: number;
  hasNotch: boolean;
  notchWidth: number;
  pillWidth: number;
  panelWidth: number;
  panelHeight: number;
};

export type HatchRequestType = {
  prompt: string;
  repos: string[];
  engine: string;
  autonomy: AutonomyType;
};

export type ChatRequestType = {
  creatureId: string;
  text: string;
  attachments?: string[];
  threadId?: string;
};

export type AttachmentInfoType = {
  path: string;
  name: string;
  kind: AttachmentKindType;
  skillName?: string;
};

export type LabRunType = {
  id: string;
  at: number;
  shots: string[];
};

export type LabWorkspaceType = {
  id: string;
  path: string;
  commit: string;
  ref: string;
  ready: boolean;
  flows: string[];
  server: { running: boolean; port: number; pid?: number };
  runs: LabRunType[];
};

export type LabJobType = {
  id: string;
  kind: LabJobKindType;
  workspaceId: string;
  label: string;
  status: LabJobStatusType;
  lines: string[];
  startedAt: number;
  endedAt?: number;
};

export type LabStateType = {
  enabled: boolean;
  title: string;
  now: string;
  tz: string;
  home: string;
  skillReady: boolean;
  workspaces: LabWorkspaceType[];
  jobs: LabJobType[];
  examples?: string[];
};

export type LabShootRequestType = {
  workspaceId: string;
  flow: string;
  devices: string;
  lang: LabLangType;
  colorScheme: LabSchemeType;
  now?: string;
  tz?: string;
};

export type ProfileSettingsType = {
  name: string;
  vault: string;
  claudeConfigDir: string;
  repos: { name: string; path: string }[];
  engines: { name: string; adapter: EngineAdapterType; bin: string; args: string[] }[];
  guard: { maxMinutes: number; maxPlanUsage: number; worktree: boolean; alwaysDeny: string[]; builtInDeny: string[] };
  daycare: { mode: DaycareModeType; autoApproveFullAuto: boolean };
  env: { key: string; value: string }[];
  lab: {
    enabled: boolean;
    title: string;
    home: string;
    skill: string;
    examples: string;
    markerFile: string;
    refFile: string;
    serverScript: string;
    readyPath: string;
    port: number;
    now: string;
    tz: string;
  };
};

export type PrerequisiteType = {
  id: string;
  label: string;
  ok: boolean;
  detail: string;
  required: boolean;
};

export type ProfileCreateRequestType = {
  name: string;
  vault: string;
  claudeConfigDir?: string;
};

export type SkillInstallRequestType = {
  path: string;
  creatureId?: string;
};

export type ApprovalDecisionType = {
  id: string;
  decision: DecisionType;
};

export type DaycareDecisionType = {
  id: string;
  action: DaycareActionType;
};
