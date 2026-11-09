#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."
APP_NAME="Trainer HQ.app"
TARGET="/Applications/$APP_NAME"

npm run build
npx electron-builder --mac --dir
BUILT="$(ls -d dist/mac*/"$APP_NAME" | head -1)"
codesign --force --deep --sign - "$BUILT"

pkill -f "$APP_NAME/Contents/MacOS" || true
rm -rf "$TARGET"
cp -R "$BUILT" /Applications/
echo "Installed $TARGET"

if [ "${1:-}" != "--no-open" ]; then
  open "$TARGET"
fi
