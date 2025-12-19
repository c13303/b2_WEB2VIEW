const fs = require("fs");
const path = require("path");
const {
  app,
  BrowserWindow,
  Menu,
  globalShortcut,
  ipcMain,
  shell,
} = require("electron");

const GAME_ORIGIN = "https://blektre.com";
const WRAPPER_FILE = path.join(__dirname, "wrapper.html");
const VERSION_FILE = path.join(__dirname, "version.txt");
const STEAM_APP_ID = 3045400;

let mainWindow = null;
let pageReady = false;
const pendingMessages = [];
let steamClient = null;
let steamAvailable = false;
const storeFilePath = () => path.join(app.getPath("userData"), "store.json");

function readVersionString() {
  try {
    const raw = fs.readFileSync(VERSION_FILE, "utf8").trim();
    return raw || "VERSION2002_HOTFIX333";
  } catch (_) {
    return "VERSION2002_HOTFIX333";
  }
}

// Help Steam overlay injection on Windows.
app.commandLine.appendSwitch(
  "disable-features",
  "RendererCodeIntegrity,CalculateNativeWinOcclusion"
);
app.commandLine.appendSwitch("disable-gpu-sandbox");

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 720,
    backgroundColor: "#000000",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow = win;
  win.setMenuBarVisibility(false);
  const version = readVersionString();
  win.loadFile(WRAPPER_FILE, { query: { version } });

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith(GAME_ORIGIN) || url.startsWith("file://")) {
      return { action: "allow" };
    }
    shell.openExternal(url);
    return { action: "deny" };
  });

  win.webContents.on("will-navigate", (event, url) => {
    if (
      url.startsWith(GAME_ORIGIN) ||
      url.startsWith("file://") ||
      url === "about:blank"
    ) {
      return;
    }
    event.preventDefault();
    shell.openExternal(url);
  });

  win.webContents.on("before-input-event", (event, input) => {
    if (input.type !== "keyDown") return;
    const isF12 = input.key === "F12";
    const isCtrlShiftI = input.control && input.shift && input.key === "I";
    if (isF12 || isCtrlShiftI) {
      event.preventDefault();
      win.webContents.toggleDevTools();
    }
  });

  win.webContents.on("did-finish-load", async () => {
    pageReady = true;
    flushPendingMessages();
    await sendSteamState();
  });
}

function sendToGame(data) {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }
  if (!pageReady) {
    pendingMessages.push(data);
    return;
  }

  const payload = JSON.stringify(data);
  const script = `
    (function() {
      const payload = ${payload};
      const targetOrigin = ${JSON.stringify(GAME_ORIGIN)};
      const frame = document.getElementById("mainframe");
      if (frame && frame.contentWindow) {
        frame.contentWindow.postMessage(payload, targetOrigin);
      } else {
        window.postMessage(payload, targetOrigin);
      }
    })();
  `;
  mainWindow.webContents.executeJavaScript(script, true).catch((err) => {
    console.warn("[web2view] Failed to postMessage:", err);
  });
}

function flushPendingMessages() {
  while (pendingMessages.length) {
    sendToGame(pendingMessages.shift());
  }
}

function loadStore() {
  try {
    const raw = fs.readFileSync(storeFilePath(), "utf8");
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") {
      return parsed;
    }
  } catch (_) {
    // Ignore missing/corrupt store.
  }
  return {};
}

function saveStore(store) {
  try {
    fs.writeFileSync(storeFilePath(), JSON.stringify(store, null, 2), "utf8");
  } catch (err) {
    console.warn("[web2view] Failed to save store:", err);
  }
}

function initSteam() {
  try {
    // Lazy require so the app can still run without Steam installed.
    // eslint-disable-next-line global-require, import/no-extraneous-dependencies
    const steamworks = require("steamworks.js");
    steamClient = steamworks.init(STEAM_APP_ID);
    steamAvailable = !!steamClient;
  } catch (err) {
    steamAvailable = false;
    steamClient = null;
    console.warn("[web2view] Steamworks init failed:", err?.message || err);
  }
}

