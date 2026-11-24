const {
  app,
  BrowserWindow,
  ipcMain,
  session,
  shell,
  systemPreferences,
  desktopCapturer,
} = require('electron');
const path = require('path');
const fs = require('fs');
const net = require('net');
const crypto = require('crypto');
const { spawn } = require('child_process');

// Ultron: one random token per launch, shared only with our own window.
const SESSION_TOKEN = crypto.randomBytes(32).toString('base64url');
// Sites the in-app web windows may load. Everything else opens in the default browser.
const WEB_WINDOW_HOSTS = new Set(['www.instagram.com', 'instagram.com', 'web.whatsapp.com', 'www.youtube.com', 'x.com']);

function appOrigin() {
  return `http://localhost:${activePort}`;
}

function isAppUrl(raw) {
  try {
    return new URL(raw).origin === appOrigin();
  } catch {
    return false;
  }
}

function isHttpUrl(raw) {
  try {
    const u = new URL(raw);
    return (u.protocol === 'https:' || u.protocol === 'http:') && !u.username && !u.password;
  } catch {
    return false;
  }
}

/** IPC calls are only accepted from the main Ultron window. */
function fromApp(event) {
  const url = event?.senderFrame?.url || '';
  return Boolean(mainWindow) && event.sender === mainWindow.webContents && isAppUrl(url);
}

let mainWindow = null;
let serverStarted = false;
let activePort = Number(process.env.PORT) || 3000;

function getAppBundlePath() {
  if (app.isPackaged) {
    // process.execPath => .../AIRA AI Assistant.app/Contents/MacOS/AIRA AI Assistant
    return path.resolve(process.execPath, '..', '..', '..');
  }
  return path.resolve(__dirname, '..');
}

function getPermissionsStatePath() {
  return path.join(app.getPath('userData'), 'permissions-state.json');
}

function readPermissionsState() {
  try {
    const p = getPermissionsStatePath();
    if (fs.existsSync(p)) {
      return JSON.parse(fs.readFileSync(p, 'utf8'));
    }
  } catch {}
  return { promptedOnce: false, screenGranted: false };
}

function writePermissionsState(patch) {
  try {
    const prev = readPermissionsState();
    const next = { ...prev, ...patch };
    fs.mkdirSync(path.dirname(getPermissionsStatePath()), { recursive: true });
    fs.writeFileSync(getPermissionsStatePath(), JSON.stringify(next, null, 2));
    return next;
  } catch {
    return { promptedOnce: true };
  }
}

function getPermissionsStatus() {
  const isMac = process.platform === 'darwin';
  const appPath = getAppBundlePath();
  if (!isMac) {
    return {
      platform: process.platform,
      accessibility: true,
      screen: 'granted',
      microphone: 'granted',
      camera: 'granted',
      appPath,
      inApplications: true,
    };
  }
  const saved = readPermissionsState();
  const sysScreen = systemPreferences.getMediaAccessStatus('screen');
  return {
    platform: 'darwin',
    accessibility: systemPreferences.isTrustedAccessibilityClient(false),
    screen: sysScreen === 'granted' || saved.screenGranted ? 'granted' : sysScreen,
    microphone: systemPreferences.getMediaAccessStatus('microphone'),
    camera: systemPreferences.getMediaAccessStatus('camera'),
    appPath,
    inApplications: appPath.startsWith('/Applications/'),
  };
}

function pokeAutomationPermission() {
  return new Promise((resolve) => {
    try {
      const child = spawn('osascript', ['-e', 'tell application "System Events" to count processes'], {
        stdio: 'ignore',
      });
      const timer = setTimeout(() => {
        try { child.kill(); } catch {}
        resolve();
      }, 2500);
      child.on('close', () => {
        clearTimeout(timer);
        resolve();
      });
      child.on('error', () => {
        clearTimeout(timer);
        resolve();
      });
    } catch {
      resolve();
    }
  });
}

