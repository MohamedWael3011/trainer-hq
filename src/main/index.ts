import { join } from 'path';
import { app, dialog, globalShortcut, ipcMain, net, Notification, protocol, shell } from 'electron';
import { DOCK_SHORTCUT, Ipc, LAB_PROTOCOL, OUTPUT_PROTOCOL, NOTCH_SHORTCUT, SPRITE_PROTOCOL, type AutonomyType, type SurfaceType } from '@shared/constants';
import type { CreatureContextRequestType, ScheduleSaveRequestType, SessionAdoptRequestType, ApprovalDecisionType, ChatRequestType, DaycareDecisionType, DockSizeType, HatchRequestType, LabShootRequestType, ProfileCreateRequestType, ProfileSettingsType, SkillInstallRequestType, ThreadCreateRequestType } from '@shared/types';
import { expandHome } from './paths';
import { pathToFileURL } from 'url';
import { inspectAttachment, savePastedFile } from './attachments';
import { loadLoginShellPath } from './env';
import { watchFullscreen } from './fullscreen';
import { openLocal } from './links';
import { resourcesDir } from './paths';
import { Hq } from './hq';
import { registerSpriteProtocol } from './sprites';
import { runSmokeIfRequested } from './smoke';
import { Windows } from './windows';

protocol.registerSchemesAsPrivileged([
  { scheme: SPRITE_PROTOCOL, privileges: { standard: true, secure: true, supportFetchAPI: true, bypassCSP: true } },
  { scheme: LAB_PROTOCOL, privileges: { standard: true, secure: true, supportFetchAPI: true, bypassCSP: true } },
  { scheme: OUTPUT_PROTOCOL, privileges: { standard: true, secure: true, supportFetchAPI: true, bypassCSP: true } },
]);

if (!process.env.THQ_SMOKE_DIR && !app.requestSingleInstanceLock()) app.quit();

const hq = new Hq();
const windows = new Windows();
let stopFullscreenWatch: (() => void) | undefined;

