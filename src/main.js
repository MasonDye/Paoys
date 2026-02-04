const { app, BrowserWindow, Tray, Menu, ipcMain, screen, nativeImage, shell } = require("electron");
const fs = require("fs");
const path = require("path");

const VARIANTS = [
  { id: "classic", label: "Classic" },
  { id: "dog", label: "Dog" },
  { id: "tora", label: "Tora" },
  { id: "maia", label: "Maia" },
  { id: "vaporwave", label: "Vaporwave" },
];

const SETTINGS_FILE = "oneko-settings.json";
const TASKBAR_EDGE_OFFSET = 13;

let mainWindow = null;
let tray = null;
let settings = null;
let cursorTimer = null;

function getSettingsPath() {
  return path.join(app.getPath("userData"), SETTINGS_FILE);
}

function loadSettings() {
  const defaults = {
    variant: "classic",
    kuroNeko: false,
    mode: "follow",
    autoLaunch: false,
  };

  try {
    const raw = fs.readFileSync(getSettingsPath(), "utf8");
    const parsed = JSON.parse(raw);
    const merged = { ...defaults, ...parsed };
    if (!parsed.mode) {
      if (parsed.forceSleep === true) {
        merged.mode = "sleep";
      } else {
        merged.mode = defaults.mode;
      }
    }
    delete merged.forceSleep;
    return merged;
  } catch (err) {
    return defaults;
  }
}

function saveSettings() {
  try {
    const persisted = { ...settings };
    delete persisted.forceSleep;
    fs.writeFileSync(getSettingsPath(), JSON.stringify(persisted, null, 2));
  } catch (err) {
    // Best effort: ignore write failures so the app can keep running.
  }
}

function getDisplayInfo() {
  const displays = screen.getAllDisplays().map((display) => ({
    id: display.id,
    bounds: display.bounds,
  }));
  const primary = screen.getPrimaryDisplay();
  return {
    displays,
    primaryId: primary.id,
  };
}

function getTaskbarEdge(display) {
  const bounds = display.bounds;
  const workArea = display.workArea;
  const insetLeft = workArea.x - bounds.x;
  const insetTop = workArea.y - bounds.y;
  const insetRight = bounds.width - workArea.width - insetLeft;
  const insetBottom = bounds.height - workArea.height - insetTop;

  let edge = "bottom";
  if (insetBottom > 0) {
    edge = "bottom";
  } else if (insetTop > 0) {
    edge = "top";
  } else if (insetLeft > 0) {
    edge = "left";
  } else if (insetRight > 0) {
    edge = "right";
  }

  return { edge, bounds, workArea };
}

function getTaskbarSleepTarget(display) {
  const { edge, bounds, workArea } = getTaskbarEdge(display);
  let targetX = workArea.x + workArea.width - 16;
  let targetY = workArea.y + workArea.height - TASKBAR_EDGE_OFFSET;

  switch (edge) {
    case "top":
      targetY = workArea.y + TASKBAR_EDGE_OFFSET;
      break;
    case "left":
      targetX = workArea.x + TASKBAR_EDGE_OFFSET;
      targetY = workArea.y + workArea.height - TASKBAR_EDGE_OFFSET;
      break;
    case "right":
      targetX = workArea.x + workArea.width - TASKBAR_EDGE_OFFSET;
      targetY = workArea.y + workArea.height - TASKBAR_EDGE_OFFSET;
      break;
    case "bottom":
    default:
      targetY = workArea.y + workArea.height - TASKBAR_EDGE_OFFSET;
      break;
  }

  const minX = bounds.x + 16;
  const maxX = bounds.x + bounds.width - 16;
  const minY = bounds.y + 16;
  const maxY = bounds.y + bounds.height - 16;

  return {
    x: Math.min(Math.max(targetX, minX), maxX),
    y: Math.min(Math.max(targetY, minY), maxY),
  };
}

function getTaskbarRoamInfo(display) {
  const { edge, workArea } = getTaskbarEdge(display);

  if (edge === "left" || edge === "right") {
    const fixed = edge === "left" ? workArea.x + TASKBAR_EDGE_OFFSET : workArea.x + workArea.width - TASKBAR_EDGE_OFFSET;
    return {
      edge,
      axis: "y",
      min: workArea.y + 16,
      max: workArea.y + workArea.height - 16,
      fixed,
    };
  }

  const fixed = edge === "top" ? workArea.y + TASKBAR_EDGE_OFFSET : workArea.y + workArea.height - TASKBAR_EDGE_OFFSET;
  return {
    edge,
    axis: "x",
    min: workArea.x + 16,
    max: workArea.x + workArea.width - 16,
    fixed,
  };
}

function createTrayIcon() {
  const iconPath = path.join(__dirname, "..", "assets", "tray.png");
  let image = nativeImage.createFromPath(iconPath);
  if (image.isEmpty()) {
    image = nativeImage.createEmpty();
  }
  tray = new Tray(image);
  tray.setToolTip("Paoys");
  rebuildTrayMenu();
}

