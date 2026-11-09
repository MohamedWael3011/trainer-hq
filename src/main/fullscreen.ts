import { spawn, type ChildProcess } from 'child_process';
import { createInterface } from 'readline';

const RESTART_DELAY_MS = 5000;

// Long-running JXA loop: every second, checks whether another app has a normal-layer
// window covering the whole primary display (a full-screen app or video) and prints
// FULL / NOT whenever that changes. Window bounds and owners need no screen-recording
// permission. Panel windows float above full-screen Spaces no matter their collection
// behavior, so the notch and dock have to be hidden by hand.
const SCRIPT = `
ObjC.import('CoreGraphics');
ObjC.import('AppKit');
function isFull(ownPid) {
  var frame = $.NSScreen.screens.objectAtIndex(0).frame;
  var list = ObjC.castRefToObject($.CGWindowListCopyWindowInfo($.kCGWindowListOptionOnScreenOnly | $.kCGWindowListExcludeDesktopElements, 0));
  for (var i = 0; i < list.count; i++) {
    var info = list.objectAtIndex(i);
    if (info.objectForKey('kCGWindowLayer').intValue !== 0) continue;
    if (info.objectForKey('kCGWindowOwnerPID').intValue === ownPid) continue;
    var b = info.objectForKey('kCGWindowBounds');
    if (b.objectForKey('X').doubleValue === 0 && b.objectForKey('Y').doubleValue === 0 &&
        b.objectForKey('Width').doubleValue >= frame.size.width && b.objectForKey('Height').doubleValue >= frame.size.height) return true;
  }
  return false;
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
