#!/usr/bin/env node
// In unpackaged `pnpm dev`, macOS Dock hover text uses the .app *folder name* (Electron.app),
// not CFBundleDisplayName. Packaged builds are named correctly by electron-builder.
// Rename the bundle, fix path.txt, and sync Info.plist before electron-vite launches.
import { execFileSync } from 'node:child_process';
import { existsSync, renameSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

if (process.platform !== 'darwin') process.exit(0);

const NAME = 'Open Laser Studio';
const APP_ID = 'org.openlaserstudio.desktop';
const desktopRoot = join(dirname(fileURLToPath(import.meta.url)), '../apps/desktop');
const require = createRequire(join(desktopRoot, 'package.json'));

let electronPkg;
try {
  electronPkg = dirname(require.resolve('electron/package.json'));
} catch {
  process.exit(0);
}

const dist = join(electronPkg, 'dist');
const pathTxt = join(electronPkg, 'path.txt');
const stockApp = join(dist, 'Electron.app');
const namedApp = join(dist, `${NAME}.app`);

if (existsSync(stockApp)) {
  if (existsSync(namedApp)) {
    // Prefer a fresh stock bundle after an electron reinstall.
    execFileSync('rm', ['-rf', namedApp]);
  }
  renameSync(stockApp, namedApp);
} else if (!existsSync(namedApp)) {
  process.exit(0);
}

// electron's path.txt reader does not trim; a trailing newline makes spawn ENOENT.
writeFileSync(pathTxt, `${NAME}.app/Contents/MacOS/Electron`);

const plist = join(namedApp, 'Contents/Info.plist');
if (!existsSync(plist)) process.exit(0);

const setString = (key, value) => {
  execFileSync('plutil', ['-replace', key, '-string', value, plist]);
};

setString('CFBundleName', NAME);
setString('CFBundleDisplayName', NAME);
setString('CFBundleIdentifier', APP_ID);

// Refresh Launch Services so Dock / Cmd-Tab pick up the new name.
const lsregister =
  '/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister';
if (existsSync(lsregister)) {
  try {
    execFileSync(lsregister, ['-f', namedApp], { stdio: 'ignore' });
  } catch {
    // Non-fatal: name still works after relaunch even if registration fails.
  }
}