const registerIpc = (): void => {
  ipcMain.handle(Ipc.STATE_GET, () => hq.getState());
  ipcMain.handle(Ipc.LIVE_GET, () => hq.getLive());
  ipcMain.handle(Ipc.CHAT_SEND, (_event, request: ChatRequestType) => hq.chat(request));
  ipcMain.handle(Ipc.HATCH_START, (_event, request: HatchRequestType) => hq.hatch(request));
  ipcMain.handle(Ipc.QUEST_CANCEL, (_event, questId: string) => hq.cancel(questId));
  ipcMain.handle(Ipc.APPROVAL_DECIDE, (_event, decision: ApprovalDecisionType) => hq.decideApproval(decision));
  ipcMain.handle(Ipc.CREATURE_AUTONOMY, (_event, id: string, autonomy: AutonomyType) => hq.setAutonomy(id, autonomy));
  ipcMain.handle(Ipc.CREATURE_MODEL, (_event, id: string, model: string) => hq.setModel(id, model));
  ipcMain.handle(Ipc.CREATURE_EFFORT, (_event, id: string, effort: string) => hq.setEffort(id, effort));
  ipcMain.handle(Ipc.CREATURE_ENGINE, (_event, id: string, engine: string) => hq.setEngine(id, engine));
  ipcMain.handle(Ipc.ENGINE_MODELS, (_event, engine: string) => hq.engineModels(engine));
  ipcMain.handle(Ipc.CREATURE_SPRITE, (_event, id: string, path: string) => hq.setSprite(id, path));
  ipcMain.handle(Ipc.CREATURE_SPRITE_RESET, (_event, id: string) => hq.resetSprite(id));
  ipcMain.handle(Ipc.DAYCARE_DECIDE, (_event, decision: DaycareDecisionType) => hq.decideDaycare(decision));
  ipcMain.handle(Ipc.PROFILE_SWITCH, (_event, profileId: string) => hq.switchProfile(profileId));
  ipcMain.handle(Ipc.AUTH_REFRESH, () => hq.refreshAuth());
  ipcMain.handle(Ipc.CREATURES_REORDER, (_event, ids: string[]) => hq.reorderCreatures(ids));
  ipcMain.handle(Ipc.SETTINGS_GET, () => hq.getSettings());
  ipcMain.handle(Ipc.SETTINGS_SAVE, (_event, settings: ProfileSettingsType) => hq.saveSettings(settings));
  ipcMain.handle(Ipc.PICK_FOLDER, async (_event, defaultPath?: string) => {
    const owner = windows.dashboard && !windows.dashboard.isDestroyed() ? windows.dashboard : undefined;
    const options: Electron.OpenDialogOptions = { properties: ['openDirectory', 'createDirectory'], defaultPath: defaultPath ? expandHome(defaultPath) : undefined };
    const result = owner ? await dialog.showOpenDialog(owner, options) : await dialog.showOpenDialog(options);
    return result.canceled ? undefined : result.filePaths[0];
  });
  ipcMain.handle(Ipc.PREREQS, () => hq.prerequisites());
  ipcMain.handle(Ipc.ONBOARDING_DONE, (_event, done: boolean) => hq.setOnboarded(done));
  ipcMain.handle(Ipc.CREATURES_POINT, (_event, repoPath: string) => hq.pointCreaturesAt(repoPath));
  ipcMain.handle(Ipc.LAB_STATE, () => ({ ...hq.lab.state(), examples: hq.lab.exampleFlows() }));
  ipcMain.handle(Ipc.LAB_START_SERVER, (_event, id: string) => hq.lab.startServer(id));
  ipcMain.handle(Ipc.LAB_STOP_SERVER, (_event, id: string) => hq.lab.stopServer(id));
  ipcMain.handle(Ipc.LAB_SHOOT, (_event, request: LabShootRequestType) => hq.lab.shoot(request));
  ipcMain.handle(Ipc.LAB_CREATE, (_event, topic: string, ref: string) => hq.lab.createWorkspace(topic, ref));
  ipcMain.handle(Ipc.LAB_IMPORT, (_event, id: string, flow: string) => hq.lab.importExamples(id, flow));
  ipcMain.handle(Ipc.LAB_CANCEL, (_event, jobId: string) => hq.lab.cancel(jobId));
  ipcMain.handle(Ipc.LAB_FREE_SPACE, (_event, id: string) => hq.lab.freeSpace(id));
  ipcMain.handle(Ipc.THREAD_CREATE, (_event, request: ThreadCreateRequestType) => hq.createThread(request));
  ipcMain.handle(Ipc.THREAD_ARCHIVE, (_event, id: string, removeWorktree: boolean) => hq.archiveThread(id, removeWorktree));
  ipcMain.handle(Ipc.THREAD_CLEAR, (_event, creatureId: string, threadId?: string) => hq.clearThread(creatureId, threadId));
  ipcMain.handle(Ipc.THREAD_COMPACT, (_event, creatureId: string, threadId?: string) => hq.compactThread(creatureId, threadId));
  ipcMain.handle(Ipc.UPDATE_CHECK, () => hq.checkUpdate());
  ipcMain.handle(Ipc.UPDATE_INSTALL, () => hq.installUpdate());
  ipcMain.handle(Ipc.THREAD_TERMINAL, (_event, creatureId: string, threadId?: string) => hq.openThreadInTerminal(creatureId, threadId));
  ipcMain.handle(Ipc.THREAD_HELD_SEND, (_event, creatureId: string, threadId?: string) => hq.sendHeldNow(creatureId, threadId));
  ipcMain.handle(Ipc.COMMANDS_LIST, (_event, creatureId: string) => hq.listCommands(creatureId));
  ipcMain.handle(Ipc.THREAD_QUEUED_CANCEL, (_event, creatureId: string, threadId?: string) => hq.cancelQueued(creatureId, threadId));
  ipcMain.handle(Ipc.THREAD_HELD_CANCEL, (_event, creatureId: string, threadId?: string) => hq.cancelHeld(creatureId, threadId));
  ipcMain.handle(Ipc.AUTH_LOGIN, () => hq.openLogin());
  ipcMain.handle(Ipc.PROFILE_CREATE, (_event, request: ProfileCreateRequestType) => hq.createProfile(request));
  ipcMain.handle(Ipc.OPEN_DASHBOARD, (_event, creatureId?: string) => windows.openDashboard(creatureId));
  ipcMain.handle(Ipc.SURFACE_INTERACTIVE, (_event, surface: SurfaceType, interactive: boolean) => windows.setInteractive(surface, interactive));
  ipcMain.handle(Ipc.OPEN_PATH, (_event, target?: string) => shell.openPath(target ?? hq.vaultPath()));
  ipcMain.handle(Ipc.SIGN_IN, (_event, kind: unknown) => hq.signIn(kind));
  ipcMain.handle(Ipc.OPEN_LOCAL, (_event, target: string, baseDir?: string) => openLocal(target, [baseDir, hq.vaultPath()].filter((dir): dir is string => !!dir)));
  ipcMain.handle(Ipc.LOGIN_ITEM_GET, () => app.getLoginItemSettings().openAtLogin);
  ipcMain.handle(Ipc.NOTCH_METRICS, () => windows.notchMetrics());
  ipcMain.handle(Ipc.DISPLAYS_LIST, () => windows.listDisplays());
  ipcMain.handle(Ipc.UI_SET_DISPLAY, (_event, surface: 'notch' | 'dock', displayId: number) => hq.setOverlayDisplay(surface, displayId));
  ipcMain.handle(Ipc.ATTACHMENT_INSPECT, (_event, path: string) => inspectAttachment(path));
  ipcMain.handle(Ipc.ATTACHMENT_SAVE_PASTE, (_event, data: ArrayBuffer, type: string) => savePastedFile(data, type));
  ipcMain.handle(Ipc.SKILL_INSTALL, (_event, request: SkillInstallRequestType) => hq.installSkill(request));
  ipcMain.handle(Ipc.DOCK_SET_HIDDEN, (_event, hidden: boolean) => hq.setDockHidden(hidden));
  ipcMain.handle(Ipc.DOCK_RESIZE, (_event, size: DockSizeType, persist: boolean) => {
    const applied = windows.resizeDock(size);
    if (persist) hq.setDockSize(applied);
    return applied;
  });
  ipcMain.handle(Ipc.CREATURE_CONTEXT, (_event, request: CreatureContextRequestType) => hq.setCreatureContext(request));
  ipcMain.handle(Ipc.CREATURE_BUDGET, (_event, creatureId: string, weeklyUsd: number) => hq.setCreatureBudget(creatureId, weeklyUsd));
  ipcMain.handle(Ipc.BRAIN_HEALTH, (_event, creatureId: string) => hq.brainHealth(creatureId));
  ipcMain.handle(Ipc.SCHEDULE_SAVE, (_event, request: ScheduleSaveRequestType) => hq.saveSchedule(request));
  ipcMain.handle(Ipc.SCHEDULE_DELETE, (_event, id: string) => hq.deleteSchedule(id));
  ipcMain.handle(Ipc.SCHEDULE_RUN, (_event, id: string) => hq.runSchedule(id));
  ipcMain.handle(Ipc.SESSION_ADOPT, (_event, request: SessionAdoptRequestType) => hq.adoptSession(request));
  ipcMain.handle(Ipc.LOGIN_ITEM_SET, (_event, enabled: boolean) => app.setLoginItemSettings({ openAtLogin: enabled, openAsHidden: true }));
};