function getSteamIdObject() {
  if (!steamClient) return null;
  try {
    if (steamClient.localplayer?.getSteamId) {
      return steamClient.localplayer.getSteamId();
    }
    if (steamClient.localPlayer?.getSteamId) {
      return steamClient.localPlayer.getSteamId();
    }
    if (steamClient.getSteamId) {
      return steamClient.getSteamId();
    }
  } catch (err) {
    console.warn("[web2view] Failed to get Steam ID:", err?.message || err);
  }
  return null;
}

function getAccountId(steamIdObj) {
  if (!steamIdObj) return 0;
  return (
    steamIdObj.accountId ||
    steamIdObj.accountID ||
    steamIdObj.accountid ||
    0
  );
}

function isOwnedApp(appId) {
  if (!steamClient) return false;
  try {
    if (steamClient.apps?.isSubscribedApp) {
      return steamClient.apps.isSubscribedApp(appId);
    }
    if (steamClient.app?.isSubscribedApp) {
      return steamClient.app.isSubscribedApp(appId);
    }
    if (steamClient.isSubscribedApp) {
      return steamClient.isSubscribedApp(appId);
    }
  } catch (err) {
    console.warn("[web2view] Ownership check failed:", err?.message || err);
  }
  return false;
}

async function sendSteamState() {
  if (!steamAvailable) {
    sendToGame({ key: "demoversion", value: 1 });
    return;
  }

  const owned = isOwnedApp(STEAM_APP_ID);
  if (!owned) {
    sendToGame({ key: "steamapp", value: "demo" });
    return;
  }

  const steamIdObj = getSteamIdObject();
  const accountId = getAccountId(steamIdObj);
  if (accountId) {
    sendToGame({ key: "steamapp", value: accountId });
  } else {
    sendToGame({ key: "steamapp", value: "demo" });
  }
}

function handleAchievement(name) {
  if (!steamAvailable || !steamClient || !name) return;
  try {
    if (steamClient.userStats?.setAchievement) {
      steamClient.userStats.setAchievement(name);
      steamClient.userStats.storeStats?.();
    } else if (steamClient.achievements?.unlock) {
      steamClient.achievements.unlock(name);
    }
  } catch (err) {
    console.warn("[web2view] Achievement error:", err?.message || err);
  }
}

function handleIncomingMessage(data) {
  if (!data || typeof data !== "object") return;

  const command =
    data.type ||
    data.fn ||
    data.action ||
    data.command ||
    data.key ||
    "";

  const normalized = String(command).toLowerCase();

  if (normalized === "checkownership") {
    sendSteamState();
    return;
  }

  if (normalized === "achievement") {
    const name = data.nom || data.name || data.value || data.data;
    handleAchievement(name);
    return;
  }

  if (normalized === "store" || normalized === "storage") {
    let key = data.key || data.storageKey || data.k;
    let value =
      data.valued !== undefined
        ? data.valued
        : data.value !== undefined
          ? data.value
          : data.v;
    if (Array.isArray(data.data)) {
      [key, value] = data.data;
    }
    if (typeof key === "string") {
      const store = loadStore();
      store[key] = value ?? "";
      saveStore(store);
    }
    return;
  }

  if (normalized === "restore") {
    let key = data.key || data.storageKey || data.k || data.value;
    if (typeof data.data === "string") {
      key = data.data;
    }
    if (typeof key === "string") {
      const store = loadStore();
      const value = store[key] ?? "";
      sendToGame({ key, value });
    }
    return;
  }

  if (normalized === "clearstore") {
    const store = loadStore();
    delete store.user;
    delete store.stay;
    delete store.staytoken;
    saveStore(store);
    return;
  }

  if (
    normalized === "myquit" ||
    normalized === "quit" ||
    normalized === "c3quit"
  ) {
    app.quit();
  }
}

app.whenReady().then(() => {
  initSteam();
  Menu.setApplicationMenu(null);
  ipcMain.on("web2view-message", (_event, data) => {
    handleIncomingMessage(data);
  });
  globalShortcut.register("F12", () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.webContents.toggleDevTools();
  });
  globalShortcut.register("CommandOrControl+Shift+I", () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.webContents.toggleDevTools();
  });
  createWindow();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("will-quit", () => {
  globalShortcut.unregisterAll();
});

app.on("before-quit", () => {
  try {
    steamClient?.shutdown?.();
  } catch (_) {
    // Ignore shutdown errors.
  }
});
