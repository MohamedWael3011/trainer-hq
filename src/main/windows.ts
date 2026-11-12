import { join } from 'path';
import { BrowserWindow, screen } from 'electron';
import { Ipc, MAX_DOCK_HEIGHT, MIN_DOCK_SIZE, Surface, type SurfaceType } from '@shared/constants';
import type { DockSizeType, NotchMetricsType } from '@shared/types';

// Displays report several changes while a monitor connects; wait for them to settle.
const DISPLAY_SETTLE_MS = 400;
const NOTCH_SIZE = { width: 520, height: 520 };
const HARDWARE_NOTCH_MIN_BAR = 32;
const HARDWARE_NOTCH_WIDTH = 200;
const NOTCH_WING = 64;
const PILL_WIDTH = 200;
const OVERLAY_ACTIVATE_GRACE_MS = 2500;
const PANEL_TYPE = 'panel';
const DASHBOARD_SIZE = { width: 1180, height: 780 };
const DOCK_GAP = 6;
const OVERLAY_LEVEL = 'screen-saver';
const FLOATING_LEVEL = 'floating';

const preload = join(__dirname, '../preload/index.js');

const load = (win: BrowserWindow, surface: SurfaceType): void => {
  const devUrl = process.env.ELECTRON_RENDERER_URL;
  if (devUrl) void win.loadURL(`${devUrl}#${surface}`);
  else void win.loadFile(join(__dirname, '../renderer/index.html'), { hash: surface });
};

const overlay = (bounds: Electron.Rectangle, focusable: boolean, overMenuBar = false): BrowserWindow =>
  new BrowserWindow({
    ...bounds,
    enableLargerThanScreen: overMenuBar,
    type: PANEL_TYPE,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    hasShadow: false,
    skipTaskbar: true,
    focusable,
    show: false,
    backgroundColor: '#00000000',
    webPreferences: { preload, sandbox: false, contextIsolation: true },
  });

export class Windows {
  dock!: BrowserWindow;
  notch!: BrowserWindow;
  dashboard: BrowserWindow | undefined;
  private lastOverlayAt = 0;
  private interactive = new Set<SurfaceType>();
  private dockWanted = true;
  private dockSize: DockSizeType = MIN_DOCK_SIZE;
  private placeTimer: NodeJS.Timeout | undefined;
  private fullscreen = false;

  // Clicking or typing in the notch or dock can activate the app, which macOS reports as a
  // reopen. Treat the overlays as "in use" while the pointer is over them or they have focus,
  // and for a short grace period after, so that activation never pops the dashboard open.
  recentlyUsedOverlay(): boolean {
    if (this.interactive.size > 0) return true;
    if ([this.notch, this.dock].some((win) => win && !win.isDestroyed() && win.isFocused())) return true;
    return Date.now() - this.lastOverlayAt < OVERLAY_ACTIVATE_GRACE_MS;
  }

  private trackOverlay(win: BrowserWindow): void {
    const mark = (): void => { this.lastOverlayAt = Date.now(); };
    win.on('focus', mark);
    win.on('blur', mark);
  }

  private dockBounds(size: DockSizeType): Electron.Rectangle {
    const area = screen.getPrimaryDisplay().workArea;
    const width = Math.round(Math.min(Math.max(size.width, MIN_DOCK_SIZE.width), area.width - 40));
    const height = Math.round(Math.min(Math.max(size.height, MIN_DOCK_SIZE.height), MAX_DOCK_HEIGHT));
    return {
      x: Math.round(area.x + (area.width - width) / 2),
      y: area.y + area.height - height - DOCK_GAP,
      width,
      height,
    };
  }

  resizeDock(size: DockSizeType): DockSizeType {
    this.dockSize = size;
    const bounds = this.dockBounds(size);
    this.dock.setBounds(bounds);
    return { width: bounds.width, height: bounds.height };
  }

  // The notch sits at the top centre of the main display (the one with the menu bar).
  private notchBounds(): Electron.Rectangle {
    const bounds = screen.getPrimaryDisplay().bounds;
    return {
      x: Math.round(bounds.x + (bounds.width - NOTCH_SIZE.width) / 2),
      y: bounds.y,
      ...NOTCH_SIZE,
    };
  }

  // Plugging in a monitor, unplugging it, or changing which display is main moves the menu bar.
  // Move the notch and dock with it, and let the notch redraw for a display with or without a notch.
  private replace(): void {
    if (this.placeTimer) clearTimeout(this.placeTimer);
    this.placeTimer = setTimeout(() => {
      this.placeTimer = undefined;
      if (!this.notch.isDestroyed()) {
        this.notch.setBounds(this.notchBounds());
        this.notch.webContents.send(Ipc.DISPLAYS_CHANGED);
      }
      if (!this.dock.isDestroyed()) this.dock.setBounds(this.dockBounds(this.dockSize));
    }, DISPLAY_SETTLE_MS);
  }