app.on('web-contents-created', (_event, contents) => {
  contents.on('will-navigate', (event) => event.preventDefault());
  contents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
});

app.whenReady().then(async () => {
  loadLoginShellPath();
  if (!app.isPackaged) app.dock?.setIcon(join(resourcesDir(), 'icon.png'));
  await hq.start();
  registerSpriteProtocol((id) => hq.spritePath(id));
  protocol.handle(LAB_PROTOCOL, (request) => {
    const file = hq.lab.resolveShot(decodeURIComponent(new URL(request.url).pathname.replace(/^\/+/, '')));
    return file ? net.fetch(pathToFileURL(file).toString()) : new Response('Not found', { status: 404 });
  });
  protocol.handle(OUTPUT_PROTOCOL, (request) => {
    // thq-output://f/Users/me/shots/home.png: the path is the URL path.
    const file = decodeURIComponent(new URL(request.url).pathname);
    return hq.isOutput(file) ? net.fetch(pathToFileURL(file).toString()) : new Response('Not found', { status: 404 });
  });
  hq.onLab(() => windows.dashboard?.webContents.send(Ipc.LAB_STATE));
  registerIpc();
  windows.create(hq.isDockHidden(), hq.dockSize(), hq.getState().ui.notchDisplay, hq.getState().ui.dockDisplay);
  if (!app.getLoginItemSettings().wasOpenedAtLogin) windows.openDashboard();
  runSmokeIfRequested({ windows: () => windows.labeled(), state: () => hq.getState(), chat: (request) => hq.chat(request), openNotch: () => windows.toggleNotchFromShortcut(), openView: (view) => windows.dashboard?.webContents.send(Ipc.OPEN_VIEW, view), cancel: (questId) => hq.cancel(questId), openNotchAnimated: () => windows.openNotchAnimated() });
  // Dev runs (npm run dev) have no build info and skip the check.
  hq.startUpdateChecks();
  hq.onNudge((nudge) => {
    if (!Notification.isSupported()) return;
    const notification = new Notification({ title: nudge.title, body: nudge.body, silent: true });
    notification.on('click', () => windows.openDashboard());
    notification.show();
  });
  hq.onLive((live) => windows.all().forEach((win) => win.webContents.send(Ipc.LIVE_CHANGED, live)));
  hq.onState((state) => {
    windows.setDockVisible(!state.ui.dockHidden);
    windows.setDisplays(state.ui.notchDisplay, state.ui.dockDisplay);
    windows.all().forEach((win) => win.webContents.send(Ipc.STATE_CHANGED, state));
  });
  stopFullscreenWatch = watchFullscreen((displayIds) => windows.setFullscreenDisplays(displayIds));
  globalShortcut.register(NOTCH_SHORTCUT, () => windows.toggleNotchFromShortcut());
  globalShortcut.register(DOCK_SHORTCUT, () => {
    if (hq.isDockHidden()) hq.setDockHidden(false);
    else windows.dock.webContents.send(Ipc.DOCK_TOGGLE);
  });
  app.on('activate', () => {
    if (windows.recentlyUsedOverlay()) return;
    windows.openDashboard();
  });
  app.on('second-instance', () => windows.openDashboard());
});

app.on('window-all-closed', () => undefined);

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  stopFullscreenWatch?.();
  hq.stop();
});
