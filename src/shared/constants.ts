export const Autonomy = {
  ASK: 'ask',
  AUTO_EDIT: 'auto-edit',
  FULL_AUTO: 'full-auto',
} as const;
export type AutonomyType = (typeof Autonomy)[keyof typeof Autonomy];

export const PermissionMode = {
  [Autonomy.ASK]: 'manual',
  [Autonomy.AUTO_EDIT]: 'acceptEdits',
  [Autonomy.FULL_AUTO]: 'bypassPermissions',
} as const;

// Claude models offered in the Dex. An empty id means the CLI's default model.
export const CLAUDE_MODELS = [
  { id: '', label: 'Default', desc: 'Follows your CLI setting (Opus)', cost: 'CLI default (Opus)', optionLabel: 'Default · follows CLI (Opus)' },
  { id: 'claude-fable-5-1', label: 'Fable 5.1', desc: 'Most capable · uses your plan fastest', cost: 'Highest plan use', optionLabel: 'Fable 5.1 · most capable, uses your plan fastest' },
  { id: 'opus', label: 'Opus', desc: 'Deep reasoning · heavy plan use', cost: 'High plan use', optionLabel: 'Opus · deep reasoning, heavy plan use' },
  { id: 'sonnet', label: 'Sonnet', desc: 'Balanced speed and smarts', cost: 'Medium plan use', optionLabel: 'Sonnet · balanced' },
  { id: 'haiku', label: 'Haiku', desc: 'Fastest · cheapest on your plan', cost: 'Cheapest', optionLabel: 'Haiku · cheapest' },
] as const;

// Claude Code effort levels. '' follows the user's own CLI setting; lower effort thinks less and uses less of the plan.
export const CLAUDE_EFFORTS = [
  { id: '', label: 'Default' },
  { id: 'low', label: 'Low · quick edits' },
  { id: 'medium', label: 'Medium · recommended' },
  { id: 'high', label: 'High · harder problems' },
  { id: 'xhigh', label: 'Extra high · heavy plan use' },
  { id: 'max', label: 'Max · heaviest plan use' },
] as const;

// How Day Care finds notes worth keeping after a chat.
// free: the creature lists them itself at the end of its answer (no extra model call).
// ai: a separate cheap Haiku pass reads the chat. off: no suggestions.
export const DaycareMode = {
  FREE: 'free',
  AI: 'ai',
  OFF: 'off',
} as const;
export type DaycareModeType = (typeof DaycareMode)[keyof typeof DaycareMode];

export const QuestStatus = {
  RUNNING: 'running',
  WAITING: 'waiting',
  DONE: 'done',
  FAILED: 'failed',
  PAUSED: 'paused',
  CANCELLED: 'cancelled',
} as const;
export type QuestStatusType = (typeof QuestStatus)[keyof typeof QuestStatus];

export const QuestKind = {
  CHAT: 'chat',
  HATCH: 'hatch',
  DAYCARE: 'daycare',
  HANDOFF: 'handoff',
} as const;
export type QuestKindType = (typeof QuestKind)[keyof typeof QuestKind];

export const EventKind = {
  USER: 'user',
  TEXT: 'text',
  TOOL: 'tool',
  RESULT: 'result',
  ERROR: 'error',
  SYSTEM: 'system',
  // A file the creature produced during the reply (its absolute path is the event text).
  OUTPUT: 'output',
} as const;
export type EventKindType = (typeof EventKind)[keyof typeof EventKind];

export const EngineAdapter = {
  CLAUDE: 'claude',
  ANTIGRAVITY: 'antigravity',
  CLI: 'cli',
} as const;
export type EngineAdapterType = (typeof EngineAdapter)[keyof typeof EngineAdapter];

export const Surface = {
  DOCK: 'dock',
  NOTCH: 'notch',
  DASHBOARD: 'dashboard',
} as const;
export type SurfaceType = (typeof Surface)[keyof typeof Surface];

export const View = {
  PARTY: 'party',
  QUESTS: 'quests',
  DEX: 'dex',
  DAYCARE: 'daycare',
  TRAINER: 'trainer',
  LAB: 'lab',
  SETTINGS: 'settings',
} as const;
export type ViewType = (typeof View)[keyof typeof View];

export const Decision = {
  ALLOW: 'allow',
  ALLOW_QUEST: 'allow-quest',
  DENY: 'deny',
} as const;
export type DecisionType = (typeof Decision)[keyof typeof Decision];

export const DaycareAction = {
  APPROVE: 'approve',
  DISMISS: 'dismiss',
} as const;
export type DaycareActionType = (typeof DaycareAction)[keyof typeof DaycareAction];

export const AttachmentKind = {
  FILE: 'file',
  FOLDER: 'folder',
  ZIP: 'zip',
  SKILL: 'skill',
} as const;
export type AttachmentKindType = (typeof AttachmentKind)[keyof typeof AttachmentKind];

export const LabJobKind = {
  SERVER: 'server',
  SHOOT: 'shoot',
  SETUP: 'setup',
  IMPORT: 'import',
} as const;
export type LabJobKindType = (typeof LabJobKind)[keyof typeof LabJobKind];

export const LabJobStatus = {
  RUNNING: 'running',
  DONE: 'done',
  FAILED: 'failed',
} as const;
export type LabJobStatusType = (typeof LabJobStatus)[keyof typeof LabJobStatus];

