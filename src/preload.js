const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  list: () => ipcRenderer.invoke('accounts:list'),
  add: () => ipcRenderer.invoke('accounts:add'),
  delete: (userId) => ipcRenderer.invoke('accounts:delete', userId),
  reorder: (orderedUserIds) => ipcRenderer.invoke('accounts:reorder', orderedUserIds),
  setNote: (userId, note) => ipcRenderer.invoke('accounts:setNote', userId, note),
  launch: (userId, options) => ipcRenderer.invoke('accounts:launch', userId, options),
  exportAccounts: (passphrase) => ipcRenderer.invoke('accounts:export', passphrase),
  importAccounts: (passphrase) => ipcRenderer.invoke('accounts:import', passphrase),
  loadConfig: () => ipcRenderer.invoke('config:load'),
  saveConfig: (payload) => ipcRenderer.invoke('config:save', payload),
  getPlatform: () => ipcRenderer.invoke('app:getPlatform'),
  checkClientInstalled: () => ipcRenderer.invoke('app:checkClientInstalled'),
  openExternal: (url) => ipcRenderer.invoke('app:openExternal', url),
  getAutoLaunch: () => ipcRenderer.invoke('app:getAutoLaunch'),
  setAutoLaunch: (enabled) => ipcRenderer.invoke('app:setAutoLaunch', enabled),
  getPreference: (key) => ipcRenderer.invoke('app:getPreference', key),
  setPreference: (key, value) => ipcRenderer.invoke('app:setPreference', key, value),
  getVersion: () => ipcRenderer.invoke('app:getVersion'),
  checkForUpdates: () => ipcRenderer.invoke('app:checkForUpdates'),
  getLogPath: () => ipcRenderer.invoke('app:getLogPath'),
  openLogFile: () => ipcRenderer.invoke('app:openLogFile'),
  getBackupInfo: () => ipcRenderer.invoke('backup:getInfo'),
  openBackupsFolder: () => ipcRenderer.invoke('backup:openFolder'),

  onPresenceUpdate: (cb) => ipcRenderer.on('presence:update', (_e, accounts) => cb(accounts)),
});
