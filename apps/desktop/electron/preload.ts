import { contextBridge, ipcRenderer } from 'electron';

import type { VaultEntryKind } from './types';

// Phase 1 : pont contextIsolation-safe (pas de nodeIntegration) vers le
// vault local — la logique fichier réelle vit dans vault.js (accès fs
// natif dans le process principal), exposée ici via IPC.
contextBridge.exposeInMainWorld('electronBridge', {
  platform: process.platform,
});

contextBridge.exposeInMainWorld('vault', {
  chooseFolder: () => ipcRenderer.invoke('vault:choose-folder'),
  getCurrentPath: () => ipcRenderer.invoke('vault:get-current-path'),
  listTree: () => ipcRenderer.invoke('vault:list-tree'),
  readNote: (relPath: string) => ipcRenderer.invoke('vault:read-note', relPath),
  writeNote: (relPath: string, content: string) => ipcRenderer.invoke('vault:write-note', relPath, content),
  createNote: (name: string, parentRelPath?: string, kind?: VaultEntryKind) =>
    ipcRenderer.invoke('vault:create-note', name, parentRelPath, kind),
  createFolder: (name: string, parentRelPath?: string) =>
    ipcRenderer.invoke('vault:create-folder', name, parentRelPath),
  rename: (relPath: string, newName: string) => ipcRenderer.invoke('vault:rename', relPath, newName),
  move: (relPath: string, destinationParentRelPath?: string) =>
    ipcRenderer.invoke('vault:move', relPath, destinationParentRelPath),
  setPath: (relPath: string, newRelPath: string) => ipcRenderer.invoke('vault:set-path', relPath, newRelPath),
  delete: (relPath: string) => ipcRenderer.invoke('vault:delete', relPath),
  getLastOpened: () => ipcRenderer.invoke('vault:get-last-opened'),
  setLastOpened: (relPath: string | null) => ipcRenderer.invoke('vault:set-last-opened', relPath),
  ensureDailyNote: (dateIso: string) => ipcRenderer.invoke('vault:ensure-daily-note', dateIso),
  reorder: (parentRelPath: string | undefined, orderedNames: string[]) =>
    ipcRenderer.invoke('vault:reorder', parentRelPath, orderedNames),
  importAttachment: () => ipcRenderer.invoke('vault:import-attachment'),
  readAttachmentDataUrl: (relPath: string) => ipcRenderer.invoke('vault:read-attachment-data-url', relPath),
  duplicate: (relPath: string) => ipcRenderer.invoke('vault:duplicate', relPath),
  listTags: () => ipcRenderer.invoke('vault:list-tags'),
});

contextBridge.exposeInMainWorld('vaults', {
  list: () => ipcRenderer.invoke('vaults:list'),
  getActive: () => ipcRenderer.invoke('vaults:get-active'),
  addExisting: () => ipcRenderer.invoke('vaults:add-existing'),
  createNew: (name: string) => ipcRenderer.invoke('vaults:create-new', name),
  switch: (id: string) => ipcRenderer.invoke('vaults:switch', id),
  rename: (id: string, name: string) => ipcRenderer.invoke('vaults:rename', id, name),
  remove: (id: string) => ipcRenderer.invoke('vaults:remove', id),
  setCloudLink: (id: string, payload: { linked: boolean; remoteVaultId?: string | null }) =>
    ipcRenderer.invoke('vaults:set-cloud-link', id, payload),
  onChanged: (callback: (vaultList: unknown) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, vaultList: unknown) => callback(vaultList);
    ipcRenderer.on('vaults:changed', handler);
    return () => ipcRenderer.removeListener('vaults:changed', handler);
  },
});

contextBridge.exposeInMainWorld('updater', {
  getVersion: () => ipcRenderer.invoke('updater:get-version'),
  getStatus: () => ipcRenderer.invoke('updater:get-status'),
  check: () => ipcRenderer.invoke('updater:check'),
  quitAndInstall: () => ipcRenderer.invoke('updater:quit-and-install'),
  onStatusChange: (callback: (status: unknown) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, status: unknown) => callback(status);
    ipcRenderer.on('updater:status', handler);
    return () => ipcRenderer.removeListener('updater:status', handler);
  },
});

contextBridge.exposeInMainWorld('preferences', {
  get: () => ipcRenderer.invoke('preferences:get'),
  set: (partial: unknown) => ipcRenderer.invoke('preferences:set', partial),
  reset: () => ipcRenderer.invoke('preferences:reset'),
  getConfigPath: () => ipcRenderer.invoke('preferences:get-config-path'),
  revealConfigFolder: () => ipcRenderer.invoke('preferences:reveal-config-folder'),
});