  create(dockHidden: boolean, dockSize: DockSizeType): void {
    this.dockSize = dockSize;
    this.dock = overlay(this.dockBounds(dockSize), true);
    this.dock.setAlwaysOnTop(true, FLOATING_LEVEL);
    this.dock.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: false });
    this.dock.setIgnoreMouseEvents(true, { forward: true });
    load(this.dock, Surface.DOCK);
    this.trackOverlay(this.dock);
    this.dockWanted = !dockHidden;
    this.dock.once('ready-to-show', () => {
      if (this.dockWanted && !this.fullscreen) this.dock.showInactive();
    });

    const notchBounds = this.notchBounds();
    this.notch = overlay(notchBounds, true, true);
    this.notch.setBounds(notchBounds);
    this.notch.setAlwaysOnTop(true, OVERLAY_LEVEL);
    this.notch.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: false });
    this.notch.setIgnoreMouseEvents(true, { forward: true });
    load(this.notch, Surface.NOTCH);
    this.trackOverlay(this.notch);
    this.notch.once('ready-to-show', () => {
      if (!this.fullscreen) this.notch.showInactive();
    });
    const replace = (): void => this.replace();
    screen.on('display-added', replace);
    screen.on('display-removed', replace);
    screen.on('display-metrics-changed', replace);
  }

  notchMetrics(): NotchMetricsType {
    const display = screen.getPrimaryDisplay();
    const barHeight = Math.max(24, display.workArea.y - display.bounds.y);
    const hasNotch = barHeight >= HARDWARE_NOTCH_MIN_BAR;
    return {
      barHeight,
      hasNotch,
      notchWidth: hasNotch ? HARDWARE_NOTCH_WIDTH : 0,
      pillWidth: hasNotch ? HARDWARE_NOTCH_WIDTH + NOTCH_WING * 2 : PILL_WIDTH,
      panelWidth: NOTCH_SIZE.width,
      panelHeight: NOTCH_SIZE.height,
    };
  }

  setDockVisible(visible: boolean): void {
    this.dockWanted = visible;
    this.applyDock();
  }

  // Another app is full screen on the primary display: get out of its way.
  setFullscreen(fullscreen: boolean): void {
    if (fullscreen === this.fullscreen) return;
    this.fullscreen = fullscreen;
    this.applyDock();
    if (this.notch.isDestroyed()) return;
    if (fullscreen) {
      this.notch.setIgnoreMouseEvents(true, { forward: true });
      this.interactive.delete(Surface.NOTCH);
      this.notch.hide();
    } else if (!this.notch.isVisible()) {
      this.notch.showInactive();
    }
  }

  private applyDock(): void {
    const visible = this.dockWanted && !this.fullscreen;
    if (this.dock.isDestroyed() || visible === this.dock.isVisible()) return;
    if (visible) {
      this.dock.showInactive();
      this.dock.webContents.send(Ipc.DOCK_EXPAND);
    } else {
      this.dock.setIgnoreMouseEvents(true, { forward: true });
      this.interactive.delete(Surface.DOCK);
      this.dock.hide();
    }
  }

  setInteractive(surface: SurfaceType, interactive: boolean): void {
    const win = surface === Surface.NOTCH ? this.notch : surface === Surface.DOCK ? this.dock : undefined;
    if (!win) return;
    this.lastOverlayAt = Date.now();
    if (interactive) this.interactive.add(surface);
    else this.interactive.delete(surface);
    win.setIgnoreMouseEvents(!interactive, { forward: true });
    if (!interactive && surface === Surface.NOTCH && this.fullscreen) {
      win.hide();
    } else if (!interactive && surface === Surface.NOTCH && win.isFocused()) {
      win.hide();
      win.showInactive();
    }
  }

  openNotchAnimated(): void {
    this.setInteractive(Surface.NOTCH, true);
    this.notch.webContents.send(Ipc.NOTCH_TOGGLE, { instant: false });
  }

  toggleNotchFromShortcut(): void {
    this.lastOverlayAt = Date.now();
    this.setInteractive(Surface.NOTCH, true);
    this.notch.show();
    this.notch.focus();
    this.notch.webContents.send(Ipc.NOTCH_TOGGLE, { instant: true });
  }

  openDashboard(creatureId?: string): void {
    if (!this.dashboard || this.dashboard.isDestroyed()) {
      this.dashboard = new BrowserWindow({
        ...DASHBOARD_SIZE,
        minWidth: 760,
        minHeight: 520,
        titleBarStyle: 'hiddenInset',
        vibrancy: 'under-window',
        visualEffectState: 'active',
        backgroundColor: '#00000000',
        show: false,
        title: 'Trainer HQ',
        webPreferences: { preload, sandbox: false, contextIsolation: true },
      });
      load(this.dashboard, Surface.DASHBOARD);
      this.dashboard.once('ready-to-show', () => {
        this.dashboard?.show();
        if (creatureId) this.dashboard?.webContents.send(Ipc.FOCUS_CREATURE, creatureId);
      });
      return;
    }
    this.dashboard.show();
    this.dashboard.focus();
    if (creatureId) this.dashboard.webContents.send(Ipc.FOCUS_CREATURE, creatureId);
  }

  labeled(): [string, BrowserWindow][] {
    const entries: [string, BrowserWindow | undefined][] = [
      [Surface.DOCK, this.dock],
      [Surface.NOTCH, this.notch],
      [Surface.DASHBOARD, this.dashboard],
    ];
    return entries.filter((entry): entry is [string, BrowserWindow] => !!entry[1] && !entry[1].isDestroyed());
  }

  all(): BrowserWindow[] {
    return [this.dock, this.notch, this.dashboard].filter((win): win is BrowserWindow => !!win && !win.isDestroyed());
  }
}
