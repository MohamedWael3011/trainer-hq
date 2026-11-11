import { spawn, type ChildProcess } from 'child_process';
import { createInterface } from 'readline';

const RESTART_DELAY_MS = 5000;

// Long-running JXA loop: every second, checks whether another app has a normal-layer
// window filling the primary display (a full-screen app or video; on notched MacBooks,
// everything below the menu-bar band, in a Space without the Dock's desktop window) and prints
// FULL / NOT whenever that changes. Window bounds and owners need no screen-recording
// permission. Panel windows float above full-screen Spaces no matter their collection
// behavior, so the notch and dock have to be hidden by hand.
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
  return coversAll || (fillsBelowTop && !desktopDock);
}
function run(argv) {
  var ownPid = parseInt(argv[0], 10);
  var last = null;
  while (true) {
    var full = false;
    try { full = isFull(ownPid); } catch (e) {}
    if (full !== last) { console.log(full ? 'FULL' : 'NOT'); last = full; }
    delay(1);
  }
}
`;

export const watchFullscreen = (onChange: (fullscreen: boolean) => void): (() => void) => {
  if (process.platform !== 'darwin') return () => undefined;
  let child: ChildProcess | undefined;
  let stopped = false;
  let restart: NodeJS.Timeout | undefined;

  const start = (): void => {
    child = spawn('/usr/bin/osascript', ['-l', 'JavaScript', '-e', SCRIPT, String(process.pid)], { stdio: ['ignore', 'ignore', 'pipe'] });
    // osascript's console.log writes to stderr.
    if (child.stderr) createInterface({ input: child.stderr }).on('line', (line) => {
      const value = line.trim();
      if (value === 'FULL') onChange(true);
      else if (value === 'NOT') onChange(false);
    });
    child.on('exit', () => {
      if (stopped) return;
      onChange(false);
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
