const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('airaDesktop', {
  isElectron: true,
  platform: process.platform,
  openExternal: (url) => ipcRenderer.invoke('aira:open-external', url),
  openApp: (target) => ipcRenderer.invoke('aira:open-app', target),
  openWebWindow: (opts) => ipcRenderer.invoke('aira:open-web-window', opts),
  getPermissionsStatus: () => ipcRenderer.invoke('aira:get-permissions'),
  requestAllPermissions: () => ipcRenderer.invoke('aira:request-permissions'),
  openPrivacyPane: (pane) => ipcRenderer.invoke('aira:open-privacy-pane', pane),
  revealAppInFinder: () => ipcRenderer.invoke('aira:reveal-app'),
  installToApplications: () => ipcRenderer.invoke('aira:install-to-applications'),
});