export const LabLang = { EN: 'en', AR: 'ar' } as const;
export type LabLangType = (typeof LabLang)[keyof typeof LabLang];

export const LabScheme = { LIGHT: 'light', DARK: 'dark' } as const;
export type LabSchemeType = (typeof LabScheme)[keyof typeof LabScheme];

export const LAB_DEVICE_SETS = ['phones', 'ios', 'android', 'samsung', 'duo', 'foldables', 'mobile'];
export const LAB_PROTOCOL = 'thq-lab';
// Serves files creatures produced (see Hq.isOutput) to the chat log.
export const OUTPUT_PROTOCOL = 'thq-output';

export const Ipc = {
  STATE_GET: 'state:get',
  STATE_CHANGED: 'state:changed',
  LIVE_CHANGED: 'live:changed',
  LIVE_GET: 'live:get',
  CHAT_SEND: 'chat:send',
  QUEST_CANCEL: 'quest:cancel',
  APPROVAL_DECIDE: 'approval:decide',
  CREATURE_AUTONOMY: 'creature:autonomy',
  CREATURE_MODEL: 'creature:model',
  CREATURE_EFFORT: 'creature:effort',
  CREATURE_ENGINE: 'creature:engine',
  ENGINE_MODELS: 'engine:models',
  CREATURE_SPRITE: 'creature:sprite',
  CREATURE_SPRITE_RESET: 'creature:sprite-reset',
  HATCH_START: 'hatch:start',
  DAYCARE_DECIDE: 'daycare:decide',
  PROFILE_SWITCH: 'profile:switch',
  PROFILE_CREATE: 'profile:create',
  CREATURES_REORDER: 'creatures:reorder',
  THREAD_CREATE: 'thread:create',
  THREAD_ARCHIVE: 'thread:archive',
  THREAD_CLEAR: 'thread:clear',
  THREAD_COMPACT: 'thread:compact',
  THREAD_TERMINAL: 'thread:terminal',
  THREAD_HELD_SEND: 'thread:held-send',
  THREAD_HELD_CANCEL: 'thread:held-cancel',
  THREAD_QUEUED_CANCEL: 'thread:queued-cancel',
  COMMANDS_LIST: 'commands:list',
  UPDATE_CHECK: 'update:check',
  UPDATE_INSTALL: 'update:install',
  LAB_STATE: 'lab:state',
  SETTINGS_GET: 'settings:get',
  SETTINGS_SAVE: 'settings:save',
  PICK_FOLDER: 'dialog:pick-folder',
  PREREQS: 'onboarding:prereqs',
  ONBOARDING_DONE: 'onboarding:done',
  CREATURES_POINT: 'creatures:point-at',
  LAB_START_SERVER: 'lab:start-server',
  LAB_STOP_SERVER: 'lab:stop-server',
  LAB_SHOOT: 'lab:shoot',
  LAB_CREATE: 'lab:create',
  LAB_IMPORT: 'lab:import',
  LAB_CANCEL: 'lab:cancel',
  LAB_FREE_SPACE: 'lab:free-space',
  AUTH_REFRESH: 'auth:refresh',
  AUTH_LOGIN: 'auth:login',
  OPEN_DASHBOARD: 'window:open-dashboard',
  OPEN_VIEW: 'ui:open-view',
  SURFACE_INTERACTIVE: 'surface:interactive',
  NOTCH_TOGGLE: 'notch:toggle',
  FOCUS_CREATURE: 'ui:focus-creature',
  OPEN_PATH: 'shell:open-path',
  OPEN_LOCAL: 'shell:open-local',
  LOGIN_ITEM_GET: 'app:login-item-get',
  NOTCH_METRICS: 'notch:metrics',
  DISPLAYS_CHANGED: 'displays:changed',
  DISPLAYS_LIST: 'displays:list',
  UI_SET_DISPLAY: 'ui:set-display',
  DOCK_TOGGLE: 'dock:toggle',
  DOCK_EXPAND: 'dock:expand',
  DOCK_SET_HIDDEN: 'dock:set-hidden',
  DOCK_RESIZE: 'dock:resize',
  ATTACHMENT_INSPECT: 'attachment:inspect',
  ATTACHMENT_SAVE_PASTE: 'attachment:save-paste',
  SKILL_INSTALL: 'skill:install',
  LOGIN_ITEM_SET: 'app:login-item-set',
} as const;

export const SPRITE_PROTOCOL = 'thq-sprite';
export const SPRITE_HOST = 'creature';
export const BUILTIN_SPRITE_PREFIX = 'builtin:';
export const DEFAULT_SPRITE = 'hatchling';
export const SPRITE_ALIASES: Record<string, string> = { dozer: 'hampotamos', egg: 'hatchling' };
export const MCP_SERVER_NAME = 'thq';
export const PERMISSION_TOOL = 'approve';
export const ASK_TOOL = 'ask_creature';
export const MAX_HANDOFF_DEPTH = 2;
export const NOTCH_SHORTCUT = 'Alt+Space';
export const DOCK_SHORTCUT = 'Alt+Shift+Space';
export const DOCK_MINIMIZED_KEY = 'thq-dock-minimized';
export const NOTCH_TARGET_KEY = 'thq-notch-target';
export const DEFAULT_DOCK_SIZE = { width: 640, height: 112 };
export const MIN_DOCK_SIZE = { width: 360, height: 84 };
export const MAX_DOCK_HEIGHT = 220;
export const HATCHERY_ID = 'hatchery';
