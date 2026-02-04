const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("oneko", {
  getDisplayInfo: () => ipcRenderer.invoke("oneko:get-display-info"),
  getSleepTarget: (point) => ipcRenderer.invoke("oneko:get-sleep-target", point),
  getTaskbarRoam: (point) => ipcRenderer.invoke("oneko:get-taskbar-roam", point),
  setPosition: (x, y) => ipcRenderer.send("oneko:set-position", { x, y }),
  updateSettings: (patch) => ipcRenderer.send("oneko:update-settings", patch),
  onCursor: (callback) => ipcRenderer.on("oneko:cursor", (_event, point) => callback(point)),
  onSettings: (callback) => ipcRenderer.on("oneko:settings", (_event, settings) => callback(settings)),
  onVariantChange: (callback) => ipcRenderer.on("oneko:set-variant", (_event, variant) => callback(variant)),
  onModeChange: (callback) => ipcRenderer.on("oneko:set-mode", (_event, mode) => callback(mode)),
  onDisplayChange: (callback) => ipcRenderer.on("oneko:display-info", (_event, info) => callback(info)),
});