function rebuildTrayMenu() {
  if (!tray) return;

  const modeItems = [
    {
      label: "Follow Mouse",
      type: "radio",
      checked: settings.mode === "follow",
      click: () => {
        settings.mode = "follow";
        saveSettings();
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send("oneko:set-mode", settings.mode);
        }
        rebuildTrayMenu();
      },
    },
    {
      label: "Sleep",
      type: "radio",
      checked: settings.mode === "sleep",
      click: () => {
        settings.mode = "sleep";
        saveSettings();
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send("oneko:set-mode", settings.mode);
        }
        rebuildTrayMenu();
      },
    },
    {
      label: "Taskbar Roam",
      type: "radio",
      checked: settings.mode === "taskbar",
      click: () => {
        settings.mode = "taskbar";
        saveSettings();
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send("oneko:set-mode", settings.mode);
        }
        rebuildTrayMenu();
      },
    },
  ];

  const variantItems = VARIANTS.map((variant) => ({
    label: variant.label,
    type: "radio",
    checked: settings.variant === variant.id,
    click: () => {
      settings.variant = variant.id;
      saveSettings();
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("oneko:set-variant", variant.id);
      }
      rebuildTrayMenu();
    },
  }));

  const menu = Menu.buildFromTemplate([
    { label: "Mode", submenu: modeItems },
    {
      label: "Start at login",
      type: "checkbox",
      checked: settings.autoLaunch === true,
      click: (item) => {
        setAutoLaunch(Boolean(item.checked));
      },
    },
    { type: "separator" },
    ...variantItems,
    { type: "separator" },
    {
      label: "GitHub",
      click: () => {
        shell.openExternal("https://github.com/MasonDye/Paoys");
      },
    },
    { type: "separator" },
    {
      label: "Quit",
      click: () => app.quit(),
    },
  ]);

  tray.setContextMenu(menu);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 32,
    height: 32,
    frame: false,
    transparent: true,
    resizable: false,
    hasShadow: false,
    show: true,
    skipTaskbar: true,
    alwaysOnTop: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, "preload.js"),
    },
  });

  mainWindow.setMenuBarVisibility(false);
  mainWindow.setAlwaysOnTop(true, "screen-saver", 1);
  mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  mainWindow.loadFile(path.join(__dirname, "renderer", "index.html"));

  mainWindow.webContents.on("did-finish-load", () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.webContents.send("oneko:settings", settings);
    mainWindow.webContents.send("oneko:display-info", getDisplayInfo());
  });

  mainWindow.on("show", () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.setAlwaysOnTop(true, "screen-saver", 1);
  });

  mainWindow.on("blur", () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.setAlwaysOnTop(true, "screen-saver", 1);
  });
}

function setAutoLaunch(enabled) {
  app.setLoginItemSettings({
    openAtLogin: enabled,
    path: process.execPath,
  });
  settings.autoLaunch = enabled;
  saveSettings();
  rebuildTrayMenu();
}

function startCursorLoop() {
  if (cursorTimer) return;
  cursorTimer = setInterval(() => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    const point = screen.getCursorScreenPoint();
    mainWindow.webContents.send("oneko:cursor", point);
  }, 100);
}

app.whenReady().then(() => {
  settings = loadSettings();
  const loginSettings = app.getLoginItemSettings();
  if (typeof loginSettings.openAtLogin === "boolean") {
    settings.autoLaunch = loginSettings.openAtLogin;
  }
  createWindow();
  createTrayIcon();
  startCursorLoop();

  screen.on("display-metrics-changed", () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("oneko:display-info", getDisplayInfo());
    }
  });

  screen.on("display-added", () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("oneko:display-info", getDisplayInfo());
    }
  });

  screen.on("display-removed", () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("oneko:display-info", getDisplayInfo());
    }
  });
});

ipcMain.on("oneko:set-position", (_event, position) => {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const x = Math.round(position.x - 16);
  const y = Math.round(position.y - 16);
  mainWindow.setPosition(x, y, false);
});

ipcMain.on("oneko:update-settings", (_event, patch) => {
  if (patch && Object.prototype.hasOwnProperty.call(patch, "forceSleep")) {
    if (patch.forceSleep) {
      patch.mode = "sleep";
    } else if (settings.mode === "sleep") {
      patch.mode = "follow";
    }
    delete patch.forceSleep;
  }
  if (patch && Object.prototype.hasOwnProperty.call(patch, "autoLaunch")) {
    setAutoLaunch(Boolean(patch.autoLaunch));
    delete patch.autoLaunch;
  }
  settings = { ...settings, ...patch };
  saveSettings();
  rebuildTrayMenu();
});

ipcMain.handle("oneko:get-display-info", () => getDisplayInfo());

ipcMain.handle("oneko:get-sleep-target", (_event, point) => {
  const targetPoint = point && typeof point.x === "number" && typeof point.y === "number" ? point : screen.getCursorScreenPoint();
  const display = screen.getDisplayNearestPoint(targetPoint);
  return getTaskbarSleepTarget(display);
});

ipcMain.handle("oneko:get-taskbar-roam", (_event, point) => {
  const targetPoint = point && typeof point.x === "number" && typeof point.y === "number" ? point : screen.getCursorScreenPoint();
  const display = screen.getDisplayNearestPoint(targetPoint);
  return getTaskbarRoamInfo(display);
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});