async function requestAllPermissions() {
  if (process.platform !== 'darwin') {
    return getPermissionsStatus();
  }

  // 1. Accessibility (registers AIRA AI Assistant.app in Privacy & Security -> Accessibility and pops prompt)
  try {
    if (!systemPreferences.isTrustedAccessibilityClient(false)) {
      systemPreferences.isTrustedAccessibilityClient(true);
    }
  } catch {}

  // 2. Microphone & Camera
  try {
    if (systemPreferences.getMediaAccessStatus('microphone') !== 'granted') {
      await systemPreferences.askForMediaAccess('microphone');
    }
  } catch {}
  try {
    if (systemPreferences.getMediaAccessStatus('camera') !== 'granted') {
      await systemPreferences.askForMediaAccess('camera');
    }
  } catch {}

  // 3. Screen Recording (registers AIRA AI Assistant.app in Screen & System Audio Recording)
  let screenGranted = systemPreferences.getMediaAccessStatus('screen') === 'granted';
  try {
    if (!screenGranted) {
      const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 1, height: 1 } });
      if (Array.isArray(sources) && sources.length > 0) {
        screenGranted = true;
      }
    }
  } catch {}

  // 4. Automation (System Events)
  await pokeAutomationPermission();

  writePermissionsState({ promptedOnce: true, screenGranted });
  return getPermissionsStatus();
}

function isPortOpen(port) {
  return new Promise((resolve) => {
    const tester = net
      .createServer()
      .once('error', () => resolve(false))
      .once('listening', () => {
        tester.close(() => resolve(true));
      })
      .listen(port, '127.0.0.1');
  });
}

async function ensureBackendRunning() {
  if (serverStarted) return activePort;

  // Always start our own backend so it shares this launch's session token.
  const port3000Free = await isPortOpen(3000);
  activePort = port3000Free ? 3000 : 3456;

  const appRoot = app.isPackaged ? process.resourcesPath : path.resolve(__dirname, '..');
  const distServer = app.isPackaged
    ? path.join(app.getAppPath(), 'dist', 'server.cjs')
    : path.resolve(__dirname, '..', 'dist', 'server.cjs');

  process.env.NODE_ENV = 'production';
  process.env.PORT = String(activePort);
  process.env.AIRA_APP_ROOT = app.isPackaged ? app.getAppPath() : path.resolve(__dirname, '..');
  process.env.AIRA_DATA_DIR = app.getPath('userData');
  process.env.ULTRON_SESSION_TOKEN = SESSION_TOKEN;
  process.env.ULTRON_QUIET_URL = '1';
  process.env.ULTRON_HOST = '127.0.0.1';

  // Secrets are read only from the per-user data folder, never bundled into the app.
  const envCandidates = app.isPackaged
    ? [path.join(app.getPath('userData'), '.env')]
    : [path.join(appRoot, '.env'), path.join(app.getPath('userData'), '.env')];
  for (const envPath of envCandidates) {
    if (fs.existsSync(envPath)) {
      try {
        require('dotenv').config({ path: envPath });
        break;
      } catch {}
    }
  }

  if (fs.existsSync(distServer)) {
    require(distServer);
    serverStarted = true;
  }

  return activePort;
}

