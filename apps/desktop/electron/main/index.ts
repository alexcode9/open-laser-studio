import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { BrowserWindow, app, nativeImage, session, shell } from 'electron';

import { registerIpc } from './ipc';
import { addLogSink, initLogger, log } from './logger';
import { MachineHost } from './machine';
import { type NativeModule, loadNative } from './native';
import { SettingsStore } from './settings';

const here = fileURLToPath(new URL('.', import.meta.url));
const devUrl = process.env.ELECTRON_RENDERER_URL;
const isDev = !app.isPackaged && !!devUrl;

if (process.env.OLS_USER_DATA_DIR) app.setPath('userData', process.env.OLS_USER_DATA_DIR);

// productName in package.json is used when packaged; set it explicitly for unpackaged runs too.
app.setName('Open Laser Studio');

// One instance only: two instances could command the same (simulated or real) machine.
if (!app.requestSingleInstanceLock()) {
  app.quit();
}
app.enableSandbox();

let mainWindow: BrowserWindow | null = null;

/** Source PNG used by electron-builder (`buildResources`). Packaged builds get the OS bundle icon. */
function resolveAppIconPath(): string | null {
  const candidates = [
    join(app.getAppPath(), 'build/icon.png'),
    join(here, '../../build/icon.png'),
  ];
  return candidates.find((p) => existsSync(p)) ?? null;
}

function csp(): string {
  const connect = isDev ? "'self' ws://localhost:* http://localhost:*" : "'self'";
  const script = isDev ? "'self' 'unsafe-inline'" : "'self'";
  return [
    "default-src 'self'",
    `script-src ${script}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    `connect-src ${connect}`,
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join('; ');
}

function isTrustedSender(url: string): boolean {
  if (isDev && devUrl) return url.startsWith(devUrl);
  return url.startsWith('file://');
}

function createWindow(): BrowserWindow {
  const iconPath = !app.isPackaged ? resolveAppIconPath() : null;
  const win = new BrowserWindow({
    width: 1600,
    height: 980,
    minWidth: 1100,
    minHeight: 700,
    show: false,
    backgroundColor: '#0b0d10',
    title: 'Open Laser Studio',
    autoHideMenuBar: true,
    ...(iconPath ? { icon: iconPath } : {}),
    webPreferences: {
      preload: join(here, '../preload/index.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webviewTag: false,
      spellcheck: false,
      devTools: !app.isPackaged || process.env.OLS_DEVTOOLS === '1',
    },
  });
  win.once('ready-to-show', () => win.show());

  // Navigation is never allowed away from the app; external links open in the OS browser.
  win.webContents.on('will-navigate', (e, url) => {
    if (!isTrustedSender(url)) {
      e.preventDefault();
      log('warn', 'blocked navigation', { url });
    }
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-attach-webview', (e) => e.preventDefault());

  if (isDev && devUrl) void win.loadURL(devUrl);
  else void win.loadFile(join(here, '../renderer/index.html'));
  return win;
}

void app.whenReady().then(() => {
  const logPath = initLogger(join(app.getPath('userData'), 'logs'));
  log('info', 'starting', { version: app.getVersion(), logPath, dev: isDev });

  // macOS dock uses the .app bundle icon when packaged; in `pnpm dev` set it from build/icon.png.
  if (!app.isPackaged && process.platform === 'darwin') {
    const iconPath = resolveAppIconPath();
    if (iconPath) {
      const img = nativeImage.createFromPath(iconPath);
      if (!img.isEmpty()) app.dock?.setIcon(img);
    }
  }

  session.defaultSession.webRequest.onHeadersReceived((details, cb) => {
    cb({ responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [csp()] } });
  });
  session.defaultSession.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
  session.defaultSession.setPermissionCheckHandler(() => false);

  const settings = new SettingsStore(app.getPath('userData'));
  let native: NativeModule | null = null;
  let nativeError: string | null = null;
  try {
    native = loadNative(app.getAppPath(), process.resourcesPath);
    log('info', 'native core loaded', { ...native.nativeInfo() });
  } catch (e) {
    nativeError = e instanceof Error ? e.message : String(e);
    log('error', 'native core unavailable', { error: nativeError });
  }

  const machine = native
    ? new MachineHost(native, (snap) => {
        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('machine:snapshot', snap);
      })
    : null;
  if (machine) machine.speed = settings.get().simSpeed;

  addLogSink((entry) => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('app:log', entry);
  });

  registerIpc({ window: () => mainWindow, native, nativeError, settings, machine, isTrustedSender });

  mainWindow = createWindow();
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.on('before-quit', () => {
    // Always latch a stop on the way out; never leave a (simulated) job running.
    machine?.emergencyStopQuiet();
    machine?.dispose();
    log('info', 'quit');
  });
});

app.on('window-all-closed', () => {
  app.quit();
});
