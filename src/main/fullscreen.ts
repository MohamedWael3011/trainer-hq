import { spawn, type ChildProcess } from 'child_process';
import { createInterface } from 'readline';

const RESTART_DELAY_MS = 5000;

// Long-running JXA loop: every second, checks which displays are showing a full-screen app and
// prints "FULL <display ids>" whenever that changes. Panel windows
// float above full-screen Spaces no matter their collection behavior, so the notch and dock have
// to be hidden by hand.
//
// The answer comes from macOS's own Spaces list (a full-screen app's Space has type 4), which is
// right on any display, plus any window covering the whole display including the menu bar (apps
// with their own full-screen mode). The rest of the window-geometry guess is only the fallback if
// the Spaces list can't be read: it was tuned on a notched MacBook screen and mistakes maximized
// windows on other displays for full screen.
const SCRIPT = `
ObjC.import('CoreGraphics');
ObjC.import('AppKit');
// Full-screen windows on notched MacBooks start just under the menu-bar band (y=37 on a 1512x982 screen).
var TOP_BAND = 48;
function isFull(ownPid) {
  var frame = $.NSScreen.screens.objectAtIndex(0).frame;
  var list = ObjC.castRefToObject($.CGWindowListCopyWindowInfo($.kCGWindowListOptionOnScreenOnly | $.kCGWindowListExcludeDesktopElements, 0));
  var coversAll = false;
  var fillsBelowTop = false;
  var desktopDock = false;
  for (var i = 0; i < list.count; i++) {
    var info = list.objectAtIndex(i);
    var layer = info.objectForKey('kCGWindowLayer').intValue;
    var owner = ObjC.unwrap(info.objectForKey('kCGWindowOwnerName')) || '';
    var b = info.objectForKey('kCGWindowBounds');
    var x = b.objectForKey('X').doubleValue, y = b.objectForKey('Y').doubleValue;
    var w = b.objectForKey('Width').doubleValue, h = b.objectForKey('Height').doubleValue;
    // The Dock keeps a screen-sized window on ordinary desktops; a full-screen Space has none.
    if (owner === 'Dock' && layer === 20 && w >= frame.size.width && h >= frame.size.height) { desktopDock = true; continue; }
    if (layer !== 0 || info.objectForKey('kCGWindowOwnerPID').intValue === ownPid) continue;
    if (x !== 0 || w < frame.size.width || y + h < frame.size.height) continue;
    if (y === 0) coversAll = true;
    else if (y <= TOP_BAND) fillsBelowTop = true;
  }
  // A maximized window can also fill everything under the menu bar, but then the Dock's window is there.
  return { coversAll: coversAll, guess: coversAll || (fillsBelowTop && !desktopDock) };
}
ObjC.bindFunction('CGSMainConnectionID', ['int', []]);
ObjC.bindFunction('CGSCopyManagedDisplaySpaces', ['id', ['int']]);
ObjC.bindFunction('CGDisplayCreateUUIDFromDisplayID', ['void *', ['unsigned int']]);
ObjC.bindFunction('CFUUIDCreateString', ['id', ['void *', 'void *']]);
var FULLSCREEN_SPACE = 4;
function uuidOf(id) {
  return ObjC.unwrap($.CFUUIDCreateString(null, $.CGDisplayCreateUUIDFromDisplayID(id)));
}
// Display ids (as Electron reports them) currently showing a full-screen app.
function fullDisplays(ownPid) {
  var screens = $.NSScreen.screens;
  var mainHeight = screens.objectAtIndex(0).frame.size.height;
  var spaces = null;
  try { spaces = ObjC.deepUnwrap($.CGSCopyManagedDisplaySpaces($.CGSMainConnectionID())); } catch (e) {}
  var list = ObjC.castRefToObject($.CGWindowListCopyWindowInfo($.kCGWindowListOptionOnScreenOnly | $.kCGWindowListExcludeDesktopElements, 0));
  var windows = [];
  for (var i = 0; i < list.count; i++) {
    var info = list.objectAtIndex(i);
    if (info.objectForKey('kCGWindowLayer').intValue !== 0 || info.objectForKey('kCGWindowOwnerPID').intValue === ownPid) continue;
    var b = info.objectForKey('kCGWindowBounds');
    windows.push({ x: b.objectForKey('X').doubleValue, y: b.objectForKey('Y').doubleValue, w: b.objectForKey('Width').doubleValue, h: b.objectForKey('Height').doubleValue });
  }
  var ids = [];
  for (var s = 0; s < screens.count; s++) {
    var screen = screens.objectAtIndex(s);
    var id = screen.deviceDescription.objectForKey('NSScreenNumber').unsignedIntValue;
    var f = screen.frame;
    // Window bounds use top-left coordinates from the main display; screen frames use bottom-left.
    var top = mainHeight - (f.origin.y + f.size.height);
    var full = null;
    if (spaces && spaces.length) {
      var uuid = uuidOf(id);
      // "Main" when all displays share one set of Spaces ("Displays have separate Spaces" off).
      var entry = spaces.filter(function (d) { return d['Display Identifier'] === uuid; })[0]
        || (s === 0 ? spaces.filter(function (d) { return d['Display Identifier'] === 'Main'; })[0] : null)
        || (s === 0 && spaces.length === 1 ? spaces[0] : null);
      if (entry && entry['Current Space']) full = entry['Current Space'].type === FULLSCREEN_SPACE;
    }
    // Apps with their own full-screen mode (browser video, some terminals and games) cover the whole
    // display, menu bar included, without a full-screen Space; no maximized window does that.
    var covers = windows.some(function (w) { return w.x === f.origin.x && w.y === top && w.w >= f.size.width && w.h >= f.size.height; });
    if (full === null && s === 0) { try { full = isFull(ownPid).guess; } catch (e) {} }
    if (full || covers) ids.push(id);
  }
  return ids;
}
function run(argv) {
  var ownPid = parseInt(argv[0], 10);
  var last = null;
  while (true) {
    var ids = [];
    try { ids = fullDisplays(ownPid); } catch (e) {}
    var line = 'FULL ' + ids.join(',');
    if (line !== last) { console.log(line); last = line; }
    delay(1);
  }
}
`;

// Calls back with the ids of the displays showing a full-screen app, whenever that changes.
export const watchFullscreen = (onChange: (displayIds: number[]) => void): (() => void) => {
  if (process.platform !== 'darwin') return () => undefined;
  let child: ChildProcess | undefined;
  let stopped = false;
  let restart: NodeJS.Timeout | undefined;

  const start = (): void => {
    child = spawn('/usr/bin/osascript', ['-l', 'JavaScript', '-e', SCRIPT, String(process.pid)], { stdio: ['ignore', 'ignore', 'pipe'] });
    // osascript's console.log writes to stderr.
    if (child.stderr) createInterface({ input: child.stderr }).on('line', (line) => {
      const match = line.trim().match(/^FULL\s*([\d,]*)$/);
      if (match) onChange(match[1].split(',').filter(Boolean).map(Number));
    });
    child.on('exit', () => {
      if (stopped) return;
      onChange([]);
      restart = setTimeout(start, RESTART_DELAY_MS);
    });
    child.on('error', () => undefined);
  };

  start();
  return () => {
    stopped = true;
    if (restart) clearTimeout(restart);
    child?.kill();
  };
};