contextBridge.exposeInMainWorld('contextMenu', {
  show: (items: { id: string; label: string }[]) => ipcRenderer.invoke('context-menu:show', items),
});

contextBridge.exposeInMainWorld('auth', {
  openExternal: (url: string) => ipcRenderer.invoke('auth:open-external', url),
  onCallback: (callback: (url: string) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, url: string) => callback(url);
    ipcRenderer.on('auth:callback', handler);
    return () => ipcRenderer.removeListener('auth:callback', handler);
  },
});

contextBridge.exposeInMainWorld('sync', {
  hashVaultTree: () => ipcRenderer.invoke('sync:hash-vault'),
});

contextBridge.exposeInMainWorld('tasks', {
  list: () => ipcRenderer.invoke('tasks:list'),
  add: (text: string) => ipcRenderer.invoke('tasks:add', text),
  toggle: (id: string) => ipcRenderer.invoke('tasks:toggle', id),
  remove: (id: string) => ipcRenderer.invoke('tasks:remove', id),
  update: (id: string, patch: { text?: string; description?: string }) =>
    ipcRenderer.invoke('tasks:update', id, patch),
  addSubtask: (taskId: string, text: string) => ipcRenderer.invoke('tasks:add-subtask', taskId, text),
  renameSubtask: (taskId: string, subtaskId: string, text: string) =>
    ipcRenderer.invoke('tasks:rename-subtask', taskId, subtaskId, text),
  toggleSubtask: (taskId: string, subtaskId: string) =>
    ipcRenderer.invoke('tasks:toggle-subtask', taskId, subtaskId),
  removeSubtask: (taskId: string, subtaskId: string) =>
    ipcRenderer.invoke('tasks:remove-subtask', taskId, subtaskId),
  addAttachment: (taskId: string, attachment: { relPath: string; name: string }) =>
    ipcRenderer.invoke('tasks:add-attachment', taskId, attachment),
  removeAttachment: (taskId: string, relPath: string) =>
    ipcRenderer.invoke('tasks:remove-attachment', taskId, relPath),
});

contextBridge.exposeInMainWorld('calendar', {
  listEvents: () => ipcRenderer.invoke('calendar:list-events'),
  addEvent: (input: unknown) => ipcRenderer.invoke('calendar:add-event', input),
  updateEvent: (id: string, patch: unknown) => ipcRenderer.invoke('calendar:update-event', id, patch),
  removeEvent: (id: string) => ipcRenderer.invoke('calendar:remove-event', id),
});

contextBridge.exposeInMainWorld('properties', {
  list: () => ipcRenderer.invoke('properties:list'),
  create: (name: string, type: string, options?: string[]) =>
    ipcRenderer.invoke('properties:create', name, type, options),
  update: (id: string, patch: unknown) => ipcRenderer.invoke('properties:update', id, patch),
  remove: (id: string) => ipcRenderer.invoke('properties:remove', id),
});

contextBridge.exposeInMainWorld('occurrences', {
  list: () => ipcRenderer.invoke('occurrences:list'),
  create: (word: string, description?: string) => ipcRenderer.invoke('occurrences:create', word, description),
  update: (id: string, patch: unknown) => ipcRenderer.invoke('occurrences:update', id, patch),
  remove: (id: string) => ipcRenderer.invoke('occurrences:remove', id),
  findNotes: (word: string) => ipcRenderer.invoke('occurrences:find-notes', word),
});

contextBridge.exposeInMainWorld('search', {
  run: (query: string, options?: { propertyId?: string; propertyValue?: string }) =>
    ipcRenderer.invoke('vault:search', query, options),
});

contextBridge.exposeInMainWorld('taskLists', {
  list: () => ipcRenderer.invoke('tasklists:list'),
  getActive: () => ipcRenderer.invoke('tasklists:get-active'),
  create: (name: string) => ipcRenderer.invoke('tasklists:create', name),
  rename: (id: string, name: string) => ipcRenderer.invoke('tasklists:rename', id, name),
  remove: (id: string) => ipcRenderer.invoke('tasklists:remove', id),
  switch: (id: string) => ipcRenderer.invoke('tasklists:switch', id),
  onChanged: (callback: (lists: unknown) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, lists: unknown) => callback(lists);
    ipcRenderer.on('tasklists:changed', handler);
    return () => ipcRenderer.removeListener('tasklists:changed', handler);
  },
});