function createWindow(port) {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 720,
    backgroundColor: '#05070a',
    title: 'Ultron',
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      webviewTag: true,
      spellcheck: false,
    },
  });

  mainWindow.loadURL(`http://localhost:${port}/#token=${SESSION_TOKEN}`);

  // Only plain web links leave the app, and they open in the default browser.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isHttpUrl(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!isAppUrl(url)) {
      event.preventDefault();
      if (isHttpUrl(url)) shell.openExternal(url);
    }
  });
  // Embedded <webview> tags (Instagram portal) get no Node, no preload, and only allowlisted sites.
  mainWindow.webContents.on('will-attach-webview', (event, webPreferences, params) => {
    delete webPreferences.preload;
    webPreferences.nodeIntegration = false;
    webPreferences.contextIsolation = true;
    webPreferences.sandbox = true;
    let host = '';
    try {
      host = new URL(params.src).hostname;
    } catch {}
    if (!WEB_WINDOW_HOSTS.has(host) || !String(params.partition || '').startsWith('persist:')) {
      event.preventDefault();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function registerDesktopIpc() {
  ipcMain.handle('aira:open-external', async (event, url) => {
    if (!fromApp(event)) return { ok: false, error: 'Forbidden' };
    if (typeof url === 'string' && isHttpUrl(url)) {
      await shell.openExternal(url);
      return { ok: true };
    }
    return { ok: false, error: 'Invalid URL' };
  });

  ipcMain.handle('aira:open-web-window', async (event, opts) => {
    if (!fromApp(event)) return { ok: false, error: 'Forbidden' };
    const { url, title, partition } = opts || {};
    if (!url || typeof url !== 'string' || !isHttpUrl(url)) return { ok: false, error: 'Invalid URL' };
    if (!WEB_WINDOW_HOSTS.has(new URL(url).hostname)) {
      await shell.openExternal(url);
      return { ok: true, external: true };
    }
    if (partition && !/^persist:[a-z0-9-]{1,40}$/.test(String(partition))) return { ok: false, error: 'Invalid partition' };
    const win = new BrowserWindow({
      width: 1120,
      height: 760,
      backgroundColor: '#0b141a',
      title: String(title || 'Ultron Portal').slice(0, 80),
      webPreferences: {
        partition: partition || 'persist:ultron-web',
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    win.webContents.setWindowOpenHandler(({ url: next }) => {
      if (isHttpUrl(next)) shell.openExternal(next);
      return { action: 'deny' };
    });
    win.loadURL(url, {
      userAgent:
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    });
    return { ok: true };
  });

  ipcMain.handle('aira:get-permissions', async (event) => {
    if (!fromApp(event)) return { ok: false, error: 'Forbidden' };
    return getPermissionsStatus();
  });

  ipcMain.handle('aira:request-permissions', async (event) => {
    if (!fromApp(event)) return { ok: false, error: 'Forbidden' };
    return await requestAllPermissions();
  });

  ipcMain.handle('aira:open-privacy-pane', async (event, pane) => {
    if (!fromApp(event)) return { ok: false, error: 'Forbidden' };
    if (process.platform !== 'darwin') return { ok: false };
    const paneMap = {
      accessibility: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility',
      screen: 'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture',
      microphone: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone',
      camera: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Camera',
      automation: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Automation',
    };
    const target = paneMap[pane] || paneMap.accessibility;
    await shell.openExternal(target);
    return { ok: true };
  });

  ipcMain.handle('aira:reveal-app', async (event) => {
    if (!fromApp(event)) return { ok: false, error: 'Forbidden' };
    const bundlePath = getAppBundlePath();
    shell.showItemInFolder(bundlePath);
    return { ok: true, path: bundlePath };
  });

  ipcMain.handle('aira:install-to-applications', async (event) => {
    if (!fromApp(event)) return { ok: false, error: 'Forbidden' };
    if (process.platform !== 'darwin' || !app.isPackaged) {
      return { ok: false, error: 'Packaged macOS app required' };
    }
    const src = getAppBundlePath();
    const dest = `/Applications/${path.basename(src)}`;
    if (src === dest) {
      shell.showItemInFolder(dest);
      return { ok: true, path: dest };
    }
    // No shell: copy with fs so paths can never be interpreted as commands.
    try {
      await fs.promises.rm(dest, { recursive: true, force: true });
      await fs.promises.cp(src, dest, { recursive: true, verbatimSymlinks: true });
      shell.showItemInFolder(dest);
      return { ok: true, path: dest };
    } catch {
      return { ok: false, error: 'Failed copying app to /Applications' };
    }
  });

  // Routed through the backend so the same policy and audit log apply.
  ipcMain.handle('aira:open-app', async (event, target) => {
    if (!fromApp(event)) return { ok: false, error: 'Forbidden' };
    try {
      const res = await fetch(`${appOrigin()}/api/system/action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Ultron-Token': SESSION_TOKEN },
        body: JSON.stringify({ action: 'open_app', target: String(target || '').slice(0, 300) }),
      });
      return await res.json();
    } catch {
      return { ok: false, error: 'Backend unreachable' };
    }
  });
}

app.whenReady().then(async () => {
  // Auto-grant mic & camera permissions inside AIRA desktop app
  // Camera, mic and notifications only for the Ultron window itself, never for loaded websites.
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
    const requester = details?.requestingUrl || webContents.getURL();
    const allowed = ['media', 'audioCapture', 'videoCapture', 'notifications'].includes(permission);
    callback(allowed && isAppUrl(requester));
  });
  session.defaultSession.setPermissionCheckHandler((_wc, permission, requestingOrigin) => {
    return ['media', 'notifications'].includes(permission) && requestingOrigin === appOrigin();
  });

  registerDesktopIpc();
  const port = await ensureBackendRunning();
  setTimeout(() => {
    createWindow(port);
    // Only auto-prompt macOS permissions ONCE on true first launch so it never nags repeatedly
    setTimeout(() => {
      const saved = readPermissionsState();
      if (saved.promptedOnce) return;
      const status = getPermissionsStatus();
      const missing =
        !status.accessibility ||
        status.screen !== 'granted' ||
        status.microphone !== 'granted' ||
        status.camera !== 'granted';
      if (missing) {
        void requestAllPermissions();
      } else {
        writePermissionsState({ promptedOnce: true });
      }
    }, 1500);
  }, 500);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow(activePort);
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
